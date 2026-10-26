import type { FactoryConfig } from "../config.js";
import type { Delivery, Job, Question, Store } from "../state/store.js";
import { APPROVAL_SPAN } from "../telemetry/metrics.js";
import type { Tracer } from "../telemetry/tracer.js";
import type { NewPost, Townhall } from "../townhall/index.js";
import { removeWorkCopy } from "../workspace.js";

export interface LedgerDeps {
  config: FactoryConfig;
  store: Store;
  tracer: Tracer;
  townhall: Townhall;
  now?: () => Date;
}

export function engineSummary(config: FactoryConfig): string {
  return (["spec", "build", "review"] as const).map((s) => `${s}=${config.stations[s].engine ?? config.engine}`).join(", ");
}

export function describeDelivery(d: Delivery): string {
  if (d.mode === "merge") return `integrado en la rama base (${d.commit?.slice(0, 8)})`;
  if (d.mode === "pull-request") return `solicitud de cambio ${d.url}`;
  return `rama ${d.branch} lista`;
}

/** Parks a job until the owner answers, recording how long the factory waited. */
export function askOwner(deps: LedgerDeps, job: Job, q: Omit<Question, "askedAt" | "expiresAt" | "onTimeout">): Job {
  const now = (deps.now ?? (() => new Date()))();
  const spanId = `approval-${job.id}-${now.getTime()}`;
  deps.tracer.start(APPROVAL_SPAN, { id: spanId, jobId: job.id, parentId: deps.tracer.jobSpanId(job.id), attrs: { "zero.question": q.kind } });
  const { timeoutHours, onTimeout } = deps.config.approvals;
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
 * townhall report and removal of the work copy (the branch is kept).
 */
export async function finalizeJob(
  deps: LedgerDeps,
  job: Job,
  status: "delivered" | "failed" | "stopped",
  opts: { reason?: string; delivery?: Delivery } = {},
): Promise<Job> {
  if (job.question) closeQuestion(deps, job, "closed");
  const done = deps.store.finishJob(job.id, status, {
    reason: opts.reason,
    delivery: opts.delivery,
    ...(status === "delivered" && { checkpoint: "delivered" as const }),
  });
  deps.store.endSpan(deps.tracer.jobSpanId(job.id), done.finishedAt!, status === "failed" ? "error" : "ok", {
    "zero.outcome": status,
    "zero.attempts": done.attempt,
    "zero.cost.usd": done.costUsd,
  });

  const line = deps.config.lines.find((l) => l.name === job.line);
  if (line && done.worktree) removeWorkCopy(line.repo, done.worktree);

  const topic = done.title ?? done.request.slice(0, 80);
  const posts: NewPost[] = [
    {
      kind: "run",
      line: done.line,
      job: done.id,
      source: "zero",
      topic,
      body: status === "delivered" && opts.delivery ? describeDelivery(opts.delivery) : (opts.reason ?? status).slice(0, 500),
      data: {
        status,
        attempts: done.attempt,
        costUsd: done.costUsd,
        durationMs: Date.parse(done.finishedAt!) - Date.parse(done.createdAt),
        engines: engineSummary(deps.config),
        delivery: opts.delivery && describeDelivery(opts.delivery),
      },
    },
  ];
  if (status === "failed") posts.push({ kind: "blocker", line: done.line, job: done.id, source: "zero", topic, body: (opts.reason ?? "").slice(0, 1000) });
  await deps.townhall.publish(posts);
  return done;
}
