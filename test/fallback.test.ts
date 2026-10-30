import { afterEach, describe, expect, it } from "vitest";
import { createAgentRunner, quotaAttrs, type EngineExecute } from "../src/agent.js";
import { factoryStatus, productionLine, requestWork, trace } from "../src/app.js";
import { stationEngines } from "../src/box/credentials.js";
import { egressPolicy } from "../src/box/egress.js";
import { budgetState, pickEngine } from "../src/budget.js";
import { AGENT_STATIONS, ConfigError, parseFactory, stationChain } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import type { EngineRequest, QuotaReport } from "../src/engines/index.js";
import { formatStatus } from "../src/format.js";
import { runJob } from "../src/line/runner.js";
import { lineView } from "../src/panel/html.js";
import type { Store } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { Tracer } from "../src/telemetry/tracer.js";
import { cleanup, fakeAgents, gitIn, gitRepo, tempDir, testFactory, testStore, writeTree } from "./helpers.js";

afterEach(cleanup);

// Local times, so the owner-facing text reads "23:20".
const NOW = new Date(2026, 9, 29, 15, 0);
const UNTIL = new Date(2026, 9, 29, 23, 20).toISOString();
const clock = () => NOW;
const passes = `node -e "process.exit(0)"`;

const usedUp = (resetsAt = UNTIL): QuotaReport => ({ billing: "subscription", limited: true, windows: [{ name: "five_hour", label: "5 horas", utilization: 1, status: "exhausted", resetsAt }] });
const fine: QuotaReport = { billing: "subscription", windows: [{ name: "five_hour", label: "5 horas", utilization: 0.2, status: "ok", resetsAt: UNTIL }] };
const api: QuotaReport = { billing: "api", windows: [] };

/** A call of another job, as the agent runner records it. */
function call(store: Store, engine: string, costUsd: number, quota?: QuotaReport, at = NOW) {
  new Tracer(store, () => at).start(AGENT_SPAN, { attrs: { "zero.engine": engine } }).end("ok", { "zero.cost.usd": costUsd, ...quotaAttrs(quota) });
}

const config = (yaml: string) => parseFactory(`engine: claude\n${yaml}\nlines: []\n`);

describe("replacement engines in the configuration", () => {
  it("takes a global list of names", () => {
    const cfg = config("fallback: [codex]");
    for (const station of AGENT_STATIONS) expect(stationChain(cfg, station)).toEqual([{ engine: "claude" }, { engine: "codex" }]);
  });

  it("lets a station replace the global list, with a model", () => {
    const cfg = config("fallback: [codex]\nstations: { review: { fallback: [{ engine: antigravity, model: m1 }] } }");
    expect(stationChain(cfg, "review")).toEqual([{ engine: "claude" }, { engine: "antigravity", model: "m1" }]);
    expect(stationChain(cfg, "build")).toEqual([{ engine: "claude" }, { engine: "codex" }]);
  });

  it("refuses an engine that is neither built in nor declared", () => {
    expect(() => config("fallback: [nadie]")).toThrow(ConfigError);
    expect(() => config("fallback: [nadie]")).toThrow(/nadie/);
    expect(() => config("stations: { build: { fallback: [{ engine: nadie }] } }")).toThrow(/stations\.build\.fallback\.0: .*nadie/);
    expect(stationChain(config("engines: { alt: { command: [x] } }\nfallback: [alt]"), "spec")).toEqual([{ engine: "claude" }, { engine: "alt" }]);
  });

  it("keeps each station on its own engine without a list", () => {
    const cfg = config("");
    for (const station of AGENT_STATIONS) expect(stationChain(cfg, station)).toEqual([{ engine: "claude" }]);
  });

  it("counts replacements among the engines of the box and the egress gate", () => {
    const cfg = parseFactory("egress: { mode: allowlist }\nengines: { alt: { command: [x], hosts: [api.alt.dev] } }\nfallback: [alt]\nlines: []\n");
    expect(stationEngines(cfg)).toContain("alt");
    expect(egressPolicy(cfg).allow).toContain("api.alt.dev");
  });
});

