// The switch to a prepared version of zero. It runs as a process of its own, started by the daemon right before it stops,
// from a copy outside the install folder (`<ZERO_HOME>/self-update/switch.mjs`), so it imports only Node's built-in modules:
// the install folder's `dist` and `node_modules` are what it replaces.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cp, lstat, mkdir, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** What the daemon hands the switch in `plan.json`. */
export interface SwitchPlan {
  /** ZERO_HOME. */
  home: string;
  /** The install folder whose `dist` and `node_modules` are replaced. */
  install: string;
  /** The folder where the new version was prepared. */
  prepared: string;
  /** Commit running now. */
  from: string;
  /** Commit prepared. */
  to: string;
  /** The install folder's branch, fast-forwarded to `to`. */
  branch: string;
  /** How long the new daemon has to take the lock. */
  timeoutMs: number;
  /** The daemon log: the started daemons write there, and so does the switch. */
  log: string;
  /** Absolute paths of node and git, found by the daemon. */
  node: string;
  git: string;
}

export interface SwitchResult {
  from: string;
  to: string;
  at: string;
  outcome: "updated" | "rolled-back" | "failed";
  reason?: string;
  /** The failure came from the machine (a locked file, a missing part), so the commit is tried again later. */
  machine?: boolean;
}

export interface FileEntry {
  /** Relative to the listed folder, with `/`. */
  path: string;
  size: number;
}

export interface SwitchFs {
  exists(path: string): boolean;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, text: string): Promise<void>;
  /** Every file under a folder, recursively, with its size. */
  list(dir: string): Promise<FileEntry[]>;
  /** The names right under a folder; none when it does not exist. */
  entries(dir: string): string[];
  /** Removes a folder only when it is empty; rejects otherwise. */
  removeEmpty(path: string): Promise<void>;
}

/** The switch's own operating system lock, held from its start until its result is written. */
export interface SwitchLock {
  release(): void;
}

/** Everything the switch touches outside itself; tests inject fakes. */
export interface SwitchDeps {
  fs: SwitchFs;
  /** git with its arguments on the install folder; returns stdout, throws on failure. */
  git(args: string[]): Promise<string>;
  /** Whether a daemon holds the factory's lock. */
  lockHeld(): boolean;
  /** Takes the switch lock, or undefined when another switch holds it. */
  switchLock(): SwitchLock | undefined;
  /** Starts `node <install>/dist/cli.js start` detached, like `zero start --detach`. */
  launch(): { pid?: number };
  /** Ends a started daemon and everything under it. */
  kill(pid: number): void;
  /** Runs `node <cli> --version` from the install folder with a time limit; rejects with the end of its error output. */
  check(cli: string): Promise<void>;
  say(message: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

/** How long the old daemon has to let go of the lock. */
export const RELEASE_WAIT_MS = 60_000;
const POLL_MS = 250;
const PARTS = ["dist", "node_modules"] as const;
type Part = (typeof PARTS)[number];
/** What a rename answers on Windows while another process has files of the folder open. */
const LOCKED = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);
const RENAME_TRIES = 6;
const RENAME_WAIT_MS = 500;
const RESULT_TRIES = 3;
const CHECK_TIMEOUT_MS = 60_000;

export const resultPath = (home: string) => join(home, "self-update", "result.json");
export const previousPath = (home: string) => join(home, "self-update", "previous");
/** Where the switch stages the new build and sets the old one aside: inside the install folder, so on its volume. */
export const stagingPath = (install: string) => join(install, ".zero-switch");
/** The switch lock: while it is held, a switch is at work and nothing else prepares or switches. */
export const switchLockPath = (home: string) => join(home, "self-update", "switch.lock");

const text = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);
const tail = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(-300);
const errCode = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** An error that comes from the machine (a missing or incomplete part), not from the commit. */
const machineError = (message: string) => Object.assign(new Error(message), { machine: true });
const fromMachine = (err: unknown) => (err as { machine?: unknown } | undefined)?.machine === true || LOCKED.has(errCode(err) ?? "");

/**
 * A rename, or a copy and a removal when the two folders are on different volumes. Never used on the install folder's parts.
 * With `keepSource` the copy's source stays for the final cleanup, which comes after the result.
 */
