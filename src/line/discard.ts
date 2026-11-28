import { directMerges, getJob, type FactoryContext, type MergeApiFactory } from "../app.js";
import type { LineConfig } from "../config.js";
import { lineRepository } from "../intake/github.js";
import { log } from "../log.js";
import { spawnGit, tryGit } from "../shell.js";
import type { Job, Store } from "../state/store.js";
import { checkedOutAt } from "../workspace.js";
import { mergeKey, pullRequestOf, type MergeApi, type MergeState, type MergeVia, type PullRequestState } from "./automerge.js";
import { discardedByFactory, discardedByYou, finalizeJob, prRefreshKey } from "./finish.js";
import { scrubLocal } from "./research.js";

/** What discarding a job did. A GitHub or git failure is a problem here, never a job left undiscarded. */
export interface DiscardOutcome {
  job: Job;
  /** The job's GitHub pull request, when it has one; `was` when there was nothing to close. */
  pullRequest?: { url: string; closed: boolean; was?: "merged" | "closed" };
  /** The job's branch and where it was deleted; `kept` says why zero does not delete it anywhere. */
  branch: { name: string; local: boolean; remote: boolean; kept?: string };
  problems: string[];
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether the factory's own record says a delivered pull request is no longer open, for when GitHub cannot be asked. */
function recordedGone(ctx: FactoryContext, job: Job): boolean {
  if (job.delivery?.commit) return true;
  const raw = ctx.store.getKv(mergeKey(job.id));
  const status = raw ? (JSON.parse(raw) as MergeState).status : undefined;
  return status === "merged" || status === "closed";
}

/** Why a job in this state cannot be discarded, if it cannot. */
export function discardRefusal(job: Job): string | undefined {
  if (job.status === "running") return `El trabajo ${job.id} está en marcha: detenelo primero con \`zero stop ${job.id}\`.`;
  if (job.status === "stopped") return `El trabajo ${job.id} ya está detenido: no hay nada que descartar.`;
  if (job.status === "delivered" && !(job.delivery?.url && pullRequestOf(job.delivery.url))) return `El trabajo ${job.id} ya está entregado y no tiene un pull request abierto: no hay nada que descartar.`;
  return undefined;
}

/** Throws when a job in this state cannot be discarded. */
function checkDiscardable(job: Job) {
  const refusal = discardRefusal(job);
  if (refusal) throw new Error(refusal);
}

/** Why a job's branch is never deleted: only the factory's own `zero/` branches go, and never a base branch. */
function branchKept(ctx: FactoryContext, branch: string, prBase?: string): string | undefined {
  if (branch === prBase || ctx.config.lines.some((l) => l.baseBranch === branch)) return "es una rama base";
  if (!branch.startsWith("zero/")) return "no es una rama de la fábrica (zero/…)";
  return undefined;
}

/** Comments on an open pull request and closes it; what GitHub refuses goes to `problems`. */
async function closePullRequest(gh: MergeApi, number: number, url: string, body: string, problems: string[]): Promise<boolean> {
  try {
    await gh.comment(number, body);
  } catch (err) {
    problems.push(`No pude comentar en el pull request ${url}: ${message(err)}`);
  }
  try {
    if (!gh.close) throw new Error("este acceso a GitHub no sabe cerrarlo");
    await gh.close(number);
    return true;
  } catch (err) {
    problems.push(`No pude cerrar el pull request ${url}: ${message(err)}`);
    return false;
  }
}

/** Deletes a branch of the line's repository unless it is checked out somewhere. */
function deleteLocalBranch(line: LineConfig, branch: string, problems: string[]): boolean {
  try {
    if (tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], line.repo) === undefined) return false;
    if (checkedOutAt(line.repo, branch)) {
      problems.push(`La rama ${branch} está abierta en una copia de trabajo: no la borré.`);
      return false;
    }
    if (tryGit(["branch", "-D", branch], line.repo) !== undefined) return true;
    problems.push(`No pude borrar la rama ${branch} del repositorio de la línea.`);
  } catch (err) {
    problems.push(`No pude borrar la rama ${branch} del repositorio de la línea: ${message(err)}`);
  }
  return false;
}

