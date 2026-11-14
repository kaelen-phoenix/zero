import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestWork, SHUTDOWN_KEY } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { importSwitchResult, readSelfUpdate, recordSelfUpdate, SWITCH_STALE_MS, type SelfUpdateState } from "../src/self-update.js";
import { previousPath, resultPath, runSwitch, stagingPath, type FileEntry, type SwitchDeps, type SwitchFs, type SwitchPlan } from "../src/self-update-switch.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

/** A home, an install folder with its old build and a prepared folder with the new one, on real temporary folders. */
function setup() {
  const home = tempDir("zero-home-");
  const install = tempDir("zero-install-");
  const prepared = join(home, "self-update", TO.slice(0, 12));
  writeTree(install, { "dist/cli.js": "old", "node_modules/x/index.js": "old" });
  writeTree(prepared, { "dist/cli.js": "new", "node_modules/x/index.js": "new" });
  const plan: SwitchPlan = { home, install, prepared, from: FROM, to: TO, branch: "main", timeoutMs: 5_000, log: join(home, "daemon.log"), node: "node", git: "git" };
  return { home, install, prepared, plan };
}

interface World {
  /** Polls the old daemon keeps the lock for. */
  releaseAfter?: number;
  /** Launches whose daemon takes the lock (by launch number, from 1). */
  takes: number[];
  /** Renames between the home and the install folder fail as across volumes. */
  exdev?: boolean;
  /** An error code for a rename, by its source and how many times that source was renamed before. */
  renameFails?: (from: string, tries: number) => string | undefined;
  /** A relative path the copy leaves out. */
  dropOnCopy?: string;
  /** What the version check rejects with. */
  checkFails?: string;
  launchThrows?: boolean;
  /** Writes of result.json that fail before one goes through. */
  resultWriteFails?: number;
}

function listTree(dir: string, rel = ""): FileEntry[] {
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? listTree(dir, path) : [{ path, size: lstatSync(join(dir, path)).size }];
  });
}

/** git, the lock, the launcher, the kill and the clock as fakes; the clock moves on every sleep. */
function fakes(world: World, install?: string) {
  const clock = { at: Date.parse("2026-11-11T10:00:00Z") };
  const git: string[][] = [];
  const launches: number[] = [];
  const killed: number[] = [];
  const checks: string[] = [];
  const tries = new Map<string, number>();
  let writeFails = world.resultWriteFails ?? 0;
  let polls = 0;
  let holder: number | undefined;
  const inInstall = (p: string) => install !== undefined && p.startsWith(install);
  const realFs: SwitchFs = {
    exists: existsSync,
    rename: async (a, b) => {
      if (world.exdev && inInstall(a) !== inInstall(b)) throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      const n = tries.get(a) ?? 0;
      tries.set(a, n + 1);
      const code = world.renameFails?.(a, n);
      if (code) throw Object.assign(new Error(`${code}: operation not permitted, rename '${a}'`), { code });
      await rename(a, b);
    },
    copy: async (a, b) => {
      await cp(a, b, { recursive: true });
      if (world.dropOnCopy && existsSync(join(b, world.dropOnCopy))) rmSync(join(b, world.dropOnCopy));
    },
    remove: (p) => rm(p, { recursive: true, force: true }),
    mkdir: async (p) => void (await mkdir(p, { recursive: true })),
    writeFile: async (p, t) => {
      if (p.endsWith("result.json") && writeFails > 0) {
        writeFails--;
        throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
      }
      await writeFile(p, t);
    },
    list: async (dir) => listTree(dir),
  };
  const deps: SwitchDeps = {
    fs: realFs,
    git: async (args) => {
      git.push(args);
      return args[0] === "rev-parse" ? "main" : "";
    },
    lockHeld: () => {
      polls++;
      if (holder === undefined && launches.length === 0) return polls <= (world.releaseAfter ?? 0);
      return holder !== undefined;
    },
    launch: () => {
      if (world.launchThrows) throw new Error("spawn EPERM");
      launches.push(clock.at);
      const pid = 1000 + launches.length;
      holder = world.takes.includes(launches.length) ? pid : undefined;
      return { pid };
    },
    kill: (pid) => {
      killed.push(pid);
      if (holder === pid) holder = undefined;
    },
    check: async (cli) => {
      checks.push(cli);
      if (world.checkFails) throw new Error(world.checkFails);
    },
    say: () => {},
    sleep: async (ms) => void (clock.at += ms),
    now: () => new Date(clock.at),
  };
  return { deps, git, launches, killed, checks };
}

