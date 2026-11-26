import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryStatus, packageAdd, packageList, packageUpdate, requestWork, type FactoryContext, type PackageUpdateInput, type ShutdownResult } from "../src/app.js";
import { parseFactory } from "../src/config.js";
import { runDaemon, type DaemonOptions } from "../src/daemon.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { acquirePackageUpdateLock, attemptOf, duePackageUpdate, launchPackageUpdate, PACKAGE_RUN_KEY, packageRunUnderWay, readPackageRun, recordAttempt, type PackageAutoRun } from "../src/package-auto-update.js";
import { recordSeen, updateKey, type GitRunner } from "../src/package-install.js";
import { factoryConfig } from "../src/packages.js";
import { overviewPage, packagesPage } from "../src/panel/html.js";
import { acquireSwitchLock } from "../src/self-update-switch.js";
import { recordSelfUpdate } from "../src/self-update.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
});

const NOW = new Date("2026-11-25T12:00:00Z");
const V10 = "a".repeat(40);
const V11 = "b".repeat(40);
const V12 = "c".repeat(40);
const URL_V = "https://github.com/acme/hola.git";
const SOURCE = "github:acme/hola";
const manifest = (name = "hello", over: Record<string, unknown> = {}) => stringify({ interface: 1, name, version: "1.0.0", ...over });

function packageEntry(name = "hello", over: Record<string, unknown> = {}) {
  const path = tempDir("zero-package-");
  writeTree(path, { "zero-package.yaml": manifest(name) });
  return { git: SOURCE, path, commit: V10, channel: "estable", ...over };
}

/** A factory with automatic updates on and packages at v1.0.0 that have v1.1.0 on record. */
async function factory(over: { selfUpdate?: Record<string, unknown>; entries?: () => Record<string, unknown>[]; definition?: Record<string, unknown> } = {}): Promise<FactoryContext> {
  const packages = over.entries?.() ?? [packageEntry()];
  const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [], selfUpdate: over.selfUpdate ?? { enabled: true }, packages, ...over.definition }, () => NOW);
  ctx.config = await factoryConfig(ctx.home);
  for (const p of ctx.config.loadedPackages!.packages) recordSeen(ctx.store, p.name, V11, NOW, { version: "1.1.0", current: { commit: V10, version: "1.0.0" } });
  return ctx;
}

/** One pass of the daemon with a fake launcher; the packages it was called for. */
async function daemon(ctx: FactoryContext, over: DaemonOptions = {}): Promise<string[]> {
  const launched: string[] = [];
  await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner, launchPackageUpdate: async (_, name) => void launched.push(name), ...over });
  return launched;
}