describe("budget per engine", () => {
  it("pauses only the engine whose plan is used up", () => {
    const store = testStore();
    call(store, "claude", 1, usedUp());
    const b = budgetState(store, config("fallback: [codex]"), NOW);
    expect(b.engines).toEqual(expect.arrayContaining([
      expect.objectContaining({ engine: "claude", paused: true, until: UNTIL }),
      expect.objectContaining({ engine: "codex", paused: false, billing: "unknown" }),
    ]));
    expect(b).toMatchObject({ reached: false, replacements: [{ engine: "claude", until: UNTIL, with: "codex" }] });
  });

  it("applies the daily dollar cap to each engine billed per use", () => {
    const store = testStore();
    call(store, "claude", 1, fine);
    call(store, "codex", 10, api);
    const b = budgetState(store, config("fallback: [codex]\nlimits: { usdPerDay: 10 }"), NOW);
    expect(b.engines.find((e) => e.engine === "codex")).toMatchObject({ paused: true });
    expect(b.engines.find((e) => e.engine === "claude")).toMatchObject({ paused: false });
    expect(b.reached).toBe(false);
  });

  it("does not count another engine's spend", () => {
    const store = testStore();
    call(store, "codex", 2, api);
    call(store, "alt", 9, api);
    const b = budgetState(store, config("engines: { alt: { command: [x] } }\nfallback: [codex, alt]\nlimits: { usdPerDay: 10 }"), NOW);
    expect(b.engines.find((e) => e.engine === "codex")).toMatchObject({ paused: false });
  });

  it("pauses the factory only when a station has no engine left", () => {
    const store = testStore();
    call(store, "claude", 1, usedUp());
    call(store, "codex", 10, api);
    expect(budgetState(store, config("fallback: [codex]\nlimits: { usdPerDay: 10 }"), NOW)).toMatchObject({ reached: true, until: UNTIL, reason: expect.stringMatching(/cupo/) });
  });

  it("pauses as before without replacements", () => {
    const store = testStore();
    const until = new Date(2026, 9, 29, 18, 0).toISOString();
    call(store, "claude", 1, usedUp(until));
    expect(budgetState(store, config(""), NOW)).toMatchObject({ reached: true, until, reason: expect.stringMatching(/todo el cupo de 5 horas/), replacements: [] });
  });

  it("chooses the first engine that is not paused, and the own one again once it renews", () => {
    const store = testStore();
    const cfg = config("fallback: [codex]");
    expect(pickEngine(store, cfg, "review", NOW)).toEqual({ engine: "claude", billing: "unknown", available: true });
    call(store, "claude", 1, usedUp());
    expect(pickEngine(store, cfg, "review", NOW)).toEqual({ engine: "codex", billing: "unknown", available: true, replaces: "claude", reason: "claude pausado hasta 23:20" });
    expect(pickEngine(store, cfg, "review", new Date(Date.parse(UNTIL) + 60_000))).toMatchObject({ engine: "claude", available: true });
    // Nothing left: the station's own engine, as without replacements.
    expect(pickEngine(store, config(""), "review", NOW)).toMatchObject({ engine: "claude", available: false });
  });

  it("says in the status who works while an engine is paused", () => {
    const ctx = testFactory({ engine: "claude", fallback: ["codex"], lines: [] }, clock);
    call(ctx.store, "claude", 1, usedUp());
    const text = formatStatus(factoryStatus(ctx), NOW);
    expect(text).toContain("claude pausado hasta 23:20 · trabajando con codex");
    expect(text).not.toContain("PAUSADA");
  });
});

