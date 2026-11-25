import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FactoryContext } from "./app.js";
import type { FactoryConfig } from "./config.js";
import { mergeKey, type MergeState } from "./line/automerge.js";
import { log } from "./log.js";
import { findGit, gitEnv, lockProblemAt, npmCiArgs, runNpm, runProcess, type GitRunner } from "./package-install.js";
import { listReleases, newestRelease, releaseTag, type Release } from "./releases.js";
import { resultPath, switchLockHeldAt, type SwitchPlan, type SwitchResult } from "./self-update-switch.js";
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
/** What the last look at a configured channel found. */
export const SELF_UPDATE_LOOK_KEY = "self-update:look";
/** How many past updates the history keeps. */
export const HISTORY_LIMIT = 20;

export type SelfUpdateChannel = NonNullable<FactoryConfig["selfUpdate"]["channel"]>;

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
  /** A commit that failed for the machine (a locked file, a folder left without its build), prepared again from `at`. */
  retry?: SelfUpdateRetry;
  /** The install folder's HEAD at the last check: a different one makes the check due. */
  head?: string;
  /** When the switch process was launched (ISO). */
  switchingAt?: string;
  /** The channel configured at the last check, and so the one a version was prepared for; absent: none, which is `ultimo`. */
  channel?: SelfUpdateChannel;
}

/** Whether what a state holds is of the channel configured now. */
export const ofChannel = (state: SelfUpdateState, channel: SelfUpdateChannel | undefined) => (state.channel ?? "ultimo") === (channel ?? "ultimo");

/** A version to move to, with its release version when it is one. */
export interface SelfUpdateTarget {
  commit: string;
  version?: string;
}

/** The last look that could tell the channel's newest version; kept only while a channel is configured. */
export interface SelfUpdateLook {
  channel: SelfUpdateChannel;
  checkedAt: string;
  /** The commit installed at the look, with its release version when it is one. */
  head: string;
  version?: string;
  /** A newer version the installation can move to. */
  available?: SelfUpdateTarget;
}

export interface SelfUpdateRetry {
  commit: string;
  /** When it may be prepared again (ISO). */
  at: string;
  /** Consecutive machine failures of that commit. */
  tries: number;
}

/** The first wait after a machine failure, doubling with each one in a row up to RETRY_MAX_MS. */
export const RETRY_FIRST_MS = 60 * 60_000;
export const RETRY_MAX_MS = 24 * 60 * 60_000;

const MACHINE_CODE = /\b(EPERM|EBUSY|EACCES|ENOTEMPTY)\b/;

/** Whether an error comes from the machine (a file held by another process, a refused removal) rather than from the commit. */
export function isMachineFailure(err: unknown, depth = 0): boolean {
  if (!err || depth > 5) return false;
  if (typeof err === "string") return MACHINE_CODE.test(err);
  if (typeof err !== "object") return false;
  const { code, message, cause } = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof code === "string" && MACHINE_CODE.test(code)) return true;
  if (typeof message === "string" && MACHINE_CODE.test(message)) return true;
  return isMachineFailure(cause, depth + 1);
}

/** The next retry of a commit that failed for the machine: one more try in a row of the same commit, a longer wait. */
export function machineRetry(state: SelfUpdateState, commit: string, at: Date): SelfUpdateRetry {
  const tries = state.retry?.commit === commit ? state.retry.tries + 1 : 1;
  const wait = Math.min(RETRY_FIRST_MS * 2 ** (tries - 1), RETRY_MAX_MS);
  return { commit, at: new Date(at.getTime() + wait).toISOString(), tries };
}

/**
 * Where a failed commit goes: a machine failure only waits for a retry, any other failure is kept among the failed
 * ones for good. A retry of that commit is dropped in the latter case.
 */
