import { createHash } from "node:crypto";
import { AGENT_STATIONS, stationChain, type FactoryConfig } from "../config.js";
import { issueKey, jiraIssueKey, linearIssueKey } from "../intake/keys.js";
import { endedOn, finalizeJob, TAKEN_BY_ANOTHER, type LedgerDeps } from "../line/finish.js";
import { scrubLocal } from "../line/research.js";
import { log } from "../log.js";
import type { MachineIdentity } from "../machine.js";
import { isPriority } from "../priority.js";
import type { Job, JobSource, Store } from "../state/store.js";
import { claimSource, finished, listClaims, publishQueued, readQueueRecord, type ClaimRecord, type CoordApi, type JobNeeds, type QueueRecord } from "./protocol.js";

/** `coord:job:<id>`: a local job this machine already published on the shared queue, or imported from it, with what it needs. */
export const queuedKey = (id: string) => `coord:job:${id}`;

export interface QueuedState {
  origin: "published" | "imported";
  needs: JobNeeds;
}

export function readQueued(store: Store, id: string): QueuedState | undefined {
  const raw = store.getKv(queuedKey(id));
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as QueuedState | null;
    return v && (v.origin === "published" || v.origin === "imported") && v.needs && Array.isArray(v.needs.engines) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** The engines a job of this factory starts its stations on: another machine needs them all to take it. */
export function primaryEngines(config: Pick<FactoryConfig, "engine" | "stations" | "fallback">): string[] {
  return [...new Set(AGENT_STATIONS.map((s) => stationChain(config, s)[0]!.engine))].sort();
}

/** What a job asks of the machine that takes it: the box when it runs in one here, and this factory's engines. */
export function jobNeeds(job: Job, config: Pick<FactoryConfig, "engine" | "stations" | "fallback" | "isolation">, boxReady: boolean): JobNeeds {
  return { box: job.isolation === "container" || (config.isolation === "container" && boxReady), engines: primaryEngines(config) };
}

/** Whether this machine can do a job that needs `needs`: its box when asked for, and every engine. */
export function canTake(needs: JobNeeds, config: Pick<FactoryConfig, "engine" | "stations" | "fallback">, boxReady: boolean): boolean {
  if (needs.box && !boxReady) return false;
  const engines = new Set(AGENT_STATIONS.flatMap((s) => stationChain(config, s).map((l) => l.engine)));
  return needs.engines.every((e) => engines.has(e));
}

/** The same origin on every machine gets the same key, fit for a ref name. A package's requests are each machine's own: keyed by the job. */
export function sourceKey(source: JobSource, jobId: string): string {
  const parts: Record<JobSource["kind"], (s: never) => string> = {
    "github-issue": (s: Extract<JobSource, { kind: "github-issue" }>) => `${s.repository.toLowerCase()}#${s.number}`,
    "linear-issue": (s: Extract<JobSource, { kind: "linear-issue" }>) => `${s.team}/${s.id}`,
    "jira-issue": (s: Extract<JobSource, { kind: "jira-issue" }>) => `${s.site}/${s.key}`,
    "night-shift": (s: Extract<JobSource, { kind: "night-shift" }>) => s.proposal,
    research: (s: Extract<JobSource, { kind: "research" }>) => s.note,
    package: (s: Extract<JobSource, { kind: "package" }>) => `${s.package}/${s.station}/${jobId}`,
    "security-alert": (s: Extract<JobSource, { kind: "security-alert" }>) => `${s.repository.toLowerCase()}/${s.ecosystem}/${s.package}/${[...s.alerts].sort((a, b) => a - b).join(",")}`,
    "pull-request": (s: Extract<JobSource, { kind: "pull-request" }>) => `${s.repository.toLowerCase()}#${s.number}`,
  };
  const id = (parts[source.kind] as (s: JobSource) => string)(source);
  return `${source.kind}-${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/** The intake's state for the origin, which names the job serving it; undefined for origins without one. */
function originKey(source: JobSource): string | undefined {
  if (source.kind === "github-issue") return issueKey(source.repository, source.number);
  if (source.kind === "linear-issue") return linearIssueKey(source.team, source.id);
  if (source.kind === "jira-issue") return jiraIssueKey(source.site, source.key);
  return undefined;
}

/** The intake's state of a duplicate's origin now names the job of the shared queue, so it reports on that one. */
function repointOrigin(store: Store, source: JobSource, from: string, to: string): void {
  const key = originKey(source);
  const raw = key && store.getKv(key);
  if (!key || !raw) return;
  try {
    const state = JSON.parse(raw) as { job?: string };
    if (state.job === from) store.setKv(key, JSON.stringify({ ...state, job: to }));
  } catch {
    // A state that does not read is the intake's to fix; nothing to point.
  }
}

type QueueCtx = LedgerDeps;

/**
 * The shared queue's share of the coordination pass, only with the protocol on:
 * local copies of jobs another machine finished end here as that machine left
 * them; other machines' queued jobs whose line exists here come in with their
 * own id; and this machine's queued jobs go out, one job per request origin.
 * Gives back the claims it read, the pass's only listing of them.
 */
export async function queuePass(ctx: QueueCtx, api: CoordApi, machine: MachineIdentity, boxReady: boolean): Promise<Map<string, ClaimRecord>> {
  const { store, config } = ctx;
  const claims = await listClaims(api);

  for (const job of store.listJobs({ status: ["queued"] })) {
    const claim = claims.get(job.id);
    if (!finished(claim) || claim.machine === machine.id) continue;
    // The daemon may have met the same record when claiming, meanwhile.
    if (store.getJob(job.id)?.status !== "queued") continue;
    await finalizeJob(ctx, job, claim.status, { reason: endedOn(claim.name) });
  }

  for (const ref of await api.list("queue/")) {
    const record = readQueueRecord(ref);
    if (!record || store.getJob(record.id) || finished(claims.get(record.id))) continue;
    if (!config.lines.some((l) => l.name === record.line)) continue;
    importJob(ctx, record);
  }

  for (const job of store.listJobs({ status: ["queued"] })) {
    if (readQueued(store, job.id) || store.getJob(job.id)?.status !== "queued") continue;
    const line = config.lines.find((l) => l.name === job.line);
    if (!line) continue;
    if (job.source) {
      const owner = await claimSource(api, sourceKey(job.source, job.id), job.id);
      if (owner !== job.id) {
        log.info("request already queued by another machine of the factory; ending the local duplicate", { job: job.id, owner });
        repointOrigin(store, job.source, job.id, owner);
        await finalizeJob(ctx, job, "stopped", { reason: TAKEN_BY_ANOTHER });
        continue;
      }
    }
    const needs = jobNeeds(job, config, boxReady);
    const record: QueueRecord = {
      id: job.id,
      line: job.line,
      kind: job.kind,
      request: scrubLocal(job.request, line),
      priority: job.priority ?? "media",
      ...(job.source && { source: job.source as QueueRecord["source"] }),
      createdAt: job.createdAt,
      needs,
    };
    await publishQueued(api, record);
    store.setKv(queuedKey(job.id), JSON.stringify({ origin: "published", needs } satisfies QueuedState));
  }
  return claims;
}

function importJob(ctx: QueueCtx, record: QueueRecord): void {
  const { store, config } = ctx;
  const job = store.createJob({
    id: record.id,
    line: record.line,
    kind: record.kind,
    request: record.request,
    budgetUsd: config.limits.usdPerJob,
    ...(record.source && { source: record.source as unknown as JobSource }),
    priority: isPriority(record.priority) ? record.priority : undefined,
    createdAt: record.createdAt,
  });
  store.setKv(queuedKey(job.id), JSON.stringify({ origin: "imported", needs: record.needs } satisfies QueuedState));
  ctx.tracer.start("zero.job", { id: ctx.tracer.jobSpanId(job.id), jobId: job.id, attrs: { "zero.line": job.line, "zero.kind": job.kind, "zero.imported": true } });
  log.info("job imported from the factory's shared queue", { job: job.id, line: job.line });
}