describe("agent runner with a replacement", () => {
  async function runWith(engine: { name: string; replaces?: string; reason?: string }) {
    const ctx = testFactory({ engine: "claude", fallback: ["codex"], lines: [] });
    const seen: { engine: string; req: EngineRequest }[] = [];
    const execute: EngineExecute = async (e, req) => (seen.push({ engine: e.name, req }), { ok: true, text: "ok" });
    await createAgentRunner(ctx.config, { execute })({ station: "review", prompt: "p", cwd: tempDir(), engine, trace: { tracer: ctx.tracer, jobId: "j1", parentId: "p1" } });
    return { seen, span: ctx.store.spansForJob("j1").find((s) => s.name === AGENT_SPAN)! };
  }

  it("runs the replacement through the same executor, read-only, and records why", async () => {
    const { seen, span } = await runWith({ name: "codex", replaces: "claude", reason: "claude pausado hasta 23:20" });
    expect(seen).toMatchObject([{ engine: "codex", req: { access: "read" } }]);
    expect(span.attrs).toMatchObject({ "zero.engine": "codex", "zero.engine.replaces": "claude", "zero.engine.reason": "claude pausado hasta 23:20" });
  });

  it("records no reason on the station's own engine", async () => {
    const { seen, span } = await runWith({ name: "claude" });
    expect(seen[0]!.engine).toBe("claude");
    expect(span.attrs).toMatchObject({ "zero.engine": "claude" });
    expect(span.attrs).not.toHaveProperty("zero.engine.reason");
  });

  it("never runs an engine the owner did not configure for the station", async () => {
    const ctx = testFactory({ engine: "claude", lines: [] });
    const execute: EngineExecute = async () => ({ ok: true, text: "ok" });
    await expect(createAgentRunner(ctx.config, { execute })({ station: "review", prompt: "p", cwd: tempDir(), engine: { name: "codex" } })).rejects.toThrow(/not configured/);
  });
});

