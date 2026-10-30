import type { FactoryContext } from "../app.js";
import { log } from "../log.js";
import { git } from "../shell.js";
import type { Job, Proposal } from "../state/store.js";

/** A proposal the night shift took and integrated on its own, by merging into the base branch, with the merge commit to look for. */
function autonomousMerge(ctx: FactoryContext, proposal: Proposal): { job: Job; commit: string } | undefined {
  if (proposal.decidedBy !== "night-shift" || !proposal.jobId) return undefined;
  const job = ctx.store.getJob(proposal.jobId);
  // An integration the owner granted at before-integrate is theirs, not the night shift's.
  if (!job || job.status !== "delivered" || job.approvals.integrate === true) return undefined;
  const commit = job.delivery?.mode === "merge" ? job.delivery.commit : undefined;
  return commit ? { job, commit } : undefined;
}

/**
 * Marks as `reverted` the proposals the night shift integrated on its own when
 * the line's base branch has a commit that reverts their merge (the message
 * `git revert` writes), and leaves the lesson in the line's townhall. Reverts
 * only on the remote, squashes and manual undos are not seen.
 */
export async function detectReverts(ctx: FactoryContext): Promise<number> {
  let reverted = 0;
  for (const line of ctx.config.lines) {
    const merged = ctx.store
      .listProposals({ line: line.name, status: ["approved"] })
      .map((p) => ({ proposal: p, merge: autonomousMerge(ctx, p) }))
      .filter((c) => c.merge);
    if (!merged.length) continue;
    let messages: string;
    try {
      messages = git(["log", line.baseBranch, "--format=%B", "--grep=This reverts commit", "--fixed-strings"], line.repo);
    } catch (err) {
      log.warn("cannot read the base branch to detect reverts", { line: line.name, error: String(err) });
      continue;
    }
    for (const { proposal, merge } of merged) {
      if (!messages.includes(`This reverts commit ${merge!.commit}`)) continue;
      if (!ctx.store.updateProposal(proposal.id, { status: "reverted", note: proposal.note, from: "approved" })) continue;
      reverted++;
      log.info("the owner reverted a night-shift integration", { line: line.name, proposal: proposal.id, job: merge!.job.id, commit: merge!.commit });
      try {
        await ctx.townhall.publish([
          { kind: "lesson", line: line.name, topic: "propuesta revertida", source: "", body: `"${proposal.title}": el turno nocturno la integró solo (trabajo ${merge!.job.id}) y el dueño la revirtió en ${line.baseBranch}.` },
        ]);
      } catch (err) {
        log.warn("cannot record the revert in the townhall", { proposal: proposal.id, error: String(err) });
      }
    }
  }
  return reverted;
}
