import type { Approvals, Job } from "../state/store.js";
import { closeQuestion, finalizeJob, type LedgerDeps } from "./finish.js";

export type Decision = "approve" | "reject";

/** What approving each kind of question allows, so the runner does not ask again. */
function granted(job: Job): Approvals {
  const q = job.question!;
  const a = { ...job.approvals };
  switch (q.kind) {
    case "spec-ready":
      a.spec = true;
      break;
    case "before-integrate":
      a.integrate = true;
      break;
    case "protected-path":
      a.protectedPaths = [...(a.protectedPaths ?? []), ...((q.data?.paths as string[] | undefined) ?? [])];
      break;
    case "budget-exceeded":
      a.extraBudgetUsd = (a.extraBudgetUsd ?? 0) + Number(q.data?.extraUsd ?? 0);
      break;
    case "integration-blocked":
      a.retryIntegration = true;
      break;
  }
  return a;
}

/**
 * Applies the owner's answer to a waiting job. Approving puts it back in the
 * queue to continue after the approved point; rejecting stops it.
 */
export async function answerJob(deps: LedgerDeps, job: Job, decision: Decision, note?: string): Promise<Job> {
  if (job.status !== "waiting" || !job.question) throw new Error(`El trabajo ${job.id} no está esperando una respuesta (estado: ${job.status}).`);
  if (decision === "reject") {
    const kept = job.question.kind === "integration-blocked" && job.branch ? ` La rama ${job.branch} queda disponible.` : "";
    return finalizeJob(deps, job, "stopped", { reason: `Rechazado por el dueño${note ? `: ${note}` : "."}${kept}` });
  }
  closeQuestion(deps, job, "approve");
  return deps.store.updateJob(job.id, { status: "queued", question: null, approvals: granted(job) });
}
