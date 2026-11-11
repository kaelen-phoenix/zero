import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { mergeKey } from "../src/line/automerge.js";
import { log } from "../src/log.js";
import type { GitRunner } from "../src/package-install.js";
import { CHECK_EVERY_MS, HISTORY_LIMIT, installFolder, readSelfUpdate, recordSelfUpdate, SELF_UPDATE_HISTORY_KEY, SELF_UPDATE_STATE_KEY, selfUpdateCheck, versionText, type SelfUpdateDeps } from "../src/self-update.js";
import { cleanup, gitIn, gitRepo, tempDir, testFactory, testStore } from "./helpers.js";

afterEach(cleanup);

describe("selfUpdate in the factory file", () => {
  it("is off by default with the documented defaults", () => {
    const cfg = parseFactory("lines: []\n");
    expect(cfg.selfUpdate).toEqual({ enabled: false, remote: "origin", startTimeoutSeconds: 120 });
  });

  it("takes the person in charge's settings", () => {
    const cfg = parseFactory("selfUpdate:\n  enabled: true\n  remote: upstream\n  branch: main\n  startTimeoutSeconds: 30\n");
    expect(cfg.selfUpdate).toEqual({ enabled: true, remote: "upstream", branch: "main", startTimeoutSeconds: 30 });
  });

  it("refuses unknown keys and a start timeout under 10 s", () => {
    expect(() => parseFactory("selfUpdate: { enabled: true, token: x }\n")).toThrow();
    expect(() => parseFactory("selfUpdate: { enabled: true, startTimeoutSeconds: 5 }\n")).toThrow();
  });
});

describe("zero --version", () => {
  const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

  it("prints the package version and exits 0 without opening the factory", () => {
    const home = join(tempDir(), "missing-home");
    for (const flag of ["--version", "-v"]) {
      const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", flag], { encoding: "utf8", env: { ...process.env, ZERO_HOME: home }, input: "", windowsHide: true });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`zero ${version}`);
    }
  }, 30_000);

  it("adds the install folder's commit when it is a git repository", () => {
    const repo = gitRepo({ "package.json": JSON.stringify({ version: "9.8.7" }) });
    const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    expect(versionText(repo)).toBe(`zero 9.8.7 (${commit})`);
    expect(versionText(tempDir())).toBe("zero desconocida");
  });

  it("finds the install folder above the folder holding cli.js", () => {
    const root = tempDir();
    expect(installFolder(join(root, "zero", "dist", "cli.js"))).toBe(join(root, "zero"));
    expect(installFolder(join(process.cwd(), "dist", "cli.js"))).toBe(process.cwd());
  });
});

describe("self-update records", () => {
  it("keeps the state and the last 20 updates", () => {
    const store = testStore();
    expect(readSelfUpdate(store)).toEqual({ state: { status: "idle" }, history: [] });
    recordSelfUpdate(store, { state: { status: "ready", from: "a", to: "b", dir: "/x" } });
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) recordSelfUpdate(store, { entry: { from: `f${i}`, to: `t${i}`, at: new Date(i).toISOString(), outcome: "updated" } });
    const { state, history } = readSelfUpdate(store);
    expect(state).toEqual({ status: "ready", from: "a", to: "b", dir: "/x" });
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.from).toBe("f5");
    expect(history.at(-1)?.to).toBe(`t${HISTORY_LIMIT + 4}`);
  });

  it("reads a broken record as nothing and never throws on a store failure", () => {
    const store = testStore();
    store.setKv(SELF_UPDATE_HISTORY_KEY, "{not json");
    expect(readSelfUpdate(store).history).toEqual([]);
    store.close();
    expect(() => recordSelfUpdate(store, { state: { status: "idle" }, entry: { from: "a", to: "b", at: "x", outcome: "failed" } })).not.toThrow();
    expect(readSelfUpdate(store)).toEqual({ state: { status: "idle" }, history: [] });
  });
});

