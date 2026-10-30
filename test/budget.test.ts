import { afterEach, describe, expect, it } from "vitest";
import { quotaAttrs } from "../src/agent.js";
import { factoryStatus, requestWork } from "../src/app.js";
import { budgetState } from "../src/budget.js";
import { parseFactory } from "../src/config.js";
import { claudeQuota } from "../src/engines/claude.js";
import type { QuotaReport } from "../src/engines/index.js";
import { formatStatus } from "../src/format.js";
import { runJob } from "../src/line/runner.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { Tracer } from "../src/telemetry/tracer.js";
import { cleanup, fakeAgents, gitRepo, testFactory, testStore, writeTree } from "./helpers.js";

afterEach(cleanup);

const at = (iso: string) => () => new Date(iso);
const config = (limits: Record<string, unknown> = {}) => parseFactory(`engine: claude\nlimits: ${JSON.stringify(limits)}\nlines: []\n`);

const plan = (over: Partial<QuotaReport> = {}): QuotaReport => ({
  billing: "subscription",
  windows: [
    { name: "five_hour", label: "5 horas", utilization: 0.45, status: "ok", resetsAt: "2026-10-29T21:30:00Z" },
    { name: "seven_day", label: "semana", utilization: 0.32, status: "ok", resetsAt: "2026-11-02T12:00:00Z" },
  ],
  ...over,
});

function call(tracer: Tracer, costUsd: number, quota?: QuotaReport, engine = "claude") {
  tracer.start(AGENT_SPAN, { attrs: { "zero.engine": engine } }).end("ok", { "zero.cost.usd": costUsd, ...quotaAttrs(quota) });
}

describe("claude plan readings", () => {
  it("reads every window of a subscription from a rate limit event", () => {
    // As the SDK sent it on a real claude.ai login.
    const info = {
      status: "allowed",
      resetsAt: 1793326800,
      rateLimitType: "five_hour",
      overageStatus: "rejected",
      isUsingOverage: false,
      unifiedWindows: { five_hour: { utilization: 0, resetsAt: 1793326800, status: "allowed" }, seven_day: { utilization: 0.1, resetsAt: 1793498400, status: "allowed" } },
    } as never;
    expect(claudeQuota("none", info)).toEqual({
      billing: "subscription",
      windows: [
        { name: "five_hour", label: "5 horas", utilization: 0, status: "ok", resetsAt: new Date(1793326800_000).toISOString() },
        { name: "seven_day", label: "semana", utilization: 0.1, status: "ok", resetsAt: new Date(1793498400_000).toISOString() },
      ],
    });
  });

  it("marks a refused call and tells an API key from a subscription", () => {
    const refused = claudeQuota("none", { status: "rejected", rateLimitType: "five_hour", resetsAt: 1793326800, utilization: 100 } as never);
    expect(refused).toMatchObject({ billing: "subscription", limited: true, windows: [{ name: "five_hour", status: "exhausted", utilization: 1 }] });
    expect(claudeQuota("ANTHROPIC_API_KEY", undefined)).toEqual({ billing: "api", windows: [] });
    expect(claudeQuota(undefined, undefined)).toBeUndefined();
  });
});

