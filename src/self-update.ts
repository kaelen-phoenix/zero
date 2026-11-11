import { readFileSync, realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FactoryContext } from "./app.js";
import { mergeKey, type MergeState } from "./line/automerge.js";
import { log } from "./log.js";
import { findGit, gitEnv, lockProblemAt, npmCiArgs, runNpm, runProcess, type GitRunner } from "./package-install.js";
import { tryGit } from "./shell.js";
import type { Store } from "./state/store.js";

/** Where the running zero is installed: the parent of the folder holding cli.js (`dist` once built). */
export function installFolder(entry: string = process.argv[1] ?? ""): string {
  return dirname(dirname(resolve(entry)));
}

/** `zero <version>` plus the install folder's short commit when git can tell it. */
export function versionText(install: string = installFolder()): string {
  let version = "desconocida";
  try {
    version = String((JSON.parse(readFileSync(join(install, "package.json"), "utf8")) as { version?: unknown }).version ?? version);
  } catch {
    // Without a readable package.json the version is unknown, never an error.
  }
  const commit = tryGit(["rev-parse", "--short", "HEAD"], install);
  return commit ? `zero ${version} (${commit})` : `zero ${version}`;
}

export const SELF_UPDATE_STATE_KEY = "self-update:state";
export const SELF_UPDATE_HISTORY_KEY = "self-update:history";
/** How many past updates the history keeps. */
export const HISTORY_LIMIT = 20;

/** Where the self-update stands: idle, a prepared version waiting for a free factory, or a switch under way. */
export interface SelfUpdateState {
  status: "idle" | "ready" | "switching";
  /** Commit running when the update was prepared. */
  from?: string;
  /** Commit prepared. */
  to?: string;
  /** Folder holding the prepared version. */
  dir?: string;
  /** Last check (ISO). */
  checkedAt?: string;
  /** The current problem, recorded once per distinct text. */
  problem?: string;
  /** Commits whose preparation or start failed; never prepared again. */
  failed?: string[];
}

export type SelfUpdateOutcome = "updated" | "rolled-back" | "failed";

export interface SelfUpdateEntry {
  from: string;
  to: string;
  /** When it happened (ISO). */
  at: string;
  outcome: SelfUpdateOutcome;
  reason?: string;
}

const IDLE: SelfUpdateState = { status: "idle" };

/** The state and history on record; a store failure or a broken record reads as nothing. */
export function readSelfUpdate(store: Store): { state: SelfUpdateState; history: SelfUpdateEntry[] } {
  let state: SelfUpdateState = IDLE;
  let history: SelfUpdateEntry[] = [];
  try {
    const raw = store.getKv(SELF_UPDATE_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SelfUpdateState) : undefined;
    if (parsed && typeof parsed === "object" && ["idle", "ready", "switching"].includes(parsed.status)) state = parsed;
  } catch (err) {
    log.warn("cannot read self-update state", { error: String(err) });
  }
  try {
    const raw = store.getKv(SELF_UPDATE_HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) history = parsed.filter((e): e is SelfUpdateEntry => Boolean(e) && typeof e.from === "string" && typeof e.to === "string" && typeof e.at === "string");
  } catch (err) {
    log.warn("cannot read self-update history", { error: String(err) });
  }
  return { state, history };
}

/** Writes the state and, when given, appends an entry to the history (last HISTORY_LIMIT kept); store failures are logged, never thrown. */
export function recordSelfUpdate(store: Store, change: { state?: SelfUpdateState; entry?: SelfUpdateEntry }): void {
  try {
    if (change.state) store.setKv(SELF_UPDATE_STATE_KEY, JSON.stringify(change.state));
    if (change.entry) {
      const history = [...readSelfUpdate(store).history, change.entry].slice(-HISTORY_LIMIT);
      store.setKv(SELF_UPDATE_HISTORY_KEY, JSON.stringify(history));
    }
  } catch (err) {
    log.warn("cannot record self-update", { error: String(err) });
  }
}

/** What the self-update runs; tests inject fakes, the daemon `realSelfUpdateDeps`. */
export interface SelfUpdateDeps {
  git: GitRunner;
  /** npm with its arguments, run on the folder given. */
  npm: (args: string[], cwd: string) => Promise<string>;
  /** Node on a script of the folder given (`dist/cli.js` and its arguments). */
  node: (args: string[], cwd: string) => Promise<string>;
  now?: () => Date;
  /** The install folder; absent: the running zero's. */
  install?: string;
}

/** Without a merge of its own, the install folder's remote is looked at once a day. */
export const CHECK_EVERY_MS = 24 * 60 * 60_000;
const STEP_TIMEOUT_MS = 10 * 60_000;

/** Where prepared versions (and later the switch's files) live, never in a repository. */
export const selfUpdateDir = (ctx: Pick<FactoryContext, "home">) => join(ctx.home.root, "self-update");

const samePath = (a: string, b: string) => {
  try {
    const [x, y] = [realpathSync(a), realpathSync(b)];
    return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
  } catch {
    return false;
  }
};

