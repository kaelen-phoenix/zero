import type { FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { log } from "../log.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job, Proposal } from "../state/store.js";
import { pullRequestOf, recordMergeCommit, type MergeApi } from "./automerge.js";

/** A night-shift integration and what on the base branch would undo it. */
interface Integration {
  job: Job;
  commit?: string;
  /** owner/repo and number of its pull request, for pull-request deliveries. */
  pr?: { repository: string; number: number };
}

/** A proposal the night shift took and integrated on its own, by merging into the base branch or through a pull request. */
function autonomousIntegration(ctx: FactoryContext, proposal: Proposal): Integration | undefined {
  if (proposal.decidedBy !== "night-shift" || !proposal.jobId) return undefined;
  const job = ctx.store.getJob(proposal.jobId);
  // An integration the owner granted at before-integrate is theirs, not the night shift's.
  if (!job || job.status !== "delivered" || job.approvals.integrate === true) return undefined;
  if (job.delivery?.mode === "merge") return job.delivery.commit ? { job, commit: job.delivery.commit } : undefined;
  if (job.delivery?.mode === "pull-request" && job.delivery.url) {
    const pr = pullRequestOf(job.delivery.url);
    return pr && { job, commit: job.delivery.commit, pr };
  }
  return undefined;
}

/** How long a pull request closed without merging goes unasked: it can still be reopened and merged, so it is never dropped for good. */
const CLOSED_WAIT_MS = 24 * 60 * 60 * 1000;
const closedKey = (jobId: string) => `reverts:closed:${jobId}`;

/** When the job's closed pull request is worth asking about again; NaN, which never holds a query back, when there is no readable date. */
function closedUntil(ctx: FactoryContext, jobId: string): number {
  try {
    return Date.parse(ctx.store.getKv(closedKey(jobId)) ?? "");
  } catch (err) {
    log.warn("cannot read the wait of a closed pull request", { job: jobId, error: String(err) });
    return NaN;
  }
}

/** The wait is only a saving: a store failure must not cost the pass or the commit just obtained. */
function updateClosedWait(ctx: FactoryContext, jobId: string, until?: Date) {
  try {
    if (until) ctx.store.setKv(closedKey(jobId), until.toISOString());
    else ctx.store.deleteKv(closedKey(jobId));
  } catch (err) {
    log.warn("cannot update the wait of a closed pull request", { job: jobId, error: String(err) });
  }
}

/** Fills in the commit a pull request was merged with (merge or squash), when GitHub says it was merged. */
async function mergeCommit(ctx: FactoryContext, it: Integration, merges?: (repository: string) => MergeApi | undefined): Promise<Integration> {
  if (it.commit || !it.pr || !merges) return it;
  const now = (ctx.now ?? (() => new Date()))().getTime();
  if (now < closedUntil(ctx, it.job.id)) return it;
  try {
    const gh = merges(it.pr.repository);
    if (!gh) return it;
    const state = await gh.pullRequest(it.pr.number);
    if (!state.open && !state.merged) updateClosedWait(ctx, it.job.id, new Date(now + CLOSED_WAIT_MS));
    if (state.open) updateClosedWait(ctx, it.job.id);
    if (!state.merged || !state.mergeCommitSha) return it;
    const job = recordMergeCommit(ctx, it.job, state.mergeCommitSha);
    updateClosedWait(ctx, it.job.id);
    return { ...it, job, commit: state.mergeCommitSha };
  } catch (err) {
    log.warn("cannot read the pull request to detect reverts", { job: it.job.id, error: String(err) });
    return it;
  }
}

/** Revert messages on the line's base branch, local and (when it exists) remote-tracking; undefined when neither can be read. */
function revertMessages(line: LineConfig): string | undefined {
  // Best effort: pull requests are merged on GitHub, so their reverts land there first.
  if (line.integrate === "pull-request") {
    spawnGit(["fetch", "-q", line.remote, line.baseBranch], line.repo, { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  }
  const refs = [line.baseBranch, `${line.remote}/${line.baseBranch}`].filter((ref) => tryGit(["rev-parse", "--verify", "-q", `${ref}^{commit}`], line.repo) !== undefined);
  if (!refs.length) return undefined;
  return tryGit(["log", ...refs, "--format=%B", "--grep=This reverts commit", "--grep=Reverts ", "--fixed-strings"], line.repo);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `git revert` of its commit, or GitHub's Revert button on its pull request (`Reverts owner/repo#N`). */
function isReverted(messages: string, it: Integration): boolean {
  // Only a pull request known to be merged (its commit recorded) can have been reverted.
  if (!it.commit) return false;
  if (messages.includes(`This reverts commit ${it.commit}`)) return true;
  return Boolean(it.pr &&new RegExp(`Reverts ${escape(it.pr.repository)}#${it.pr.number}(?!\\d)`, "i").test(messages));
}

/**
 * Marks as `reverted` the proposals the night shift integrated on its own when
 * the line's base branch has a commit that reverts them: the message `git
 * revert` writes for their merge (or squash) commit, or the one GitHub's
 * Revert button writes for their pull request. Leaves the lesson in the
 * line's townhall. Manual undos are not seen.
 */
export async function detectReverts(ctx: FactoryContext, merges?: (repository: string) => MergeApi | undefined): Promise<number> {
  let reverted = 0;
  for (const line of ctx.config.lines) {
    const found = ctx.store
      .listProposals({ line: line.name, status: ["approved"] })
      .map((p) => ({ proposal: p, integration: autonomousIntegration(ctx, p) }))
      .filter((c): c is { proposal: Proposal; integration: Integration } => Boolean(c.integration));
    if (!found.length) continue;
    const candidates: { proposal: Proposal; integration: Integration }[] = [];
    for (const c of found) candidates.push({ ...c, integration: await mergeCommit(ctx, c.integration, merges) });
    const messages = revertMessages(line);
    if (messages === undefined) {
      log.warn("cannot read the base branch to detect reverts", { line: line.name, branch: line.baseBranch });
      continue;
    }
    for (const { proposal, integration } of candidates) {
      if (!isReverted(messages, integration)) continue;
      if (!ctx.store.updateProposal(proposal.id, { status: "reverted", note: proposal.note, from: "approved" })) continue;
      reverted++;
      log.info("the owner reverted a night-shift integration", { line: line.name, proposal: proposal.id, job: integration.job.id, commit: integration.commit });
      try {
        await ctx.townhall.publish([
          { kind: "lesson", line: line.name, topic: "propuesta revertida", source: "", body: `"${proposal.title}": el turno nocturno la integró solo (trabajo ${integration.job.id}) y quien está a cargo la revirtió en ${line.baseBranch}.` },
        ]);
      } catch (err) {
        log.warn("cannot record the revert in the townhall", { proposal: proposal.id, error: String(err) });
      }
    }
  }
  return reverted;
}
