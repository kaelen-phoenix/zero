import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAEMON_KEY, daemonInfo, daemonProcesses, ensureDaemon, factoryStatus, listDaemonCandidates, parsePosixProcesses, parseWindowsProcesses, requestWork, SHUTDOWN_KEY, shutdownFactory, type ProcessEntry } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { acquireDaemonLock, daemonLockHeld, type DaemonLock } from "../src/daemon-lock.js";
import { formatStatus, shutdownOutcome } from "../src/format.js";
import { overviewPage } from "../src/panel/html.js";
import { cleanup as removeFactories, fakeAgents, gitRepo, tempDir, testFactory } from "./helpers.js";

const locks: DaemonLock[] = [];
const children: ChildProcess[] = [];
const orphans: number[] = [];

afterEach(async () => {
  for (const lock of locks.splice(0)) lock.release();
  await Promise.all(children.splice(0).map(kill));
  for (const pid of orphans.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  removeFactories();
});

const factory = () => testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
type Factory = ReturnType<typeof factory>;

function take(ctx: Factory): DaemonLock {
  const lock = acquireDaemonLock(ctx.home);
  if (!lock) throw new Error("lock not available");
  locks.push(lock);
  return lock;
}

const beat = (ctx: Factory, pid: number, ageMs = 0) => ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid, beatAt: new Date(Date.now() - ageMs).toISOString() }));
const STALE = 60_000;

function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    child.once("exit", () => done());
    child.kill("SIGKILL");
  });
}