describe("self-update check and side preparation", () => {
  const HEAD = "a".repeat(40);
  const TIP = "b".repeat(40);
  const LOCK = JSON.stringify({ name: "zero", lockfileVersion: 3, packages: { "": { name: "zero" } } });
  const GIT_LOCK = JSON.stringify({ name: "zero", lockfileVersion: 3, packages: { "": { name: "zero", dependencies: { x: "1.0.0" } }, "node_modules/x": { version: "1.0.0", resolved: `git+https://host/x.git#${"c".repeat(40)}` } } });

  interface World {
    status?: string;
    tip?: string;
    diverged?: boolean;
    lock?: string;
    failNpm?: string;
  }
  type Call = { tool: string; args: string[]; cwd?: string };

  /** zero's install folder as fake git, npm and node see it, with every call recorded. */
  function fakes(world: World, clock: { at: Date }) {
    const install = gitRepo({ "package.json": JSON.stringify({ version: "1.0.0" }) });
    const before = readFileSync(join(install, "package.json"), "utf8");
    const calls: Call[] = [];
    const git: GitRunner = async (args, opts = {}) => {
      calls.push({ tool: "git", args, cwd: opts.cwd });
      const [cmd, a1] = args;
      if (cmd === "rev-parse" && a1 === "--show-cdup") return "";
      if (cmd === "rev-parse" && a1 === "--abbrev-ref") return "main";
      if (cmd === "status") return world.status ?? "";
      if (cmd === "rev-parse" && a1 === "FETCH_HEAD") return world.tip ?? TIP;
      if (cmd === "rev-parse" && a1 === "HEAD") return HEAD;
      if (cmd === "merge-base" && world.diverged) throw new Error("git merge-base: terminó con código 1");
      if (cmd === "ls-tree" && args[3] === "package-lock.json") return `100644 blob ${"d".repeat(40)}\tpackage-lock.json`;
      if (cmd === "ls-tree" && args[3] === "package.json") return `100644 blob ${"e".repeat(40)}\tpackage.json`;
      if (cmd === "ls-tree") return "";
      if (cmd === "show" && a1?.endsWith(":package-lock.json")) return world.lock ?? LOCK;
      if (cmd === "show" && a1?.endsWith(":package.json")) return JSON.stringify({ name: "zero" });
      return "";
    };
    const npm = async (args: string[], cwd: string) => {
      calls.push({ tool: "npm", args, cwd });
      if (world.failNpm && args.includes(world.failNpm)) throw new Error(`npm ${args[0]}: falló`);
      return "";
    };
    const node = async (args: string[], cwd: string) => {
      calls.push({ tool: "node", args, cwd });
      return "zero 1.0.1";
    };
    const deps: SelfUpdateDeps = { git, npm, node, install, now: () => clock.at };
    return { install, calls, deps, untouched: () => readFileSync(join(install, "package.json"), "utf8") === before && gitIn(install, "status", "--porcelain") === "" };
  }

  const factory = (selfUpdate: Record<string, unknown> | undefined, install: string, clock: { at: Date }) =>
    testFactory({ ...(selfUpdate ? { selfUpdate } : {}), lines: [{ name: "zero", repo: install, verify: ["npm test"] }] }, () => clock.at);
  const fetches = (calls: Call[], install: string) => calls.filter((c) => c.tool === "git" && c.args[0] === "fetch" && c.cwd === install).length;
  const later = (clock: { at: Date }, ms: number) => (clock.at = new Date(clock.at.getTime() + ms));

  it("does nothing while it is off", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({}, clock);
    const ctx = factory(undefined, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    expect(f.calls).toEqual([]);
    expect(ctx.store.getKv(SELF_UPDATE_STATE_KEY)).toBeUndefined();
    expect(ctx.store.getKv(SELF_UPDATE_HISTORY_KEY)).toBeUndefined();
  });

  it("leaves local changes alone and says so once", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ status: " M src/cli.ts" }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      await selfUpdateCheck(ctx, f.deps);
      later(clock, CHECK_EVERY_MS);
      await selfUpdateCheck(ctx, f.deps);
      expect(warn.mock.calls.filter(([m]) => m === "self-update held back")).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
    const { state } = readSelfUpdate(ctx.store);
    expect(state.status).toBe("idle");
    expect(state.problem).toContain("cambios locales");
    expect(f.calls.filter((c) => c.args[0] === "status")).toHaveLength(2);
    expect(fetches(f.calls, f.install)).toBe(0);
    expect(f.calls.some((c) => c.tool !== "git")).toBe(false);
  });

  it("refuses a history that is not a fast-forward", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ diverged: true }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    const { state } = readSelfUpdate(ctx.store);
    expect(state.status).toBe("idle");
    expect(state.problem).toContain("no es un avance rápido");
    expect(f.calls.some((c) => c.tool === "npm" || c.args[0] === "clone")).toBe(false);
  });

  it("prepares nothing when it is up to date, and looks only once a day", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ tip: HEAD }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "idle", checkedAt: clock.at.toISOString() });
    later(clock, CHECK_EVERY_MS - 60_000);
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(1);
    later(clock, 60_000);
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(2);
    expect(f.calls.some((c) => c.tool === "npm")).toBe(false);
  });

  it("looks again after a pull request of its own line merges", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ tip: HEAD }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    later(clock, 60 * 60_000);
    const job = ctx.store.createJob({ line: "zero", kind: "request", request: "x", budgetUsd: 3 });
    ctx.store.finishJob(job.id, "delivered");
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "waiting" }));
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(1);
    later(clock, 60_000);
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "merged" }));
    later(clock, 60_000);
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(2);
    later(clock, 60_000);
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(2);
  });

  it("stops before npm when the target's lock resolves a git dependency", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ lock: GIT_LOCK }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    expect(f.calls.some((c) => c.tool === "npm" || c.tool === "node" || c.args[0] === "clone")).toBe(false);
    const { state, history } = readSelfUpdate(ctx.store);
    expect(state.failed).toEqual([TIP]);
    expect(state.problem).toMatch(/la dependencia x/);
    expect(history).toEqual([expect.objectContaining({ from: HEAD, to: TIP, outcome: "failed", reason: expect.stringMatching(/la dependencia x/) })]);
  });

  it("records a failed build once, stays on the current version and never prepares that commit again", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({ failNpm: "build" }, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    try {
      await selfUpdateCheck(ctx, f.deps);
      later(clock, CHECK_EVERY_MS);
      await selfUpdateCheck(ctx, f.deps);
      expect(warn.mock.calls.filter(([m]) => m === "self-update preparation failed; staying on the current version")).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
    expect(fetches(f.calls, f.install)).toBe(2);
    expect(f.calls.filter((c) => c.tool === "npm" && c.args.includes("build"))).toHaveLength(1);
    expect(f.calls.some((c) => c.tool === "node")).toBe(false);
    const { state, history } = readSelfUpdate(ctx.store);
    expect(state.status).toBe("idle");
    expect(state.failed).toEqual([TIP]);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: HEAD, to: TIP, outcome: "failed" });
    expect(existsSync(join(ctx.home.root, "self-update", TIP.slice(0, 12)))).toBe(false);
    expect(f.untouched()).toBe(true);
  });

  it("prepares the new version in its own folder and becomes ready", async () => {
    const clock = { at: new Date("2026-11-11T10:00:00Z") };
    const f = fakes({}, clock);
    const ctx = factory({ enabled: true }, f.install, clock);
    await selfUpdateCheck(ctx, f.deps);
    const dir = join(ctx.home.root, "self-update", TIP.slice(0, 12));
    expect(readSelfUpdate(ctx.store).state).toEqual({ status: "ready", from: HEAD, to: TIP, dir, checkedAt: clock.at.toISOString() });
    const steps = f.calls.filter((c) => c.cwd === dir || c.args.includes(dir)).map((c) => [c.tool, ...c.args].join(" "));
    expect(steps).toEqual([
      `git clone --quiet --no-hardlinks --no-local --no-checkout ${f.install} ${dir}`,
      `git fetch --quiet ${f.install} ${TIP}`,
      `git checkout --quiet --detach ${TIP}`,
      "npm ci --ignore-scripts --no-audit --no-fund",
      "npm run build",
      "node dist/cli.js --version",
      "node dist/cli.js self-update check",
    ]);
    // In the install folder only looks, the fetch and the lock's reading run.
    expect(new Set(f.calls.filter((c) => c.cwd === f.install).map((c) => c.args[0]))).toEqual(new Set(["rev-parse", "status", "fetch", "merge-base", "ls-tree", "show"]));
    expect(f.untouched()).toBe(true);
    // A ready version waits for its switch: no more looking meanwhile.
    later(clock, CHECK_EVERY_MS);
    await selfUpdateCheck(ctx, f.deps);
    expect(fetches(f.calls, f.install)).toBe(1);
  });
});