async function move(fs: SwitchFs, from: string, to: string, keepSource = false): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (errCode(err) !== "EXDEV") throw err;
    await fs.copy(from, to);
    if (!keepSource) await fs.remove(from);
  }
}

/** A rename inside the install folder, tried again with a growing wait while another process holds its files. */
async function renameRetrying(deps: SwitchDeps, part: string, from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.fs.rename(from, to);
      return;
    } catch (err) {
      const code = errCode(err);
      if (!code || !LOCKED.has(code)) throw err;
      if (attempt >= RENAME_TRIES) {
        throw Object.assign(new Error(`no pude mover ${part} (${code}): otro proceso (por ejemplo el servidor MCP del chat) puede tener abiertos sus archivos`), { code });
      }
      deps.say(`${part} is locked (${code}); trying again`);
      await deps.sleep(RENAME_WAIT_MS * 2 ** (attempt - 1));
    }
  }
}

async function waitFor(deps: SwitchDeps, held: boolean, ms: number): Promise<boolean> {
  for (const deadline = deps.now().getTime() + ms; deps.lockHeld() !== held; await deps.sleep(POLL_MS)) {
    if (deps.now().getTime() >= deadline) return false;
  }
  return true;
}

const sameFiles = (a: FileEntry[], b: FileEntry[]) => {
  const key = (files: FileEntry[]) => files.map((f) => `${f.path}\0${f.size}`).sort().join("\n");
  return a.length === b.length && key(a) === key(b);
};

interface Staging {
  /** The new build, before it goes in place. */
  fresh: string;
  /** The install folder's parts, set aside until the new daemon runs. */
  old: string;
  /** New parts taken out of the install folder by a rollback. */
  failed: string;
}

type Outcome = (outcome: SwitchResult["outcome"], reason?: string, machine?: boolean) => SwitchResult;

/**
 * Takes the switch lock, waits for the old daemon to stop, stages the prepared build inside the install folder and checks it
 * arrived whole, swaps the parts only by renames on the install folder's volume, checks that `dist/cli.js --version` runs
 * from there, fast-forwards the branch and starts the new daemon. Anything that fails puts the previous build, commit and
 * daemon back. Writes `result.json` for the next daemon to record, releases the lock and only then removes what is left
 * under the staging folder, which can take hours on a locked file; never throws.
 */
export async function runSwitch(plan: SwitchPlan, deps: SwitchDeps): Promise<SwitchResult> {
  const result: Outcome = (outcome, reason, machine) => ({
    from: plan.from,
    to: plan.to,
    at: deps.now().toISOString(),
    outcome,
    ...(reason ? { reason } : {}),
    ...(machine && outcome === "failed" ? { machine: true } : {}),
  });
  let lock: SwitchLock | undefined;
  try {
    lock = deps.switchLock();
  } catch (err) {
    say(deps, `cannot take the switch lock: ${text(err)}`);
  }
  if (!lock) {
    // Another switch is at work: its own result is the one to tell, so this one writes none and touches nothing.
    const outcome = result("failed", "otro cambio de versión está en curso", true);
    say(deps, `self-update switch not run: ${outcome.reason}`);
    return outcome;
  }
  const root = stagingPath(plan.install);
  // What earlier switches left, listed under the lock: this run picks fresh names and removes those only at the end.
  const leftovers = safeEntries(deps, root).map((name) => join(root, name));
  const own: string[] = [];
  let keep: string | undefined;
  let outcome: SwitchResult;
  try {
    ({ outcome, keep } = await apply(plan, deps, result, own));
  } catch (err) {
    outcome = result("failed", text(err), fromMachine(err));
  }
  await finish(plan, deps, outcome);
  try {
    lock.release();
  } catch (err) {
    say(deps, `cannot release the switch lock: ${text(err)}`);
  }
  // Named folders only, never the root as a whole; a folder still holding the only copy of the previous build stays.
  for (const dir of [...leftovers, ...own]) {
    if (dir === keep) continue;
    try {
      if (deps.fs.exists(dir)) await deps.fs.remove(dir);
    } catch (err) {
      say(deps, `cannot remove ${dir}: ${text(err)}`);
    }
  }
  if (deps.fs.exists(root)) await deps.fs.removeEmpty(root).catch(() => undefined);
  return outcome;
}