/** Due when it was never checked, a day has passed, or a pull request of a line working on the install folder merged since. */
function due(ctx: FactoryContext, state: SelfUpdateState, install: string, at: Date): boolean {
  if (!state.checkedAt || at.getTime() - Date.parse(state.checkedAt) >= CHECK_EVERY_MS) return true;
  const lines = new Set(ctx.config.lines.filter((l) => samePath(l.repo, install)).map((l) => l.name));
  if (!lines.size) return false;
  for (const job of ctx.store.listJobs({ status: ["delivered"] })) {
    if (!lines.has(job.line)) continue;
    const raw = ctx.store.getKv(mergeKey(job.id));
    if (!raw) continue;
    try {
      if ((JSON.parse(raw) as MergeState).status !== "merged") continue;
    } catch {
      continue;
    }
    const when = ctx.store.kvUpdatedAt(mergeKey(job.id));
    if (when && when > state.checkedAt) return true;
  }
  return false;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

/**
 * Looks at whether the install folder's branch moved on its remote and, when it is a clean fast-forward,
 * prepares that commit off to the side. Never touches the install folder's files; the switch happens later.
 */
export async function selfUpdateCheck(ctx: FactoryContext, deps: SelfUpdateDeps): Promise<void> {
  const settings = ctx.config.selfUpdate;
  if (!settings?.enabled) return;
  const at = (deps.now ?? ctx.now ?? (() => new Date()))();
  const { state } = readSelfUpdate(ctx.store);
  // A prepared version waits for its switch, and a switch under way is the next daemon's to tell.
  if (state.status !== "idle") return;
  const install = deps.install ?? installFolder();
  if (!due(ctx, state, install, at)) return;
  const checked: SelfUpdateState = { ...state, checkedAt: at.toISOString() };
  const save = (next: SelfUpdateState) => recordSelfUpdate(ctx.store, { state: next });
  // Each distinct problem is said once; the check time moves on either way.
  const problem = (text: string) => {
    if (text !== state.problem) log.warn("self-update held back", { problem: text });
    save({ ...checked, problem: text });
  };
  const git = (args: string[]) => deps.git(args, { cwd: install });

  let head: string;
  let tip: string;
  const notRoot = `${install} no es la raíz de su propio repositorio de git`;
  try {
    if ((await git(["rev-parse", "--show-cdup"])) !== "") return problem(notRoot);
  } catch {
    return problem(notRoot);
  }
  try {
    const current = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = settings.branch ?? current;
    if (current === "HEAD" || current !== branch) return problem(`${install} no está en la rama ${branch === "HEAD" ? "de trabajo" : branch}`);
    if ((await git(["status", "--porcelain", "--untracked-files=no"])) !== "") return problem(`cambios locales en ${install}: no actualizo`);
    await git(["fetch", settings.remote, branch]);
    tip = await git(["rev-parse", "FETCH_HEAD"]);
    head = await git(["rev-parse", "HEAD"]);
  } catch (err) {
    return problem(`no pude mirar ${settings.remote}: ${reason(err)}`);
  }
  if (tip === head) return save({ ...checked, problem: undefined });
  // A commit that already failed is never prepared again; its failure was already told.
  if (state.failed?.includes(tip)) return save(checked);
  try {
    await git(["merge-base", "--is-ancestor", "HEAD", tip]);
  } catch {
    return problem(`${tip.slice(0, 12)} no es un avance rápido desde ${head.slice(0, 12)}`);
  }

  const dir = join(selfUpdateDir(ctx), tip.slice(0, 12));
  try {
    await prepare(deps, install, tip, dir);
  } catch (err) {
    const why = `no pude preparar ${tip.slice(0, 12)}: ${reason(err)}`;
    log.warn("self-update preparation failed; staying on the current version", { from: head, to: tip, error: why });
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((e) => log.warn("cannot remove a failed self-update folder", { dir, error: String(e) }));
    recordSelfUpdate(ctx.store, {
      state: { ...checked, problem: why, failed: [...(state.failed ?? []), tip].slice(-HISTORY_LIMIT) },
      entry: { from: head, to: tip, at: at.toISOString(), outcome: "failed", reason: why },
    });
    return;
  }
  log.info("self-update ready; switching once the factory is free", { from: head, to: tip, dir });
  save({ ...checked, status: "ready", from: head, to: tip, dir, problem: undefined });
}

/** The target commit in a fresh folder of its own, built and tried; throws on the first step that fails. */
async function prepare(deps: SelfUpdateDeps, install: string, tip: string, dir: string): Promise<void> {
  // The same rules as the packages: npm runs code from a git dependency even with --ignore-scripts.
  const lock = await lockProblemAt(deps.git, install, tip);
  if (lock) throw new Error(lock);
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(dirname(dir), { recursive: true });
  await deps.git(["clone", "--quiet", "--no-hardlinks", "--no-local", "--no-checkout", install, dir]);
  // The fetched tip is on no branch of the install folder, so it is asked for by name.
  await deps.git(["fetch", "--quiet", install, tip], { cwd: dir });
  await deps.git(["checkout", "--quiet", "--detach", tip], { cwd: dir });
  // The build needs the development dependencies; install scripts never run.
  await deps.npm([...npmCiArgs().filter((a) => a !== "--omit=dev")], dir);
  await deps.npm(["run", "build"], dir);
  await deps.node(["dist/cli.js", "--version"], dir);
  await deps.node(["dist/cli.js", "self-update", "check"], dir);
}

/** git with the local protocol allowed too: the prepared copy is cloned from the install folder. */
const selfUpdateGit: GitRunner = async (args, opts = {}) => {
  const git = findGit();
  if (!git) throw new Error("No encontré git en el PATH.");
  return runProcess(`git ${args[0]}`, git, [...(opts.cwd ? ["-C", opts.cwd] : []), ...args], { env: { ...gitEnv(), GIT_ALLOW_PROTOCOL: "https:ssh:file" }, timeout: STEP_TIMEOUT_MS });
};

export const realSelfUpdateDeps = (): SelfUpdateDeps => ({
  git: selfUpdateGit,
  npm: (args, cwd) => runNpm([...args, "--prefix", cwd], STEP_TIMEOUT_MS),
  node: ([script = "", ...args], cwd) => runProcess(`node ${script}`, process.execPath, [join(cwd, script), ...args], { env: { ...process.env }, timeout: STEP_TIMEOUT_MS }),
});