describe("self-update in the daemon", () => {
  it("runs the check as a background pass when its tools are injected", async () => {
    const install = gitRepo();
    const ctx = testFactory({ selfUpdate: { enabled: true }, lines: [] });
    const calls: string[][] = [];
    const deps: SelfUpdateDeps = {
      install,
      git: async (args) => {
        calls.push(args);
        if (args[0] === "status" || args[1] === "--show-cdup") return "";
        if (args[1] === "--abbrev-ref") return "main";
        return "a".repeat(40);
      },
      npm: async () => "",
      node: async () => "",
    };
    await runDaemon(ctx, { once: true, pollMs: 10, selfUpdate: deps });
    expect(calls.some((a) => a[0] === "fetch")).toBe(true);
    expect(readSelfUpdate(ctx.store).state.checkedAt).toBeDefined();
  });

  it("does not look in once runs without injected tools", async () => {
    const ctx = testFactory({ selfUpdate: { enabled: true }, lines: [] });
    await runDaemon(ctx, { once: true, pollMs: 10 });
    expect(ctx.store.getKv(SELF_UPDATE_STATE_KEY)).toBeUndefined();
  });
});

describe("zero self-update check", () => {
  it("loads the factory file and exits 0, or fails on a bad one", () => {
    const home = tempDir();
    const check = () => spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "self-update", "check"], { encoding: "utf8", env: { ...process.env, ZERO_HOME: home }, input: "", windowsHide: true });
    writeFileSync(join(home, "zero.factory.yaml"), "lines: []\n");
    expect(check().status).toBe(0);
    writeFileSync(join(home, "zero.factory.yaml"), "selfUpdate: { token: x }\n");
    expect(check().status).toBe(1);
  }, 30_000);
});
