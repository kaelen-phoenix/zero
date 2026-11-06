import { AGENT_STATIONS, type FactoryConfig } from "../config.js";
import { log } from "../log.js";
import { tryGit } from "../shell.js";
import type { Delivery, Job, Question, Store } from "../state/store.js";
import { APPROVAL_SPAN } from "../telemetry/metrics.js";
import type { Tracer } from "../telemetry/tracer.js";
import type { NewPost, Townhall } from "../townhall/index.js";
import { checkedOutAt, removeWorkCopy } from "../workspace.js";

export interface LedgerDeps {
  config: FactoryConfig;
  store: Store;
  tracer: Tracer;
  townhall: Townhall;
  now?: () => Date;
}

/**
 * A delivered job taken back to update its pull request with the base: the tip
 * the pull request had, and how far the merge went. While this exists, the job
 * can only end delivered, with its pull request as it found it or updated.
 */
export interface PrRefresh {
  head: string;
  /** The owner had approved integrating the code before this update. */
  approved?: boolean;
  started?: boolean;
  /** The files that were in conflict; absent when the merge was clean. */
  paths?: string[];
  /** The merge is committed on the branch. */
  resolved?: boolean;
}

export const prRefreshKey = (jobId: string) => `pr-refresh:${jobId}`;

export function prRefresh(store: Pick<Store, "getKv">, jobId: string): PrRefresh | undefined {
  const raw = store.getKv(prRefreshKey(jobId));
  return raw ? (JSON.parse(raw) as PrRefresh) : undefined;
}

export function engineSummary(config: FactoryConfig): string {
  return AGENT_STATIONS.map((s) => `${s}=${config.stations[s].engine ?? config.engine}`).join(", ");
}

export function describeDelivery(d: Delivery): string {
  if (d.mode === "merge") return `integrado en la rama base (${d.commit?.slice(0, 8)})`;
  if (d.mode === "pull-request") return `solicitud de cambio ${d.url}`;
  return `rama ${d.branch} lista`;
}

/** The stored reason of a job the person stopped; it speaks to them, so anything other people read goes through `reasonForOthers`. */
export const STOPPED_BY_YOU = "Lo detuviste vos.";

/** The stored reason of a job the person rejected, with their note when there is one. */
export const rejectedByYou = (note?: string) => `Lo rechazaste vos${note ? `: ${note}` : "."}`;

/** A stored reason in the third person, for issues, the reply station and the townhall. Any other reason stays as it is. */
export function reasonForOthers(reason: string): string {
  return reason.replace(/^Lo detuviste vos/, "Lo detuvo la persona responsable").replace(/^Lo rechazaste vos/, "Lo rechazó la persona responsable");
}

/**
 * Parks a job until the owner answers, recording how long the factory waited.
 * `onTimeout` overrides the configured default answer, for gates that must
 * never pass without a human.
 */
export function askOwner(deps: LedgerDeps, job: Job, q: Omit<Question, "askedAt" | "expiresAt" | "onTimeout">, opts: { onTimeout?: Question["onTimeout"] } = {}): Job {
  const now = (deps.now ?? (() => new Date()))();
  const spanId = `approval-${job.id}-${now.getTime()}`;
  deps.tracer.start(APPROVAL_SPAN, { id: spanId, jobId: job.id, parentId: deps.tracer.jobSpanId(job.id), attrs: { "zero.question": q.kind } });
  const { timeoutHours } = deps.config.approvals;
  const onTimeout = opts.onTimeout ?? deps.config.approvals.onTimeout;
  return deps.store.updateJob(job.id, {
    status: "waiting",
    question: {
      ...q,
      data: { ...q.data, spanId },
      askedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutHours * 3_600_000).toISOString(),
      onTimeout,
    },
  });
}

/** Ends the approval span of a pending question, if any. */
export function closeQuestion(deps: LedgerDeps, job: Job, answer: string) {
  const spanId = job.question?.data?.spanId;
  if (typeof spanId === "string") deps.store.endSpan(spanId, (deps.now ?? (() => new Date()))().toISOString(), "ok", { "zero.answer": answer });
}

/**
 * Every way a job ends goes through here: final status, the job span, the
 * townhall report and removal of the work copy (the branch is kept). An update
 * of a pull request that did not get pushed leaves the job delivered as it was,
 * with its branch back at the tip on record, so the pull request stays watched.
 */
export async function finalizeJob(
  deps: LedgerDeps,
  job: Job,
  status: "delivered" | "failed" | "stopped",
  opts: { reason?: string; delivery?: Delivery } = {},
): Promise<Job> {
  if (job.question) closeQuestion(deps, job, "closed");
  const refresh = prRefresh(deps.store, job.id);
  const gaveUp = refresh && status !== "delivered" ? refresh : undefined;
  const outcome = gaveUp ? "delivered" : status;
  const delivery = gaveUp ? job.delivery : opts.delivery;
  const done = deps.store.finishJob(job.id, outcome, {
    reason: gaveUp ? undefined : opts.reason,
    delivery,
    ...(outcome === "delivered" && { checkpoint: "delivered" as const }),
  });
  deps.store.endSpan(deps.tracer.jobSpanId(job.id), done.finishedAt!, outcome === "failed" ? "error" : "ok", {
    "zero.outcome": outcome,
    "zero.attempts": done.attempt,
    "zero.cost.usd": done.costUsd,
  });

  const line = deps.config.lines.find((l) => l.name === job.line);
  if (line && done.worktree) removeWorkCopy(line.repo, done.worktree);
  if (gaveUp) {
    log.warn("pull request not updated", { job: job.id, status, reason: opts.reason });
    const branch = delivery?.branch;
    if (line && branch && !checkedOutAt(line.repo, branch)) tryGit(["update-ref", `refs/heads/${branch}`, gaveUp.head], line.repo);
  }
  if (refresh) deps.store.deleteKv(prRefreshKey(job.id));

  const topic = done.title ?? done.request.slice(0, 80);
  const posts: NewPost[] = [
    {
      kind: "run",
      line: done.line,
      job: done.id,
      source: "zero",
      topic,
      body: outcome === "delivered" && delivery ? describeDelivery(delivery) : reasonForOthers(opts.reason ?? status).slice(0, 500),
      data: {
        status: outcome,
        attempts: done.attempt,
        costUsd: done.costUsd,
        durationMs: Date.parse(done.finishedAt!) - Date.parse(done.createdAt),
        engines: engineSummary(deps.config),
        delivery: delivery && describeDelivery(delivery),
      },
    },
  ];
  if (outcome === "failed") posts.push({ kind: "blocker", line: done.line, job: done.id, source: "zero", topic, body: (opts.reason ?? "").slice(0, 1000) });
  if (gaveUp) posts.push({ kind: "blocker", line: done.line, job: done.id, source: "zero", topic, body: `No se actualizó el pull request con la rama base: ${reasonForOthers(opts.reason ?? status)}`.slice(0, 1000) });
  await deps.townhall.publish(posts);
  return done;
}