const read = (path: string) => readFileSync(path, "utf8");

describe("the switch process", () => {
  it("waits for the old daemon, puts the new build in place, fast-forwards and starts the new daemon", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ releaseAfter: 3, takes: [1] });
    const result = await runSwitch(plan, f.deps);
    expect(result).toMatchObject({ from: FROM, to: TO, outcome: "updated" });
    expect(result.at).toMatch(/^2026-11-11T10:00/);
    expect(read(join(install, "dist", "cli.js"))).toBe("new");
    expect(read(join(install, "node_modules", "x", "index.js"))).toBe("new");
    expect(read(join(previousPath(home), "dist", "cli.js"))).toBe("old");
    expect(f.git).toContainEqual(["merge", "--ff-only", "--quiet", TO]);
    expect(f.launches).toHaveLength(1);
    expect(f.killed).toEqual([]);
    expect(JSON.parse(read(resultPath(home)))).toEqual(result);
  });

  it("copies only between volumes and swaps the install's parts by renames", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ takes: [1], exdev: true }, install);
    expect((await runSwitch(plan, f.deps)).outcome).toBe("updated");
    expect(read(join(install, "dist", "cli.js"))).toBe("new");
    expect(read(join(install, "node_modules", "x", "index.js"))).toBe("new");
    expect(read(join(previousPath(home), "dist", "cli.js"))).toBe("old");
    expect(read(join(previousPath(home), "node_modules", "x", "index.js"))).toBe("old");
    expect(existsSync(stagingPath(install))).toBe(false);
  });

  it("touches nothing of the install when the staged copy comes out incomplete", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ takes: [1], exdev: true, dropOnCopy: "x/index.js" }, install);
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("node_modules");
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(read(join(install, "node_modules", "x", "index.js"))).toBe("old");
    expect(f.git.some((a) => a[0] === "merge")).toBe(false);
    expect(f.checks).toEqual([]);
    expect(JSON.parse(read(resultPath(home)))).toEqual(result);
  });

  it("tries a locked folder again", async () => {
    const { install, plan } = setup();
    const modules = join(install, "node_modules");
    const f = fakes({ takes: [1], renameFails: (from, n) => (from === modules && n < 2 ? "EBUSY" : undefined) }, install);
    expect((await runSwitch(plan, f.deps)).outcome).toBe("updated");
    expect(read(join(modules, "x", "index.js"))).toBe("new");
    expect(read(join(install, "dist", "cli.js"))).toBe("new");
  });

  it("gives up on a folder that stays locked and puts back what it moved", async () => {
    const { home, install, plan } = setup();
    const modules = join(install, "node_modules");
    const f = fakes({ takes: [1], renameFails: (from) => (from === modules ? "EPERM" : undefined) }, install);
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("node_modules");
    expect(result.reason).toContain("EPERM");
    expect(result.reason).toContain("servidor MCP");
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(read(join(modules, "x", "index.js"))).toBe("old");
    expect(f.git.some((a) => a[0] === "merge" || a[0] === "reset")).toBe(false);
    expect(f.launches).toHaveLength(1);
    expect(JSON.parse(read(resultPath(home)))).toEqual(result);
    expect(existsSync(stagingPath(install))).toBe(false);
  });

  it("puts the previous build back when the installed copy does not run", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ takes: [1], checkFails: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@napi-rs/keyring'" }, install);
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("ERR_MODULE_NOT_FOUND");
    expect(f.checks).toEqual([join(install, "dist", "cli.js")]);
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(read(join(install, "node_modules", "x", "index.js"))).toBe("old");
    expect(f.git.some((a) => a[0] === "merge")).toBe(false);
    expect(f.launches).toHaveLength(1);
    expect(JSON.parse(read(resultPath(home))).outcome).toBe("failed");
  });

  it("checks the installed copy before merging and launching", async () => {
    const { install, plan } = setup();
    const order: string[] = [];
    const f = fakes({ takes: [1] }, install);
    const { check, git, launch } = f.deps;
    f.deps.check = async (cli) => {
      order.push("check");
      await check(cli);
    };
    f.deps.git = async (args) => {
      order.push(args[0]!);
      return git(args);
    };
    f.deps.launch = () => {
      order.push("launch");
      return launch();
    };
    expect((await runSwitch(plan, f.deps)).outcome).toBe("updated");
    expect(f.checks).toEqual([join(install, "dist", "cli.js")]);
    expect(order).toEqual(["rev-parse", "check", "merge", "launch"]);
  });

  it("leaves a result even when the launch throws", async () => {
    const { home, install, plan } = setup();
    const modules = join(install, "node_modules");
    const f = fakes({ takes: [], launchThrows: true, renameFails: (from) => (from === modules ? "EPERM" : undefined) }, install);
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("no pude arrancar el daemon");
    expect(JSON.parse(read(resultPath(home)))).toEqual(result);
  });

  it("writes the result again when the first write fails", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ takes: [1], resultWriteFails: 1 }, install);
    const result = await runSwitch(plan, f.deps);
    expect(JSON.parse(read(resultPath(home)))).toEqual(result);
  });

  it("gets past a staging folder an earlier switch left", async () => {
    const { install, plan } = setup();
    writeTree(install, { ".zero-switch/new/dist/cli.js": "leftover" });
    const f = fakes({ takes: [1] }, install);
    expect((await runSwitch(plan, f.deps)).outcome).toBe("updated");
    expect(read(join(install, "dist", "cli.js"))).toBe("new");
    expect(existsSync(stagingPath(install))).toBe(false);
  });

  it("keeps its staging folder out of git", () => {
    expect(read(".gitignore").split(/\r?\n/)).toContain(".zero-switch/");
  });

  it("kills a new daemon that does not take the lock, puts the previous version back and starts it", async () => {
    const { home, install, plan } = setup();
    const f = fakes({ takes: [2] });
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("rolled-back");
    expect(result.reason).toContain("no tomó el candado en 5 s");
    expect(f.killed).toEqual([1001]);
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(read(join(install, "node_modules", "x", "index.js"))).toBe("old");
    expect(f.git).toContainEqual(["reset", "--keep", FROM]);
    expect(f.launches).toHaveLength(2);
    expect(f.launches[1]! - f.launches[0]!).toBeGreaterThanOrEqual(5_000);
    expect(JSON.parse(read(resultPath(home))).outcome).toBe("rolled-back");
    expect(existsSync(stagingPath(install))).toBe(false);
  });

  it("touches nothing while the old daemon keeps the lock", async () => {
    const { install, plan } = setup();
    const f = fakes({ releaseAfter: Infinity, takes: [] });
    const result = await runSwitch(plan, f.deps);
    expect(result.outcome).toBe("failed");
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(f.git).toEqual([]);
  });

  it("puts everything back when the branch moved", async () => {
    const { install, plan } = setup();
    const f = fakes({ takes: [1] });
    const result = await runSwitch({ ...plan, branch: "release" }, f.deps);
    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("ya no está en la rama release");
    expect(read(join(install, "dist", "cli.js"))).toBe("old");
    expect(f.git.some((a) => a[0] === "merge" || a[0] === "reset")).toBe(false);
    expect(f.launches).toHaveLength(1);
  });

  it("imports only node built-in modules", () => {
    const source = read(join("src", "self-update-switch.ts"));
    const imports = [...source.matchAll(/^import [^;]+ from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((m) => m!.startsWith("node:"))).toBe(true);
  });
});