describe("budget", () => {
  it("does not stop a subscription at the dollar cap, whose costs are only estimates", () => {
    const store = testStore();
    const tracer = new Tracer(store, at("2026-10-29T15:00:00Z"));
    call(tracer, 12, plan());
    const b = budgetState(store, config({ usdPerDay: 10 }), new Date("2026-10-29T15:05:00Z"));
    expect(b).toMatchObject({ billing: "subscription", reached: false, spentUsd: 0, estimatedUsd: 12 });
    expect(b.windows.map((w) => w.name)).toEqual(["five_hour", "seven_day"]);
  });

  it("pauses while a window is used up and resumes when it renews", () => {
    const store = testStore();
    const tracer = new Tracer(store, at("2026-10-29T15:00:00Z"));
    call(tracer, 1, plan({ limited: true, windows: [{ name: "five_hour", label: "5 horas", utilization: 1, status: "exhausted", resetsAt: "2026-10-29T18:00:00Z" }] }));
    expect(budgetState(store, config(), new Date("2026-10-29T16:00:00Z"))).toMatchObject({ reached: true, until: "2026-10-29T18:00:00.000Z", reason: expect.stringMatching(/todo el cupo de 5 horas/) });
    expect(budgetState(store, config(), new Date("2026-10-29T18:00:01Z"))).toMatchObject({ reached: false, windows: [] });
  });

  it("leaves the owner's reserve unused", () => {
    const store = testStore();
    call(new Tracer(store, at("2026-10-29T15:00:00Z")), 1, plan({ windows: [{ name: "seven_day", label: "semana", utilization: 0.85, status: "ok", resetsAt: "2026-11-02T12:00:00Z" }] }));
    const now = new Date("2026-10-29T15:05:00Z");
    expect(budgetState(store, config(), now).reached).toBe(false);
    expect(budgetState(store, config({ reservePercent: 20 }), now)).toMatchObject({ reached: true, until: "2026-11-02T12:00:00.000Z", reason: expect.stringMatching(/80% del cupo de semana/) });
  });

  it("keeps the daily dollar cap for calls billed per use", () => {
    const store = testStore();
    const tracer = new Tracer(store, at("2026-10-29T15:00:00Z"));
    call(tracer, 6, { billing: "api", windows: [] });
    call(tracer, 4);
    expect(budgetState(store, config({ usdPerDay: 10 }), new Date("2026-10-29T15:05:00Z"))).toMatchObject({ billing: "api", reached: true, spentUsd: 10 });
  });

  it("bills calls made before engines reported their plan like the engine's latest reading", () => {
    const store = testStore();
    const tracer = new Tracer(store, at("2026-10-29T15:00:00Z"));
    call(tracer, 11);
    const now = new Date("2026-10-29T15:05:00Z");
    // Unknown until the next call: it is let through to find out.
    expect(budgetState(store, config({ usdPerDay: 10 }), now)).toMatchObject({ billing: "unknown", reached: false, spentUsd: 0, estimatedUsd: 11 });
    call(tracer, 0.01, plan());
    expect(budgetState(store, config({ usdPerDay: 10 }), now)).toMatchObject({ billing: "subscription", reached: false, spentUsd: 0 });

    const paid = testStore();
    const t2 = new Tracer(paid, at("2026-10-29T15:00:00Z"));
    call(t2, 11);
    call(t2, 0.01, { billing: "api", windows: [] });
    expect(budgetState(paid, config({ usdPerDay: 10 }), now)).toMatchObject({ billing: "api", reached: true });
  });

  it("shows the plan instead of dollars in the status", () => {
    const ctx = testFactory({ lines: [] }, at("2026-10-29T15:00:00Z"));
    call(ctx.tracer, 11.16, plan());
    const text = formatStatus(factoryStatus(ctx));
    expect(text).toMatch(/Suscripción: 5 horas al 45% \(se renueva .+\) · semana al 32% \(se renueva .+\)/);
    expect(text).toContain("costo estimado hoy $11.16 (no se cobra)");
    expect(text).not.toContain("ALCANZADO");
  });
});

describe("production line on a subscription", () => {
  function setup() {
    const repo = gitRepo();
    const ctx = testFactory({ engine: "fake", level: "L2", isolation: "worktree", limits: { usdPerJob: 0.15 }, lines: [{ name: "demo", repo, verify: [`node -e "process.exit(0)"`] }] });
    return ctx;
  }
  const write = (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });

  it("has no dollar cap per job", async () => {
    const ctx = setup();
    const agents = fakeAgents({ spec: () => ({ quota: plan() }), build: (req) => (write(req), { quota: plan() }) });
    const { job } = requestWork(ctx, { text: "x" });
    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done.status).toBe("delivered");
    expect(done.costUsd).toBeGreaterThan(0.15);
    expect(agents.calls.filter((c) => c.station !== "spec").every((c) => c.maxBudgetUsd === undefined)).toBe(true);
  });

  it("puts a job cut short by the plan back in the queue without losing the attempt", async () => {
    const ctx = setup();
    const used = plan({ limited: true, windows: [{ name: "five_hour", label: "5 horas", utilization: 1, status: "exhausted", resetsAt: "2099-01-01T00:00:00Z" }] });
    const agents = fakeAgents({ spec: () => ({ quota: plan() }), build: (req, n) => (n === 1 ? { ok: false, text: "rate limited", quota: used } : (write(req), { quota: plan() })) });
    const { job } = requestWork(ctx, { text: "x" });

    const parked = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(parked).toMatchObject({ status: "queued", attempt: 0, checkpoint: "spec" });
    expect(budgetState(ctx.store, ctx.config).reached).toBe(true);

    const done = await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count.spec).toBe(1);
  });
});
