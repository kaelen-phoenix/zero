// The switch to a prepared version of zero. It runs as a process of its own, started by the daemon right before it stops,
// from a copy outside the install folder (`<ZERO_HOME>/self-update/switch.mjs`), so it imports only Node's built-in modules:
// the install folder's `dist` and `node_modules` are what it replaces.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, openSync, readFileSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
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
}

export interface SwitchFs {
  exists(path: string): boolean;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, text: string): Promise<void>;
}

/** Everything the switch touches outside itself; tests inject fakes. */
export interface SwitchDeps {
  fs: SwitchFs;
  /** git with its arguments on the install folder; returns stdout, throws on failure. */
  git(args: string[]): Promise<string>;
  /** Whether a daemon holds the factory's lock. */
  lockHeld(): boolean;
  /** Starts `node <install>/dist/cli.js start` detached, like `zero start --detach`. */
  launch(): { pid?: number };
  /** Ends a started daemon and everything under it. */
  kill(pid: number): void;
  say(message: string): void;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

/** How long the old daemon has to let go of the lock. */
export const RELEASE_WAIT_MS = 60_000;
const POLL_MS = 250;
const PARTS = ["dist", "node_modules"] as const;

export const resultPath = (home: string) => join(home, "self-update", "result.json");
export const previousPath = (home: string) => join(home, "self-update", "previous");

const text = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** A rename, or a copy and a removal when the two folders are on different volumes. */
async function move(fs: SwitchFs, from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.copy(from, to);
    await fs.remove(from);
  }
}

async function waitFor(deps: SwitchDeps, held: boolean, ms: number): Promise<boolean> {
  for (const deadline = deps.now().getTime() + ms; deps.lockHeld() !== held; await deps.sleep(POLL_MS)) {
    if (deps.now().getTime() >= deadline) return false;
  }
  return true;
}

/**
 * Waits for the old daemon to stop, puts the prepared build in the install folder, fast-forwards its branch and starts the
 * new daemon. A daemon that does not take the lock in time is killed, and the previous build, commit and daemon come back.
 * Writes `result.json` for the next daemon to record; never throws.
 */
export async function runSwitch(plan: SwitchPlan, deps: SwitchDeps): Promise<SwitchResult> {
  const { fs } = deps;
  const previous = previousPath(plan.home);
  const moved: string[] = [];
  let merged = false;
  const result = (outcome: SwitchResult["outcome"], reason?: string): SwitchResult => ({ from: plan.from, to: plan.to, at: deps.now().toISOString(), outcome, ...(reason ? { reason } : {}) });

  // Back to what ran before: the previous build and commit, and its daemon started again.
  const restore = async (): Promise<string | undefined> => {
    const problems: string[] = [];
    for (const part of moved) {
      const there = join(plan.install, part);
      try {
        if (fs.exists(there)) await fs.remove(there);
        await move(fs, join(previous, part), there);
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
    deps.launch();
    if (!(await waitFor(deps, true, plan.timeoutMs))) problems.push("la versión anterior tampoco tomó el candado");
    return problems.length ? problems.join("; ") : undefined;
  };

  let outcome: SwitchResult;
  try {
    if (!(await waitFor(deps, false, RELEASE_WAIT_MS))) {
      // Nothing was touched: the old daemon still runs, or a launch here finds the lock taken and ends.
      deps.launch();
      outcome = result("failed", "la fábrica no se apagó a tiempo; sigo en la versión actual");
    } else {
      try {
        const branch = await deps.git(["rev-parse", "--abbrev-ref", "HEAD"]);
        if (branch !== plan.branch) throw new Error(`${plan.install} ya no está en la rama ${plan.branch}`);
        if (fs.exists(previous)) await fs.remove(previous);
        await fs.mkdir(previous);
        for (const part of PARTS) {
          if (!fs.exists(join(plan.prepared, part))) throw new Error(`falta ${part} en la versión preparada`);
          if (fs.exists(join(plan.install, part))) {
            await move(fs, join(plan.install, part), join(previous, part));
            moved.push(part);
          }
          await move(fs, join(plan.prepared, part), join(plan.install, part));
        }
        await deps.git(["merge", "--ff-only", "--quiet", plan.to]);
        merged = true;
      } catch (err) {
        const why = `no pude poner ${plan.to.slice(0, 12)}: ${text(err)}`;
        deps.say(why);
        const trouble = await restore();
        return await finish(plan, deps, result("failed", trouble ? `${why}; ${trouble}` : why));
      }
      const started = deps.launch();
      if (await waitFor(deps, true, plan.timeoutMs)) {
        outcome = result("updated");
      } else {
        const why = `la versión ${plan.to.slice(0, 12)} no tomó el candado en ${Math.round(plan.timeoutMs / 1000)} s`;
        deps.say(`${why}; vuelvo a ${plan.from.slice(0, 12)}`);
        if (started.pid) deps.kill(started.pid);
        await waitFor(deps, false, RELEASE_WAIT_MS);
        const trouble = await restore();
        outcome = result("rolled-back", trouble ? `${why}; ${trouble}` : why);
      }
    }
  } catch (err) {
    outcome = result("failed", text(err));
  }
  return finish(plan, deps, outcome);
}

async function finish(plan: SwitchPlan, deps: SwitchDeps, outcome: SwitchResult): Promise<SwitchResult> {
  deps.say(`self-update ${outcome.outcome}: ${outcome.from.slice(0, 12)} -> ${outcome.to.slice(0, 12)}${outcome.reason ? ` (${outcome.reason})` : ""}`);
  try {
    await deps.fs.writeFile(resultPath(plan.home), JSON.stringify(outcome));
  } catch (err) {
    deps.say(`cannot write the self-update result: ${text(err)}`);
  }
  return outcome;
}

/** The lock check of `daemonLockHeld`: a read-only open that SQLite refuses as busy while a daemon holds it. */
function lockHeldAt(file: string): boolean {
  if (!existsSync(file)) return false;
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    return false;
  } catch (err) {
    return (((err as { errcode?: number }).errcode ?? 0) & 0xff) === 5;
  } finally {
    db?.close();
  }
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
    },
    git: (args) =>
      new Promise((done, fail) => {
        const r = spawnSync(plan.git, ["-C", plan.install, ...args], { encoding: "utf8", windowsHide: true, timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
        if (r.status === 0) done(r.stdout.trim());
        else fail(new Error(`git ${args[0]}: ${(r.stderr || r.error?.message || "").trim().slice(-300)}`));
      }),
    lockHeld: () => lockHeldAt(join(plan.home, "daemon.lock")),
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
    say,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
  };
}

// Run as `node switch.mjs <plan.json>`.
if (process.argv[2] && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as SwitchPlan;
  void runSwitch(plan, realSwitchDeps(plan));
}
