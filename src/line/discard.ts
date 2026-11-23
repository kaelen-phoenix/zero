import { directMerges, getJob, type FactoryContext, type MergeApiFactory } from "../app.js";
import type { LineConfig } from "../config.js";
import { lineRepository } from "../intake/github.js";
import { log } from "../log.js";
import { tryGit } from "../shell.js";
import type { Job } from "../state/store.js";
import { checkedOutAt } from "../workspace.js";
import { mergeKey, pullRequestOf, type MergeApi, type MergeState, type MergeVia, type PullRequestState } from "./automerge.js";
import { discardedByYou, finalizeJob, prRefreshKey } from "./finish.js";
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