function safeEntries(deps: SwitchDeps, dir: string): string[] {
  try {
    return deps.fs.entries(dir);
  } catch (err) {
    say(deps, `cannot list ${dir}: ${text(err)}`);
    return [];
  }
}

function say(deps: SwitchDeps, message: string): void {
  try {
    deps.say(message);
  } catch {
    // A log line changes nothing.
  }
}

/** The switch itself; `own` gets the staging folders it makes, `keep` names one the final cleanup must leave. */
async function apply(plan: SwitchPlan, deps: SwitchDeps, result: Outcome, own: string[]): Promise<{ outcome: SwitchResult; keep?: string }> {
  const { fs } = deps;
  const install = (part: Part) => join(plan.install, part);
  const moved: Part[] = [];
  const placed: Part[] = [];
  let merged = false;
  let stage: Staging | undefined;

  const launch = (): { pid?: number; problem?: string } => {
    try {
      return deps.launch();
    } catch (err) {
      say(deps, `cannot start the daemon: ${text(err)}`);
      return { problem: `no pude arrancar el daemon: ${text(err)}` };
    }
  };

  // Back to what ran before: the previous build and commit, and its daemon started again. Nothing of the install is deleted.
  const restore = async (): Promise<string | undefined> => {
    const problems: string[] = [];
    for (const part of [...PARTS].reverse()) {
      try {
        if (stage && placed.includes(part) && fs.exists(install(part))) {
          await fs.mkdir(stage.failed);
          await renameRetrying(deps, part, install(part), join(stage.failed, part));
        }
        if (stage && moved.includes(part)) await renameRetrying(deps, part, join(stage.old, part), install(part));
      } catch (err) {
        problems.push(`no pude devolver ${part}: ${text(err)}`);
      }
    }
    if (merged) {
      try {
        await deps.git(["reset", "--keep", plan.from]);
      } catch (err) {
        problems.push(`no pude volver a ${plan.from.slice(0, 12)}: ${text(err)}`);
      }
    }
    const started = launch();
    if (started.problem) problems.push(started.problem);
    else if (!(await waitFor(deps, true, plan.timeoutMs))) problems.push("la versión anterior tampoco tomó el candado");
    return problems.length ? problems.join("; ") : undefined;
  };
  const giveUp = async (outcome: "failed" | "rolled-back", why: string, machine = false): Promise<{ outcome: SwitchResult; keep?: string }> => {
    say(deps, why);
    let trouble: string | undefined;
    try {
      trouble = await restore();
    } catch (err) {
      trouble = text(err);
    }
    // A part that did not go back still sits among the old ones: that folder is the only copy of it.
    const stranded = stage && moved.some((part) => fs.exists(join(stage!.old, part)));
    return { outcome: result(outcome, trouble ? `${why}; ${trouble}` : why, machine), ...(stranded ? { keep: stage!.old } : {}) };
  };

  if (!(await waitFor(deps, false, RELEASE_WAIT_MS))) {
    // Nothing was touched: the old daemon still runs, or a launch here finds the lock taken and ends.
    const started = launch();
    const why = "la fábrica no se apagó a tiempo; sigo en la versión actual";
    return { outcome: result("failed", started.problem ? `${why}; ${started.problem}` : why, true) };
  }

  try {
    const branch = await deps.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== plan.branch) throw new Error(`${plan.install} ya no está en la rama ${plan.branch}`);
    const staged = await freshStaging(plan, deps, own);
    stage = staged;
    // The new build arrives whole next to the install before anything of the install moves.
    for (const part of PARTS) {
      const from = join(plan.prepared, part);
      if (!fs.exists(from)) throw machineError(`falta ${part} en la versión preparada`);
      const listed = await fs.list(from);
      await move(fs, from, join(staged.fresh, part));
      if (!sameFiles(listed, await fs.list(join(staged.fresh, part)))) throw machineError(`la copia de ${part} de la versión nueva quedó incompleta`);
    }
    for (const part of PARTS) {
      if (fs.exists(install(part))) {
        await renameRetrying(deps, part, install(part), join(staged.old, part));
        moved.push(part);
      }
      await renameRetrying(deps, part, join(staged.fresh, part), install(part));
      placed.push(part);
    }
  } catch (err) {
    return giveUp("failed", `no pude poner ${plan.to.slice(0, 12)}: ${text(err)}`, fromMachine(err));
  }

  try {
    await deps.check(join(plan.install, "dist", "cli.js"));
  } catch (err) {
    return giveUp("failed", `la versión ${plan.to.slice(0, 12)} no corre desde ${plan.install}: ${tail(err)}`);
  }

  try {
    await deps.git(["merge", "--ff-only", "--quiet", plan.to]);
    merged = true;
  } catch (err) {
    return giveUp("failed", `no pude poner ${plan.to.slice(0, 12)}: ${text(err)}`);
  }

  const started = launch();
  if (!started.problem && (await waitFor(deps, true, plan.timeoutMs))) {
    if (stage) await keepPrevious(plan, deps, stage.old, moved);
    return { outcome: result("updated") };
  }
  const why = started.problem ?? `la versión ${plan.to.slice(0, 12)} no tomó el candado en ${Math.round(plan.timeoutMs / 1000)} s`;
  say(deps, `${why}; vuelvo a ${plan.from.slice(0, 12)}`);
  if (started.pid) deps.kill(started.pid);
  await waitFor(deps, false, RELEASE_WAIT_MS);
  return giveUp("rolled-back", why);
}

