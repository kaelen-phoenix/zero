import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
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

/**
 * What merging the newest base into a job's branch did. `conflict` leaves the
 * merge in progress in the work copy; `refused` leaves nothing behind.
 */
export type BaseUpdate = { kind: "up-to-date" } | { kind: "merged"; commit: string } | { kind: "conflict"; paths: string[] } | { kind: "refused"; reason: string };

/** A job's own copy of the line's repository, on its own branch. */
export interface WorkCopy {
  cwd: string;
  branch: string;
  base: string;
  hasChanges(): boolean;
  /** Commits everything, concluding a merge in progress; returns false when there was nothing to commit. */
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
  /** Whether a merge is waiting to be concluded in this copy. */
  mergeInProgress(): boolean;
  /** Merges the newest base into the branch, as a factory commit with this message. */
  updateFromBase(message: string): BaseUpdate;
}

/** Untracked files present in a work copy, e.g. what a setup command such as `npm install` created. */
export function untrackedPaths(cwd: string): string[] {
  return git(["status", "--porcelain", "--untracked-files=normal"], cwd)
    .split("\n")
    .filter((l) => l.startsWith("?? "))
    .map((l) => l.slice(3).replace(/^"|"$/g, ""));
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
    // A clone's base only moves when it is fetched from the line's repository.
    updateFromBase(message) {
      try {
        const baseRef = git(["rev-parse", "--symbolic-full-name", base], repo);
        git(["fetch", "-q", "--update-head-ok", repo, `+${baseRef}:${baseRef}`], path);
      } catch (err) {
        return { kind: "refused", reason: err instanceof Error ? err.message : String(err) };
      }
      return copy.updateFromBase(message);
    },
  };
}

/**
 * `exclude` lists paths the factory itself created (setup output). They are
 * never committed and never discarded. `identity` says who authors the
 * commits: with `owner`, the identity git config resolves in `repo` at commit time.
 */
export function workCopyAt(cwd: string, base: string, branch: string, exclude: string[] = [], identity?: { author: CommitAuthor; repo: string }): WorkCopy {
  const scope = ["--", ".", ...exclude.map((p) => `:(exclude)${p}`)];
  const mergeInProgress = () => tryGit(["rev-parse", "-q", "--verify", "MERGE_HEAD"], cwd) !== undefined;
  return {
    cwd,
    branch,
    base,
    hasChanges: () => git(["status", "--porcelain", ...scope], cwd).length > 0,
    commitAll(message) {
      git(["add", "-A", ...scope], cwd);
      // A resolved merge may match HEAD, and it still has to be concluded.
      if (!mergeInProgress() && !git(["diff", "--cached", "--name-only"], cwd)) return false;
      git([...FACTORY_IDENTITY, "commit", "-q", "-m", message], cwd, identity && authorEnv(identity.author, identity.repo));
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
    mergeInProgress,
    updateFromBase(message) {
      const before = git(["rev-parse", "HEAD"], cwd);
      const env = identity && authorEnv(identity.author, identity.repo);
      const r = spawnSync("git", [...FACTORY_IDENTITY, "merge", "--no-edit", "-q", "-m", message, base], { cwd, encoding: "utf8", windowsHide: true, ...(env && { env }) });
      if (r.status === 0) {
        const commit = git(["rev-parse", "HEAD"], cwd);
        return commit === before ? { kind: "up-to-date" } : { kind: "merged", commit };
      }
      const paths = git(["-c", "core.quotepath=off", "diff", "--name-only", "--diff-filter=U"], cwd).split("\n").filter(Boolean);
      if (paths.length) return { kind: "conflict", paths };
      tryGit(["merge", "--abort"], cwd);
      return { kind: "refused", reason: (r.stderr || r.stdout || String(r.error ?? "")).trim() };
    },
  };
}

/** Which of these files still hold conflict markers; a file the resolution deleted holds none. */
export function filesWithMarkers(cwd: string, paths: string[]): string[] {
  return paths.filter((p) => {
    const file = join(cwd, p);
    return existsSync(file) && /^(<{7}|>{7})( |\r?$)/m.test(readFileSync(file, "latin1"));
  });
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