/** Deletes a branch on GitHub; one that is not there (never pushed, or already deleted) is not a problem. */
async function deleteRemoteBranch(gh: MergeApi, branch: string, problems: string[]): Promise<boolean> {
  try {
    await gh.deleteBranch(branch);
    return true;
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 404 && !/reference does not exist/i.test(message(err))) problems.push(`No pude borrar la rama ${branch} en GitHub: ${message(err)}`);
    return false;
  }
}

/** The GitHub repository of a line's remote, if git can read it. */
function ownRepository(line: LineConfig | undefined): string | undefined {
  try {
    return line && lineRepository(line);
  } catch {
    return undefined;
  }
}

/**
 * Discards a job because the person in charge asked for it (CLI, chat or panel): a failed, queued or waiting one, or
 * a delivered one whose pull request is still open. It ends `stopped` through `finalizeJob` before anything is closed
 * or deleted, so the daemon no longer builds or merges it; then its open pull request is commented and closed and its
 * branch deleted in the line's repository and on GitHub. Every refusal comes before anything is written.
 */
export async function discardJob(ctx: FactoryContext, id: string, opts: { reason?: string; via: MergeVia; api?: MergeApiFactory }): Promise<DiscardOutcome> {
  const found = getJob(ctx, id);
  checkDiscardable(found);
  const reason = opts.reason?.trim() || undefined;
  const problems: string[] = [];
  const line = ctx.config.lines.find((l) => l.name === found.line);
  const url = found.delivery?.url;
  const pull = url ? pullRequestOf(url) : undefined;
  const repository = pull?.repository ?? ownRepository(line);
  const gh = repository ? (opts.api ?? directMerges(ctx))(repository, line) : undefined;

  let pr: PullRequestState | undefined;
  if (pull && !gh) problems.push(`Sin acceso a GitHub para cerrar el pull request ${url}: iniciá sesión con \`gh auth login\` o definí GH_TOKEN.`);
  if (pull && gh) {
    try {
      pr = await gh.pullRequest(pull.number);
    } catch (err) {
      problems.push(`No pude leer el pull request ${url}: ${message(err)}`);
    }
  }
  // Read again: the factory may have moved it while GitHub answered.
  const job = getJob(ctx, id);
  checkDiscardable(job);
  const gone = pr && (pr.merged || !pr.open);
  if (job.status === "delivered" && (pr ? gone : recordedGone(ctx, job))) {
    throw new Error(`El pull request del trabajo ${id} ya no está abierto${pr?.merged ? " (se fundió)" : ""}: no hay nada que descartar.`);
  }

  // A pending update of its pull request would leave the job delivered.
  ctx.store.deleteKv(prRefreshKey(id));
  const done = await finalizeJob(ctx, job, "stopped", { reason: discardedByYou(reason), delivery: job.delivery });

  let closed = false;
  // One that could not be read is tried all the same: the records say it is open.
  if (pull && gh && !gone) {
    const why = reason ? `: ${line ? scrubLocal(reason, line) : reason}` : "";
    closed = await closePullRequest(gh, pull.number, url!, `La fábrica descartó el trabajo \`${id}\` a pedido de la persona responsable${why}${/[.!?…]$/.test(why) ? "" : "."} Este pull request se cierra sin fundirlo.`, problems);
  }

  const name = job.delivery?.branch ?? `zero/${id}`;
  const kept = branchKept(ctx, name, pr?.base);
  const local = !kept && line ? deleteLocalBranch(line, name, problems) : false;
  const remote = !kept && gh ? await deleteRemoteBranch(gh, name, problems) : false;

  ctx.tracer.start("zero.discard", { jobId: id, parentId: ctx.tracer.jobSpanId(id), attrs: { "zero.discard.via": opts.via, "zero.discard.pull_closed": closed, "zero.discard.problems": problems.length } }).end("ok");
  log.info("job discarded", { job: id, via: opts.via, url, closed, branch: name, local, remote, problems: problems.length });
  return {
    job: done,
    ...(pull && { pullRequest: { url: url!, closed, ...(gone && { was: pr!.merged ? ("merged" as const) : ("closed" as const) }) } }),
    branch: { name, local, remote, ...(kept && { kept }) },
    problems,
  };
}

