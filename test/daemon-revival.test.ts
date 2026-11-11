import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAEMON_KEY, daemonStatus, factoryStatus, readStopRecord, requestWork, reviveDaemon, SHUTDOWN_KEY, STOPPED_KEY, type FactoryContext } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { acquireDaemonLock, type DaemonLock } from "../src/daemon-lock.js";
import { formatStatus } from "../src/format.js";
import { createZeroMcpServer, reviveOnStart } from "../src/mcp/server.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

const locks: DaemonLock[] = [];
afterEach(() => {
  for (const lock of locks.splice(0)) lock.release();
  cleanup();
});

const factory = () => testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [] }] });
type Factory = ReturnType<typeof factory>;

/** A pid that belonged to a process that has already ended. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
const at1437 = () => {
  const d = new Date();
  d.setHours(14, 37, 0, 0);
  return d.toISOString();
};
const beat = (ctx: Factory, pid: number, beatAt: string) => ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid, beatAt }));
const factoryLine = (ctx: Factory) => formatStatus(factoryStatus(ctx)).split("\n")[0]!;

/** A daemon that crashed at 14:37 leaving one job in `running`. */
function crashed(): Factory {
  const ctx = factory();
  const job = requestWork(ctx, { text: "en curso" }).job;
  ctx.store.updateJob(job.id, { status: "running" });
  beat(ctx, deadPid(), at1437());
  return ctx;
}

describe("daemon state", () => {
  it("reads a crash with work in progress", () => {
    const ctx = crashed();
    const daemon = factoryStatus(ctx).daemon;
    expect(daemon.state).toBe("crashed");
    expect(daemon.since).toBe(at1437());
    const line = factoryLine(ctx);
    expect(line).toContain("se cayó");
    expect(line).toContain("14:37");
    expect(line).toContain("1 trabajo en curso");
    expect(line).not.toContain("apagada");
  });

  it("takes a beat from before the machine started for a crash, even if its pid lives again", () => {
    const ctx = factory();
    beat(ctx, process.pid, new Date(Date.now() - 60_000).toISOString());
    expect(daemonStatus(ctx, new Date(), Date.now() - 1_000).state).toBe("crashed");
    expect(daemonStatus(ctx, new Date(), Date.now() - 3_600_000).state).toBe("unresponsive");
  });

  it("is not a crash while another process holds the lock", () => {
    const ctx = crashed();
    const lock = acquireDaemonLock(ctx.home)!;
    locks.push(lock);
    expect(factoryStatus(ctx).daemon.state).toBe("unresponsive");
  });

  it("is running while a fresh heartbeat's process lives", () => {
    const ctx = factory();
    beat(ctx, process.ppid, new Date().toISOString());
    expect(factoryStatus(ctx).daemon.state).toBe("running");
  });

  it("is stopped on purpose after zero shutdown, from the time of the stop", async () => {
    const ctx = factory();
    const running = runDaemon(ctx, { pollMs: 10, panel: false, scout: false, unjam: false, research: false, packages: false, packageUpdates: false, agentRunner: () => fakeAgents({}).runner });
    await new Promise((r) => setTimeout(r, 100));
    ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
    await running;

    expect(ctx.store.getKv(DAEMON_KEY)).toBeUndefined();
    const record = readStopRecord(ctx.store)!;
    expect(record.reason).toBe("shutdown");
    const stoppedAt = record.at;
    const status = factoryStatus(ctx);
    expect(status.daemon.state).toBe("stopped");
    expect(status.daemon.since).toBe(stoppedAt);
    const d = new Date(stoppedAt);
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(factoryLine(ctx)).toContain(`apagada a propósito desde ${hhmm}`);
  });

  it("records a once run as a stop and clears the record on the next start", async () => {
    const ctx = factory();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => fakeAgents({}).runner });
    expect(readStopRecord(ctx.store)?.reason).toBe("once");
    const job = requestWork(ctx, { text: "algo" }).job;
    let during: string | undefined = "unset";
    await runDaemon(ctx, {
      once: true,
      pollMs: 10,
      agentRunner: () => {
        during = ctx.store.getKv(STOPPED_KEY);
        return fakeAgents({}).runner;
      },
    });
    expect(ctx.store.getJob(job.id)).toBeDefined();
    expect(during).toBeUndefined();
  });

  it("an error ending the loop leaves the heartbeat and writes no stop record", async () => {
    const ctx = factory();
    requestWork(ctx, { text: "algo" });
    await expect(
      runDaemon(ctx, {
        once: true,
        pollMs: 10,
        agentRunner: () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(ctx.store.getKv(DAEMON_KEY)).toBeDefined();
    expect(ctx.store.getKv(STOPPED_KEY)).toBeUndefined();
  });
});

describe("reviveDaemon", () => {
  const starter = () => vi.fn(async (_ctx: FactoryContext) => true);

  it("starts a crashed factory with a job in progress", async () => {
    const ctx = crashed();
    const start = starter();
    await expect(reviveDaemon(ctx, start)).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts a crashed factory with only queued work", async () => {
    const ctx = factory();
    requestWork(ctx, { text: "en cola" });
    beat(ctx, deadPid(), at1437());
    const start = starter();
    await expect(reviveDaemon(ctx, start)).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("never starts a factory stopped on purpose", async () => {
    const ctx = factory();
    requestWork(ctx, { text: "en cola" });
    ctx.store.setKv(STOPPED_KEY, JSON.stringify({ at: new Date().toISOString(), reason: "shutdown" }));
    const start = starter();
    expect(factoryStatus(ctx).daemon.state).toBe("stopped");
    await expect(reviveDaemon(ctx, start)).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("does nothing after a crash with no work left", async () => {
    const ctx = factory();
    beat(ctx, deadPid(), at1437());
    const start = starter();
    await expect(reviveDaemon(ctx, start)).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("does nothing while the daemon runs", async () => {
    const ctx = factory();
    requestWork(ctx, { text: "en cola" });
    beat(ctx, process.ppid, new Date().toISOString());
    const start = starter();
    await expect(reviveDaemon(ctx, start)).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});

describe("MCP revival", () => {
  async function call(ctx: Factory, autoStart: boolean, start: (ctx: FactoryContext) => Promise<boolean>) {
    const server = createZeroMcpServer(ctx.home, { autoStart, start });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(clientSide);
    const r = (await client.callTool({ name: "zero_status", arguments: {} })) as { content: { text: string }[] };
    await client.close();
    return r.content[0]!.text;
  }

  it("a tool call starts a crashed factory with work left", async () => {
    const ctx = crashed();
    const start = vi.fn(async () => true);
    expect(await call(ctx, true, start)).toContain("se cayó");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("starts nothing without autoStart", async () => {
    const ctx = crashed();
    const start = vi.fn(async () => true);
    await call(ctx, false, start);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a crashed factory when the server starts", async () => {
    const ctx = crashed();
    const start = vi.fn(async () => true);
    await reviveOnStart(ctx.home, start);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
