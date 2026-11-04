import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AgentRunner } from "../agent.js";
import { ANDON_KEY, type FactoryContext } from "../app.js";
import { budgetState, pickAgentEngine } from "../budget.js";
import type { PackageStation } from "../config.js";
import { log } from "../log.js";
import { warnOnce } from "../packages.js";
import { REDACTED } from "../secrets.js";
import { publicText } from "../social/filter.js";
import type { Job } from "../state/store.js";
import { PACKAGE_AGENT_PREFIX, periodStart, scoutSpent } from "./scout.js";

const CHARS_PER_TEXT = 600;

/** What a station's agent call gives back. */
export interface StationAgentRun<T> {
  ok: boolean;
  text: string;
  output?: T;
  costUsd: number;
}

export interface DeliveredJob {
  line: string;
  title: string;
  summary: string;
  /** When it was delivered, ISO 8601. */
  at: string;
}

/** All a station receives from the factory: interface 1 of the package format. */
export interface StationContext {
  package: string;
  station: string;
  now: Date;
  /** Aborted when the pass runs out of time or the factory shuts down. */
  signal: AbortSignal;
  /** The entry's `config`, through the module's `parseConfig` if it exports one. */
  config: unknown;
  /** Only the names the station declared in its manifest. */
  secrets: { get(name: string): string | undefined };
  /** A read-only agent, in an empty folder, with the station's instructions and skills. */
  runAgent<T = unknown>(req: { prompt: string; schema?: z.ZodType<T> }): Promise<StationAgentRun<T>>;
  /** zero's own zod, for `runAgent` schemas. */
  z: typeof z;
  log: { info(message: string, fields?: Record<string, unknown>): void; warn(message: string, fields?: Record<string, unknown>): void };
  /** Line names only. */
  lines: string[];
  /** Kept between passes, in keys of this station alone; any value JSON can hold. */
  state: { get<T = unknown>(name: string): T | undefined; set(name: string, value: unknown): void };
  /** No job ids, branches or local paths. */
  deliveredJobs(since: Date): DeliveredJob[];
}

interface StationModule {
  pass?: unknown;
  parseConfig?: unknown;
}

const stationKey = (station: Pick<PackageStation, "package" | "name">) => `${PACKAGE_AGENT_PREFIX}${station.package}/${station.name}`;

/** Where the time of a station's last pass is kept. */
export const stationLastKey = (pkg: string, name: string) => `${stationKey({ package: pkg, name })}:last`;