/** A line is looked at again after this long, or as soon as another job of it fails. */
export const RESOLVED_MS = 60_000;
/** A pull request closed without merging can still be reopened and merged, so it is only asked about less often. */
const CLOSED_WAIT_MS = 24 * 60 * 60 * 1000;

/** What the last look at a line's failed jobs left, so nothing unchanged is asked or compared again. */
interface ResolvedLook {
  at: string;
  jobs: Record<string, { failed: string; compared?: string; askAfter?: string }>;
}

export const resolvedKey = (line: string) => `resolved:${line}`;

function readLook(store: Store, line: string): ResolvedLook | undefined {
  try {
    const raw = store.getKv(resolvedKey(line));
    return raw ? (JSON.parse(raw) as ResolvedLook) : undefined;
  } catch {
    return undefined;
  }
}

const failedAt = (job: Job) => job.finishedAt ?? job.updatedAt;
const branchOf = (job: Job) => job.delivery?.branch ?? `zero/${job.id}`;

/** The tips of the line's local branches. */
function branchTips(line: LineConfig): Map<string, string> {
  const out = tryGit(["for-each-ref", "--format=%(objectname) %(refname)", "refs/heads"], line.repo) ?? "";
  return new Map(
    out
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(l.indexOf(" ") + 1).replace("refs/heads/", ""), l.slice(0, l.indexOf(" "))]),
  );
}

/** The line's base on its remote, brought up to date when the remote answers; undefined when there is none. */
function remoteBase(line: LineConfig): string | undefined {
  const ref = `refs/remotes/${line.remote}/${line.baseBranch}`;
  if (tryGit(["remote", "get-url", line.remote], line.repo) !== undefined) {
    const fetched = spawnGit(["fetch", "-q", line.remote, `+refs/heads/${line.baseBranch}:${ref}`], line.repo, { timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (fetched.status !== 0) log.warn("cannot fetch the base branch to look for resolved jobs", { line: line.name, remote: line.remote, error: (fetched.stderr || String(fetched.error ?? "")).trim().slice(0, 300) });
  }
  return tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], line.repo);
}

const contains = (repo: string, commit: string, tip: string) => tryGit(["merge-base", "--is-ancestor", commit, tip], repo) !== undefined;

/**
 * Whether the branch was ever worked on: a commit of the job's, or one made on the branch itself. A branch still where
 * it started (a job that failed before its first commit) is an ancestor of the base too, with nothing of its own in it.
 */
function ownWork(repo: string, job: Job, branch: string, tip: string): boolean {
  if (tryGit(["log", "-1", "--format=%H", "--fixed-strings", `--grep=zero(${job.id})`, tip], repo)) return true;
  const commits = (tryGit(["log", "-g", "--format=%H %gs", `refs/heads/${branch}`], repo) ?? "").split("\n").filter((l) => /^\w+ commit\b/.test(l));
  return commits.some((l) => contains(repo, l.split(" ")[0]!, tip));
}

