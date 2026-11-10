import { Octokit } from "@octokit/rest";
import type { FactoryContext } from "../app.js";
import type { LineConfig } from "../config.js";
import { GithubHalted, isRateLimit } from "../github-quota.js";
import { log } from "../log.js";
import { FACTORY_MARK } from "../intake/keys.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job } from "../state/store.js";
import { cleanupKey } from "./cleanup.js";
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
  /** When it finished, when GitHub says. */
  at?: string;
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
        ...runs.map((r) => ({ name: r.name, done: r.status === "completed", ok: PASSED.has(r.conclusion ?? ""), ...actionsRun(r.details_url), ...(r.completed_at && { at: r.completed_at }) })),
        ...statuses.map((s) => ({ name: s.context, done: s.state !== "pending", ok: s.state === "success", ...(s.updated_at && { at: s.updated_at }) })),
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
/** How long GitHub is given to show that the runs it was asked to run again are under way. */
const RERUN_SHOWS_MS = 2 * 60_000;

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
  /**
   * What the factory started and is still under way: a refresh (the tip it was asked for, gone once the new
   * tip's checks end) or, with `rerun`, failed runs run again on that tip (gone once its checks end).
   */
  refreshing?: { head: string; at: string; rerun?: true };
  /** The tip whose failed checks were already run again. */
  rerun?: string;
  /** The last pull request tip whose job went back to the queue to merge the base in. */
  resolving?: string;
  /** The `since` of the environment outage of its repository that held it (see `ChecksOutage`). */
  outage?: string;
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

/** Whether a refresh or a second run the state tells about still holds its repository. */
const holds = (state: MergeState, now: number) => Boolean(state.refreshing) && now - Date.parse(state.refreshing!.at) < REFRESH_HOLD_MS;

/** Whether what the factory started for this pull request has ended, so its repository is free for the next one. Asked only once every check of its tip is done. */
function ended(started: NonNullable<MergeState["refreshing"]>, head: string, now: number): boolean {
  return started.rerun ? started.head !== head || now - Date.parse(started.at) >= RERUN_SHOWS_MS : started.head !== head;
}

/**
 * What the factory does on its own for a pull request whose checks failed, before leaving it blocked. Most of
 * these are not the change's fault: the checks ran against an older base (a fix that reached the base since,
 * a workflow that changed), or a run was cancelled or failed once for no reason of the code.
 * - Behind its base: the base is merged in on GitHub (never a rebase or a forced push), so every check runs
 *   again on today's base. At most `MAX_REFRESHES` times in its life.
 * - Up to date: the failed GitHub Actions runs are run again, once per tip.
 * Either of them only with nothing else under way in the repository (`busy`): CI that shares an environment
 * keeps one run waiting and cancels the others, so a run started on top of another loses one of the two.
 * Returns what it did, or undefined when there is nothing left to try. Never throws: a GitHub that refuses means nothing was done.
 */
async function unblock(job: Job, gh: MergeApi, number: number, pr: PullRequestState, failed: Check[], state: MergeState, busy: boolean, now: number, after: Recovery): Promise<Unblocking | undefined> {
  try {
    // GitHub takes a moment to make the new tip: until it shows, the refresh asked for this one is still under way.
    const started = state.refreshing;
    if (showing(state, pr.headSha, now)) {
      return { kind: "done", why: started!.rerun ? "sus checks fallidos corren de nuevo" : "actualizándose con la rama base", patch: {} };
    }
    const refreshes = state.refreshes ?? 0;
    if (pr.base && gh.behind && gh.updateBranch && refreshes < MAX_REFRESHES && (await gh.behind(pr.base, pr.headSha))) {
      if (busy) return { kind: "turn", why: "espera su turno para actualizarse con la rama base" };
      const down = await baseFailures(gh, pr.base, failed, after.since);
      if (down.length) return { kind: "outage", failed: down };
      await gh.updateBranch(number, pr.headSha);
      log.info("pull request brought up to date with its base; its checks run again", { job: job.id, head: pr.headSha, refresh: refreshes + 1 });
      return { kind: "done", why: "actualizado con la rama base; esperando sus checks", patch: { refreshes: refreshes + 1, refreshing: { head: pr.headSha, at: new Date(now).toISOString() } }, refreshed: true };
    }
    const runs = [...new Set(failed.flatMap((c) => (c.run ? [c.run] : [])))];
    // A run spent while the environment was down does not count: once it is back, a held pull request gets one more.
    if (gh.rerun && runs.length && (state.rerun !== pr.headSha || after.again)) {
      if (busy) return { kind: "turn", why: "espera su turno para correr de nuevo sus checks" };
      const down = await baseFailures(gh, pr.base, failed, after.since);
      if (down.length) return { kind: "outage", failed: down };
      for (const run of runs) await gh.rerun(run);
      log.info("failed checks of a pull request run again", { job: job.id, head: pr.headSha, runs });
      return { kind: "done", why: "sus checks fallidos corren de nuevo", patch: { rerun: pr.headSha, refreshing: { head: pr.headSha, at: new Date(now).toISOString(), rerun: true } }, refreshed: true };
    }
  } catch (err) {
    if (err instanceof GithubHalted || isRateLimit(err)) throw err;
    log.warn("could not unblock a pull request; left as it is", { job: job.id, error: err instanceof Error ? err.message : String(err) });
  }
  return undefined;
}