/** Text out of a station without the values of what it declared. */
function withoutSecrets(text: string, ctx: FactoryContext, station: PackageStation): string {
  return station.secrets.reduce((out, name) => {
    const value = ctx.secrets.get(name);
    return value ? out.replaceAll(value, REDACTED) : out;
  }, text);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A job's text as a station may read it: no secret, path or id. */
function jobText(text: string, job: Job, repos: string[]): string {
  let out = publicText(text, repos).text;
  for (const branch of [job.branch, job.delivery?.branch]) if (branch) out = out.replaceAll(branch, "");
  out = out.replaceAll(job.id, "");
  return out.replace(/\bzero[/-][0-9a-f]{8}\b/g, "").replace(/\b[0-9a-f]{8}\b/g, "").replace(/[ \t]{2,}/g, " ").trim().slice(0, CHARS_PER_TEXT);
}

/** What was delivered since then. Jobs born from business material stay out: a third party's code may publish what it reads. */
function deliveredJobs(ctx: FactoryContext, since: Date): DeliveredJob[] {
  const repos = ctx.config.lines.map((l) => l.repo);
  const fromBusiness = (job: Job) => {
    const source = job.source;
    if (source?.kind === "night-shift") return ctx.store.getProposal(source.proposal)?.business ?? false;
    if (source?.kind === "research") return ctx.store.getResearchNote(source.note)?.business ?? false;
    return false;
  };
  return ctx.store
    .finishedSince(since)
    .filter((j) => j.status === "delivered" && !fromBusiness(j))
    .map((j) => {
      const summary = (j.spec as { summary?: unknown } | undefined)?.summary;
      return {
        line: j.line,
        title: jobText(j.title ?? j.request.split("\n")[0]!, j, repos),
        summary: typeof summary === "string" ? jobText(summary, j, repos) : "",
        at: j.finishedAt!,
      };
    });
}

/** `ctx.runAgent`: read-only and recorded under the station's name; without an engine or night cap left, the engine is never called. */
function stationAgent(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, now: Date, signal: AbortSignal): StationContext["runAgent"] {
  const key = stationKey(station);
  return async <T>(req: { prompt: string; schema?: z.ZodType<T> }): Promise<StationAgentRun<T>> => {
    const refused = (text: string): StationAgentRun<T> => ({ ok: false, text, costUsd: 0 });
    if (signal.aborted) return refused("la pasada ya terminó");
    if (ctx.store.getKv(ANDON_KEY) === "on") return refused("la fábrica está detenida");
    if (!station.instructions) return refused("la estación no declara instrucciones en su manifiesto");
    const own = { engine: station.entry.engine, model: station.entry.model };
    const choice = pickAgentEngine(ctx.store, ctx.config, own, now);
    if (!choice.available) return refused("no hay ningún motor disponible");
    let maxBudgetUsd: number | undefined;
    if (choice.billing !== "subscription") {
      const left = ctx.config.limits.usdPerNight - scoutSpent(ctx.store, periodStart(ctx.config.nightShift, now));
      if (left <= 0) return refused("ya se gastó el tope de limits.usdPerNight");
      maxBudgetUsd = Math.round(left * 1e6) / 1e6;
    }
    // No repository and nothing left from another call: what the agent knows is what the station wrote in the prompt.
    const parent = join(ctx.home.jobs, "package-stations", station.package, station.name);
    await mkdir(parent, { recursive: true });
    const cwd = await mkdtemp(join(parent, "run-"));
    try {
      const run = await runAgent<T>({
        station: "scout",
        prompt: req.prompt,
        cwd,
        schema: req.schema,
        engine: { name: choice.engine, model: choice.model, replaces: choice.replaces, reason: choice.reason },
        maxBudgetUsd,
        signal,
        trace: { tracer: ctx.tracer },
        custom: { name: key, instructions: await readFile(station.instructions, "utf8"), access: "read", ...own, maxTurns: station.maxTurns, timeoutMinutes: station.timeoutMinutes, skills: station.skills },
      });
      if (!run.ok) return { ok: false, text: run.text, costUsd: run.costUsd };
      if (!req.schema) return { ok: true, text: run.text, output: run.output, costUsd: run.costUsd };
      // Checked here as well: the guarantee is zero's, whatever the engine validated.
      const parsed = req.schema.safeParse(run.output);
      return parsed.success ? { ok: true, text: run.text, output: parsed.data, costUsd: run.costUsd } : { ok: false, text: `invalid structured output: ${parsed.error.message}`, costUsd: run.costUsd };
    } catch (err) {
      return refused(withoutSecrets(errorText(err), ctx, station));
    } finally {
      await rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  };
}

function stationContext(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, config: unknown, now: Date, signal: AbortSignal): StationContext {
  const key = stationKey(station);
  const stateKey = (name: string) => `${key}:state:${name}`;
  const clean = (fields?: Record<string, unknown>) => (fields ? (JSON.parse(JSON.stringify(fields, (_k, v: unknown) => (typeof v === "string" ? withoutSecrets(v, ctx, station) : v))) as Record<string, unknown>) : undefined);
  return {
    package: station.package,
    station: station.name,
    now,
    signal,
    config,
    secrets: { get: (name) => (station.secrets.includes(name) ? ctx.secrets.get(name) : undefined) },
    runAgent: stationAgent(ctx, runAgent, station, now, signal),
    z,
    log: {
      info: (message, fields) => log.info(`${key}: ${withoutSecrets(message, ctx, station)}`, clean(fields)),
      warn: (message, fields) => log.warn(`${key}: ${withoutSecrets(message, ctx, station)}`, clean(fields)),
    },
    lines: ctx.config.lines.map((l) => l.name),
    state: {
      get: <T>(name: string) => {
        const raw = ctx.store.getKv(stateKey(name));
        return raw === undefined ? undefined : (JSON.parse(raw) as T);
      },
      set: (name, value) => ctx.store.setKv(stateKey(name), JSON.stringify(value)),
    },
    deliveredJobs: (since) => deliveredJobs(ctx, since),
  };
}

/** One station's turn; it never throws, and an end by time leaves its signal aborted and the pass behind. */
async function runStation(ctx: FactoryContext, runAgent: AgentRunner, station: PackageStation, now: Date, outer?: AbortSignal): Promise<void> {
  const key = stationKey(station);
  const lastKey = stationLastKey(station.package, station.name);
  const last = ctx.store.getKv(lastKey);
  if (last && now.getTime() - Date.parse(last) < station.everyMinutes * 60_000) return;
  const missing = station.secrets.filter((s) => !ctx.secrets.has(s));
  if (missing.length) {
    warnOnce(`${key}: no corre porque faltan los secretos ${missing.join(", ")}`);
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  const work = (async () => {
    let mod: StationModule;
    try {
      mod = (await import(/* @vite-ignore */ pathToFileURL(station.module).href)) as StationModule;
    } catch (err) {
      warnOnce(`${key}: no corre porque su módulo no se pudo importar: ${withoutSecrets(errorText(err), ctx, station)}`);
      return;
    }
    if (typeof mod.pass !== "function") {
      warnOnce(`${key}: no corre porque su módulo no exporta una función pass`);
      return;
    }
    let config: unknown = station.entry.config;
    if (typeof mod.parseConfig === "function") {
      try {
        config = await mod.parseConfig(config);
      } catch (err) {
        warnOnce(`${key}: no corre porque su configuración no es válida: ${withoutSecrets(errorText(err), ctx, station)}`);
        return;
      }
    }
    // Before running, so a pass that crashes the process or hangs waits for its next period like any other.
    ctx.store.setKv(lastKey, now.toISOString());
    log.info(`${key} start`);
    await mod.pass(stationContext(ctx, runAgent, station, config, now, controller.signal));
    log.info(`${key} done`);
  })();
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), station.timeoutMinutes * 60_000);
  });
  const shutdown = new Promise<"shutdown">((done) => {
    if (controller.signal.aborted) done("shutdown");
    else controller.signal.addEventListener("abort", () => done("shutdown"), { once: true });
  });
  try {
    const end = await Promise.race([work.then(() => "done" as const), expired, shutdown]);
    if (end === "timeout") {
      // A module that hangs while importing would otherwise be retried on every idle pass.
      ctx.store.setKv(lastKey, now.toISOString());
      log.warn(`${key}: superó su tiempo de ${station.timeoutMinutes} minutos`);
    }
  } catch (err) {
    log.warn(`${key}: falló`, { error: withoutSecrets(errorText(err), ctx, station) });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
    // Whatever it left running is told to stop; it runs in this process, so nothing else can stop it.
    controller.abort();
    work.catch(() => undefined);
  }
}

/**
 * The installed packages' stations, one at a time and each at most once per its
 * `everyMinutes`, only while the factory has nothing else to do. A failure or a
 * hang stays in the log and the next station still runs.
 */
export async function packagesPass(ctx: FactoryContext, runAgent: AgentRunner, now: Date, opts: { signal?: AbortSignal } = {}): Promise<void> {
  for (const station of ctx.config.loadedPackages?.stations ?? []) {
    if (opts.signal?.aborted) return;
    if (ctx.store.getKv(ANDON_KEY) === "on") return;
    if (ctx.store.listJobs({ status: ["queued", "running"], limit: 1 }).length) return;
    if (budgetState(ctx.store, ctx.config, now).reached) return;
    await runStation(ctx, runAgent, station, now, opts.signal);
  }
}