/** The paths two trees differ in; undefined when git cannot tell. */
function changedPaths(repo: string, from: string, to: string): string[] | undefined {
  const r = spawnGit(["diff-tree", "-r", "-z", "--name-only", "--no-renames", from, to], repo, { maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.split("\0").filter(Boolean) : undefined;
}

/** Why the branch's work is already in the base, if it is. */
function inBase(line: LineConfig, job: Job, branch: string, tip: string, base: string): string | undefined {
  const name = `${line.remote}/${line.baseBranch}`;
  if (contains(line.repo, tip, base)) return ownWork(line.repo, job, branch, tip) ? `su rama ${branch} ya está en ${name}` : undefined;
  const start = tryGit(["merge-base", tip, base], line.repo);
  const own = start ? changedPaths(line.repo, start, tip) : undefined;
  const differ = own?.length ? changedPaths(line.repo, tip, base) : undefined;
  if (!own || !differ) return undefined;
  const missing = new Set(differ);
  return own.some((p) => missing.has(p)) ? undefined : `los cambios de su rama ${branch} ya están en ${name}`;
}

/** A failed job `discardResolved` closed. */
export interface ClosedJob {
  line: string;
  job: string;
}

/** Closes the failed jobs of one line whose work is already in. */
async function discardResolvedIn(ctx: FactoryContext, line: LineConfig, now: Date, merges?: MergeApiFactory, onClosed?: (closed: ClosedJob) => void): Promise<number> {
  const failed = ctx.store.listJobs({ line: line.name, status: ["failed"], limit: -1 });
  if (!failed.length) return 0;
  const last = readLook(ctx.store, line.name);
  const recent = last !== undefined && Math.abs(now.getTime() - Date.parse(last.at)) < RESOLVED_MS;
  if (recent && failed.every((j) => last.jobs[j.id]?.failed === failedAt(j))) return 0;

  const look: ResolvedLook = { at: now.toISOString(), jobs: {} };
  const tips = branchTips(line);
  const tipOf = (j: Job) => (branchOf(j) === line.baseBranch ? undefined : tips.get(branchOf(j)));
  const base = failed.some(tipOf) ? remoteBase(line) : undefined;
  let closed = 0;
  for (const job of failed) {
    const before = last?.jobs[job.id];
    const seen: ResolvedLook["jobs"][string] = { failed: failedAt(job), ...(before?.failed === failedAt(job) && { compared: before.compared, askAfter: before.askAfter }) };
    look.jobs[job.id] = seen;
    try {
      let why: string | undefined;
      const tip = tipOf(job);
      if (tip && base && seen.compared !== `${tip} ${base}`) {
        why = inBase(line, job, branchOf(job), tip, base);
        if (!why) seen.compared = `${tip} ${base}`;
      }
      const url = job.delivery?.url;
      const pull = url ? pullRequestOf(url) : undefined;
      const gh = !why && pull && !(seen.askAfter && now.getTime() < Date.parse(seen.askAfter)) ? merges?.(pull.repository, line) : undefined;
      if (gh && pull) {
        const pr = await gh.pullRequest(pull.number);
        if (pr.merged) why = `su pull request ${url} ya se fundió`;
        else seen.askAfter = pr.open ? undefined : new Date(now.getTime() + CLOSED_WAIT_MS).toISOString();
      }
      if (!why) continue;
      // Read again: it may have been retried or discarded while GitHub answered.
      const current = ctx.store.getJob(job.id);
      if (!current || current.status !== "failed" || failedAt(current) !== failedAt(job)) continue;
      await finalizeJob(ctx, current, "stopped", { reason: discardedByFactory(why), delivery: current.delivery });
      closed++;
      onClosed?.({ line: line.name, job: job.id });
      log.info("failed job closed: its work is already in", { job: job.id, line: line.name, why });
    } catch (err) {
      log.warn("cannot tell whether a failed job is already resolved", { job: job.id, line: line.name, error: String(err) });
    }
  }
  ctx.store.setKv(resolvedKey(line.name), JSON.stringify(look));
  return closed;
}

/**
 * Closes on its own, as `stopped` through `finalizeJob`, the failed jobs whose work is already in: GitHub says their
 * pull request was merged, or the base branch on the line's remote already has their branch or the same content. Any
 * other failed job stays as it is, and nothing is asked of the person in charge. Returns how many it closed, and tells
 * `onClosed` each one.
 */
export async function discardResolved(ctx: FactoryContext, now: Date, merges?: MergeApiFactory, onClosed?: (closed: ClosedJob) => void): Promise<number> {
  let closed = 0;
  for (const line of ctx.config.lines) {
    if (line.package) continue;
    try {
      closed += await discardResolvedIn(ctx, line, now, merges, onClosed);
    } catch (err) {
      log.warn("cannot look for resolved jobs", { line: line.name, error: String(err) });
    }
  }
  return closed;
}