/** Picks names inside the staging folder that no earlier switch left; those stay as they are until the end of the run. */
async function freshStaging(plan: SwitchPlan, deps: SwitchDeps, own: string[]): Promise<Staging> {
  const root = stagingPath(plan.install);
  let suffix = "";
  for (let n = 1; ["new", "old", "failed"].some((name) => deps.fs.exists(join(root, name + suffix))); n++) suffix = `-${n}`;
  const stage = { fresh: join(root, `new${suffix}`), old: join(root, `old${suffix}`), failed: join(root, `failed${suffix}`) };
  own.push(stage.fresh, stage.old, stage.failed);
  await deps.fs.mkdir(stage.fresh);
  await deps.fs.mkdir(stage.old);
  return stage;
}

/** The old build goes to `self-update/previous` once the new daemon runs; a failure there only gets logged. */
async function keepPrevious(plan: SwitchPlan, deps: SwitchDeps, old: string, moved: Part[]): Promise<void> {
  const previous = previousPath(plan.home);
  try {
    if (deps.fs.exists(previous)) await deps.fs.remove(previous);
    await deps.fs.mkdir(previous);
    // Across volumes the old parts are copied; removing them is the final cleanup's, after the result.
    for (const part of moved) await move(deps.fs, join(old, part), join(previous, part), true);
  } catch (err) {
    say(deps, `cannot keep the previous build in ${previous}: ${text(err)}`);
  }
}

async function finish(plan: SwitchPlan, deps: SwitchDeps, outcome: SwitchResult): Promise<SwitchResult> {
  say(deps, `self-update ${outcome.outcome}: ${outcome.from.slice(0, 12)} -> ${outcome.to.slice(0, 12)}${outcome.reason ? ` (${outcome.reason})` : ""}`);
  for (let attempt = 1; attempt <= RESULT_TRIES; attempt++) {
    try {
      await deps.fs.mkdir(join(plan.home, "self-update"));
      await deps.fs.writeFile(resultPath(plan.home), JSON.stringify(outcome));
      break;
    } catch (err) {
      say(deps, `cannot write the self-update result: ${text(err)}`);
      if (attempt < RESULT_TRIES) await deps.sleep(RENAME_WAIT_MS * attempt).catch(() => undefined);
    }
  }
  return outcome;
}

/** Every file under a folder with its `lstat` size, so that links are listed and never followed. */
async function listFiles(dir: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  const walk = async (rel: string) => {
    for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else files.push({ path, size: (await lstat(join(dir, path))).size });
    }
  };
  await walk("");
  return files;
}

/** The lock check of `daemonLockHeld`: a read-only open that SQLite refuses as busy while a daemon holds it. */
function lockHeldAt(file: string): boolean {
  if (!existsSync(file)) return false;
  const { DatabaseSync } = sqlite();
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return false;
  } catch (err) {
    return isBusy(err);
  } finally {
    db?.close();
  }
}

