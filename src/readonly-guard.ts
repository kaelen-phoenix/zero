import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Engine, EngineRequest, EngineResult } from "./engines/types.js";
import { log } from "./log.js";
import { spawnTarget } from "./shell.js";

/**
 * The read-only guarantee for an engine running without its own sandbox: a
 * snapshot of the folder before the call, a comparison after it, and only what
 * differs put back, so the owner's unsaved work stays as it was.
 *
 * The folder is read through a git repository of its own in a temporary
 * directory, with no filters, so nothing is written in the folder or in a
 * repository containing it. It sees what `git status` sees: ignored files are
 * not compared, and a new `.gitignore` that ignores itself hides what it covers.
 * Anything else changing the folder or its branch during the call looks like the
 * call's doing. Refs are the whole repository's, so `refChanges` holds the call
 * only to those it can be blamed for; the daemon starts no job in a repository
 * under a call, nor a call in a repository with a running job (`beingGuarded`).
 */

const GIT_TIMEOUT_MS = 10 * 60_000;
const GIT_MAX_OUTPUT = 256 * 1024 * 1024;
const LISTED_NAMES = 20;
/** Rounds of putting files back: restoring a `.gitignore` can reveal files it was hiding. */
const RESTORE_ROUNDS = 3;
/** Takes `.gitattributes` out of the comparison: what is stored is what is on disk, byte for byte. */
const NO_FILTERS = "* -text -ident -filter !working-tree-encoding\n";