/** The pid of a process that ended. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

function living() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  return {
    pid: child.pid!,
    end: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}

const running = (ctx: FactoryContext, pid: number, at = NOW) =>
  ctx.store.setKv(PACKAGE_RUN_KEY, JSON.stringify({ package: "hello", version: "1.1.0", at: at.toISOString(), pid } satisfies PackageAutoRun));

describe("the daemon's update of stable packages", () => {
  it("launches it once for a new release, also after a restart", async () => {
    const ctx = await factory();
    expect(await daemon(ctx)).toEqual(["hello"]);
    expect(attemptOf(ctx.store, "hello", "1.1.0")).toEqual({ version: "1.1.0", at: NOW.toISOString() });
    expect(await daemon(ctx)).toEqual([]);
  });

  it("launches nothing in a one-shot run that was given no launcher", async () => {
    const ctx = await factory();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner });
    expect(attemptOf(ctx.store, "hello", "1.1.0")).toBeUndefined();
  });

  it.each([
    ["automatic updates off", { selfUpdate: { channel: "estable" } }],
    ["no selfUpdate", { selfUpdate: {} }],
    ["a package without channel", { entries: () => [packageEntry("hello", { channel: undefined })] }],
    ["a package already at it", { entries: () => [packageEntry("hello", { commit: V11 })] }],
  ])("launches nothing with %s", async (_what, over) => {
    expect(await daemon(await factory(over))).toEqual([]);
  });

  it("launches nothing for a package ahead of the newest release, nor for a commit seen without a release", async () => {
    const ctx = await factory();
    recordSeen(ctx.store, "hello", V11, NOW, { version: "1.1.0", ahead: V10 });
    expect(await daemon(ctx)).toEqual([]);
    recordSeen(ctx.store, "hello", V11, NOW);
    expect(await daemon(ctx)).toEqual([]);
  });

  it("does not launch while a job runs, and does once it ended", async () => {
    const ctx = await factory({ definition: { lines: [{ name: "uno", repo: gitRepo(), verify: [] }] } });
    ctx.store.deleteKv(updateKey("hello"));
    requestWork(ctx, { text: "primero", line: "uno" });
    const launched: string[] = [];
    let during = -1;
    const agents = fakeAgents({
      spec: async (_, n) => {
        if (n > 1) return { ok: false };
        recordSeen(ctx.store, "hello", V11, NOW, { version: "1.1.0" });
        await new Promise((r) => setTimeout(r, 300));
        during = launched.length;
        return { ok: false };
      },
    });
    await daemon(ctx, { agentRunner: () => agents.runner, launchPackageUpdate: async (_, name) => void launched.push(name) });
    expect(during).toBe(0);
    expect(launched).toEqual(["hello"]);
  }, 60_000);

  it.each(["ready", "switching"] as const)("does not launch with a version of zero %s", async (status) => {
    const ctx = await factory();
    recordSelfUpdate(ctx.store, { state: { status, from: V10, to: V11, dir: tempDir(), switchingAt: NOW.toISOString() } });
    expect(await daemon(ctx, { launchSwitch: async () => undefined })).toEqual([]);
  });

  it("does not launch while a switch holds its lock", async () => {
    const ctx = await factory();
    const lock = acquireSwitchLock(ctx.home.root)!;
    expect(await daemon(ctx)).toEqual([]);
    lock.release();
    expect(await daemon(ctx)).toEqual(["hello"]);
  });

  it("does not launch while another package update runs", async () => {
    const ctx = await factory();
    const lock = acquirePackageUpdateLock(ctx.home)!;
    expect(await daemon(ctx)).toEqual([]);
    lock.release();
    expect(await daemon(ctx)).toEqual(["hello"]);
  });

  it("starts no job and updates no other package while its process runs, also after a restart", async () => {
    const entries = () => [packageEntry(), packageEntry("otro", { git: "github:acme/otro" })];
    const ctx = await factory({ entries, definition: { lines: [{ name: "uno", repo: gitRepo(), verify: [] }] } });
    const { job } = requestWork(ctx, { text: "primero", line: "uno" });
    const update = living();
    const launch = vi.fn(async () => update.pid);
    await daemon(ctx, { launchPackageUpdate: launch });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(readPackageRun(ctx.store)).toEqual({ package: "hello", version: "1.1.0", at: NOW.toISOString(), pid: update.pid });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect(await daemon(ctx)).toEqual([]);
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    await update.end();
    expect(await daemon(ctx)).toEqual(["otro"]);
    expect(readPackageRun(ctx.store)).toBeUndefined();
    expect(ctx.store.getJob(job.id)!.status).not.toBe("queued");
  }, 60_000);

  it("does not switch zero to a version that became ready meanwhile", async () => {
    const ctx = await factory();
    running(ctx, process.pid);
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: V10, to: V11, dir: tempDir() } });
    const launchSwitch = vi.fn(async () => undefined);
    await daemon(ctx, { launchSwitch });
    expect(launchSwitch).not.toHaveBeenCalled();
  });

  it("is left for the person in charge when the process does not start", async () => {
    const ctx = await factory();
    const launch = vi.fn(async () => Promise.reject(new Error("EACCES")));
    await daemon(ctx, { launchPackageUpdate: launch });
    await daemon(ctx, { launchPackageUpdate: launch });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(formatPackages(packageList(ctx))).toContain("aplicala a mano");
  });

  it("goes on to the next release, and never back to one it tried", async () => {
    const ctx = await factory();
    await daemon(ctx);
    recordSeen(ctx.store, "hello", V12, NOW, { version: "1.2.0" });
    expect(await daemon(ctx)).toEqual(["hello"]);
    recordSeen(ctx.store, "hello", V11, NOW, { version: "1.1.0" });
    expect(await daemon(ctx)).toEqual([]);
  });

  it("stops being under way with its process, or past its start without the lock", async () => {
    const ctx = await factory();
    const later = new Date(NOW.getTime() + 10 * 60_000);
    running(ctx, process.pid);
    expect(packageRunUnderWay(ctx, NOW)).toBeDefined();
    expect(packageRunUnderWay(ctx, later)).toBeUndefined();
    const lock = acquirePackageUpdateLock(ctx.home)!;
    expect(packageRunUnderWay(ctx, later)).toBeDefined();
    running(ctx, deadPid());
    expect(packageRunUnderWay(ctx, later)).toBeUndefined();
    lock.release();
  });
});

describe("the real launcher", () => {
  it("starts the update without a terminal, in this factory", async () => {
    const ctx = await factory();
    const dir = tempDir();
    const out = join(dir, "out.json");
    const script = join(dir, "cli.cjs");
    writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ args: process.argv.slice(2), tty: Boolean(process.stdin.isTTY), home: process.env.ZERO_HOME }));`);
    const argv = process.argv[1]!;
    process.argv[1] = script;
    try {
      expect(await launchPackageUpdate(ctx, "hello")).toBeGreaterThan(0);
    } finally {
      process.argv[1] = argv;
    }
    await vi.waitFor(() => expect(existsSync(out) && readFileSync(out, "utf8")).toBeTruthy(), { timeout: 20_000 });
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ args: ["package", "update", "hello"], tty: false, home: ctx.home.root });
  }, 30_000);

  it("starts nothing in a container, whose end would take the update along", async () => {
    const ctx = await factory();
    vi.stubEnv("ZERO_CONTAINER", "1");
    await expect(launchPackageUpdate(ctx, "hello")).rejects.toThrow(/contenedor/);
  });
});

describe("the update the daemon started", () => {
  const entry = (ctx: FactoryContext) => parseFactory(readFileSync(ctx.home.config, "utf8")).packages[0]!;

  function gitTo(repo: string): GitRunner {
    const insteadOf = ["-c", `url.${repo.replace(/\\/g, "/")}.insteadOf=${URL_V}`];
    return async (args, opts = {}) => {
      const r = spawnSync("git", [...insteadOf, ...args], { cwd: opts.cwd, encoding: "utf8", env: { ...process.env, GIT_ALLOW_PROTOCOL: "file:https:ssh", GIT_TERMINAL_PROMPT: "0" } });
      if (r.status !== 0) throw new Error(`git ${args[0]}: ${r.stderr.trim()}`);
      return r.stdout.trim();
    };
  }

  /** A package at v1.0.0 whose remote released v1.1.0, and this process taken for the one the daemon started. */
  async function started(files: Record<string, string>) {
    const repo = gitRepo({ "zero-package.yaml": manifest() });
    gitIn(repo, "tag", "v1.0.0");
    const ctx = testFactory({ isolation: "worktree", level: "L2", lines: [], selfUpdate: { enabled: true }, packages: [] }, () => NOW);
    ctx.config = await factoryConfig(ctx.home);
    const git = gitTo(repo);
    await packageAdd(ctx, { source: SOURCE, channel: "estable", git, confirm: async () => true, deps: async () => undefined });
    const from = entry(ctx).commit!;
    writeTree(repo, files);
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-q", "-m", "nuevo");
    gitIn(repo, "tag", "v1.1.0");
    recordAttempt(ctx.store, "hello", { version: "1.1.0", at: NOW.toISOString() });
    running(ctx, process.pid);
    const shutdown = vi.fn(async (): Promise<ShutdownResult> => ({ status: "stopped" }));
    const start = vi.fn(async () => true);
    const input: PackageUpdateInput = { name: "hello", git, deps: async () => undefined, daemon: { shutdown, start } };
    return { repo, ctx, from, input, shutdown, start };
  }

  it("moves the package and turns the factory on again", async () => {
    const { repo, ctx, input, shutdown, start } = await started({ "a.md": "a\n" });
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
    expect(entry(ctx).commit).toBe(gitIn(repo, "rev-parse", "v1.1.0"));
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(factoryStatus(ctx).packagesByHand).toBeUndefined();
  });

  it("does not apply a release that asks for more", async () => {
    const station = { name: "reportes", module: "reportes.mjs", everyMinutes: 60, secrets: ["TOKEN_NUEVO"] };
    const { ctx, from, input, shutdown } = await started({ "zero-package.yaml": manifest("hello", { stations: [station] }), "reportes.mjs": "export const pass = async () => {};\n" });
    const { text } = await packageUpdate(ctx, input);
    expect(text).toContain("TOKEN_NUEVO");
    expect(text).toContain("no se aplicó");
    expect(entry(ctx).commit).toBe(from);
    expect(shutdown).not.toHaveBeenCalled();
    ctx.store.deleteKv(PACKAGE_RUN_KEY);
    expect(formatPackages(packageList(ctx))).toContain("aplicala a mano");
  });

  it("puts on record the release it found when it is a newer one", async () => {
    const { repo, ctx, input } = await started({ "a.md": "a\n" });
    gitIn(repo, "tag", "v1.2.0");
    await packageUpdate(ctx, input);
    expect(attemptOf(ctx.store, "hello", "1.2.0")).toBeDefined();
  });

  it("puts nothing on record when it was run by hand", async () => {
    const { repo, ctx, input } = await started({ "a.md": "a\n" });
    ctx.store.deleteKv(PACKAGE_RUN_KEY);
    gitIn(repo, "tag", "v1.2.0");
    await packageUpdate(ctx, input);
    expect(attemptOf(ctx.store, "hello", "1.2.0")).toBeUndefined();
  });

  it.each([
    ["the package left its channel", (text: string) => text.replace(/^\s*channel: estable\r?\n/m, "")],
    ["automatic updates were turned off", (text: string) => text.replace("enabled: true", "enabled: false")],
  ])("updates nothing once %s", async (_what, change) => {
    const { ctx, from, input } = await started({ "a.md": "a\n" });
    const before = readFileSync(ctx.home.config, "utf8");
    expect(change(before)).not.toBe(before);
    writeFileSync(ctx.home.config, change(before));
    ctx.config = await factoryConfig(ctx.home);
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toContain("no se actualiza sola");
    expect(entry(ctx).commit).toBe(from);
  });

  it("goes one at a time, by hand or not", async () => {
    const { ctx, from, input } = await started({ "a.md": "a\n" });
    const lock = acquirePackageUpdateLock(ctx.home)!;
    const { text, failed } = await packageUpdate(ctx, input);
    expect(failed).toBe(true);
    expect(text).toContain("Ya hay una actualización de paquetes en curso");
    expect(entry(ctx).commit).toBe(from);
    lock.release();
    expect((await packageUpdate(ctx, input)).failed).toBe(false);
  });
});

