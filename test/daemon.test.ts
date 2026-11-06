import { createServer as createNetServer, Server as NetServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, DAEMON_KEY, daemonInfo, egressReport, factoryStatus, requestWork, SHUTDOWN_KEY } from "../src/app.js";
import { saveBoxStatus, type BoxStatus } from "../src/box/status.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { HALT_KEY, QUOTA_KEY } from "../src/github-quota.js";
import { finalizeJob } from "../src/line/finish.js";
import { overviewPage } from "../src/panel/html.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitIn, gitRepo, simulatedBox, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;

function factory(over: Record<string, unknown> = {}) {
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }], ...over });
}

const builder = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { [`src/${Math.random().toString(36).slice(2)}.ts`]: "ok" }) });

describe("box not ready", () => {
  afterEach(() => vi.unstubAllEnvs());

  const boxed = () => factory({ isolation: "container" });
  const noBox: BoxStatus = { ready: false, image: "zero-box:test", problems: ["no hay Podman ni Docker instalados: corré `zero box setup`"], checkedAt: "2026-11-05T00:00:00Z" };

  it("in a container: the job stays queued, no agent is called and no idle pass runs", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const ctx = boxed();
    const job = requestWork(ctx, { text: "espera" }).job;
    const agents = builder();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, inspectBox: () => noBox, scout: true, research: true });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
    expect(agents.calls).toEqual([]);
  });

  it("in a container: a stop still ends a queued job", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const ctx = boxed();
    const job = requestWork(ctx, { text: "ya no" }).job;
    ctx.store.updateJob(job.id, { stopRequested: true });
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner, inspectBox: () => noBox });
    expect(ctx.store.getJob(job.id)!.status).toBe("stopped");
  });

  it("in a container: `zero status` says the jobs wait and what to run", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const ctx = boxed();
    saveBoxStatus(ctx.store, noBox);
    const text = formatStatus(factoryStatus(ctx));
    expect(text).toContain("los trabajos esperan la caja");
    expect(text).toContain("zero box setup");
    expect(text).toContain("zero setup");
    expect(text).not.toContain("copias locales");
    const html = overviewPage(factoryStatus(ctx), [], "n");
    expect(html).toContain("esperan en la cola");
    expect(html).not.toContain("copias locales");
    expect(egressReport(ctx, {}).note).not.toContain("copias locales");
  });

  it("in a container with `isolation: worktree`: the owner chose, so the job runs", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const ctx = factory();
    const job = requestWork(ctx, { text: "sin caja" }).job;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("in a container with the box ready: the job runs in the box", async () => {
    vi.stubEnv("ZERO_CONTAINER", "1");
    const ctx = boxed();
    ctx.secrets.set("CLAUDE_CODE_OAUTH_TOKEN", "token-de-prueba");
    const job = requestWork(ctx, { text: "con caja" }).job;
    const agents = builder();
    const { box } = simulatedBox(agents.runner);
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, inspectBox: () => ({ ...noBox, ready: true, runtime: "docker", problems: [] }), boxExecutor: () => box });
    expect(ctx.store.getJob(job.id)!.isolation).toBe("container");
  });

  it("outside a container: the job starts as it always did, in a local copy", async () => {
    const ctx = boxed();
    const job = requestWork(ctx, { text: "copia local" }).job;
    const agents = builder();
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => agents.runner, inspectBox: () => noBox });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
    expect(agents.calls.length).toBeGreaterThan(0);
    expect(formatStatus(factoryStatus(ctx))).toContain("copias locales");
  });
});

describe("panel.host", () => {
  afterEach(() => vi.restoreAllMocks());

  it("listens on the address of the file and still asks for the key", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createNetServer().listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const ctx = factory({ panel: { port, host: "0.0.0.0" }, lines: [] });
    const listen = vi.spyOn(NetServer.prototype, "listen");
    const daemon = runDaemon(ctx, { pollMs: 10, panel: true, scout: false, research: false, packages: false, packageUpdates: false, agentRunner: () => builder().runner });
    let address: AddressInfo | undefined;
    for (let i = 0; i < 200 && !address; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const server = listen.mock.contexts.find((s) => (s as NetServer).listening && ((s as NetServer).address() as AddressInfo)?.port === port) as NetServer | undefined;
      address = server?.address() as AddressInfo | undefined;
    }
    try {
      expect(address?.address).toBe("0.0.0.0");
      const r = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
      expect(r.status).toBe(401);
    } finally {
      ctx.store.setKv(SHUTDOWN_KEY, "1");
      await daemon;
    }
  });
});

describe("GitHub pause", () => {
  /** A line with work for every GitHub pass, and factories that count every time a pass reaches for GitHub. */
  async function githubWork() {
    const repo = gitRepo();
    gitIn(repo, "remote", "add", "origin", "https://github.com/kaelen/demo.git");
    const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, integrate: "pull-request", autoMerge: true, issues: { label: "zero" } }] });
    const job = ctx.store.createJob({ line: "demo", kind: "request", request: "x", budgetUsd: 3 });
    await finalizeJob(ctx, job, "delivered", { delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/kaelen/demo/pull/10", autoMerge: true } });
    const reached = { issues: 0, merges: 0 };
    return {
      ctx,
      reached,
      opts: {
        once: true,
        pollMs: 10,
        agentRunner: () => builder().runner,
        issues: () => {
          reached.issues++;
          return undefined;
        },
        merges: () => {
          reached.merges++;
          return undefined;
        },
      },
    };
  }

  it("starts every GitHub pass with no pause", async () => {
    const { ctx, reached, opts } = await githubWork();
    await runDaemon(ctx, opts);
    expect(reached.issues).toBeGreaterThan(0);
    expect(reached.merges).toBeGreaterThan(0);
  });

  it("starts no GitHub pass during a pause, and still runs the rest of the loop", async () => {
    const { ctx, reached, opts } = await githubWork();
    ctx.store.setKv(HALT_KEY, JSON.stringify({ until: new Date(Date.now() + 600_000).toISOString(), why: "límite" }));
    const job = requestWork(ctx, { text: "owner work" }).job;
    await runDaemon(ctx, opts);
    expect(reached).toEqual({ issues: 0, merges: 0 });
    expect(ctx.store.getJob(job.id)!.status).not.toBe("queued");
  });

  it("starts no GitHub pass inside the reserve either", async () => {
    const { ctx, reached, opts } = await githubWork();
    ctx.store.setKv(QUOTA_KEY, JSON.stringify({ limit: 5000, remaining: 1000, resetAt: new Date(Date.now() + 600_000).toISOString() }));
    await runDaemon(ctx, opts);
    expect(reached).toEqual({ issues: 0, merges: 0 });
  });
});

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

  it("holds new jobs once the daily budget billed per use is spent", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 } });
    ctx.tracer.start(AGENT_SPAN, { attrs: { "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 1.2, "zero.cost.source": "reported", "zero.billing": "api" });
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
    expect(ctx.store.getJob(job.id)).toMatchObject({ status: "stopped", reason: expect.stringContaining("Se rechazó solo: venció sin respuesta") });
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