function runGit(args: string[], cwd: string, opts: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<string> {
  return new Promise((done, fail) => {
    // The guarded folder is an agent's: on Windows a bare name would find a git planted there.
    const target = spawnTarget("git", cwd);
    const child = execFile(target.bin, args, { cwd: target.cwd, encoding: "utf8", windowsHide: true, maxBuffer: GIT_MAX_OUTPUT, timeout: GIT_TIMEOUT_MS, ...(opts.env && { env: opts.env }) }, (err, stdout, stderr) => {
      if (err) fail(new Error(`git ${args[args.length - 1]} falló: ${(stderr || err.message).trim()}`));
      else done(stdout);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input ?? "");
  });
}

/** A file of a folder as it was: its bytes (a link's target) and mode. */
interface Kept {
  data: Buffer;
  mode: number;
  link: boolean;
}

async function keepFiles(root: string, under = ""): Promise<Map<string, Kept>> {
  const kept = new Map<string, Kept>();
  const entries = await readdir(join(root, under), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const rel = under ? `${under}/${e.name}` : e.name;
    const path = join(root, rel);
    if (e.isDirectory()) {
      for (const [k, v] of await keepFiles(root, rel)) kept.set(k, v);
    } else if (e.isSymbolicLink()) {
      kept.set(rel, { data: Buffer.from(await readlink(path)), mode: 0, link: true });
    } else {
      kept.set(rel, { data: await readFile(path), mode: (await lstat(path)).mode, link: false });
    }
  }
  return kept;
}

const sameKept = (a: Kept | undefined, b: Kept | undefined) => Boolean(a && b && a.link === b.link && a.mode === b.mode && a.data.equals(b.data));

/** Removes a path and the folders left empty by that, up to `root`. */
async function removeAndPrune(root: string, rel: string): Promise<void> {
  await rm(join(root, rel), { recursive: true, force: true });
  const top = resolve(root);
  for (let dir = dirname(join(root, rel)); resolve(dir).length > top.length; dir = dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
  }
}

interface RepoFiles {
  /** Files git keeps as they are, compared byte for byte, under the name shown to the owner. */
  raw: { name: string; path: string; data?: Buffer }[];
  hooksDir: string;
  hooks: Map<string, Kept>;
  index: string;
  /** Where the index's bytes were kept; absent when there was no index. */
  savedIndex?: string;
  /** What the index holds: its bytes change on any `git status`, so they do not tell. */
  stage: string;
  refs: Map<string, string>;
  /** The branch of this checkout, which the call answers for wherever it runs. */
  branch?: string;
  /** A linked worktree: the rest of the repository's refs belong to other checkouts. */
  linked: boolean;
  /** Files tracked although an ignore rule matches them, which `git add` would otherwise skip. */
  trackedIgnored: string[];
  /** The objects git already has, so an unchanged file takes no room in the snapshot. */
  objects: string;
  /** The ignores outside the worktree that `git status` honours in this repository. */
  excludes?: string;
}

export interface Snapshot {
  cwd: string;
  dir: string;
  tree: string;
  /** The tree first seen after the call differing from `tree`: what a discard threw away. */
  after?: string;
  repo?: RepoFiles;
}

/** Git on the owner's repository, unable to start the hooks or the monitor its config names. */
const realGit = (s: { cwd: string; dir: string }, args: string[]) => runGit(["-c", `core.hooksPath=${join(s.dir, "no-hooks")}`, "-c", "core.fsmonitor=false", ...args], s.cwd);

/** Git on the snapshot's own repository, over the folder. */
function snapshotGit(s: Pick<Snapshot, "cwd" | "dir" | "repo">, args: string[], opts: { index?: string; input?: string } = {}): Promise<string> {
  const settings = {
    "core.autocrlf": "false",
    "core.safecrlf": "false",
    "core.fsmonitor": "false",
    "core.longpaths": "true",
    "core.hooksPath": join(s.dir, "no-hooks"),
    // A folder that is not a repository has no business with the owner's global ignores.
    ...(s.repo ? (s.repo.excludes ? { "core.excludesFile": s.repo.excludes } : {}) : { "core.excludesFile": join(s.dir, "no-excludes") }),
  };
  return runGit([...Object.entries(settings).flatMap(([k, v]) => ["-c", `${k}=${v}`]), ...args], s.cwd, {
    input: opts.input,
    env: {
      ...process.env,
      GIT_DIR: join(s.dir, "git", ".git"),
      GIT_WORK_TREE: s.cwd,
      GIT_INDEX_FILE: join(s.dir, opts.index ?? "index"),
      ...(s.repo && { GIT_ALTERNATE_OBJECT_DIRECTORIES: s.repo.objects }),
    },
  });
}

async function treeOf(s: Pick<Snapshot, "cwd" | "dir" | "repo">): Promise<string> {
  // A deleted one leaves the snapshot's index in `add -A`, and once back it would look ignored; a folder in its place is `add -A`'s to handle.
  const seeds = [];
  for (const path of s.repo?.trackedIgnored ?? []) if (!(await lstat(join(s.cwd, path)).catch(() => undefined))?.isDirectory()) seeds.push(path);
  if (seeds.length) await snapshotGit(s, ["update-index", "--add", "--remove", "-z", "--stdin"], { input: `${seeds.join("\0")}\0` });
  await snapshotGit(s, ["add", "-A", "."]);
  return (await snapshotGit(s, ["write-tree"])).trim();
}

const readRefs = async (s: { cwd: string; dir: string }): Promise<Map<string, string>> => {
  const out = await realGit(s, ["for-each-ref", "--format=%(refname) %(objectname)"]);
  const refs = out.split(/\r?\n/).filter(Boolean).map((l) => l.split(" ") as [string, string]);
  // A background fetch moves these during any call, and the next fetch sets them right anyway.
  return new Map(refs.filter(([name]) => !name.startsWith("refs/remotes/")));
};

const readStage = (s: { cwd: string; dir: string }) => realGit(s, ["ls-files", "--stage", "-z"]);

const headBranch = (head: Buffer | undefined) => head?.toString().match(/^ref: (\S+)/)?.[1];

/**
 * The refs that differ from the snapshot, split by who answers for them. The call
 * answers for its checkout's branch and, outside a linked worktree, for the rest,
 * except what the factory or another checkout moves on its own: the factory's job
 * branches, branches checked out elsewhere and new tags, which any fetch brings.
 */
async function refChanges(s: { cwd: string; dir: string }, repo: RepoFiles): Promise<{ call: string[]; elsewhere: string[] }> {
  const refs = await readRefs(s);
  const changed = [...new Set([...refs.keys(), ...repo.refs.keys()])].filter((name) => refs.get(name) !== repo.refs.get(name));
  if (!changed.length) return { call: [], elsewhere: [] };
  const own = new Set([repo.branch, headBranch(await readFile(repo.raw[0]!.path).catch(() => undefined))]);
  const worktrees = await realGit(s, ["worktree", "list", "--porcelain"]);
  const checkedOut = new Set(worktrees.split(/\r?\n/).filter((l) => l.startsWith("branch ")).map((l) => l.slice("branch ".length)));
  const elsewhere = (name: string) => !own.has(name) && (repo.linked || name.startsWith("refs/heads/zero/") || checkedOut.has(name) || (name.startsWith("refs/tags/") && !repo.refs.has(name)));
  return { call: changed.filter((name) => !elsewhere(name)), elsewhere: changed.filter(elsewhere) };
}

/** The repository whose root is the folder; undefined when the folder is not the root of one, even inside another. */
async function repoFiles(cwd: string, dir: string): Promise<RepoFiles | undefined> {
  if (!existsSync(join(cwd, ".git"))) return undefined;
  const at = { cwd, dir };
  const [top, gitDir, common, index, head, worktreeConfig] = (await realGit(at, ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir", "--git-path", "index", "--git-path", "HEAD", "--git-path", "config.worktree"])).split(/\r?\n/);
  if (!top || !gitDir || !common || !index || !head || !worktreeConfig) throw new Error("git no dijo dónde está el repositorio");
  if ((await realpath(top)) !== (await realpath(cwd))) throw new Error(`la carpeta no es la raíz de su repositorio (${top})`);
  const commonDir = resolve(cwd, common);
  const raw = [
    { name: "HEAD", path: resolve(cwd, head) },
    { name: ".git/config", path: join(commonDir, "config") },
    { name: ".git/config.worktree", path: resolve(cwd, worktreeConfig) },
  ];
  const excludes = (await realGit(at, ["config", "--path", "--get", "core.excludesFile"]).catch(() => "")).trim();
  const exclude = join(commonDir, "info", "exclude");
  if (existsSync(exclude)) await copyFile(exclude, join(dir, "git", ".git", "info", "exclude"));
  const indexPath = resolve(cwd, index);
  const savedIndex = existsSync(indexPath) ? join(dir, "index.saved") : undefined;
  if (savedIndex) await copyFile(indexPath, savedIndex);
  const hooksDir = join(commonDir, "hooks");
  const kept = await Promise.all(raw.map(async (f) => ({ ...f, data: await readFile(f.path).catch(() => undefined) })));
  return {
    raw: kept,
    hooksDir,
    hooks: await keepFiles(hooksDir),
    index: indexPath,
    savedIndex,
    stage: await readStage(at),
    refs: await readRefs(at),
    branch: headBranch(kept[0]!.data),
    linked: resolve(cwd, gitDir) !== commonDir,
    trackedIgnored: (await realGit(at, ["ls-files", "-z", "--cached", "--ignored", "--exclude-standard"])).split("\0").filter(Boolean),
    objects: join(commonDir, "objects"),
    ...(excludes && { excludes }),
  };
}

/** Takes the snapshot, or throws having left nothing behind. */
export async function takeSnapshot(cwd: string): Promise<Snapshot> {
  if (!(await stat(cwd)).isDirectory()) throw new Error(`${cwd} no es una carpeta`);
  const dir = await mkdtemp(join(tmpdir(), "zero-readonly-"));
  try {
    const gitDir = join(dir, "git");
    await runGit(["init", "-q", "--template=", gitDir], dir);
    await mkdir(join(gitDir, ".git", "info"), { recursive: true });
    await writeFile(join(gitDir, ".git", "info", "attributes"), NO_FILTERS);
    const repo = await repoFiles(cwd, dir);
    const base = { cwd, dir, repo };
    return { ...base, tree: await treeOf(base) };
  } catch (err) {
    await discardSnapshot(dir);
    throw err;
  }
}

/** A leftover temporary folder never changes the call's result. */
const discardSnapshot = (dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});

interface TreeChange {
  path: string;
  added: boolean;
}

async function treeChanges(s: Snapshot, after: string): Promise<TreeChange[]> {
  const fields = (await snapshotGit(s, ["diff-tree", "-r", "-z", "--no-renames", s.tree, after])).split("\0").filter(Boolean);
  const changes: TreeChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ path: fields[i + 1]!, added: fields[i]!.endsWith(" A") });
  return changes;
}

/** What differs from the snapshot now, under the names shown to the owner. Changes nothing in the folder. */
export async function differences(s: Snapshot): Promise<string[]> {
  const found: string[] = [];
  const { repo } = s;
  if (repo) {
    for (const f of repo.raw) {
      const now = await readFile(f.path).catch(() => undefined);
      if (now ? !f.data?.equals(now) : f.data) found.push(f.name);
    }
    const hooks = await keepFiles(repo.hooksDir);
    for (const name of new Set([...hooks.keys(), ...repo.hooks.keys()])) if (!sameKept(hooks.get(name), repo.hooks.get(name))) found.push(`.git/hooks/${name}`);
    if ((await readStage(s)) !== repo.stage) found.push("índice de git");
    found.push(...(await refChanges(s, repo)).call);
  } else if (existsSync(join(s.cwd, ".git"))) {
    found.push(".git");
  }
  const now = await treeOf(s);
  if (now !== s.tree) {
    s.after ??= now;
    found.push(...(await treeChanges(s, now)).map((c) => c.path));
  }
  return found;
}

async function restoreRepo(s: Snapshot, repo: RepoFiles): Promise<void> {
  // Asked before HEAD goes back: a branch the call left checked out is the call's.
  const { call } = await refChanges(s, repo);
  for (const f of repo.raw) {
    if (f.data) await writeFile(f.path, f.data);
    else await rm(f.path, { force: true });
  }
  const hooks = await keepFiles(repo.hooksDir);
  for (const name of hooks.keys()) if (!repo.hooks.has(name)) await removeAndPrune(repo.hooksDir, name);
  for (const [name, kept] of repo.hooks) {
    if (sameKept(hooks.get(name), kept)) continue;
    const path = join(repo.hooksDir, name);
    await rm(path, { force: true });
    await mkdir(dirname(path), { recursive: true });
    if (kept.link) await symlink(kept.data.toString(), path);
    else {
      await writeFile(path, kept.data);
      await chmod(path, kept.mode);
    }
  }
  if (repo.savedIndex) await copyFile(repo.savedIndex, repo.index);
  else await rm(repo.index, { force: true });
  // Deletions first, since a new branch can stand where a kept one needs to be.
  for (const name of call) if (!repo.refs.has(name)) await realGit(s, ["update-ref", "-d", "--no-deref", name]);
  for (const name of call) {
    const sha = repo.refs.get(name);
    if (sha) await realGit(s, ["update-ref", "--no-deref", name, sha]);
  }
}

/** Puts back what differs, and only that; never `reset --hard` or `clean`. Throws when the folder does not end up as it was. */
export async function restoreSnapshot(s: Snapshot): Promise<void> {
  if (s.repo) await restoreRepo(s, s.repo);
  else await rm(join(s.cwd, ".git"), { recursive: true, force: true });
  await snapshotGit(s, ["read-tree", s.tree], { index: "restore-index" });
  for (let round = 0; round < RESTORE_ROUNDS; round++) {
    const now = await treeOf(s);
    if (now === s.tree) break;
    const changes = await treeChanges(s, now);
    for (const c of changes) if (c.added) await removeAndPrune(s.cwd, c.path);
    const back = changes.filter((c) => !c.added).map((c) => c.path);
    if (back.length) await snapshotGit(s, ["checkout-index", "-f", "-z", "--stdin"], { index: "restore-index", input: `${back.join("\0")}\0` });
  }
  const left = await differences(s);
  if (left.length) throw new Error(`siguen distintos: ${nameList(left)}`);
}

const nameList = (names: string[]) => {
  const unique = [...new Set(names)];
  return unique.length > LISTED_NAMES ? `${unique.slice(0, LISTED_NAMES).join(", ")} y ${unique.length - LISTED_NAMES} más` : unique.join(", ");
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const guarded = new Map<string, number>();

/** Whether a call is being checked in this folder right now: the factory stays out of its repository meanwhile. */
export const beingGuarded = (folder: string) => guarded.has(resolve(folder));

interface GuardOptions {
  restore?: (s: Snapshot) => Promise<void>;
}

/**
 * A read-only call of an engine without its own sandbox. It is not started when
 * the folder cannot be checked; if it changed the folder, what it did is put
 * back and the call fails, keeping what the engine reported on cost and plan.
 */
export async function runGuarded(engine: Engine, req: EngineRequest, opts: GuardOptions = {}): Promise<EngineResult> {
  // Taken before anything is awaited, so the daemon sees it the moment it hands the call over.
  const folder = resolve(req.cwd);
  guarded.set(folder, (guarded.get(folder) ?? 0) + 1);
  try {
    return await checkedCall(engine, req, opts);
  } finally {
    const left = guarded.get(folder)! - 1;
    if (left) guarded.set(folder, left);
    else guarded.delete(folder);
  }
}

async function checkedCall(engine: Engine, req: EngineRequest, opts: GuardOptions): Promise<EngineResult> {
  let snapshot: Snapshot;
  try {
    snapshot = await takeSnapshot(req.cwd);
  } catch (err) {
    return { ok: false, text: `zero no pudo comprobar la carpeta de trabajo antes de la llamada, así que no lanzó ${engine.name}: ${message(err)}` };
  }
  let keep = false;
  try {
    let result: EngineResult | undefined;
    let thrown: unknown;
    try {
      result = await engine.run(req);
    } catch (err) {
      thrown = err;
    }
    let warning: string | undefined;
    try {
      const elsewhere = snapshot.repo ? (await refChanges(snapshot, snapshot.repo)).elsewhere : [];
      if (elsewhere.length) log.warn("refs changed during a read-only call, left as they are", { engine: engine.name, cwd: req.cwd, refs: nameList(elsewhere) });
      const changed = await differences(snapshot);
      if (changed.length) {
        const prefix = `${engine.name} cambió la carpeta de trabajo en una estación de solo lectura`;
        keep = true;
        log.warn("read-only call changed its folder", { engine: engine.name, cwd: req.cwd, changed: nameList(changed), discarded: snapshot.dir, tree: snapshot.after });
        try {
          await (opts.restore ?? restoreSnapshot)(snapshot);
          warning = `${prefix} y zero descartó los cambios: ${nameList(changed)}.`;
        } catch (err) {
          warning = `${prefix} y zero no pudo deshacerlo, así que la carpeta pudo quedar modificada: ${nameList(changed)}. ${message(err)}`;
        }
      }
    } catch (err) {
      warning = `zero no pudo comprobar la carpeta de trabajo después de la llamada, así que la carpeta pudo quedar modificada: ${message(err)}`;
    }
    if (!warning) {
      if (thrown !== undefined) throw thrown;
      return result!;
    }
    const failure = thrown === undefined ? (result!.ok ? undefined : result!.text) : message(thrown);
    const { output: _dropped, ...rest } = result ?? { ok: false, text: "" };
    return { ...rest, ok: false, text: failure ? `${warning}\n\n${failure}` : warning };
  } finally {
    // What a discard threw away stays in the snapshot's folder, named in the log, in case it was the owner's.
    if (!keep) await discardSnapshot(snapshot.dir);
  }
}