/** What an environment that came back changes for a pull request: failures until `since` are not counted, and `again` allows one more run. */
type Recovery = { since?: number; again: boolean };

type Unblocking = { kind: "done"; why: string; patch: Partial<MergeState>; refreshed?: boolean } | { kind: "turn"; why: string } | { kind: "outage"; failed: Check[] };

/** Whether GitHub is still to show what the factory asked for this tip (a refresh or a second run). */
function showing(state: MergeState, head: string, now: number): boolean {
  const started = state.refreshing;
  return started?.head === head && now - Date.parse(started.at) < (started.rerun ? RERUN_SHOWS_MS : REFRESH_SHOWS_MS);
}

/**
 * The failed checks of a pull request that also ended failed at the tip of its base branch: the environment,
 * not the change. A base that cannot be read says nothing, so the pull request goes on as before.
 */
async function baseFailures(gh: MergeApi, base: string | undefined, failed: Check[], recovered?: number): Promise<Check[]> {
  if (!base) return [];
  const names = new Set(failed.map((c) => c.name));
  try {
    return (await gh.checks(base)).filter((c) => c.done && !c.ok && names.has(c.name) && !before(c.at, recovered));
  } catch (err) {
    if (err instanceof GithubHalted || isRateLimit(err)) throw err;
    log.warn("cannot read the checks of the base branch", { base, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** The other watched pull requests of the repository, with what the factory knows of each. */
function elsewhere(ctx: FactoryContext, job: Job, repository: string): { job: Job; state: MergeState }[] {
  return watchedJobs(ctx)
    .filter((j) => j.id !== job.id && pullRequestOf(j.delivery!.url!)?.repository === repository)
    .map((j) => ({ job: j, state: JSON.parse(ctx.store.getKv(mergeKey(j.id)) ?? "{}") as MergeState }));
}

/** Whether another watched pull request of the repository has a refresh or a second run under way. */
function refreshedElsewhere(ctx: FactoryContext, job: Job, repository: string, now: number): boolean {
  return elsewhere(ctx, job, repository).some((other) => holds(other.state, now));
}

/**
 * Whether another watched pull request of the repository, delivered a short while ago, is still waiting for its
 * first checks: a run started now could cancel the one it has waiting. Read from what is saved, without asking GitHub.
 */
function firstChecksElsewhere(ctx: FactoryContext, job: Job, repository: string, now: number): boolean {
  return elsewhere(ctx, job, repository).some((other) => other.state.status === "waiting" && now - Date.parse(other.job.finishedAt ?? other.job.updatedAt) < REFRESH_HOLD_MS);
}

/** A failed check seen at the tip of a pull request, remembered for a day to tell an environment down from a change. */
export interface CheckFailure {
  check: string;
  job: string;
  head: string;
  /** When it ended, when GitHub says: only these are compared in time. */
  at?: string;
  seen: string;
}

/**
 * A shared environment the checks of a repository use is down: the same check failed in several pull requests
 * a short while apart, or at the tip of the base branch too. While it lasts nothing is spent on the pull
 * requests it holds (no refresh, no second run, no comment).
 */
export interface ChecksOutage {
  /** The earliest failure. */
  since: string;
  checks: string[];
  /** The latest failure of each check. */
  lastFailure: Record<string, string>;
  /** The base branch whose checks failed too, when that is how it was seen. */
  base?: string;
  probe?: { job: string; head: string; at: string };
  probeDelayMs?: number;
  nextProbeAt?: string;
  baseLookAt?: string;
}

export const checksFailuresKey = (repository: string) => `checks-failures:${repository}`;
export const checksOutageKey = (repository: string) => `checks-outage:${repository}`;
/** When the environment of a repository was last seen back: failures that ended before then were its outage's. */
export const checksRecoveredKey = (repository: string) => `checks-recovered:${repository}`;
/** Failures of one check in different pull requests this close in time are the environment's. */
export const OUTAGE_WINDOW_MS = 2 * 3_600_000;
const FAILURES_KEPT_MS = 24 * 3_600_000;
/** How long after the last failure the recovery is first tried. */
const FIRST_PROBE_MS = 30 * 60_000;
/** Each probe that fails again doubles the wait for the next, up to this. */
const LAST_PROBE_MS = 240 * 60_000;
/** While an outage lasts, the checks of the base branch are read at most this often. */
const BASE_LOOK_MS = 5 * 60_000;

const iso = (ms: number) => new Date(ms).toISOString();
const two = (n: number) => String(n).padStart(2, "0");
/** Whether a failure ended no later than the moment the environment was seen back. */
const before = (at: string | undefined, recovered: number | undefined) => recovered !== undefined && at !== undefined && Date.parse(at) <= recovered;

function recoveredAt(ctx: FactoryContext, repository: string): number | undefined {
  const raw = ctx.store.getKv(checksRecoveredKey(repository));
  return raw ? Date.parse(raw) : undefined;
}

export function readOutage(ctx: FactoryContext, repository: string): ChecksOutage | undefined {
  const raw = ctx.store.getKv(checksOutageKey(repository));
  return raw ? (JSON.parse(raw) as ChecksOutage) : undefined;
}

/** What a pull request held by an outage says, in local time. */
export function outageWhy(repository: string, outage: ChecksOutage): string {
  const d = new Date(outage.since);
  return `entorno caído en ${repository} desde ${two(d.getHours())}:${two(d.getMinutes())} (checks: ${outage.checks.join(", ")})`;
}

/** Records the outage of a repository, or widens the one under way, with these failures. */
function recordOutage(ctx: FactoryContext, repository: string, failures: { check: string; at: string }[], base?: string): ChecksOutage {
  const known = readOutage(ctx, repository);
  const outage: ChecksOutage = known ?? { since: failures[0]!.at, checks: [], lastFailure: {} };
  for (const { check, at } of failures) {
    if (Date.parse(at) < Date.parse(outage.since)) outage.since = at;
    if (!outage.checks.includes(check)) outage.checks.push(check);
    const last = outage.lastFailure[check];
    if (!last || Date.parse(at) > Date.parse(last)) outage.lastFailure[check] = at;
  }
  if (base) outage.base = base;
  const last = Math.max(...Object.values(outage.lastFailure).map((at) => Date.parse(at)));
  outage.nextProbeAt = iso(last + (outage.probeDelayMs ?? FIRST_PROBE_MS));
  ctx.store.setKv(checksOutageKey(repository), JSON.stringify(outage));
  if (!known) log.warn("the environment of the checks of a repository looks down; nothing is spent on its pull requests meanwhile", { repository, checks: outage.checks, since: outage.since, ...(base && { base }) });
  return outage;
}

/**
 * Remembers the failed checks of a pull request's tip and returns those that also failed, close in time, in
 * other watched pull requests of the repository, with them and the jobs they belong to.
 */
function sameFailures(ctx: FactoryContext, job: Job, repository: string, head: string, failed: Check[], now: number): { failures: { check: string; at: string }[]; jobs: string[] } {
  const key = checksFailuresKey(repository);
  const recovered = recoveredAt(ctx, repository);
  failed = failed.filter((c) => !before(c.at, recovered));
  const names = new Set(failed.map((c) => c.name));
  const earlier = (JSON.parse(ctx.store.getKv(key) ?? "[]") as CheckFailure[]).filter((f) => now - Date.parse(f.seen) < FAILURES_KEPT_MS && !(f.job === job.id && f.head === head && names.has(f.check)));
  const mine: CheckFailure[] = failed.map((c) => ({ check: c.name, job: job.id, head, ...(c.at && { at: c.at }), seen: iso(now) }));
  ctx.store.setKv(key, JSON.stringify([...earlier, ...mine]));
  const watched = new Set(elsewhere(ctx, job, repository).map((other) => other.job.id));
  const failures: { check: string; at: string }[] = [];
  const jobs = new Set<string>();
  for (const m of mine) {
    if (!m.at) continue;
    const near = earlier.filter((f) => f.check === m.check && f.job !== job.id && watched.has(f.job) && f.at && !before(f.at, recovered) && Math.abs(Date.parse(f.at) - Date.parse(m.at!)) <= OUTAGE_WINDOW_MS);
    if (!near.length) continue;
    failures.push({ check: m.check, at: m.at }, ...near.map((f) => ({ check: f.check, at: f.at! })));
    for (const f of near) jobs.add(f.job);
  }
  return { failures, jobs: [...jobs] };
}

/** Marks other pull requests as held by the outage, so they are not told about checks that failed for its reason. */
function markHeld(ctx: FactoryContext, jobs: string[], repository: string, outage: ChecksOutage) {
  const why = outageWhy(repository, outage);
  for (const id of jobs) {
    const raw = ctx.store.getKv(mergeKey(id));
    const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
    if (FINAL.has(state.status)) continue;
    const blocked = state.status === "blocked" && { why, ...(state.backoff && { backoff: { ...state.backoff, why } }) };
    ctx.store.setKv(mergeKey(id), JSON.stringify({ ...state, ...blocked, outage: outage.since } satisfies MergeState));
  }
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
  // Its last work copy is still waiting to be removed: the job would start in a half-removed folder. The tip stays untried, so a later look takes it back.
  if (ctx.store.getKv(cleanupKey(job.id))) return false;
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

async function watch(ctx: FactoryContext, job: Job, gh: MergeApi, number: number, repository = "", refreshing: Refreshing = new Set(), passed: Passed = new Map()) {
  const key = mergeKey(job.id);
  const raw = ctx.store.getKv(key);
  const state: MergeState = raw ? JSON.parse(raw) : { status: "waiting" };
  // What the factory already did for this pull request outlives every other change of its state.
  const kept = (): Partial<MergeState> => ({
    ...(state.resolving && { resolving: state.resolving }),
    ...(state.refreshes && { refreshes: state.refreshes }),
    ...(state.refreshing && { refreshing: state.refreshing }),
    ...(state.rerun && { rerun: state.rerun }),
    ...(state.outage && { outage: state.outage }),
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
  const checks = pr.open ? await gh.checks(pr.headSha) : [];
  seenPassing(passed, repository, checks);
  const decision = mergeDecision(pr, checks, since);
  if (decision.kind === "gone" && decision.merged) recordMergeCommit(ctx, job, pr.mergeCommitSha);
  if (decision.kind === "gone") return save({ status: decision.merged ? "merged" : "closed", why: decision.merged ? "fundido por otra persona" : "cerrado sin fundir" });
  if (since > WATCH_MS) return save({ status: "expired", why: EXPIRED });
  if (decision.kind === "wait") return save({ reported: state.reported, status: "waiting", why: decision.why });
  // Some checks failed and others are still running: starting anything now would cancel them, and the repository is not free yet.
  if (decision.kind === "blocked" && decision.failed && checks.some((c) => !c.done)) {
    return save({ reported: state.reported, status: "waiting", why: `${decision.why}; esperando los demás checks` });
  }
  // Every check of the tip ended, well or badly: its repository is free for the next one.
  if (state.refreshing && ended(state.refreshing, pr.headSha, now)) {
    if (!state.refreshing.rerun) followRemoteTip(ctx, job);
    delete state.refreshing;
    if (!refreshedElsewhere(ctx, job, repository, now)) refreshing.delete(repository);
  }
  // Held by an outage: told nothing, nothing spent, looked at again like any blocked one.
  const held = (outage: ChecksOutage) => {
    const why = outageWhy(repository, outage);
    const delayMs = unchanged ? Math.min(unchanged.delayMs * 2, LAST_BACKOFF_MS) : FIRST_BACKOFF_MS;
    return save({ status: "blocked", why, reported: state.reported, outage: outage.since, backoff: { sha: pr.headSha, mergeable: pr.mergeable, why, delayMs, nextChecksAt: iso(now + delayMs) } });
  };
  if (decision.kind === "blocked" && decision.failed && !showing(state, pr.headSha, now)) {
    const failed = decision.failed;
    const same = sameFailures(ctx, job, repository, pr.headSha, failed, now);
    const known = readOutage(ctx, repository);
    const ours = failed.filter((c) => known?.checks.includes(c.name));
    if (same.failures.length || ours.length) {
      if (known && probeFailed(known, job, pr.headSha, ours, now)) ctx.store.setKv(checksOutageKey(repository), JSON.stringify(known));
      const outage = recordOutage(ctx, repository, [...same.failures, ...ours.map((c) => ({ check: c.name, at: c.at ?? iso(now) }))]);
      markHeld(ctx, same.jobs, repository, outage);
      return held(outage);
    }
  }
  if (decision.kind === "blocked" && decision.failed) {
    const busy = (refreshing.has(repository) && !state.refreshing) || firstChecksElsewhere(ctx, job, repository, now);
    const again = Boolean(state.outage) && !readOutage(ctx, repository);
    const did = await unblock(job, gh, number, pr, decision.failed, state, busy, now, { since: recoveredAt(ctx, repository), again });
    if (did?.kind === "outage") {
      const names = new Set(did.failed.map((c) => c.name));
      const failures = [...did.failed, ...decision.failed.filter((c) => names.has(c.name))].map((c) => ({ check: c.name, at: c.at ?? iso(now) }));
      return held(recordOutage(ctx, repository, failures, pr.base));
    }
    if (did?.kind === "done") {
      if (did.refreshed) refreshing.add(repository);
      Object.assign(state, did.patch);
      // The one more run after the environment came back is spent.
      if (did.refreshed && again) delete state.outage;
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

/** The checks that ended well at the tips looked at in a pass, per repository: what tells an environment is back. */
type Passed = Map<string, Check[]>;

function seenPassing(passed: Passed, repository: string, checks: Check[]) {
  const ok = checks.filter((c) => c.done && c.ok && c.at);
  if (ok.length) passed.set(repository, [...(passed.get(repository) ?? []), ...ok]);
}

/**
 * Whether the probe of an outage, run on this pull request, failed again: then the probe is over and the next
 * one waits twice as long. Changes `outage` in place.
 */
function probeFailed(outage: ChecksOutage, job: Job, head: string, failed: Check[], now: number): boolean {
  const probe = outage.probe;
  if (!probe || probe.job !== job.id || probe.head !== head) return false;
  if (!failed.some((c) => Date.parse(c.at ?? iso(now)) > Date.parse(probe.at))) return false;
  delete outage.probe;
  outage.probeDelayMs = Math.min((outage.probeDelayMs ?? FIRST_PROBE_MS) * 2, LAST_PROBE_MS);
  log.info("the environment of the checks is still down; next probe later", { job: job.id, delayMinutes: outage.probeDelayMs / 60_000 });
  return true;
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
  const passed: Passed = new Map();
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
      await watch(ctx, job, gh, pr.number, pr.repository, refreshing, passed);
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
  for (const [key] of ctx.store.kvWithPrefix("checks-outage:")) {
    const repository = key.slice("checks-outage:".length);
    try {
      await followOutage(ctx, api, repository, refreshing, passed.get(repository) ?? [], now);
    } catch (err) {
      if (err instanceof GithubHalted || isRateLimit(err)) {
        log.warn("environment outage follow-up cut short by the GitHub limit", { repository, error: String(err) });
        return;
      }
      log.warn("could not follow the environment outage of a repository", { repository, error: String(err) });
    }
  }
}

/**
 * What follows an environment outage after the pull requests of its repository were looked at: forgotten once
 * no pull request it held is left; over once one of its checks ended well after its last failure, at a watched
 * tip or at the tip of the base branch; otherwise probed now and then by running the failed checks of a single
 * held pull request again, when nothing else runs in the repository.
 */
async function followOutage(ctx: FactoryContext, api: (repository: string, line?: LineConfig) => MergeApi | undefined, repository: string, refreshing: Refreshing, passed: Check[], now: number) {
  const outage = readOutage(ctx, repository);
  if (!outage) return;
  const watched = watchedJobs(ctx)
    .filter((j) => pullRequestOf(j.delivery!.url!)?.repository === repository)
    .map((j) => ({ job: j, state: JSON.parse(ctx.store.getKv(mergeKey(j.id)) ?? "{}") as MergeState }));
  const held = watched.filter((w) => w.state.outage);
  if (!held.length) {
    ctx.store.deleteKv(checksOutageKey(repository));
    log.info("environment outage forgotten: no pull request it held is left", { repository });
    return;
  }
  const line = ctx.config.lines.find((l) => l.name === held[0]!.job.line);
  const gh = api(repository, line);
  if (!gh) return;
  const save = () => ctx.store.setKv(checksOutageKey(repository), JSON.stringify(outage));

  let seen = passed;
  const base = outage.base ?? line?.baseBranch;
  if (!backAt(outage, seen) && base && (!outage.baseLookAt || now - Date.parse(outage.baseLookAt) >= BASE_LOOK_MS)) {
    outage.baseLookAt = iso(now);
    save();
    seen = [...seen, ...(await gh.checks(base)).filter((c) => c.done && c.ok && c.at)];
  }
  const back = backAt(outage, seen);
  if (back !== undefined) {
    ctx.store.deleteKv(checksOutageKey(repository));
    ctx.store.setKv(checksRecoveredKey(repository), iso(back));
    // Looked at again on the next pass, without waiting out what the outage left them.
    for (const { job, state } of held) {
      const { backoff: _backoff, ...rest } = state;
      ctx.store.setKv(mergeKey(job.id), JSON.stringify(rest satisfies MergeState));
    }
    log.info("the environment of the checks is back; the pull requests it held get their failed checks run again, one at a time", { repository, checks: outage.checks });
    return;
  }

  // A probe that never showed its end in the time a run is given counts as failed.
  if (outage.probe && (now - Date.parse(outage.probe.at) >= REFRESH_HOLD_MS || !held.some((w) => w.job.id === outage.probe!.job))) {
    delete outage.probe;
    outage.probeDelayMs = Math.min((outage.probeDelayMs ?? FIRST_PROBE_MS) * 2, LAST_PROBE_MS);
    outage.nextProbeAt = iso(now + outage.probeDelayMs);
    save();
  }
  if (outage.probe || !gh.rerun || (outage.nextProbeAt && now < Date.parse(outage.nextProbeAt))) return;
  const busy = refreshing.has(repository) || watched.some((w) => holds(w.state, now) || (w.state.status === "waiting" && now - Date.parse(w.job.finishedAt ?? w.job.updatedAt) < REFRESH_HOLD_MS));
  if (busy) return;
  for (const { job, state } of held) {
    const number = pullRequestOf(job.delivery!.url!)!.number;
    const pr = await gh.pullRequest(number);
    if (!pr.open || pr.merged) continue;
    const checks = await gh.checks(pr.headSha);
    if (checks.some((c) => !c.done)) continue;
    const runs = [...new Set(checks.filter((c) => !c.ok).flatMap((c) => (c.run ? [c.run] : [])))];
    if (!runs.length) continue;
    for (const run of runs) await gh.rerun(run);
    const at = iso(now);
    outage.probe = { job: job.id, head: pr.headSha, at };
    save();
    // Its own second run stays untouched: the probe is the outage's, not the pull request's.
    const { backoff: _backoff, ...rest } = state;
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ ...rest, status: "waiting", why: "probando si el entorno se recuperó: sus checks fallidos corren de nuevo", refreshing: { head: pr.headSha, at, rerun: true } } satisfies MergeState));
    refreshing.add(repository);
    log.info("probing whether the environment of the checks is back", { repository, job: job.id, head: pr.headSha, runs });
    return;
  }
}

/** When one of the outage's checks ended well after its last failure, if it did. */
function backAt(outage: ChecksOutage, passed: Check[]): number | undefined {
  const times = passed.filter((c) => outage.checks.includes(c.name) && c.at && Date.parse(c.at) > Date.parse(outage.lastFailure[c.name] ?? outage.since)).map((c) => Date.parse(c.at!));
  return times.length ? Math.max(...times) : undefined;
}