export function afterFailure(state: SelfUpdateState, commit: string, machine: boolean, at: Date): Pick<SelfUpdateState, "failed" | "retry"> {
  if (!commit) return { failed: state.failed, retry: state.retry };
  if (machine) return { failed: state.failed, retry: machineRetry(state, commit, at) };
  const failed = state.failed?.includes(commit) ? state.failed : [...(state.failed ?? []), commit].slice(-HISTORY_LIMIT);
  return { failed, retry: state.retry?.commit === commit ? undefined : state.retry };
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

/** The last look on record; a store failure or a broken record reads as none. */
export function readSelfUpdateLook(store: Store): SelfUpdateLook | undefined {
  try {
    const raw = store.getKv(SELF_UPDATE_LOOK_KEY);
    const look = raw ? (JSON.parse(raw) as SelfUpdateLook) : undefined;
    if (look && typeof look === "object" && typeof look.channel === "string" && typeof look.checkedAt === "string" && typeof look.head === "string") return look;
  } catch (err) {
    log.warn("cannot read the self-update look", { error: String(err) });
  }
  return undefined;
}

function recordLook(store: Store, look: SelfUpdateLook): void {
  try {
    store.setKv(SELF_UPDATE_LOOK_KEY, JSON.stringify(look));
  } catch (err) {
    log.warn("cannot record the self-update look", { error: String(err) });
  }
}

/** A version put in place since the look is the current one, and no longer something new. */
function lookAfterInstall(store: Store, from: string, to: string): void {
  const look = readSelfUpdateLook(store);
  if (!look) return;
  const { channel, checkedAt, available } = look;
  if (available?.commit === to) recordLook(store, { channel, checkedAt, head: to, ...(available.version && { version: available.version }) });
  else if (look.head === from && from !== to) recordLook(store, { channel, checkedAt, head: to, ...(available && { available }) });
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
/** Nothing the factory sees announces a release, so in the stable channel the remote is looked at once an hour. */
export const STABLE_CHECK_EVERY_MS = 60 * 60_000;
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

/**
 * Due when it was never checked, a day has passed, a machine retry's time came, the install folder's HEAD moved (an
 * update by hand) or a pull request of a line working on the install folder merged since. Also when the channel changed;
 * in the stable one every hour, and merges say nothing since only releases count.
 */
function due(ctx: FactoryContext, state: SelfUpdateState, install: string, at: Date, head: string | undefined): boolean {
  const { channel, enabled } = ctx.config.selfUpdate;
  if (!state.checkedAt || at.getTime() - Date.parse(state.checkedAt) >= (channel === "estable" ? STABLE_CHECK_EVERY_MS : CHECK_EVERY_MS)) return true;
  if (state.channel !== channel) return true;
  if (enabled && state.retry && at.getTime() >= Date.parse(state.retry.at)) return true;
  if (head && state.head && head !== state.head) return true;
  if (channel === "estable") return false;
  const lines = new Set(ctx.config.lines.filter((l) => samePath(l.repo, install)).map((l) => l.name));
  if (!lines.size) return false;
  for (const job of ctx.store.listJobs({ status: ["delivered"], limit: -1 })) {
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
 * Looks at whether the install folder's branch moved on its remote (in the stable channel, whether a newer version was
 * released from it) and, when it is a clean fast-forward, prepares that commit off to the side. Never touches the install
 * folder's files; the switch happens later. With a channel it keeps what it found, and without automatic updates that is
 * all it does.
 */
export async function selfUpdateCheck(ctx: FactoryContext, deps: SelfUpdateDeps): Promise<void> {
  const settings = ctx.config.selfUpdate;
  if (!settings?.enabled && !settings?.channel) return;
  const { channel } = settings;
  const at = (deps.now ?? ctx.now ?? (() => new Date()))();
  let { state } = readSelfUpdate(ctx.store);
  // A switch under way is the next daemon's to tell.
  if (state.status === "switching") return;
  // A switch still at work (even one taken for dead) owns the install folder and the prepared folders.
  if (switchLockHeldAt(ctx.home.root)) return;
  // A version prepared for another channel, or left by automatic updates since turned off, is never switched to. It goes
  // before anything is awaited, so the daemon cannot be launching its switch meanwhile.
  if (state.status === "ready" && (!ofChannel(state, channel) || !settings.enabled)) {
    const { dir, to, failed, retry } = state;
    log.info("dropping a prepared version that is no longer wanted", { to, dir, channel: channel ?? "ultimo", enabled: settings.enabled });
    state = { status: "idle", ...(failed && { failed }), ...(retry && { retry }) };
    recordSelfUpdate(ctx.store, { state });
    await removePrepared(dir);
  }
  const install = deps.install ?? installFolder();
  const git = (args: string[]) => deps.git(args, { cwd: install });
  const isAncestor = (a: string, b: string) => git(["merge-base", "--is-ancestor", a, b]).then(() => true, () => false);
  const installed = await git(["rev-parse", "HEAD"]).catch(() => undefined);
  const clean = (head: string): SelfUpdateState => ({ status: "idle", checkedAt: at.toISOString(), head, ...(channel && { channel }) });
  if (state.status === "ready") {
    // A prepared version waits for its switch, unless that commit was already put in place by hand.
    if (!installed || installed !== state.to) return;
    log.info("self-update target already installed; dropping the prepared version", { to: state.to, dir: state.dir });
    recordSelfUpdate(ctx.store, { state: clean(installed) });
    lookAfterInstall(ctx.store, state.from ?? "", installed);
    await removePrepared(state.dir);
    return;
  }
  if (!due(ctx, state, install, at, installed)) return;
  const checked: SelfUpdateState = { ...state, checkedAt: at.toISOString(), ...(installed ? { head: installed } : {}), channel };
  const save = (next: SelfUpdateState) => recordSelfUpdate(ctx.store, { state: next });
  // Each distinct problem is said once; the check time moves on either way.
  const problem = (text: string) => {
    if (text !== state.problem) log.warn("self-update held back", { problem: text });
    save({ ...checked, problem: text });
  };

  let head: string;
  let tip: string;
  let branch: string;
  let localChanges: boolean;
  let releases: Release[] = [];
  const dirty = `cambios locales en ${install}: no actualizo`;
  const notRoot = `${install} no es la raíz de su propio repositorio de git`;
  try {
    if ((await git(["rev-parse", "--show-cdup"])) !== "") return problem(notRoot);
  } catch {
    return problem(notRoot);
  }
  try {
    const current = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    branch = settings.branch ?? current;
    if (current === "HEAD" || current !== branch) return problem(`${install} no está en la rama ${branch === "HEAD" ? "de trabajo" : branch}`);
    localChanges = (await git(["status", "--porcelain", "--untracked-files=no"])) !== "";
    // With a channel they hold back the update, not the look.
    if (localChanges && !channel) return problem(dirty);
    // Before the fetch, so that what was released meanwhile is never missing from the branch. In `ultimo` releases only name what is found.
    if (channel === "estable") releases = await listReleases(deps.git, settings.remote, { cwd: install });
    else if (channel) releases = await listReleases(deps.git, settings.remote, { cwd: install }).catch(() => []);
    await git(["fetch", settings.remote, branch]);
    tip = await git(["rev-parse", "FETCH_HEAD"]);
    head = await git(["rev-parse", "HEAD"]);
  } catch (err) {
    return problem(`no pude mirar ${settings.remote}: ${reason(err)}`);
  }
  const releaseAt = (commit: string) => releases.filter((r) => r.commit === commit).at(-1)?.version;
  const found = (available?: SelfUpdateTarget) => {
    if (!channel) return;
    const version = releaseAt(head);
    recordLook(ctx.store, { channel, checkedAt: at.toISOString(), head, ...(version && { version }), ...(available && { available }) });
  };
  if (channel === "estable") {
    const newest = newestRelease(releases);
    if (newest && !(await isAncestor(newest.commit, tip))) {
      found();
      return problem(`la versión ${releaseTag(newest.version)} (${newest.commit.slice(0, 12)}) no está en ${branch} de ${settings.remote}`);
    }
    // Without releases, or already past them, it stays where it is: installations only move forward.
    if (!newest || (newest.commit !== head && (await isAncestor(newest.commit, head)))) {
      found();
      return save({ ...checked, problem: undefined, retry: undefined });
    }
    tip = newest.commit;
  }
  // Up to date, by an update or by hand: nothing of earlier failures is left to tell.
  if (tip === head) {
    found();
    return save(clean(head));
  }
  const version = releaseAt(tip);
  const notForward = `${version ? `${releaseTag(version)} (${tip.slice(0, 12)})` : tip.slice(0, 12)} no es un avance rápido desde ${head.slice(0, 12)}`;
  if (channel) {
    const forward = await isAncestor(head, tip);
    found(forward ? { commit: tip, ...(version && { version }) } : undefined);
    // A commit that is no longer the target must not keep making the check due.
    if (checked.retry && checked.retry.commit !== tip) delete checked.retry;
    if (!forward) return problem(notForward);
    if (!settings.enabled) return save({ ...checked, problem: undefined });
    if (localChanges) return problem(dirty);
  }
  // A commit that already failed is never prepared again; its failure was already told.
  if (state.failed?.includes(tip)) return save(checked);
  // A commit that failed for the machine waits for its retry.
  if (state.retry?.commit === tip && at.getTime() < Date.parse(state.retry.at)) return save(checked);
  if (!(await isAncestor("HEAD", tip))) return problem(notForward);

  const dir = join(selfUpdateDir(ctx), tip.slice(0, 12));
  try {
    await prepare(deps, install, tip, dir);
  } catch (err) {
    const why = `no pude preparar ${tip.slice(0, 12)}: ${reason(err)}`;
    const machine = isMachineFailure(err);
    log.warn("self-update preparation failed; staying on the current version", { from: head, to: tip, error: why, machine });
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((e) => log.warn("cannot remove a failed self-update folder", { dir, error: String(e) }));
    recordSelfUpdate(ctx.store, {
      state: { ...checked, problem: why, ...afterFailure(checked, tip, machine, at) },
      entry: { from: head, to: tip, at: at.toISOString(), outcome: "failed", reason: why },
    });
    return;
  }
  log.info("self-update ready; switching once the factory is free", { from: head, to: tip, dir });
  save({ ...checked, status: "ready", from: head, to: tip, dir, problem: undefined, retry: checked.retry?.commit === tip ? undefined : checked.retry });
}

async function removePrepared(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch((err) => log.warn("cannot remove the prepared self-update folder", { dir, error: String(err) }));
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

/** git with the local protocol allowed too: the prepared copy is cloned from the install folder, and a repository of the person in charge may have a folder as its remote. */
export const selfUpdateGit: GitRunner = async (args, opts = {}) => {
  const git = findGit();
  if (!git) throw new Error("No encontré git en el PATH.");
  return runProcess(`git ${args[0]}`, git, [...(opts.cwd ? ["-C", opts.cwd] : []), ...args], { env: { ...gitEnv(), GIT_ALLOW_PROTOCOL: "https:ssh:file" }, timeout: STEP_TIMEOUT_MS });
};

export const realSelfUpdateDeps = (): SelfUpdateDeps => ({
  git: selfUpdateGit,
  npm: (args, cwd) => runNpm([...args, "--prefix", cwd], STEP_TIMEOUT_MS),
  node: ([script = "", ...args], cwd) => runProcess(`node ${script}`, process.execPath, [join(cwd, script), ...args], { env: { ...process.env }, timeout: STEP_TIMEOUT_MS }),
});

/** Starts the switch to a prepared version as a process of its own that outlives this daemon; tests inject a fake. */
export type SwitchLauncher = (ctx: FactoryContext, state: SelfUpdateState) => Promise<void>;

/** A switch that left no result after this long is taken for dead, and the factory stays on what runs. */
export const SWITCH_STALE_MS = 30 * 60_000;

/**
 * Copies the switch script out of the install folder it is about to replace, writes its plan and starts it detached,
 * with the daemon log as its output, like `ensureDaemon` starts the daemon.
 */
export const launchSwitch: SwitchLauncher = async (ctx, state) => {
  const install = installFolder();
  const git = findGit();
  if (!git) throw new Error("No encontré git en el PATH.");
  if (!state.from || !state.to || !state.dir) throw new Error("la actualización preparada está incompleta");
  const branch = ctx.config.selfUpdate.branch ?? tryGit(["rev-parse", "--abbrev-ref", "HEAD"], install);
  if (!branch) throw new Error(`no sé en qué rama está ${install}`);
  const dir = selfUpdateDir(ctx);
  await mkdir(dir, { recursive: true });
  const script = join(dir, "switch.mjs");
  await copyFile(fileURLToPath(new URL("./self-update-switch.js", import.meta.url)), script);
  const plan: SwitchPlan = {
    home: ctx.home.root,
    install,
    prepared: state.dir,
    from: state.from,
    to: state.to,
    branch,
    timeoutMs: ctx.config.selfUpdate.startTimeoutSeconds * 1000,
    log: ctx.home.daemonLog,
    node: process.execPath,
    git,
  };
  const planFile = join(dir, "plan.json");
  await writeFile(planFile, JSON.stringify(plan, null, 2));
  const out = openSync(ctx.home.daemonLog, "a");
  const child = spawn(process.execPath, [script, planFile], { cwd: dir, detached: true, stdio: ["ignore", out, out], windowsHide: true, env: { ...process.env, ZERO_HOME: ctx.home.root } });
  child.unref();
};

const OUTCOMES: readonly string[] = ["updated", "rolled-back", "failed"];

/**
 * Records what the last switch did, from the result it left: an entry in the history and the state back to idle, with a
 * target that did not start (or could not be put in place) kept among the failed ones. Called when the daemon starts and
 * on its passes, since the switch writes its result only after the new daemon took the lock. Never throws.
 */
export interface ImportOptions {
  /** Whether a switch process is still at work, so a switch without a result is not taken for dead; absent: its lock is held. */
  switchRunning?: () => boolean;
}

export async function importSwitchResult(ctx: FactoryContext, opts: ImportOptions = {}): Promise<SelfUpdateEntry | undefined> {
  const file = resultPath(ctx.home.root);
  const at = (ctx.now ?? (() => new Date()))();
  const { state } = readSelfUpdate(ctx.store);
  if (!existsSync(file)) {
    // A switch that died without a word must not hold the factory forever; it says nothing of the commit, so it is tried again later.
    const since = state.switchingAt ? Date.parse(state.switchingAt) : NaN;
    if (state.status !== "switching" || !(at.getTime() - since >= SWITCH_STALE_MS)) return undefined;
    if ((opts.switchRunning ?? (() => switchLockHeldAt(ctx.home.root)))()) return undefined;
    const entry: SelfUpdateEntry = { from: state.from ?? "", to: state.to ?? "", at: at.toISOString(), outcome: "failed", reason: "el cambio de versión no dejó resultado" };
    log.warn("self-update switch left no result; staying on what runs", { from: entry.from, to: entry.to });
    recordSelfUpdate(ctx.store, { state: idleAfter(state, entry, true, at), entry });
    return entry;
  }
  let result: SwitchResult | undefined;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as SwitchResult;
    if (parsed && typeof parsed.from === "string" && typeof parsed.to === "string" && typeof parsed.at === "string" && OUTCOMES.includes(parsed.outcome)) result = parsed;
  } catch (err) {
    log.warn("cannot read the self-update result", { error: String(err) });
  }
  await rm(file, { force: true }).catch((err) => log.warn("cannot remove the self-update result", { error: String(err) }));
  if (!result) return undefined;
  const entry: SelfUpdateEntry = { from: result.from, to: result.to, at: result.at, outcome: result.outcome, ...(result.reason ? { reason: result.reason } : {}) };
  if (entry.outcome === "updated") {
    log.info("self-update done", { from: entry.from, to: entry.to });
    lookAfterInstall(ctx.store, entry.from, entry.to);
  } else log.warn("self-update did not go through; running the previous version", { from: entry.from, to: entry.to, outcome: entry.outcome, reason: entry.reason });
  const own = state.status === "switching" && Boolean(entry.to) && entry.to === state.to;
  let dir: string | undefined;
  if (own) {
    recordSelfUpdate(ctx.store, { state: idleAfter(state, entry, result.machine === true, at), entry });
    dir = state.dir;
  } else {
    // A result of an earlier switch, arriving late: it goes to the history and touches nothing of the current target,
    // except that a commit it put in place is no longer a failed one.
    log.info("self-update result of an earlier switch; only recorded", { to: entry.to, current: state.to, status: state.status });
    const succeeded = entry.outcome === "updated" ? withoutCommit(state, entry.to) : undefined;
    recordSelfUpdate(ctx.store, { ...(succeeded ? { state: succeeded } : {}), entry });
    if (entry.to && entry.to !== state.to) dir = join(selfUpdateDir(ctx), entry.to.slice(0, 12));
  }
  // What is left of that result's prepared folder is no longer needed: its build is in place or was given up.
  await removePrepared(dir);
  return entry;
}

/** The state without a commit among the failed ones or its retry, when it holds either; else undefined. */
function withoutCommit(state: SelfUpdateState, commit: string): SelfUpdateState | undefined {
  if (!state.failed?.includes(commit) && state.retry?.commit !== commit) return undefined;
  const next: SelfUpdateState = { ...state };
  const failed = state.failed?.filter((c) => c !== commit);
  if (failed?.length) next.failed = failed;
  else delete next.failed;
  if (next.retry?.commit === commit) delete next.retry;
  return next;
}

function idleAfter(state: SelfUpdateState, entry: SelfUpdateEntry, machine: boolean, at: Date): SelfUpdateState {
  const { failed, retry } =
    entry.outcome === "updated"
      ? { failed: state.failed?.filter((c) => c !== entry.to), retry: state.retry?.commit === entry.to ? undefined : state.retry }
      : afterFailure(state, entry.to, machine, at);
  return {
    status: "idle",
    ...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
    ...(state.head ? { head: state.head } : {}),
    ...(state.channel ? { channel: state.channel } : {}),
    ...(failed?.length ? { failed } : {}),
    ...(retry ? { retry } : {}),
    ...(entry.outcome === "updated" ? {} : { problem: entryProblem(entry) }),
  };
}

/** The problem a failed or rolled-back update leaves on the state; status leaves it out when it only repeats that entry. */
export function entryProblem(entry: SelfUpdateEntry): string | undefined {
  if (entry.outcome === "updated") return undefined;
  return entry.outcome === "rolled-back" ? `volví a ${entry.from.slice(0, 12)}: ${entry.reason ?? `${entry.to.slice(0, 12)} no arrancó`}` : (entry.reason ?? "el cambio de versión falló");
}
