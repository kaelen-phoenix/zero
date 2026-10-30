import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { LineConfig, Signature } from "../config.js";
import { git, tryGit } from "../shell.js";
import { withTrailer } from "../signature.js";
import type { Delivery } from "../state/store.js";
import { createGitHubTracker } from "../tracker.js";
import { checkedOutAt, FACTORY_IDENTITY, removeWorkCopy, type WorkCopy } from "../workspace.js";

export type IntegrateResult = { ok: true; delivery: Delivery } | { ok: false; reason: string };

export interface IntegrateOptions {
  jobId: string;
  title: string;
  /** Already signed by the caller; `signature` is for the merge commit's trailer. */
  body: string;
  signature?: Signature;
  /** Directory for a temporary copy when the base branch is not checked out anywhere. */
  scratchDir: string;
}

function mergeIn(dir: string, branch: string, message: string): boolean {
  const r = spawnSync("git", [...FACTORY_IDENTITY, "merge", "--no-ff", "-q", "-m", message, branch], { cwd: dir, encoding: "utf8", windowsHide: true });
  if (r.status === 0) return true;
  tryGit(["merge", "--abort"], dir);
  return false;
}

/**
 * Merges the job's branch into the line's base branch without ever touching
 * the owner's uncommitted work: if the base is open with local changes, or the
 * merge conflicts, nothing changes and the caller parks the job.
 */
export function mergeIntoBase(line: LineConfig, copy: WorkCopy, opts: IntegrateOptions): IntegrateResult {
  const message = withTrailer(`zero: ${opts.title} (${opts.jobId})`, opts.signature);
  const owner = checkedOutAt(line.repo, line.baseBranch);
  if (owner) {
    if (git(["status", "--porcelain", "--untracked-files=no"], owner)) {
      return { ok: false, reason: `La rama ${line.baseBranch} está abierta en ${owner} con cambios sin guardar. Guardalos (commit) o descartalos y la fábrica integra el trabajo.` };
    }
    if (!mergeIn(owner, copy.branch, message)) {
      return { ok: false, reason: `Integrar ${copy.branch} en ${line.baseBranch} produce conflictos (o pisaría archivos sin seguimiento en ${owner}). La rama ${copy.branch} queda lista para resolverlo.` };
    }
  } else {
    const temp = join(opts.scratchDir, `merge-${opts.jobId}`);
    removeWorkCopy(line.repo, temp);
    git(["worktree", "add", "-q", temp, line.baseBranch], line.repo);
    try {
      if (!mergeIn(temp, copy.branch, message)) {
        return { ok: false, reason: `Integrar ${copy.branch} en ${line.baseBranch} produce conflictos. La rama ${copy.branch} queda lista para resolverlo.` };
      }
    } finally {
      removeWorkCopy(line.repo, temp);
    }
  }
  return { ok: true, delivery: { mode: "merge", branch: copy.branch, commit: git(["rev-parse", line.baseBranch], line.repo) } };
}

export function githubToken(): string | undefined {
  const fromEnv = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  const r = spawnSync("gh", ["auth", "token"], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

/** owner/repo from a GitHub remote URL (https or ssh). */
export function githubRepository(url: string): string | undefined {
  return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
}

/** Published from the line's repository: its remote is GitHub, and the branch is already there (a box copy is fetched back first). */
async function openPullRequest(line: LineConfig, copy: WorkCopy, opts: IntegrateOptions): Promise<IntegrateResult> {
  const url = tryGit(["remote", "get-url", line.remote], line.repo);
  const repository = url && githubRepository(url);
  if (!repository) return { ok: false, reason: `El remoto "${line.remote}" no es un repositorio de GitHub.` };
  const token = githubToken();
  if (!token) return { ok: false, reason: "Para abrir la solicitud de cambio hace falta GH_TOKEN o haber iniciado sesión con `gh auth login`." };
  const push = spawnSync("git", ["push", "-q", "-u", line.remote, copy.branch], { cwd: line.repo, encoding: "utf8", windowsHide: true });
  if (push.status !== 0) return { ok: false, reason: `No se pudo publicar la rama: ${(push.stderr || push.stdout).trim()}` };
  const pr = await createGitHubTracker(token, repository).openPullRequest({ head: copy.branch, base: line.baseBranch, title: opts.title, body: opts.body });
  return { ok: true, delivery: { mode: "pull-request", branch: copy.branch, url: pr, ...(line.autoMerge && { autoMerge: true }) } };
}

export async function integrate(line: LineConfig, copy: WorkCopy, opts: IntegrateOptions): Promise<IntegrateResult> {
  switch (line.integrate) {
    case "merge":
      return mergeIntoBase(line, copy, opts);
    case "branch":
      return { ok: true, delivery: { mode: "branch", branch: copy.branch } };
    case "pull-request":
      return openPullRequest(line, copy, opts);
  }
}