const sqlite = () => createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const isBusy = (err: unknown) => (((err as { errcode?: number }).errcode ?? 0) & 0xff) === 5;

/** Whether a switch holds its lock, this process included; a read-only look. */
export const switchLockHeldAt = (home: string): boolean => lockHeldAt(switchLockPath(home));

/**
 * Takes the switch lock the way `acquireDaemonLock` takes the factory's: an exclusive SQLite transaction on an empty file,
 * an operating system lock that dies with the process. Undefined when another switch holds it.
 */
export function acquireSwitchLock(home: string): SwitchLock | undefined {
  mkdirSync(join(home, "self-update"), { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(switchLockPath(home));
  try {
    db.exec("PRAGMA busy_timeout=1000");
    db.exec("PRAGMA journal_mode=MEMORY");
    db.exec("BEGIN EXCLUSIVE");
  } catch (err) {
    db.close();
    if (isBusy(err)) return undefined;
    throw err;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    },
  };
}

export function realSwitchDeps(plan: SwitchPlan): SwitchDeps {
  const say = (message: string) => {
    try {
      appendFileSync(plan.log, `${JSON.stringify({ at: new Date().toISOString(), level: "info", msg: message, from: "self-update-switch" })}\n`);
    } catch {
      // A log line that cannot be written changes nothing.
    }
  };
  return {
    fs: {
      exists: existsSync,
      rename,
      copy: (from, to) => cp(from, to, { recursive: true, verbatimSymlinks: true }),
      remove: (path) => rm(path, { recursive: true, force: true, maxRetries: 5 }),
      mkdir: async (path) => void (await mkdir(path, { recursive: true })),
      writeFile: (path, body) => writeFile(path, body),
      list: listFiles,
      entries: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
      removeEmpty: (path) => rmdir(path),
    },
    git: (args) =>
      new Promise((done, fail) => {
        const r = spawnSync(plan.git, ["-C", plan.install, ...args], { encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        if (r.status === 0) done(r.stdout.trim());
        else fail(new Error(`git ${args[0]}: ${(r.stderr || r.error?.message || "").trim().slice(-300)}`));
      }),
    lockHeld: () => lockHeldAt(join(plan.home, "daemon.lock")),
    switchLock: () => acquireSwitchLock(plan.home),
    launch: () => {
      const out = openSync(plan.log, "a");
      const child = spawn(plan.node, [join(plan.install, "dist", "cli.js"), "start"], {
        cwd: plan.install,
        detached: true,
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: { ...process.env, ZERO_HOME: plan.home },
      });
      child.on("error", (err) => say(`cannot start the daemon: ${text(err)}`));
      child.unref();
      return { pid: child.pid };
    },
    kill: (pid) => {
      try {
        if (process.platform === "win32") {
          spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/pid", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15_000, stdio: "ignore" });
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            process.kill(pid, "SIGKILL");
          }
        }
      } catch {
        // Already gone.
      }
    },
    check: async (cli) => {
      const r = spawnSync(plan.node, [cli, "--version"], { cwd: plan.install, encoding: "utf8", windowsHide: true, timeout: CHECK_TIMEOUT_MS, env: { ...process.env, ZERO_HOME: plan.home } });
      if (r.status !== 0) throw new Error(`node dist/cli.js --version: ${(r.stderr || r.error?.message || `terminó con ${r.status ?? r.signal}`).trim().slice(-300)}`);
    },
    say,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

// Run as `node switch.mjs <plan.json>`.
if (process.argv[2] && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as SwitchPlan;
  // Whatever happens, the next daemon must find a result to record.
  let done = false;
  const lastWord = (err: unknown) => {
    if (done) return;
    done = true;
    try {
      const outcome: SwitchResult = { from: plan.from, to: plan.to, at: new Date().toISOString(), outcome: "failed", reason: `el cambio de versión se cortó: ${text(err)}` };
      writeFileSync(resultPath(plan.home), JSON.stringify(outcome));
    } catch {
      // Nothing else to do: the next daemon gives up on the switch after a while.
    }
  };
  process.on("uncaughtException", lastWord);
  process.on("unhandledRejection", lastWord);
  runSwitch(plan, realSwitchDeps(plan)).then(() => void (done = true), lastWord);
}
