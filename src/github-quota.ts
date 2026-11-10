import { Octokit } from "@octokit/rest";
import { log } from "./log.js";
import type { Store } from "./state/store.js";

/**
 * The factory's share of the account's GitHub quota. Every daemon pass talks to
 * GitHub through a metered client: requests are counted per pass, repeated GETs
 * are conditional (a 304 spends no quota) and, past a limit response or into the
 * reserve, nothing is sent until GitHub renews the quota. `src/tracker.ts` and
 * the CLI stay outside on purpose: delivering a finished job may use the reserve.
 */

/** Share of the quota left for everything else on the account. */
export const RESERVE_SHARE = 0.2;
/** `zero status` starts telling about the quota at this share. */
export const WARN_SHARE = 0.4;
/** The pause when a limit response does not say how long. */
export const DEFAULT_WAIT_MS = 60_000;
export const CACHE_ENTRIES = 500;

export const QUOTA_KEY = "github:quota";
export const HALT_KEY = "github:halt";
export const USAGE_KEY = "github:usage";

export type GithubPass = "merges" | "reverts" | "issues" | "proposals" | "research" | "scout" | "alerts";

export interface GithubQuota {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface GithubHaltState {
  until: string;
  why: string;
}

export interface PassCounts {
  /** Answered with anything but 304: these spend quota. */
  requests: number;
  notModified: number;
}

export interface GithubUsage {
  /** The UTC hour these counts belong to. */
  hour: string;
  passes: Partial<Record<GithubPass, PassCounts>>;
}

/** A request zero itself held back, because of a pause or the reserve. */
export class GithubHalted extends Error {
  constructor(readonly until: string) {
    super(`GitHub en pausa hasta ${until}`);
    this.name = "GithubHalted";
  }
}

function readKv<T>(store: Store, key: string): T | undefined {
  const raw = store.getKv(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const hourOf = (at: Date) => at.toISOString().slice(0, 13);
const stillValid = (iso: string, now: Date) => Date.parse(iso) > now.getTime();

/** The pause in force, from a limit response or from the reserve; the later of the two. */
export function githubHalt(store: Store, now: Date = new Date()): GithubHaltState | undefined {
  const saved = readKv<GithubHaltState>(store, HALT_KEY);
  const quota = readKv<GithubQuota>(store, QUOTA_KEY);
  const halts: GithubHaltState[] = [];
  if (saved && stillValid(saved.until, now)) halts.push(saved);
  if (quota && stillValid(quota.resetAt, now) && quota.remaining <= quota.limit * RESERVE_SHARE) halts.push({ until: quota.resetAt, why: `quedan ${quota.remaining} de ${quota.limit} pedidos: el resto es la reserva` });
  return halts.sort((a, b) => Date.parse(b.until) - Date.parse(a.until))[0];
}

type Headers = Record<string, string | number | undefined>;
interface ErrorShape {
  status?: number;
  message?: string;
  response?: { headers?: Headers };
}

/** GitHub saying "too many requests", as opposed to a 403 for lack of permission. */
export function isRateLimit(err: unknown): boolean {
  const { status, message, response } = (err ?? {}) as ErrorShape;
  if (status === 429) return true;
  if (status !== 403) return false;
  const headers = response?.headers ?? {};
  return Number(headers["x-ratelimit-remaining"] ?? NaN) === 0 || headers["retry-after"] !== undefined || /rate limit|abuse detection/i.test(message ?? "");
}

/** `retry-after` comes as seconds or, by the HTTP standard, as a date. */
function retryAfter(value: string | number | undefined, now: Date): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  const at = Number.isFinite(seconds) ? now.getTime() + seconds * 1000 : Date.parse(String(value));
  return Number.isNaN(at) ? undefined : at;
}

/** The latest moment the response names; a limit response naming none, or only past ones, still waits a little. */
function limitEnd(headers: Headers, now: Date): number {
  const reset = Number(headers["x-ratelimit-reset"] ?? NaN);
  const times = [Number.isFinite(reset) ? reset * 1000 : undefined, retryAfter(headers["retry-after"], now)].filter((t): t is number => t !== undefined);
  const latest = Math.max(0, ...times);
  return latest > now.getTime() ? latest : now.getTime() + DEFAULT_WAIT_MS;
}

/** Only the `core` quota is the one the factory spends; other resources have their own numbers. */
function saveQuota(store: Store, headers: Headers) {
  const resource = headers["x-ratelimit-resource"];
  if (resource && resource !== "core") return;
  const limit = Number(headers["x-ratelimit-limit"] ?? NaN);
  const remaining = Number(headers["x-ratelimit-remaining"] ?? NaN);
  const reset = Number(headers["x-ratelimit-reset"] ?? NaN);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset) || limit <= 0) return;
  store.setKv(QUOTA_KEY, JSON.stringify({ limit, remaining, resetAt: new Date(reset * 1000).toISOString() } satisfies GithubQuota));
}

