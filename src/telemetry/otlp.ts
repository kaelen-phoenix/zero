import { createHash } from "node:crypto";
import type { FactoryContext } from "../app.js";
import { scrubLocal } from "../line/research.js";
import { log } from "../log.js";
import type { Job, SpanRow } from "../state/store.js";

/**
 * Traces sent to an OpenTelemetry collector over OTLP/HTTP with JSON. state.db
 * stays the source of truth: the exporter reads finished jobs after a cursor
 * kept in kv, so nothing piles up in memory while the collector is down, and a
 * failure is logged and retried a bounded number of times, never thrown.
 */

export const OTLP_CURSOR_KEY = "otlp:cursor";
export const OTLP_RETRY_KEY = "otlp:retry";
/** Jobs per request. */
export const OTLP_BATCH = 20;
/** Failed requests for the same batch before it is skipped. */
export const OTLP_MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 10_000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;
/** Batches sent in one pass, so a long backlog never holds a pass for long. */
const BATCHES_PER_PASS = 10;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A job's OTLP trace id: 32 hex chars, the same on every export. */
export function otlpTraceId(jobId: string): string {
  return sha(`zero-trace:${jobId}`).slice(0, 32);
}

/** An OTLP span id for a stored span id: the id itself when it already is one, otherwise 16 hex chars derived from it. */
export function otlpSpanId(storedId: string): string {
  if (/^[0-9a-f]{16}$/.test(storedId) && !/^0+$/.test(storedId)) return storedId;
  const id = sha(`zero-span:${storedId}`).slice(0, 16);
  return /^0+$/.test(id) ? "0000000000000001" : id;
}

type AnyValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function anyValue(value: unknown, scrub: (text: string) => string): AnyValue {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: scrub(typeof value === "string" ? value : JSON.stringify(value)) };
}

const nanos = (iso: string) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

/** The OTLP/JSON body for one or more finished jobs: one resource, one scope, every ended span with its parent. */
export function otlpBody(jobs: { job: Job; spans: SpanRow[] }[], scrub: (job: Job, text: string) => string) {
  const spans = jobs.flatMap(({ job, spans }) =>
    spans
      .filter((s) => s.end)
      .map((s) => {
        const clean = (text: string) => scrub(job, text);
        const message = s.attrs["error.message"];
        return {
          traceId: otlpTraceId(job.id),
          spanId: otlpSpanId(s.id),
          ...(s.parentId ? { parentSpanId: otlpSpanId(s.parentId) } : {}),
          name: s.name,
          kind: 1,
          startTimeUnixNano: nanos(s.start),
          endTimeUnixNano: nanos(s.end!),
          attributes: [
            { key: "zero.job.id", value: { stringValue: job.id } },
            ...Object.entries(s.attrs)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([key, v]) => ({ key, value: anyValue(v, clean) })),
          ],
          status: s.status === "error" ? { code: 2, ...(message !== undefined ? { message: clean(String(message)) } : {}) } : { code: 1 },
        };
      }),
  );
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "zero" } }] },
        scopeSpans: [{ scope: { name: "zero" }, spans }],
      },
    ],
  };
}

/** Text fit to leave the machine: secrets redacted, the job's repository, the owner's home and other local paths removed. */
export function otlpScrub(ctx: Pick<FactoryContext, "config">, job: Job, text: string): string {
  const repo = ctx.config.lines.find((l) => l.name === job.line)?.repo ?? "";
  return scrubLocal(text, { repo });
}

interface Cursor {
  at: string;
  id: string;
}
interface Retry {
  attempts: number;
  nextAt: string;
}

const readJson = <T>(text: string | undefined): T | undefined => {
  try {
    return text ? (JSON.parse(text) as T) : undefined;
  } catch {
    return undefined;
  }
};

export interface ExportOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

/** One export pass: sends the jobs finished since the last one. Never throws. */
export async function exportPass(ctx: Pick<FactoryContext, "config" | "store" | "secrets" | "now">, opts: ExportOptions = {}): Promise<void> {
  try {
    await exportFinished(ctx, opts);
  } catch (err) {
    log.warn("trace export failed", { error: String(err) });
  }
}

async function exportFinished(ctx: Pick<FactoryContext, "config" | "store" | "secrets" | "now">, opts: ExportOptions) {
  const otlp = ctx.config.telemetry?.otlp;
  if (!otlp) return;
  const { store } = ctx;
  const now = opts.now ?? ctx.now ?? (() => new Date());
  const send = opts.fetch ?? fetch;
  const collector = new URL(otlp.endpoint).origin;

  const cursor = readJson<Cursor>(store.getKv(OTLP_CURSOR_KEY));
  // Turning export on starts from now: jobs finished before are not sent.
  if (!cursor) return store.setKv(OTLP_CURSOR_KEY, JSON.stringify({ at: now().toISOString(), id: "" } satisfies Cursor));
  const retry = readJson<Retry>(store.getKv(OTLP_RETRY_KEY));
  if (retry && Date.parse(retry.nextAt) > now().getTime()) return;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const missing: string[] = [];
  for (const [header, name] of Object.entries(otlp.headers)) {
    const value = ctx.secrets.get(name);
    if (value) headers[header] = value;
    else missing.push(name);
  }
  if (missing.length) return log.warn("trace export skipped: missing secrets", { secrets: missing.join(", ") });

  let at = cursor;
  let failures = retry?.attempts ?? 0;
  for (let i = 0; i < BATCHES_PER_PASS; i++) {
    const jobs = store.finishedAfter(at, OTLP_BATCH);
    if (!jobs.length) return;
    const last = jobs[jobs.length - 1]!;
    const next: Cursor = { at: last.finishedAt!, id: last.id };
    const body = otlpBody(
      jobs.map((job) => ({ job, spans: store.spansForJob(job.id) })),
      (job, text) => otlpScrub(ctx, job, text),
    );
    const error = await post(send, otlp.endpoint, headers, body, opts.timeoutMs ?? TIMEOUT_MS);
    if (!error) {
      store.setKv(OTLP_CURSOR_KEY, JSON.stringify(next));
      store.deleteKv(OTLP_RETRY_KEY);
      at = next;
      failures = 0;
      continue;
    }
    const attempts = failures + 1;
    if (attempts >= OTLP_MAX_ATTEMPTS) {
      store.setKv(OTLP_CURSOR_KEY, JSON.stringify(next));
      store.deleteKv(OTLP_RETRY_KEY);
      return log.warn("trace export gave up on a batch", { collector, jobs: jobs.length, attempts, error });
    }
    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    store.setKv(OTLP_RETRY_KEY, JSON.stringify({ attempts, nextAt: new Date(now().getTime() + delay).toISOString() } satisfies Retry));
    return log.warn("trace export failed; will retry", { collector, attempts, error });
  }
}

/** POSTs one body; the error as text, or undefined when the collector took it. */
async function post(send: typeof fetch, endpoint: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<string | undefined> {
  try {
    const res = await send(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel().catch(() => undefined);
    return res.ok ? undefined : `HTTP ${res.status}`;
  } catch (err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}
