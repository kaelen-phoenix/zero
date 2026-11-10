import { Octokit } from "@octokit/rest";
import type { FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { GithubHalted, isRateLimit } from "../github-quota.js";
import { log } from "../log.js";
import { FACTORY_MARK } from "../intake/keys.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job } from "../state/store.js";
import { prRefreshKey, type PrRefresh } from "./finish.js";

/**
 * Merges the pull requests of lines with `autoMerge` once GitHub says they
 * are ready: every check finished well and there are no conflicts. Polled by
 * the daemon, like the issue intake, so the owner's machine needs no public
 * address. A pull request that is not ready is left as it is, except one in
 * conflict with its base: while its tip is still the factory's and has not been
 * tried, its job goes back to the queue to merge the base in (`takeBack`, then
 * the mark in finish.ts and the runner). `MergeState.resolving` keeps that tip,
 * so each tip is taken back at most once, and a job that could not update it
 * ends delivered again and is told about here like any other blocked one.
 */

export interface PullRequestState {
  open: boolean;
  merged: boolean;
  /** `null` while GitHub is still working it out. */
  mergeable: boolean | null;
  headSha: string;
  /** The commit GitHub merged it with (merge or squash), once merged. */
  mergeCommitSha?: string;
  /** The branch it would be merged into. */
  base?: string;
}

export interface Check {
  name: string;
  done: boolean;
  /** Only meaningful once `done`. */
  ok: boolean;
  /** The GitHub Actions run it belongs to, when it is one: what can be run again. */
  run?: number;
}

/** The slice of GitHub automatic merging needs; tests use a fake. */
export interface MergeApi {
  pullRequest(number: number): Promise<PullRequestState>;
  /** Check runs and commit statuses of a commit. */
  checks(sha: string): Promise<Check[]>;
  /** Merges only if the head is still `sha`, so nothing pushed after the checks gets in; returns the merge commit. */
  merge(number: number, sha: string): Promise<string | undefined>;
  deleteBranch(branch: string): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  /** Whether the base branch has commits the pull request's tip does not. */
  behind?(base: string, sha: string): Promise<boolean>;
  /** Merges the base branch into the pull request on GitHub, only if its tip is still `sha`. */
  updateBranch?(number: number, sha: string): Promise<void>;
  /** Runs the failed jobs of a GitHub Actions run again. */
  rerun?(run: number): Promise<void>;
}

const QUIET = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const PASSED = new Set(["success", "neutral", "skipped"]);

export function githubMerges(token: string, repository: string, client?: Octokit): MergeApi {
  const [owner, repo] = repository.split("/") as [string, string];
  const gh = client ?? new Octokit({ auth: token, log: QUIET });
  return {
    async pullRequest(number) {
      const { data } = await gh.pulls.get({ owner, repo, pull_number: number });
      return { open: data.state === "open", merged: data.merged, mergeable: data.mergeable, headSha: data.head.sha, mergeCommitSha: data.merged ? (data.merge_commit_sha ?? undefined) : undefined, base: (data.base as { ref?: string } | undefined)?.ref };
    },
    async checks(sha) {
      const runs = await gh.paginate(gh.checks.listForRef, { owner, repo, ref: sha, per_page: 100 });
      const statuses = (await gh.repos.getCombinedStatusForRef({ owner, repo, ref: sha })).data.statuses;
      return [
        ...runs.map((r) => ({ name: r.name, done: r.status === "completed", ok: PASSED.has(r.conclusion ?? ""), ...actionsRun(r.details_url) })),
        ...statuses.map((s) => ({ name: s.context, done: s.state !== "pending", ok: s.state === "success" })),
      ];
    },
    async merge(number, sha) {
      return (await gh.pulls.merge({ owner, repo, pull_number: number, sha, merge_method: "merge" })).data.sha;
    },
    async deleteBranch(branch) {
      await gh.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    },
    async comment(number, body) {
      await gh.issues.createComment({ owner, repo, issue_number: number, body: `${body}\n\n${FACTORY_MARK}` });
    },
    async behind(base, sha) {
      return (await gh.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${sha}`, per_page: 1 })).data.behind_by > 0;
    },
    async updateBranch(number, sha) {
      await gh.pulls.updateBranch({ owner, repo, pull_number: number, expected_head_sha: sha });
    },
    async rerun(run) {
      await gh.actions.reRunWorkflowFailedJobs({ owner, repo, run_id: run });
    },
  };
}

/** The GitHub Actions run of a check, from the address of its details (`…/actions/runs/<run>/job/<job>`). */
export function actionsRun(detailsUrl: string | null | undefined): { run?: number } {
  const m = /\/actions\/runs\/(\d+)(?:\/|$)/.exec(detailsUrl ?? "");
  return m ? { run: Number(m[1]) } : {};
}

/** Checks registered by CI may take a moment to appear after the push. */
const CHECKS_GRACE_MS = 5 * 60_000;
/** A pull request left open this long after delivery is no longer watched. */
const WATCH_MS = 14 * 24 * 3_600_000;
/** How long the checks of a blocked pull request that did not change are left alone: doubles from the first to the last. */
const FIRST_BACKOFF_MS = 5 * 60_000;
const LAST_BACKOFF_MS = 60 * 60_000;
/** How many times the factory brings the base branch into one pull request with failed checks, in its whole life. */
export const MAX_REFRESHES = 3;
/** A refresh whose checks did not finish in this long no longer holds up the other pull requests of its repository. */
const REFRESH_HOLD_MS = 2 * 3_600_000;
/** How long GitHub is given to show the tip of a refresh before it is asked for again. */
const REFRESH_SHOWS_MS = 10 * 60_000;

export type MergeDecision =
  | { kind: "merge" }
  | { kind: "wait"; why: string }
  | { kind: "blocked"; key: string; why: string; failed?: Check[] }
  | { kind: "gone"; merged: boolean };

/** What to do with a pull request now. Pure, so every case is tested without GitHub. */
export function mergeDecision(pr: PullRequestState, checks: Check[], sinceDeliveryMs: number): MergeDecision {
  if (pr.merged || !pr.open) return { kind: "gone", merged: pr.merged };
  const failedChecks = checks.filter((c) => c.done && !c.ok);
  const failed = failedChecks.map((c) => c.name);
  if (failed.length) return { kind: "blocked", key: `checks:${pr.headSha}:${failed.join(",")}`, why: `fallaron los checks ${failed.join(", ")}`, failed: failedChecks };
  if (checks.some((c) => !c.done)) return { kind: "wait", why: "esperando checks" };
  if (!checks.length && sinceDeliveryMs < CHECKS_GRACE_MS) return { kind: "wait", why: "esperando que aparezcan los checks" };
  if (pr.mergeable === null) return { kind: "wait", why: "GitHub todavía está calculando si se puede fundir" };
  if (!pr.mergeable) return { kind: "blocked", key: `conflict:${pr.headSha}`, why: "tiene conflictos con la rama base" };
  return { kind: "merge" };
}

export interface MergeState {
  status: "waiting" | "blocked" | "merged" | "closed" | "expired";
  why?: string;
  /** Last problem the pull request was told about, so each is said once. */
  reported?: string;
  /** While blocked: what it looked like, and when its checks are worth asking for again. */
  backoff?: { sha: string; mergeable: boolean | null; why: string; delayMs: number; nextChecksAt: string };
  /** How many times the factory brought the base branch into it (see `unblock`). */
  refreshes?: number;
  /** The refresh under way: the tip it was asked for and when. Gone once the new tip's checks end. */
  refreshing?: { head: string; at: string };
  /** The tip whose failed checks were already run again. */
  rerun?: string;
  /** The last pull request tip whose job went back to the queue to merge the base in. */
  resolving?: string;
}

export const mergeKey = (jobId: string) => `automerge:${jobId}`;
const FINAL = new Set<MergeState["status"]>(["merged", "closed", "expired"]);

/** owner/repo and number of a GitHub pull request URL. */
export function pullRequestOf(url: string): { repository: string; number: number } | undefined {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  return m ? { repository: m[1]!, number: Number(m[2]) } : undefined;
}

/** Keeps the commit a job's pull request was merged with, so a later revert of it can be recognised. */
export function recordMergeCommit(ctx: FactoryContext, job: Job, commit: string | undefined): Job {
  if (!commit || !job.delivery || job.delivery.commit === commit) return job;
  return ctx.store.updateJob(job.id, { delivery: { ...job.delivery, commit } });
}

/** Delivered jobs whose pull request the factory still has to merge. */
export function watchedJobs(ctx: FactoryContext): Job[] {
  return ctx.store.listJobs({ status: ["delivered"], limit: 200 }).filter((job) => {
    if (!job.delivery?.autoMerge || !job.delivery.url) return false;
    const raw = ctx.store.getKv(mergeKey(job.id));
    return !raw || !FINAL.has((JSON.parse(raw) as MergeState).status);
  });
}

const EXPIRED = "pasaron 14 días sin poder fundirlo";

/** The repositories where a refresh is under way, so the pull requests of one repository are refreshed one at a time. */
type Refreshing = Set<string>;

/** Whether a refresh the state tells about still holds its repository. */
const holds = (state: MergeState, now: number) => Boolean(state.refreshing) && now - Date.parse(state.refreshing!.at) < REFRESH_HOLD_MS;

/**
 * What the factory does on its own for a pull request whose checks failed, before leaving it blocked. Most of
 * these are not the change's fault: the checks ran against an older base (a fix that reached the base since,
 * a workflow that changed), or a run was cancelled or failed once for no reason of the code.
 * - Behind its base: the base is merged in on GitHub (never a rebase or a forced push), so every check runs
 *   again on today's base. One pull request per repository at a time (CI that shares a staging environment
 *   cancels the runs that pile up), and at most `MAX_REFRESHES` times in its life.
 * - Up to date: the failed GitHub Actions runs are run again, once per tip.
 * Returns what it did, or undefined when there is nothing left to try. Never throws: a GitHub that refuses means nothing was done.
 */
async function unblock(job: Job, gh: MergeApi, number: number, pr: PullRequestState, failed: Check[], state: MergeState, busy: boolean, now: number): Promise<Unblocking | undefined> {
  try {
    // GitHub takes a moment to make the new tip: until it shows, the refresh asked for this one is still under way.
    if (state.refreshing?.head === pr.headSha && now - Date.parse(state.refreshing.at) < REFRESH_SHOWS_MS) return { kind: "done", why: "actualizándose con la rama base", patch: {} };
    const refreshes = state.refreshes ?? 0;
    if (pr.base && gh.behind && gh.updateBranch && refreshes < MAX_REFRESHES && (await gh.behind(pr.base, pr.headSha))) {
      if (busy) return { kind: "turn", why: "espera su turno para actualizarse con la rama base" };
      await gh.updateBranch(number, pr.headSha);
      log.info("pull request brought up to date with its base; its checks run again", { job: job.id, head: pr.headSha, refresh: refreshes + 1 });
      return { kind: "done", why: "actualizado con la rama base; esperando sus checks", patch: { refreshes: refreshes + 1, refreshing: { head: pr.headSha, at: new Date(now).toISOString() } }, refreshed: true };
    }
    const runs = [...new Set(failed.flatMap((c) => (c.run ? [c.run] : [])))];
    if (gh.rerun && runs.length && state.rerun !== pr.headSha) {
      for (const run of runs) await gh.rerun(run);
      log.info("failed checks of a pull request run again", { job: job.id, head: pr.headSha, runs });
      return { kind: "done", why: "sus checks fallidos corren de nuevo", patch: { rerun: pr.headSha } };
    }
  } catch (err) {
    if (err instanceof GithubHalted || isRateLimit(err)) throw err;
    log.warn("could not unblock a pull request; left as it is", { job: job.id, error: err instanceof Error ? err.message : String(err) });
  }
  return undefined;
}

type Unblocking = { kind: "done"; why: string; patch: Partial<MergeState>; refreshed?: boolean } | { kind: "turn"; why: string };

/** Whether another watched pull request of the repository has a refresh under way. */
function refreshedElsewhere(ctx: FactoryContext, job: Job, repository: string, now: number): boolean {
  return watchedJobs(ctx).some((j) => j.id !== job.id && pullRequestOf(j.delivery!.url!)?.repository === repository && holds(JSON.parse(ctx.store.getKv(mergeKey(j.id)) ?? "{}") as MergeState, now));
}

/**
 * Brings the local branch of the job to the tip GitHub made, so the line's repository keeps knowing the pull
 * request as its own. Best effort: a branch checked out somewhere, or a remote that does not answer, changes nothing.
 */
function followRemoteTip(ctx: FactoryContext, job: Job) {
  const line = ctx.config.lines.find((l) => l.name === job.line);
  const branch = job.delivery?.branch;
  if (!line || !branch) return;
  try {
    spawnGit(["fetch", "-q", line.remote, `+refs/heads/${branch}:refs/heads/${branch}`], line.repo, { timeout: 120_000 });
  } catch {
    // Nothing depends on it.
  }
}

/**
 * Puts the job of a pull request in conflict back in the queue to merge the
 * base in, or returns false when it is not the factory's to touch or there is
 * nothing left to try. State is saved first: should the rest not happen, the
 * tip counts as tried and the pull request is only told about it.
 */
function takeBack(ctx: FactoryContext, job: Job, head: string, state: MergeState, save: (next: MergeState) => void): boolean {
  const line = ctx.config.lines.find((l) => l.name === job.line);
  if (!line?.autoMerge || !job.spec || job.attempt >= line.maxAttempts || state.resolving === head) return false;
  if (tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${job.delivery!.branch}`], line.repo) !== head) return false;
  const fetched = spawnGit(["fetch", "-q", line.remote, line.baseBranch], line.repo, { timeout: 120_000 });
  if (fetched.status !== 0) {
    log.warn("cannot fetch the base branch; pull request left as it is", { job: job.id, remote: line.remote, error: (fetched.stderr || String(fetched.error ?? "")).trim().slice(0, 300) });
    return false;
  }
  save({ reported: state.reported, status: "waiting", why: "actualizándolo con la rama base", resolving: head });
  ctx.store.setKv(prRefreshKey(job.id), JSON.stringify({ head, ...(job.approvals.integrate && { approved: true }) } satisfies PrRefresh));
  // Approving the earlier code does not cover what the merge brings in.
  const { integrate: _approved, ...approvals } = job.approvals;
  ctx.store.updateJob(job.id, { status: "queued", checkpoint: "review", station: "integrate", finishedAt: null, stopRequested: false, base: `${line.remote}/${line.baseBranch}`, approvals });
  log.info("pull request in conflict; job back in the queue to update it", { job: job.id, head });
  return true;
}

async function watch(ctx: FactoryContext, job: Job, gh: MergeApi, number: number, repository = "", refreshing: Refreshing = new Set()) {
  const key = mergeKey(job.id);
  const raw = ctx.store.getKv(key);
  const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
  // What the factory already did for this pull request outlives every other change of its state.
  const kept = (): Partial<MergeState> => ({
    ...(state.resolving && { resolving: state.resolving }),
    ...(state.refreshes && { refreshes: state.refreshes }),
    ...(state.refreshing && { refreshing: state.refreshing }),
    ...(state.rerun && { rerun: state.rerun }),
  });
  const save = (next: MergeState) => ctx.store.setKv(key, JSON.stringify({ ...kept(), ...next } satisfies MergeState));
  const now = (ctx.now ?? (() => new Date()))().getTime();
  const since = now - Date.parse(job.finishedAt ?? job.updatedAt);

  const pr = await gh.pullRequest(number);
  const backoff = state.backoff;
  const unchanged = backoff && backoff.sha === pr.headSha && backoff.mergeable === pr.mergeable ? backoff : undefined;
  if (pr.open && !pr.merged && unchanged && now < Date.parse(unchanged.nextChecksAt)) {
    if (since > WATCH_MS) return save({ status: "expired", why: EXPIRED });
    return save({ ...state, status: "blocked", why: unchanged.why });
  }
  if (pr.open && !pr.merged && pr.mergeable === false && since <= WATCH_MS && takeBack(ctx, job, pr.headSha, state, save)) return;
  const decision = mergeDecision(pr, pr.open ? await gh.checks(pr.headSha) : [], since);
  if (decision.kind === "gone" && decision.merged) recordMergeCommit(ctx, job, pr.mergeCommitSha);
  if (decision.kind === "gone") return save({ status: decision.merged ? "merged" : "closed", why: decision.merged ? "fundido por otra persona" : "cerrado sin fundir" });
  if (since > WATCH_MS) return save({ status: "expired", why: EXPIRED });
  if (decision.kind === "wait") return save({ reported: state.reported, status: "waiting", why: decision.why });
  // The checks of the refreshed tip ended, well or badly: its repository is free for the next one.
  if (state.refreshing && pr.headSha !== state.refreshing.head) {
    delete state.refreshing;
    followRemoteTip(ctx, job);
    if (!refreshedElsewhere(ctx, job, repository, now)) refreshing.delete(repository);
  }
  if (decision.kind === "blocked" && decision.failed) {
    const did = await unblock(job, gh, number, pr, decision.failed, state, refreshing.has(repository) && !state.refreshing, now);
    if (did?.kind === "done") {
      if (did.refreshed) refreshing.add(repository);
      Object.assign(state, did.patch);
      return save({ reported: state.reported, status: "waiting", why: did.why });
    }
    if (did?.kind === "turn") {
      // Not told to the pull request yet: it may still merge on its own. Looked at again soon, without asking GitHub on every pass.
      const why = `${decision.why}; ${did.why}`;
      return save({ status: "blocked", why, reported: state.reported, backoff: { sha: pr.headSha, mergeable: pr.mergeable, why, delayMs: FIRST_BACKOFF_MS, nextChecksAt: new Date(now + FIRST_BACKOFF_MS).toISOString() } });
    }
  }
  if (decision.kind === "blocked") {
    if (state.reported !== decision.key) {
      await gh.comment(number, `La fábrica no funde este pull request: ${decision.why}. Queda abierto; si se arregla, lo funde en la próxima revisión.`);
    }
    const delayMs = unchanged ? Math.min(unchanged.delayMs * 2, LAST_BACKOFF_MS) : FIRST_BACKOFF_MS;
    return save({
      status: "blocked",
      why: decision.why,
      reported: decision.key,
      backoff: { sha: pr.headSha, mergeable: pr.mergeable, why: decision.why, delayMs, nextChecksAt: new Date(now + delayMs).toISOString() },
    });
  }

  recordMergeCommit(ctx, job, await gh.merge(number, pr.headSha));
  save({ status: "merged", why: "fundido por la fábrica" });
  log.info("pull request merged", { job: job.id, url: job.delivery!.url });
  await gh.deleteBranch(job.delivery!.branch).catch((err) => log.warn("could not delete merged branch", { job: job.id, error: String(err) }));
  if (job.source?.kind === "github-issue") {
    await gh.comment(job.source.number, `La fábrica fundió ${job.delivery!.url}: el cambio ya está en la rama base.`);
  }
}

/** Keeps what the pull request was already told, so a problem reaching GitHub never repeats a comment. */
function waiting(ctx: FactoryContext, job: Job, why: string) {
  const raw = ctx.store.getKv(mergeKey(job.id));
  const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
  ctx.store.setKv(mergeKey(job.id), JSON.stringify({ ...state, status: "waiting", why: why.slice(0, 300) } satisfies MergeState));
}

/** One pass over every pull request waiting to be merged; one that fails never stops the others. */
export async function pollMerges(ctx: FactoryContext, api: (repository: string, line?: LineConfig) => MergeApi | undefined): Promise<void> {
  const now = (ctx.now ?? (() => new Date()))().getTime();
  const refreshing: Refreshing = new Set();
  for (const job of watchedJobs(ctx)) {
    const repository = pullRequestOf(job.delivery!.url!)?.repository;
    if (repository && holds(JSON.parse(ctx.store.getKv(mergeKey(job.id)) ?? "{}") as MergeState, now)) refreshing.add(repository);
  }
  for (const job of watchedJobs(ctx)) {
    const pr = pullRequestOf(job.delivery!.url!);
    const gh = pr && api(pr.repository, ctx.config.lines.find((l) => l.name === job.line));
    if (!pr || !gh) {
      waiting(ctx, job, "sin acceso a GitHub: iniciá sesión con `gh auth login` o definí GH_TOKEN");
      continue;
    }
    try {
      await watch(ctx, job, gh, pr.number, pr.repository, refreshing);
    } catch (err) {
      // A pause is not news about this pull request, and the ones left would only spend more or fail the same way.
      if (err instanceof GithubHalted || isRateLimit(err)) {
        log.warn("automatic merge cut short by the GitHub limit", { job: job.id, error: String(err) });
        return;
      }
      log.warn("automatic merge failed", { job: job.id, error: String(err) });
      waiting(ctx, job, `no se pudo consultar GitHub: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