describe("production line with replacements", () => {
  function setup(over: Record<string, unknown> = {}) {
    const repo = gitRepo();
    const ctx = testFactory({ engine: "claude", fallback: ["codex"], level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, verify: [passes] }], ...over }, clock);
    return { ctx, repo };
  }
  const write = (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });
  const engines = (calls: { station: string; engine?: { name: string } }[], station: string) => calls.filter((c) => c.station === station).map((c) => c.engine?.name);

  it("works with the replacement while the station's engine is paused, and shows why", async () => {
    const { ctx } = setup();
    call(ctx.store, "claude", 1, usedUp());
    const agents = fakeAgents({ build: write });
    const { job } = requestWork(ctx, { text: "x" });
    expect((await runJob(job.id, { ...ctx, runAgent: agents.runner })).status).toBe("delivered");
    expect(engines(agents.calls, "review")).toEqual(["codex"]);

    const text = trace(ctx, job.id);
    expect(text).toContain("review vía codex");
    expect(text).toContain("claude pausado hasta 23:20");
    const review = productionLine(ctx).rows.find((r) => r.id === job.id)!.stations.find((s) => s.name === "review")!;
    expect(review.detail!.engines).toEqual(["codex (claude pausado hasta 23:20)"]);
    expect(lineView(productionLine(ctx))).toContain("Motor: codex (claude pausado hasta 23:20)");
  });

  it("goes back to the station's own engine once its plan renews", async () => {
    const { ctx } = setup();
    call(ctx.store, "claude", 1, usedUp(new Date(NOW.getTime() - 3_600_000).toISOString()), new Date(NOW.getTime() - 5 * 3_600_000));
    const agents = fakeAgents({ build: write });
    const { job } = requestWork(ctx, { text: "x" });
    await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(engines(agents.calls, "review")).toEqual(["claude"]);
    const span = ctx.store.spansForJob(job.id).find((s) => s.name === AGENT_SPAN && s.attrs["gen_ai.agent.name"] === "review")!;
    expect(span.attrs).not.toHaveProperty("zero.engine.reason");
  });

  it("passes the replacement's model", async () => {
    const { ctx } = setup({ fallback: [], stations: { build: { fallback: [{ engine: "codex", model: "m1" }] } } });
    call(ctx.store, "claude", 1, usedUp());
    const agents = fakeAgents({ build: write });
    const { job } = requestWork(ctx, { text: "x" });
    await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(agents.calls.find((c) => c.station === "build")!.engine).toMatchObject({ name: "codex", model: "m1" });
  });

  it("goes on with the replacement when the plan cuts the build short, in the same attempt", async () => {
    const { ctx, repo } = setup();
    call(ctx.store, "claude", 1, fine);
    const agents = fakeAgents({
      build: (req, n) => (n === 1 ? (writeTree(req.cwd, { "half.ts": "half done\n" }), { ok: false, text: "rate limited", quota: usedUp() }) : (write(req), {})),
    });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(engines(agents.calls, "build")).toEqual(["claude", "codex"]);
    const files = gitIn(repo, "ls-tree", "-r", "--name-only", "main");
    expect(files).toContain("src/health.ts");
    expect(files).not.toContain("half.ts");
  });

  it("goes on with the replacement when the plan cuts the review short", async () => {
    const { ctx } = setup();
    call(ctx.store, "claude", 1, fine);
    const agents = fakeAgents({ build: write, review: (_req, n) => (n === 1 ? { ok: false, text: "rate limited", output: undefined, quota: usedUp() } : {}) });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(engines(agents.calls, "review")).toEqual(["claude", "codex"]);
  });

  it("caps the calls of a replacement billed per use, not those of a subscription", async () => {
    const paid = setup({ limits: { usdPerJob: 3 } });
    call(paid.ctx.store, "claude", 1, usedUp());
    call(paid.ctx.store, "codex", 0, api);
    const agents = fakeAgents({ build: write });
    const { job } = requestWork(paid.ctx, { text: "x" });
    await runJob(job.id, { ...paid.ctx, runAgent: agents.runner });
    const build = agents.calls.find((c) => c.station === "build")!;
    expect(build.engine!.name).toBe("codex");
    // The spec call, made with codex too, already took $0.10.
    expect(build.maxBudgetUsd).toBeCloseTo(2.9);

    const sub = setup({ limits: { usdPerJob: 3 } });
    call(sub.ctx.store, "claude", 1, fine);
    const own = fakeAgents({ build: write });
    await runJob(requestWork(sub.ctx, { text: "x" }).job.id, { ...sub.ctx, runAgent: own.runner });
    expect(own.calls.find((c) => c.station === "build")).toMatchObject({ engine: { name: "claude" }, maxBudgetUsd: undefined });
  });

  it("does not charge a job's subscription estimates to its dollar cap", async () => {
    const { ctx } = setup({ fallback: [], limits: { usdPerJob: 3 }, stations: { build: { engine: "codex" } } });
    call(ctx.store, "claude", 1, fine);
    call(ctx.store, "codex", 0, api);
    const agents = fakeAgents({ spec: () => ({ costUsd: 5, quota: fine }), build: write });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done.status).toBe("delivered");
    expect(done.costUsd).toBeGreaterThanOrEqual(5);
    expect(agents.calls.find((c) => c.station === "build")!.maxBudgetUsd).toBeCloseTo(3);
  });
});

describe("daemon with replacements", () => {
  const builder = () => fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/a.ts": "ok" }) });
  const factory = (over: Record<string, unknown>) => testFactory({ engine: "claude", level: "L2", isolation: "worktree", lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }], ...over });

  it("keeps taking jobs while a replacement is available", async () => {
    const ctx = factory({ fallback: ["codex"] });
    call(ctx.store, "claude", 1, usedUp("2099-01-01T00:00:00Z"), new Date());
    const job = requestWork(ctx, { text: "x" }).job;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("delivered");
  });

  it("waits when every engine is paused", async () => {
    const ctx = factory({ fallback: ["codex"], limits: { usdPerDay: 10 } });
    call(ctx.store, "claude", 1, usedUp("2099-01-01T00:00:00Z"), new Date());
    call(ctx.store, "codex", 10, api, new Date());
    const job = requestWork(ctx, { text: "x" }).job;
    await runDaemon(ctx, { once: true, pollMs: 10, agentRunner: () => builder().runner });
    expect(ctx.store.getJob(job.id)!.status).toBe("queued");
  });
});