describe("the switch's result in the next daemon", () => {
  const switching = (dir: string): SelfUpdateState => ({ status: "switching", from: FROM, to: TO, dir, checkedAt: "2026-11-11T09:00:00Z", switchingAt: "2026-11-11T10:00:00Z" });

  it("records a rollback, keeps the target among the failed ones and removes the file", async () => {
    const ctx = testFactory({ lines: [] }, () => new Date("2026-11-11T10:05:00Z"));
    const dir = join(ctx.home.root, "self-update", "prepared");
    mkdirSync(dir, { recursive: true });
    recordSelfUpdate(ctx.store, { state: switching(dir) });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: FROM, to: TO, at: "2026-11-11T10:03:00Z", outcome: "rolled-back", reason: "no tomó el candado" }));
    await importSwitchResult(ctx);
    const { state, history } = readSelfUpdate(ctx.store);
    expect(history).toEqual([{ from: FROM, to: TO, at: "2026-11-11T10:03:00Z", outcome: "rolled-back", reason: "no tomó el candado" }]);
    expect(state.status).toBe("idle");
    expect(state.failed).toEqual([TO]);
    expect(state.problem).toContain("volví a");
    expect(existsSync(resultPath(ctx.home.root))).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  it("records a switch that gave up on a locked node_modules", async () => {
    const ctx = testFactory({ lines: [] }, () => new Date("2026-11-11T10:05:00Z"));
    const install = tempDir("zero-install-");
    const prepared = join(ctx.home.root, "self-update", TO.slice(0, 12));
    writeTree(install, { "dist/cli.js": "old", "node_modules/x/index.js": "old" });
    writeTree(prepared, { "dist/cli.js": "new", "node_modules/x/index.js": "new" });
    recordSelfUpdate(ctx.store, { state: switching(prepared) });
    const plan: SwitchPlan = { home: ctx.home.root, install, prepared, from: FROM, to: TO, branch: "main", timeoutMs: 5_000, log: join(ctx.home.root, "daemon.log"), node: "node", git: "git" };
    const modules = join(install, "node_modules");
    await runSwitch(plan, fakes({ takes: [1], renameFails: (from) => (from === modules ? "EPERM" : undefined) }, install).deps);
    await importSwitchResult(ctx);
    const { history } = readSelfUpdate(ctx.store);
    expect(history[0]).toMatchObject({ outcome: "failed", to: TO });
    expect(history[0]!.reason).toContain("node_modules");
  });

  it("records an update without a problem", async () => {
    const ctx = testFactory({ lines: [] });
    recordSelfUpdate(ctx.store, { state: switching(join(ctx.home.root, "nothing")) });
    mkdirSync(join(ctx.home.root, "self-update"), { recursive: true });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: FROM, to: TO, at: "2026-11-11T10:03:00Z", outcome: "updated" }));
    await importSwitchResult(ctx);
    const { state, history } = readSelfUpdate(ctx.store);
    expect(state).toEqual({ status: "idle", checkedAt: "2026-11-11T09:00:00Z" });
    expect(history[0]?.outcome).toBe("updated");
  });

  it("waits for a switch still under way, and gives up on one that left nothing", async () => {
    const clock = { at: new Date("2026-11-11T10:05:00Z") };
    const ctx = testFactory({ lines: [] }, () => clock.at);
    recordSelfUpdate(ctx.store, { state: switching(join(ctx.home.root, "nothing")) });
    await importSwitchResult(ctx);
    expect(readSelfUpdate(ctx.store).state.status).toBe("switching");
    clock.at = new Date(Date.parse("2026-11-11T10:00:00Z") + SWITCH_STALE_MS);
    await importSwitchResult(ctx);
    const { state, history } = readSelfUpdate(ctx.store);
    expect(state.status).toBe("idle");
    expect(history[0]).toMatchObject({ outcome: "failed", to: TO });
  });

  it("is imported when the daemon starts", async () => {
    const ctx = testFactory({ lines: [] });
    recordSelfUpdate(ctx.store, { state: switching(join(ctx.home.root, "nothing")) });
    mkdirSync(join(ctx.home.root, "self-update"), { recursive: true });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: FROM, to: TO, at: "2026-11-11T10:03:00Z", outcome: "rolled-back" }));
    await runDaemon(ctx, { once: true, pollMs: 10 });
    expect(readSelfUpdate(ctx.store).history.map((e) => e.outcome)).toEqual(["rolled-back"]);
    expect(existsSync(resultPath(ctx.home.root))).toBe(false);
  });
});