/** Another real process holding the lock, optionally with a child of its own that outlives it. */
async function holder(ctx: Factory, opts: { grandchild?: boolean } = {}): Promise<{ child: ChildProcess; grandchild?: number }> {
  const script = join(tempDir("zero-holder-"), "holder.ts");
  writeFileSync(
    script,
    `import { spawn } from "node:child_process";
import { acquireDaemonLock } from ${JSON.stringify(pathToFileURL(resolve("src/daemon-lock.ts")).href)};
const lock = acquireDaemonLock({ daemonLock: ${JSON.stringify(ctx.home.daemonLock)} });
if (!lock) process.exit(3);
const orphan = ${opts.grandchild ? `spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", windowsHide: true })` : "undefined"};
orphan?.unref();
console.log("held " + (orphan?.pid ?? 0));
setInterval(() => lock, 1000);
`,
  );
  const child = spawn(process.execPath, ["--import", "tsx", script], { stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  children.push(child);
  const pid = await new Promise<number>((done, fail) => {
    child.stdout!.on("data", (d) => {
      const m = /held (\d+)/.exec(String(d));
      if (m) done(Number(m[1]));
    });
    child.once("exit", (code) => fail(new Error(`holder exited with ${code}`)));
  });
  if (pid) orphans.push(pid);
  return { child, grandchild: pid || undefined };
}

const zero = (ctx: Factory, ...args: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
  return { code: r.status, output: r.stdout + r.stderr };
};

const processes = (...commands: [number, number, string][]): (() => ProcessEntry[]) => () => commands.map(([pid, ppid, command]) => ({ pid, ppid, command }));

describe("daemon lock", () => {
  it("leaves everything alone when another holds the lock, even with no sign of life", async () => {
    const ctx = factory();
    take(ctx);
    const job = requestWork(ctx, { text: "en curso" }).job;
    ctx.store.updateJob(job.id, { status: "running" });
    ctx.store.setKv(SHUTDOWN_KEY, "pedido");
    beat(ctx, 4242, STALE);
    const before = ctx.store.getKv(DAEMON_KEY);

    await expect(runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner })).rejects.toThrow(/ya está en marcha \(proceso 4242\)/);

    expect(ctx.store.getJob(job.id)!.status).toBe("running");
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBe("pedido");
    expect(ctx.store.getKv(DAEMON_KEY)).toBe(before);
  });

  it("refuses without naming a process when there is no heartbeat, and writes none", async () => {
    const ctx = factory();
    take(ctx);
    await expect(runDaemon(ctx, { once: true })).rejects.toThrow("La fábrica ya está en marcha.");
    expect(ctx.store.getKv(DAEMON_KEY)).toBeUndefined();
  });

  it("is free when a daemon ends, so another one starts", async () => {
    const ctx = factory();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner });
    expect(daemonLockHeld(ctx.home)).toBe(false);
    await expect(runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner })).resolves.toBeUndefined();
  });

  it("is free when the daemon refuses to go on after taking it", async () => {
    const ctx = factory();
    beat(ctx, process.ppid);
    await expect(runDaemon(ctx, { once: true })).rejects.toThrow(/ya está en marcha/);
    expect(daemonLockHeld(ctx.home)).toBe(false);
  });

  it("is released by the system when its process is killed", async () => {
    const ctx = factory();
    const { child } = await holder(ctx);
    expect(daemonLockHeld(ctx.home)).toBe(true);
    expect(acquireDaemonLock(ctx.home)).toBeUndefined();
    await kill(child);
    await vi.waitFor(() => expect(daemonLockHeld(ctx.home)).toBe(false));
    take(ctx);
    expect(daemonLockHeld(ctx.home)).toBe(true);
  }, 30_000);

  it("is not inherited by child processes", async () => {
    const ctx = factory();
    const { child, grandchild } = await holder(ctx, { grandchild: true });
    expect(daemonLockHeld(ctx.home)).toBe(true);
    await kill(child);
    expect(process.kill(grandchild!, 0)).toBe(true);
    await vi.waitFor(() => expect(daemonLockHeld(ctx.home)).toBe(false));
    expect(process.kill(grandchild!, 0)).toBe(true);
  }, 30_000);

  it("looking at it neither creates the file nor takes the lock", () => {
    const ctx = factory();
    expect(daemonLockHeld(ctx.home)).toBe(false);
    expect(existsSync(ctx.home.daemonLock)).toBe(false);
    const lock = take(ctx);
    expect(daemonLockHeld(ctx.home)).toBe(true);
    lock.release();
    lock.release();
    expect(daemonLockHeld(ctx.home)).toBe(false);
    take(ctx);
  });
});

describe("start with the lock taken", () => {
  it("ensureDaemon launches nothing while a hung daemon holds it", async () => {
    const ctx = factory();
    take(ctx);
    beat(ctx, 4242, STALE);
    await expect(ensureDaemon(ctx)).resolves.toBe(false);
    expect(existsSync(ctx.home.daemonLog)).toBe(false);
  });

  it("start --detach says the holder does not respond and fails", async () => {
    const ctx = factory();
    await holder(ctx);
    beat(ctx, 4242, STALE);
    const r = zero(ctx, "start", "--detach");
    expect(r.code).toBe(1);
    expect(r.output).toContain("4242");
    expect(r.output).toContain("no responde");
    expect(r.output).not.toContain("Fábrica encendida en segundo plano");
  }, 60_000);

  it("start --detach is fine with a healthy daemon", async () => {
    const ctx = factory();
    await holder(ctx);
    beat(ctx, process.pid);
    const r = zero(ctx, "start", "--detach");
    expect(r.code).toBe(0);
    expect(r.output).toContain("La fábrica ya estaba en marcha.");
  }, 60_000);

  it("start in the foreground refuses", async () => {
    const ctx = factory();
    await holder(ctx);
    const r = zero(ctx, "start");
    expect(r.code).toBe(1);
    expect(r.output).toContain("ya está en marcha");
  }, 60_000);
});

describe("shutdown", () => {
  it("waits until a running daemon has released the lock", async () => {
    const ctx = factory();
    const daemon = runDaemon(ctx, { pollMs: 10, panel: false, scout: false, research: false, packages: false, agentRunner: () => fakeAgents({}).runner });
    expect(daemonLockHeld(ctx.home)).toBe(true);
    await expect(shutdownFactory(ctx, { timeoutMs: 20_000, pollMs: 10 })).resolves.toEqual({ status: "stopped" });
    expect(daemonLockHeld(ctx.home)).toBe(false);
    await daemon;
  }, 30_000);

  it("gives up with the pid when the lock is not released, leaving the request in place", async () => {
    const ctx = factory();
    take(ctx);
    beat(ctx, 4242, STALE);
    await expect(shutdownFactory(ctx, { timeoutMs: 50, pollMs: 10 })).resolves.toEqual({ status: "timeout", pid: 4242 });
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeDefined();
  });

  it("the command says the daemon did not stop, with its pid, and exits with an error", () => {
    const { text, code } = shutdownOutcome({ status: "timeout", pid: 4242 });
    expect(text).toContain("4242");
    expect(text).toContain("no se apagó");
    expect(code).toBe(1);
    expect(shutdownOutcome({ status: "stopped" }).code).toBe(0);
    expect(shutdownOutcome({ status: "not-running" }).code).toBe(0);
  });

  it("has nothing to do when no daemon is there", async () => {
    const ctx = factory();
    beat(ctx, 4242, STALE);
    await expect(shutdownFactory(ctx)).resolves.toEqual({ status: "not-running" });
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeUndefined();
  });

  it("the command reports that there was nothing to stop", () => {
    const r = zero(factory(), "shutdown");
    expect(r.code).toBe(0);
    expect(r.output).toContain("no estaba en marcha");
  }, 60_000);

  it("also asks a daemon of an earlier version, which holds no lock", async () => {
    const ctx = factory();
    beat(ctx, process.ppid);
    await expect(shutdownFactory(ctx, { timeoutMs: 50, pollMs: 10 })).resolves.toEqual({ status: "timeout", pid: process.ppid });
    expect(ctx.store.getKv(SHUTDOWN_KEY)).toBeDefined();
  });
});

describe("daemon processes", () => {
  const status = (ctx: Factory, pids?: number[]) => formatStatus({ ...factoryStatus(ctx), daemonProcesses: pids });

  it("warns about two daemons, with their pids", () => {
    const pids = daemonProcesses(processes([11, 1, "node C:\\zero\\dist\\cli.js start"], [22, 2, "node /opt/zero/dist/cli.js start"]));
    expect(pids).toEqual([11, 22]);
    const text = status(factory(), pids);
    expect(text).toMatch(/AVISO.*11, 22/);
    expect(text).toContain("ZERO_HOME");
  });

  it("does not warn about one", () => {
    const pids = daemonProcesses(processes([11, 1, "node dist/cli.js start"]));
    expect(pids).toEqual([11]);
    expect(status(factory(), pids)).not.toContain("AVISO");
  });

  it("recognizes the command lines Windows and the launcher really produce", () => {
    expect(
      daemonProcesses(
        processes(
          [11, 1, '"C:\\Program Files\\nodejs\\node.exe" C:\\zero\\dist\\cli.js start'],
          [22, 1, '"C:\\Program Files\\nodejs\\node.exe" "C:\\mis cosas\\zero\\dist\\cli.js" start'],
          [33, 1, "/usr/local/bin/node --enable-source-maps /usr/local/bin/zero start"],
          [44, 1, "node --require a.cjs --import file:///x/loader.mjs src/cli.ts start"],
          [55, 1, "/usr/bin/node /home/alguien/mis cosas/zero/dist/cli.js start"],
        ),
      ),
    ).toEqual([11, 22, 33, 44, 55]);
  });

  it("does not count other processes", () => {
    expect(
      daemonProcesses(
        processes(
          [1, 0, "node dist/cli.js start --detach"],
          [2, 0, "node dist/cli.js status"],
          [3, 0, "node npm-cli.js run zero start"],
          [4, 0, "cmd /c zero start"],
          [5, 0, "node C:\\nodejs\\npm-cli.js run zero start"],
          [6, 0, 'node dist/cli.js request "arreglá C:\\zero start"'],
          [7, 0, ""],
          [process.pid, 0, "node dist/cli.js start"],
        ),
      ),
    ).toEqual([]);
  });

  it("counts a development wrapper and its child as one", () => {
    expect(daemonProcesses(processes([11, 1, "node tsx/dist/cli.mjs src/cli.ts start"], [12, 11, "node --import loader src/cli.ts start"]))).toHaveLength(1);
    expect(daemonProcesses(processes([11, 1, "node dist/cli.js start"], [12, 11, "node dist/cli.js start"]))).toEqual([11]);
  });

  it("gives an empty list when listing fails", () => {
    const ctx = factory();
    const pids = daemonProcesses(() => {
      throw new Error("timeout");
    });
    expect(pids).toEqual([]);
    expect(status(ctx, pids)).toContain("Fábrica:");
    expect(status(ctx, pids)).not.toContain("AVISO");
  });

  it("reads both listings", () => {
    const one = { ProcessId: 11, ParentProcessId: 1, CommandLine: "node a" };
    expect(parseWindowsProcesses(JSON.stringify(one))).toEqual([{ pid: 11, ppid: 1, command: "node a" }]);
    expect(parseWindowsProcesses(JSON.stringify([one, { ...one, ProcessId: 12, CommandLine: null }]))).toEqual([{ pid: 11, ppid: 1, command: "node a" }, { pid: 12, ppid: 1, command: "" }]);
    expect(parseWindowsProcesses("")).toEqual([]);
    expect(parsePosixProcesses("   11     1 node a b\n  12 11 /bin/sh\n\n")).toEqual([{ pid: 11, ppid: 1, command: "node a b" }, { pid: 12, ppid: 11, command: "/bin/sh" }]);
  });

  it.runIf(process.platform === "win32")("finds real node processes", () => {
    expect(listDaemonCandidates().some((p) => p.pid === process.pid)).toBe(true);
  }, 30_000);

  it("zero status works from the command line", () => {
    const r = zero(factory(), "status");
    expect(r.code).toBe(0);
    expect(r.output).toContain("Fábrica:");
  }, 60_000);
});

describe("status of a daemon that does not respond", () => {
  const factoryLine = (ctx: Factory) => formatStatus(factoryStatus(ctx)).split("\n")[0]!;

  it("never says it is off while the lock is held", () => {
    const ctx = factory();
    take(ctx);
    beat(ctx, 4242, STALE);
    expect(daemonInfo(ctx.store).alive).toBe(false);
    const line = factoryLine(ctx);
    expect(line).toContain("no responde");
    expect(line).toContain("4242");
    expect(line).not.toContain("apagada");
    expect(overviewPage(factoryStatus(ctx), ["demo"], "nonce")).toContain("no responde (proceso 4242)");
  });

  it("says it is off when the lock is free", () => {
    const ctx = factory();
    beat(ctx, 4242, STALE);
    expect(factoryLine(ctx)).toContain("apagada");
    expect(factoryLine(ctx)).not.toContain("no responde");
  });
});
