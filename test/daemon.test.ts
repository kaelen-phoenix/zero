import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, DAEMON_KEY, daemonInfo, requestWork } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, simulatedBox, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;

function factory(over: Record<string, unknown> = {}) {
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }], ...over });
}

const builder = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" }) });

describe("daemon", () => {
  it("runs queued jobs one at a time per line", async () => {
    const ctx = factory();
    const a = requestWork(ctx, { text: "first" }).job;
    const b = requestWork(ctx, { text: "second" }).job;
    const agents = builder();

    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner });

    const first = ctx.store.getJob(a.id)!;
    const second = ctx.store.getJob(b.id)!;
    expect([first.status, second.status]).toEqual(["delivered", "delivered"]);
    const secondStart = ctx.store.spansForJob(b.id).find((s) => s.name === "zero.station.spec")!.start;
    expect(Date.parse(secondStart)).toBeGreaterThanOrEqual(Date.parse(first.finishedAt!));
    expect(ctx.store.getKv(DAEMON_KEY)).toBeUndefined();
  });

  it("resumes jobs a previous run left running", async () => {
    const ctx = factory();
    const job = requestWork(ctx, { text: "interrupted" }).job;
    ctx.store.updateJob(job.id, { status: "running" });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("refuses to start when another daemon is alive", async () => {
    const ctx = factory();
    ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid: process.ppid, beatAt: new Date().toISOString() }));
    expect(daemonInfo(ctx.store).alive).toBe(true);
    await expect(runDaemon(ctx, { once: true })).rejects.toThrow(/ya está en marcha/);
  });

  it("starts nothing while the andon cord is pulled", async () => {
    const ctx = factory();
    const job = requestWork(ctx, { text: "wait" }).job;
    ctx.store.setKv(ANDON_KEY, "on");
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
  });

  it("holds new jobs once the daily budget is spent", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 1.2, "zero.cost.source": "reported" });
    const job = requestWork(ctx, { text: "tomorrow" }).job;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
  });

  it("applies the default answer to questions nobody answered", async () => {
    let clock = Date.parse("2026-10-26T10:00:00Z");
    const ctx = testFactory({ level: "L1", isolation: "worktree", approvals: { timeoutHours: 1, onTimeout: "reject" }, lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] }, () => new Date(clock));
    const job = requestWork(ctx, { text: "needs approval" }).job;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("waiting");

    clock += 2 * 3_600_000;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: expect.stringContaining("venció sin respuesta") });
  });

  it("hands the box to jobs once it is ready and the engines have their credentials", async () => {
    const ctx = testFactory({
      level: "L3",
      isolation: "container",
      engine: "fake",
      engines: { fake: { command: ["unused"] } },
      lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }],
    });
    const agents = builder();
    const sim = simulatedBox(agents.runner);
    const job = requestWork(ctx, { text: "in the box" }).job;
    await runDaemon(ctx, {
      once: true,
      pollMs: 10,
      agentRunner: () => fakeAgents({}).runner,
      inspectBox: () => ({ ready: true, runtime: "podman", image: "zero-box:t", problems: [], checkedAt: new Date().toISOString() }),
      boxExecutor: () => sim.box,
    });
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "delivered", isolation: "container" });
    expect(sim.calls.length).toBeGreaterThan(0);
  });
});
