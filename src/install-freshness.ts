import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { githubRepository } from "./line/integrate.js";
import { log } from "./log.js";
import { realGit, type GitRunner } from "./package-install.js";
import type { Store } from "./state/store.js";

/** Where the daemon keeps what it last saw of the installed copy of zero. */
export const INSTALL_FRESHNESS_KEY = "install:freshness";
const EVERY_MS = 60 * 60_000;

/**
 * The installed copy of zero next to what was merged: `behind` counts the
 * commits of the checkout's upstream (or `<remote>/<branch>`) missing in HEAD,
 * `staleBuild` says a file under src/ is newer than dist/cli.js. A folder that
 * is not a git repository only carries a `problem`.
 */
export interface InstallFreshness {
  checkedAt: string;
  behind?: number;
  staleBuild?: boolean;
  /** owner/repo of the upstream remote, when it is on GitHub. */
  repository?: string;
  /** The ref compared with HEAD, such as `origin/main`. */
  upstream?: string;
  problem?: string;
}

/** The folder holding the running dist/cli.js. */
export const installRoot = () => fileURLToPath(new URL("..", import.meta.url));

export function readInstallFreshness(store: Store): InstallFreshness | undefined {
  const raw = store.getKv(INSTALL_FRESHNESS_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as InstallFreshness;
  } catch {
    return undefined;
  }
}

/** Whether the record says the installed copy misses merged work or a rebuild. */
export const installBehind = (r: InstallFreshness | undefined): r is InstallFreshness => Boolean(r && !r.problem && ((r.behind ?? 0) > 0 || r.staleBuild));

const mtime = (file: string): number | undefined => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

/** The latest modification time of a regular file under a folder, without following links. */
function newestFile(dir: string): number | undefined {
  let newest: number | undefined;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    const at = e.isDirectory() ? newestFile(join(dir, e.name)) : e.isFile() ? mtime(join(dir, e.name)) : undefined;
    if (at !== undefined && (newest === undefined || at > newest)) newest = at;
  }
  return newest;
}

const samePath = (a: string, b: string) => {
  const [x, y] = [resolve(a), resolve(b)].map((p) => (process.platform === "win32" ? p.toLowerCase() : p));
  return x === y;
};

/** Looks at the installation now, from its own git checkout; a failed fetch leaves the local refs, and nothing is thrown. */
async function lookAt(root: string, git: GitRunner, now: Date): Promise<InstallFreshness> {
  const checkedAt = now.toISOString();
  let top: string;
  try {
    top = await git(["rev-parse", "--show-toplevel"], { cwd: root });
  } catch {
    return { checkedAt, problem: "La instalación de zero no es un repositorio de git." };
  }
  if (!samePath(top, root)) return { checkedAt, problem: "La instalación de zero está dentro de otro repositorio de git." };
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).catch(() => "HEAD");
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: root }).catch(() => "");
  let remote = branch === "HEAD" ? "" : await git(["config", "--get", `branch.${branch}.remote`], { cwd: root }).catch(() => "");
  if (!remote) {
    const remotes = (await git(["remote"], { cwd: root }).catch(() => "")).split("\n").map((r) => r.trim()).filter(Boolean);
    remote = remotes.includes("origin") ? "origin" : (remotes[0] ?? "");
  }
  if (!remote) return { checkedAt, problem: "La instalación de zero no tiene un remoto de git con qué compararse." };
  const ref = upstream || (branch === "HEAD" ? "" : `${remote}/${branch}`);
  const url = await git(["remote", "get-url", remote], { cwd: root }).catch(() => "");
  const repository = githubRepository(url);
  const built = mtime(join(root, "dist", "cli.js"));
  const source = newestFile(join(root, "src"));
  const staleBuild = built !== undefined && source !== undefined && source > built;
  if (!ref) return { checkedAt, staleBuild, ...(repository && { repository }), problem: "La instalación de zero no está en una rama." };
  try {
    await git(["fetch", "--quiet", remote], { cwd: root });
  } catch (err) {
    log.warn("cannot fetch zero's installation; comparing with the local refs", { error: err instanceof Error ? err.message : String(err) });
  }
  const count = await git(["rev-list", "--count", `HEAD..${ref}`], { cwd: root }).catch(() => undefined);
  const behind = count === undefined ? undefined : Number.parseInt(count, 10);
  return {
    checkedAt,
    ...(behind !== undefined && Number.isFinite(behind) ? { behind } : { problem: `No pude comparar la instalación de zero con ${ref}.` }),
    staleBuild,
    upstream: ref,
    ...(repository && { repository }),
  };
}

/**
 * The daemon's pass: at most once an hour, records in kv `install:freshness`
 * how far the installed copy of zero is from what was merged. Returns the new
 * record, or undefined when the last one is less than an hour old.
 */
export async function checkInstall(store: Store, now: Date, opts: { root?: string; git?: GitRunner } = {}): Promise<InstallFreshness | undefined> {
  const last = readInstallFreshness(store);
  const at = last ? Date.parse(last.checkedAt) : Number.NaN;
  if (Number.isFinite(at) && now.getTime() - at < EVERY_MS && now.getTime() >= at) return undefined;
  const record = await lookAt(opts.root ?? installRoot(), opts.git ?? realGit, now);
  store.setKv(INSTALL_FRESHNESS_KEY, JSON.stringify(record));
  return record;
}
