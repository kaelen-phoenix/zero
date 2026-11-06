import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommitAuthor } from "./config.js";
import { git, tryGit } from "./shell.js";

/**
 * The factory's git identity. It is always the committer of what the factory
 * commits, and also the author unless the line's `commitAuthor` is `owner`.
 */
export const FACTORY_IDENTITY = ["-c", "user.name=zero", "-c", "user.email=zero@kaelen.invalid"];

export interface GitIdentity {
  name: string;
  email: string;
}

/** The identity git config resolves in a repository (local, global, system); undefined when name or email is missing. */
export function ownerIdentity(repo: string): GitIdentity | undefined {
  const name = tryGit(["config", "user.name"], repo);
  const email = tryGit(["config", "user.email"], repo);
  return name && email ? { name, email } : undefined;
}

/**
 * The environment for a factory commit. With `owner`, the identity of the
 * line's repository goes in as the author through GIT_AUTHOR_* (never in argv);
 * without one, the factory stays the author.
 */
export function authorEnv(mode: CommitAuthor | undefined, repo: string): NodeJS.ProcessEnv | undefined {
  const who = mode === "owner" ? ownerIdentity(repo) : undefined;
  return who && { ...process.env, GIT_AUTHOR_NAME: who.name, GIT_AUTHOR_EMAIL: who.email };
}

export interface ChangedFile {
  /** git status letter: A, M, D, R... */
  status: string;
  path: string;
}

/** How merging the base into a job's branch went. `conflict` leaves the merge in progress. */
export type MergeOutcome = { outcome: "up-to-date" } | { outcome: "merged" } | { outcome: "conflict"; paths: string[] } | { outcome: "refused"; reason: string };

/** A job's own copy of the line's repository, on its own branch. */
export interface WorkCopy {
  cwd: string;
  branch: string;
  base: string;
  hasChanges(): boolean;
  /** Commits everything, concluding a merge in progress even when it changes nothing; returns false when there was nothing to commit. */
  commitAll(message: string): boolean;
  /** Merges the base into the branch, never rewriting it. With `tip`, first goes back to that commit, dropping everything else. */
  mergeBase(message: string, tip?: string): MergeOutcome;
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

const CONFLICT_MARKER = /^(?:<{7}|\|{7}|>{7})(?: |\r?$)/m;

/** Which of these paths still hold conflict markers. Regular files only; a bare `=======` is valid Markdown and does not count. */
export function conflictMarkers(cwd: string, paths: string[]): string[] {
  return paths.filter((path) => {
    const file = join(cwd, path);
    return lstatSync(file, { throwIfNoEntry: false })?.isFile() && CONFLICT_MARKER.test(readFileSync(file, "latin1"));
  });
}

/**
 * A worktree of the line's repository on the job's branch. `base` is where a
 * new branch starts and what its changes are measured against: a local branch
 * (`main`) or a remote-tracking one (`origin/main`).
 */
export async function openWorkCopy(repo: string, base: string, branch: string, path: string, exclude: string[] = [], author: CommitAuthor = "zero"): Promise<WorkCopy> {
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    git(["worktree", "prune"], repo);
    const branchExists = tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo) !== undefined;
    git(branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, base], repo);
  }
  return workCopyAt(path, base, branch, exclude, { author, repo });
}

/**
 * The work copy for the isolation box: an independent clone that shares no
 * files with the owner's repository (`--no-hardlinks`), so nothing done in the
 * box can reach it. The branch is fetched back when the job is ready.
 */
export async function openCloneCopy(repo: string, base: string, branch: string, path: string, exclude: string[] = [], author: CommitAuthor = "zero"): Promise<WorkCopy> {
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true });
    const branchExists = tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo) !== undefined;
    git(["clone", "-q", "--no-hardlinks", "--no-checkout", repo, path], repo);
    // The base under the same name it has in the line's repository (`main` or `origin/main`), for diffs against it.
    const baseRef = git(["rev-parse", "--symbolic-full-name", base], repo);
    git(["fetch", "-q", "--update-head-ok", repo, `+${baseRef}:${baseRef}`], path);
    if (branchExists) {
      git(["fetch", "-q", "--update-head-ok", repo, `+refs/heads/${branch}:refs/heads/${branch}`], path);
      git(["checkout", "-q", branch], path);
    } else git(["checkout", "-q", "-b", branch, base], path);
  }
  // The owner's identity comes from the line's repository, not from the clone.
  const copy = workCopyAt(path, base, branch, exclude, { author, repo });
  return {
    ...copy,
    publish: () => void git(["fetch", "-q", path, `+refs/heads/${branch}:refs/heads/${branch}`], repo),
  };
}

/**
 * `exclude` lists paths the factory itself created (setup output). They are
 * never committed and never discarded. `identity` says who authors the
 * commits: with `owner`, the identity git config resolves in `repo` at commit time.
 */
export function workCopyAt(cwd: string, base: string, branch: string, exclude: string[] = [], identity?: { author: CommitAuthor; repo: string }): WorkCopy {
  const scope = ["--", ".", ...exclude.map((p) => `:(exclude)${p}`)];
  return {
    cwd,
    branch,
    base,
    hasChanges: () => git(["status", "--porcelain", ...scope], cwd).length > 0,
    commitAll(message) {
      git(["add", "-A", ...scope], cwd);
      const merging = tryGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], cwd) !== undefined;
      if (!merging && !git(["diff", "--cached", "--name-only"], cwd)) return false;
      git([...FACTORY_IDENTITY, "commit", "-q", "-m", message], cwd, identity && authorEnv(identity.author, identity.repo));
      return true;
    },
    mergeBase(message, tip) {
      if (tip) {
        git(["reset", "-q", "--hard", tip], cwd);
        git(["clean", "-fdq", ...scope], cwd);
      }
      const before = git(["rev-parse", "HEAD"], cwd);
      const env = identity && authorEnv(identity.author, identity.repo);
      const r = spawnSync("git", [...FACTORY_IDENTITY, "merge", "--no-edit", "-m", message, base], { cwd, encoding: "utf8", windowsHide: true, ...(env && { env }) });
      if (r.status === 0) return { outcome: git(["rev-parse", "HEAD"], cwd) === before ? "up-to-date" : "merged" };
      const paths = (tryGit(["diff", "--name-only", "--diff-filter=U", "-z"], cwd) ?? "").split("\0").filter(Boolean);
      if (paths.length) return { outcome: "conflict", paths };
      tryGit(["merge", "--abort"], cwd);
      return { outcome: "refused", reason: (r.stderr || r.stdout || String(r.error ?? "")).trim().slice(0, 500) };
    },
    discardChanges() {
      git(["reset", "-q", "--hard", "HEAD"], cwd);
      git(["clean", "-fdq", ...scope], cwd);
    },
    changedFiles() {
      // NUL-separated: without -z git quotes and escapes any path with non-ASCII characters, and no rule would match it.
      const fields = git(["diff", "--name-status", "-z", "--no-renames", `${base}...HEAD`], cwd).split("\0").filter(Boolean);
      const files: ChangedFile[] = [];
      for (let i = 0; i + 1 < fields.length; i += 2) files.push({ status: fields[i]!.charAt(0), path: fields[i + 1]! });
      return files;
    },
    addedLines() {
      const out = git(["-c", "core.quotePath=false", "diff", "-U0", "--no-color", `${base}...HEAD`], cwd);
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