function saveHalt(store: Store, status: number | undefined, headers: Headers, now: Date) {
  const saved = readKv<GithubHaltState>(store, HALT_KEY);
  const end = Math.max(limitEnd(headers, now), saved && stillValid(saved.until, now) ? Date.parse(saved.until) : 0);
  store.setKv(HALT_KEY, JSON.stringify({ until: new Date(end).toISOString(), why: `GitHub respondió ${status} por límite` } satisfies GithubHaltState));
}

const QUIET = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

interface Cached {
  etag: string;
  response: unknown;
}

export interface GithubMeter {
  /** An Octokit whose requests count for `pass`. */
  client(token: string, pass: GithubPass): Octokit;
  /** Closes a pass's run: one log line with what it sent, when it sent anything. */
  endRun(pass: GithubPass): void;
}

/** One per daemon: the ETags live in its memory, the counts and the pause in the store. */
export function githubMeter(store: Store, now: () => Date = () => new Date()): GithubMeter {
  const cache = new Map<string, Cached>();
  const runs = new Map<GithubPass, PassCounts>();

  const count = (pass: GithubPass, kind: keyof PassCounts) => {
    const run = runs.get(pass) ?? { requests: 0, notModified: 0 };
    run[kind]++;
    runs.set(pass, run);
    const hour = hourOf(now());
    const usage = readKv<GithubUsage>(store, USAGE_KEY);
    const passes = usage?.hour === hour ? usage.passes : {};
    const mine = passes[pass] ?? { requests: 0, notModified: 0 };
    store.setKv(USAGE_KEY, JSON.stringify({ hour, passes: { ...passes, [pass]: { ...mine, [kind]: mine[kind] + 1 } } } satisfies GithubUsage));
  };

  // The newest entries go last in a Map, so the first one is always the oldest.
  const remember = (key: string, entry: Cached) => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  };

  return {
    client(token, pass) {
      const gh = new Octokit({ auth: token, log: QUIET });
      gh.hook.wrap("request", async (request, options) => {
        const halt = githubHalt(store, now());
        if (halt) throw new GithubHalted(halt.until);
        const { method, url, headers } = gh.request.endpoint.parse(options);
        const isGet = method === "GET";
        const key = `${url} ${String(headers.accept ?? "")}`;
        const cached = isGet ? cache.get(key) : undefined;
        // On the same object: the hooks inside this one were bound to it, so options passed to `request` would not reach them.
        if (cached) options.headers = { ...options.headers, "if-none-match": cached.etag };
        let response: Awaited<ReturnType<typeof request>>;
        try {
          response = await request(options);
        } catch (err) {
          const answer = err as ErrorShape;
          // No response: the request never reached GitHub's counters.
          if (!answer.response) throw err;
          const received = answer.response.headers ?? {};
          saveQuota(store, received);
          if (answer.status === 304 && cached) {
            count(pass, "notModified");
            remember(key, cached);
            // A copy: paginate modifies what it receives.
            return structuredClone(cached.response) as typeof response;
          }
          count(pass, "requests");
          if (isRateLimit(err)) saveHalt(store, answer.status, received, now());
          throw err;
        }
        saveQuota(store, response.headers as Headers);
        count(pass, "requests");
        if (isGet) {
          const etag = response.headers.etag;
          if (etag) remember(key, { etag, response: structuredClone(response) });
          else cache.delete(key);
        }
        return response;
      });
      return gh;
    },
    endRun(pass) {
      const run = runs.get(pass);
      if (!run) return;
      runs.delete(pass);
      log.info("github requests of a pass", { pass, requests: run.requests, notModified: run.notModified });
    },
  };
}

export interface GithubStatus {
  limit?: number;
  remaining?: number;
  resetAt?: string;
  haltedUntil?: string;
  /** This hour's counts per pass. */
  passes: GithubUsage["passes"];
}

/** What `zero status` tells about GitHub: only a pause in force or a valid quota at the warning share or below. */
export function githubStatus(store: Store, now: Date = new Date()): GithubStatus | undefined {
  const saved = readKv<GithubQuota>(store, QUOTA_KEY);
  const quota = saved && stillValid(saved.resetAt, now) ? saved : undefined;
  const halt = githubHalt(store, now);
  if (!halt && !(quota && quota.remaining <= quota.limit * WARN_SHARE)) return undefined;
  const usage = readKv<GithubUsage>(store, USAGE_KEY);
  return { ...quota, ...(halt && { haltedUntil: halt.until }), passes: usage?.hour === hourOf(now) ? usage.passes : {} };
}
