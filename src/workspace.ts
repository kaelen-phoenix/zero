import { existsSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { git, tryGit } from "./shell.js";

/** Commits made by the factory are authored by it, not by the owner. */
export const FACTORY_IDENTITY = ["-c", "user.name=zero", "-c", "user.email=zero@kaelen.invalid"];

export interface ChangedFile {
  /** git status letter: A, M, D, R... */
  status: string;
  path: string;
}

/** A job's own copy of the line's repository, on its own branch. */
export interface WorkCopy {
  cwd: string;
  branch: string;
  base: string;
  hasChanges(): boolean;
  /** Commits everything; returns false when there was nothing to commit. */
  commitAll(message: string): boolean;
  /** Drops uncommitted changes, including new files (ignored files such as node_modules are kept). */
  discardChanges(): void;
  /** Files changed on the branch relative to the base. */
  changedFiles(): ChangedFile[];
  /** Lines added on the branch relative to the base, per file. */
  addedLines(): { path: string; text: string }[];
  commitsAhead(): number;
  /** Makes the job's branch available in the line's repository, ready to integrate. */
  publish(): void;
}

/** Untracked files present in a work copy, e.g. what a setup command such as `npm install` created. */
export function untrackedPaths(cwd: string): string[] {
  return git(["status", "--porcelain", "--untracked-files=normal"], cwd)
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3).replace(/^"|"$/g, ""));
}

export async function openWorkCopy(repo: string, base: string, branch: string, path: string, exclude: string[] = []): Promise<WorkCopy> {
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    git(["worktree", "prune"], repo);
    const branchExists = tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo) !== undefined;
    git(branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base], repo);
  }
  return workCopyAt(path, base, branch, exclude);
}

/**
 * The work copy for the isolation box: an independent clone that shares no
 * files with the owner's repository (`--no-hardlinks`), so nothing done in the
 * box can reach it. The branch is fetched back when the job is ready.
 */
export async function openCloneCopy(repo: string, base: string, branch: string, path: string, exclude: string[] = []): Promise<WorkCopy> {
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    const branchExists = tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo) !== undefined;
    git(["clone", "-q", "--no-hardlinks", "--branch", branchExists ? branch : base, repo, path], repo);
    if (!branchExists) git(["checkout", "-q", "-b", branch], path);
    // The base must exist locally for diffs against it.
    if (branchExists) git(["branch", "-q", "--force", base, `origin/${base}`], path);
  }
  const copy = workCopyAt(path, base, branch, exclude);
  return {
    ...copy,
    publish: () => void git(["fetch", "-q", path, `+refs/heads/${branch}:refs/heads/${branch}`], repo),
  };
}

/**
 * `exclude` lists paths the factory itself created (setup output). They are
 * never committed and never discarded.
 */
export function workCopyAt(cwd: string, base: string, branch: string, exclude: string[] = []): WorkCopy {
  const scope = ["--", ".", ...exclude.map((p) => `:(exclude)${p}`)];
  return {
    cwd,
    branch,
    base,
    hasChanges: () => git(["status", "--porcelain", ...scope], cwd).length > 0,
    commitAll(message) {
      git(["add", "-A", ...scope], cwd);
      if (!git(["diff", "--cached", "--name-only"], cwd)) return false;
      git([...FACTORY_IDENTITY, "commit", "-q", "-m", message], cwd);
      return true;
    },
    discardChanges() {
      git(["reset", "-q", "--hard", "HEAD"], cwd);
      git(["clean", "-fdq", ...scope], cwd);
    },
    changedFiles() {
      const out = git(["diff", "--name-status", "--no-renames", `${base}...HEAD`], cwd);
      return out
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [status, ...rest] = l.split("\t");
          return { status: status!.charAt(0), path: rest.join("\t") };
        });
    },
    addedLines() {
      const out = git(["diff", "-U0", "--no-color", `${base}...HEAD`], cwd);
      const added: { path: string; text: string }[] = [];
      let path = "";
      for (const l of out.split("\n")) {
        if (l.startsWith("+++ ")) path = l.slice(4).replace(/^b\//, "");
        else if (l.startsWith("+") && !l.startsWith("+++")) added.push({ path, text: l.slice(1) });
      }
      return added;
    },
    commitsAhead: () => Number(git(["rev-list", "--count", `${base}..HEAD`], cwd)),
    // A worktree shares the repository: its branch is already there.
    publish: () => {},
  };
}

export function removeWorkCopy(repo: string, path: string) {
  if (existsSync(path)) tryGit(["worktree", "remove", "--force", path], repo);
  tryGit(["worktree", "prune"], repo);
  // Clones (box copies) are not worktrees: remove them directly.
  if (existsSync(path)) rmSync(path, { recursive: true, force: true, maxRetries: 3 });
}

/** Where a branch is checked out, if anywhere (the owner's copy or another worktree). */
export function checkedOutAt(repo: string, branch: string): string | undefined {
  const out = tryGit(["worktree", "list", "--porcelain"], repo) ?? "";
  let current: string | undefined;
  for (const l of out.split("\n")) {
    if (l.startsWith("worktree ")) current = l.slice(9);
    else if (l === `branch refs/heads/${branch}`) return current;
  }
  return undefined;
}