describe("what a person sees", () => {
  const lists = (ctx: FactoryContext) => [formatPackages(packageList(ctx)), packagesPage(packageList(ctx), [], "n")];
  const statuses = (ctx: FactoryContext) => [formatStatus(factoryStatus(ctx)), overviewPage(factoryStatus(ctx), [], "n")];

  it("offers a release nobody tried as always", async () => {
    const ctx = await factory();
    expect(duePackageUpdate(ctx)).toEqual({ name: "hello", version: "1.1.0" });
    for (const text of lists(ctx)) expect(text).toMatch(/aplicala con .*zero package update hello/);
    expect(factoryStatus(ctx).packagesByHand).toBeUndefined();
    for (const text of statuses(ctx)) expect(text).not.toContain("a mano");
  });

  it("tells the release tried and not applied, and how to apply it", async () => {
    const ctx = await factory();
    await daemon(ctx);
    for (const text of [...lists(ctx), ...statuses(ctx)]) for (const piece of ["v1.1.0", "2026-11-25", "a mano", "zero package update hello"]) expect(text).toContain(piece);
  });

  it("tells an update under way", async () => {
    const ctx = await factory();
    recordAttempt(ctx.store, "hello", { version: "1.1.0", at: NOW.toISOString() });
    running(ctx, process.pid);
    for (const text of lists(ctx)) expect(text).toContain("se está aplicando sola");
    for (const text of statuses(ctx)) expect(text).not.toContain("a mano");
  });

  it("escapes what it tells in the panel", async () => {
    const ctx = await factory();
    const status = { ...factoryStatus(ctx), packagesByHand: [{ package: "<img src=x>", version: "1.1.0", at: "<img>" }] };
    expect(overviewPage(status, [], "n")).not.toContain("<img");
  });
});