describe("the daemon with a prepared version", () => {
  const passes = `node -e "process.exit(0)"`;
  const ready: SelfUpdateState = { status: "ready", from: FROM, to: TO, dir: "/prepared" };
  const factory = () =>
    testFactory({ level: "L2", isolation: "worktree", concurrency: 2, selfUpdate: { enabled: true }, lines: [{ name: "a", repo: gitRepo(), verify: [passes] }, { name: "b", repo: gitRepo(), verify: [passes] }] });

  it("starts no job while one runs, then launches the switch once and stops", async () => {
    const ctx = factory();
    const first = requestWork(ctx, { text: "primero", line: "a" }).job;
    let second: string | undefined;
    const agents = fakeAgents({
      build: (req) => {
        writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" });
        if (second) return;
        // The new version is ready while this job runs, and new work arrives on the other line.
        recordSelfUpdate(ctx.store, { state: ready });
        second = requestWork(ctx, { text: "segundo", line: "b" }).job.id;
      },
    });
    const launched: { firstStatus?: string; state: SelfUpdateState }[] = [];
    await runDaemon(ctx, {
      once: true,
      pollMs: 10,
      agentRunner: () => agents.runner,
      launchSwitch: async (_ctx, state) => void launched.push({ firstStatus: ctx.store.getJob(first.id)?.status, state }),
    });
    expect(launched).toHaveLength(1);
    expect(launched[0]!.firstStatus).toBe("delivered");
    expect(launched[0]!.state).toMatchObject({ from: FROM, to: TO, dir: "/prepared" });
    expect(ctx.store.getJob(second!)!.status).toBe("queued");
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeDefined();
    expect(readSelfUpdate(ctx.store).state.status).toBe("switching");
  });

  it("launches at once and starts nothing when the factory is free", async () => {
    const ctx = factory();
    recordSelfUpdate(ctx.store, { state: ready });
    const job = requestWork(ctx, { text: "espera", line: "a" }).job;
    const agents = fakeAgents({});
    let calls = 0;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, launchSwitch: async () => void calls++ });
    expect(calls).toBe(1);
    expect(agents.calls).toEqual([]);
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeDefined();
  });

  it("stays on the current version when the switch cannot start", async () => {
    const ctx = factory();
    recordSelfUpdate(ctx.store, { state: ready });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, launchSwitch: async () => Promise.reject(new Error("sin git")) });
    const { state, history } = readSelfUpdate(ctx.store);
    expect(state.status).toBe("idle");
    expect(state.failed).toEqual([TO]);
    expect(history[0]).toMatchObject({ outcome: "failed" });
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeUndefined();
  });

  it("never switches while self-update is off", async () => {
    const ctx = testFactory({ lines: [] });
    recordSelfUpdate(ctx.store, { state: ready });
    let calls = 0;
    await runDaemon(ctx, { once: true, pollMs: 10, launchSwitch: async () => void calls++ });
    expect(calls).toBe(0);
  });
});
