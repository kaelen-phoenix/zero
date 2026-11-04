import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgentRunner, quotaAttrs, type EngineExecute } from "../src/agent.js";
import { answer, requestWork, type FactoryContext } from "../src/app.js";
import { claudeResult } from "../src/engines/claude.js";
import type { EngineResult, QuotaReport } from "../src/engines/index.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { log } from "../src/log.js";
import type { Store } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { Tracer } from "../src/telemetry/tracer.js";
import { cleanup, fakeAgents, gitIn, gitRepo, simulatedBox, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const passes = `node -e "process.exit(0)"`;
const cut = { ok: false, text: "Reached maximum budget", budgetLimited: true };
const write = (req: { cwd: string }) => writeTree(req.cwd, { "src/health.ts": "export const status = 'ok';\n" });
const deps = (ctx: FactoryContext, runner: RunnerDeps["runAgent"]): RunnerDeps => ({ ...ctx, runAgent: runner });
const builds = (calls: { station: string; prompt: string; maxBudgetUsd?: number }[]) => calls.filter((c) => c.station === "build");

function factory(over: Record<string, unknown> = {}, now?: () => Date) {
  const repo = gitRepo();
  const ctx = testFactory({ level: "L2", isolation: "worktree", limits: { usdPerJob: 1 }, lines: [{ name: "demo", repo, verify: [passes] }], ...over }, now);
  return { ctx, repo };
}

const sdkResult = (over: Record<string, unknown>) => ({ type: "result", session_id: "s1", total_cost_usd: 0.42, ...over }) as unknown as SDKResultMessage;

describe("Claude result mapping", () => {
  it("marks a call stopped by its dollar cap", () => {
    expect(claudeResult(sdkResult({ subtype: "error_max_budget_usd", errors: [] }))).toMatchObject({ ok: false, budgetLimited: true, costUsd: 0.42 });
  });

  it("recognizes the budget text in the errors or the result", () => {
    expect(claudeResult(sdkResult({ subtype: "error_during_execution", errors: ["Reached maximum budget ($0.01)"] })).budgetLimited).toBe(true);
    expect(claudeResult(sdkResult({ subtype: "success", is_error: true, result: "Reached maximum budget ($0.01)" }))).toMatchObject({ ok: false, budgetLimited: true });
  });

  it("does not mark other errors or a success", () => {
    expect(claudeResult(sdkResult({ subtype: "error_max_turns", errors: [] })).budgetLimited).not.toBe(true);
    const ok = claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done", structured_output: { a: 1 } }));
    expect(ok).toMatchObject({ ok: true, text: "done", output: { a: 1 }, costUsd: 0.42, sessionId: "s1" });
    expect(ok.budgetLimited).not.toBe(true);
  });

  it("reports the only model of a success or an error", () => {
    const success = claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done", modelUsage: { "claude-opus-5-5": { costUSD: 0.4 } } }));
    expect(success).toMatchObject({ ok: true, model: "claude-opus-5-5" });
    const error = claudeResult(sdkResult({ subtype: "error_max_turns", errors: [], modelUsage: { "claude-sonnet-5-5": { costUSD: 0.1 } } }));
    expect(error).toMatchObject({ ok: false, model: "claude-sonnet-5-5" });
  });

  it("reports the model that cost the most, the first one on a tie", () => {
    const modelUsage = { "claude-haiku-5-5": { costUSD: 0.01 }, "claude-opus-5-5": { costUSD: 0.9 }, "claude-sonnet-5-5": { costUSD: 0.2 } };
    expect(claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done", modelUsage })).model).toBe("claude-opus-5-5");
    const tie = { "claude-sonnet-5-5": { costUSD: 0.2 }, "claude-opus-5-5": { costUSD: 0.2 } };
    expect(claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done", modelUsage: tie })).model).toBe("claude-sonnet-5-5");
  });

  it("reports no model without modelUsage or with an empty one", () => {
    const missing = claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done" }));
    expect(missing.ok).toBe(true);
    expect(missing.model).toBeUndefined();
    const empty = claudeResult(sdkResult({ subtype: "success", is_error: false, result: "done", modelUsage: {} }));
    expect(empty.ok).toBe(true);
    expect(empty.model).toBeUndefined();
  });
});

describe("agent runner", () => {
  it("passes the budget mark on", async () => {
    const ctx = testFactory({ engine: "claude", lines: [] });
    const execute: EngineExecute = async () => cut;
    const run = await createAgentRunner(ctx.config, { execute })({ station: "build", prompt: "p", cwd: tempDir(), trace: { tracer: ctx.tracer, jobId: "j1" } });
    expect(run).toMatchObject({ ok: false, budgetLimited: true });
    expect(ctx.store.spansForJob("j1").find((s) => s.name === AGENT_SPAN)!.attrs).toMatchObject({ "zero.budget.limited": true });
  });
});

describe("the model that answered", () => {
  afterEach(() => vi.restoreAllMocks());

  /** One review call: the model the station asks for and what the engine answers. */
  async function answered(requested: string | undefined, result: EngineResult, opts: { schema?: z.ZodType; traced?: boolean } = {}) {
    const ctx = testFactory({ engine: "claude", lines: [], ...(requested && { stations: { review: { model: requested } } }) });
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const execute: EngineExecute = async () => result;
    const run = await createAgentRunner(ctx.config, { execute })({
      station: "review",
      prompt: "p",
      cwd: tempDir(),
      ...(opts.schema && { schema: opts.schema }),
      ...(opts.traced !== false && { trace: { tracer: ctx.tracer, jobId: "j1" } }),
    });
    const notices = info.mock.calls.filter(([, fields]) => fields && "responded" in fields);
    return { run, notices, span: ctx.store.spansForJob("j1").find((s) => s.name === AGENT_SPAN) };
  }

  it("records it next to the requested model and logs the difference", async () => {
    const { span, notices } = await answered("claude-sonnet-5-5", { ok: true, text: "ok", model: "claude-opus-5-5" });
    expect(span!.attrs).toMatchObject({ "gen_ai.request.model": "claude-sonnet-5-5", "gen_ai.response.model": "claude-opus-5-5" });
    expect(notices).toHaveLength(1);
    expect(notices[0]![1]).toMatchObject({ requested: "claude-sonnet-5-5", responded: "claude-opus-5-5" });
  });

  it("leaves the attribute and the notice out when the engine does not report it", async () => {
    const { span, notices } = await answered("claude-sonnet-5-5", { ok: true, text: "ok" });
    expect(span!.status).toBe("ok");
    expect(span!.attrs).not.toHaveProperty("gen_ai.response.model");
    expect(notices).toEqual([]);
  });

  it("records it on a failed call", async () => {
    const { span } = await answered("claude-sonnet-5-5", { ok: false, text: "error_max_turns", model: "claude-opus-5-5" });
    expect(span!.status).toBe("error");
    expect(span!.attrs).toMatchObject({ "gen_ai.response.model": "claude-opus-5-5" });
  });

  it("records it when the answer fails the schema", async () => {
    const { run, span } = await answered(undefined, { ok: true, text: "ok", output: { a: "no" }, model: "claude-opus-5-5" }, { schema: z.object({ a: z.number() }) });
    expect(run.ok).toBe(false);
    expect(span!.status).toBe("error");
    expect(span!.attrs).toMatchObject({ "gen_ai.response.model": "claude-opus-5-5" });
  });

  it("logs nothing when both models match", async () => {
    const { span, notices } = await answered("claude-opus-5-5", { ok: true, text: "ok", model: "claude-opus-5-5" });
    expect(span!.attrs).toMatchObject({ "gen_ai.response.model": "claude-opus-5-5" });
    expect(notices).toEqual([]);
  });

  it("logs nothing when no model was requested, and still records it", async () => {
    const { span, notices } = await answered(undefined, { ok: true, text: "ok", model: "claude-opus-5-5" });
    expect(span!.attrs).toMatchObject({ "gen_ai.response.model": "claude-opus-5-5" });
    expect(notices).toEqual([]);
  });

  it("logs the difference without a trace", async () => {
    const { span, notices } = await answered("claude-sonnet-5-5", { ok: true, text: "ok", model: "claude-opus-5-5" }, { traced: false });
    expect(span).toBeUndefined();
    expect(notices).toHaveLength(1);
  });
});

describe("a build cut short by the job budget", () => {
  it("asks the owner at L2 without counting the attempt", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ build: (req) => (writeTree(req.cwd, { "half.ts": "half\n" }), cut) });
    const { job } = requestWork(ctx, { text: "health" });
    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting).toMatchObject({ status: "waiting", checkpoint: "spec", attempt: 0, question: { kind: "budget-exceeded", data: { extraUsd: 1 } } });
    expect(waiting.feedback ?? "").not.toContain("más chicos");
    expect(agents.count.build).toBe(1);
  });

  it("fails by budget at L3 without burning the attempts", async () => {
    const { ctx } = factory({ level: "L3", isolation: "container" });
    const agents = fakeAgents({ build: () => cut });
    const { job } = requestWork(ctx, { text: "health" });
    const failed = await runJob(job.id, { ...deps(ctx, agents.runner), box: simulatedBox(agents.runner).box });
    expect(failed).toMatchObject({ status: "failed", reason: expect.stringMatching(/presupuesto/) });
    expect(failed.reason).not.toContain("Se agotaron los 3 intentos");
    expect(agents.count.build).toBe(1);
  });

  it("resumes from the spec once the owner approves more budget", async () => {
    const { ctx, repo } = factory();
    const agents = fakeAgents({ build: (req, n) => (n === 1 ? (writeTree(req.cwd, { "half.ts": "half\n" }), cut) : (write(req), {})) });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect((await answer(ctx, job.id, "approve")).status).toBe("queued");
    const done = await runJob(job.id, deps(ctx, agents.runner));
    expect(done).toMatchObject({ status: "delivered", attempt: 1 });
    expect(agents.count).toMatchObject({ spec: 1, build: 2 });
    expect(builds(agents.calls)[1]!.prompt).not.toContain("Feedback from the previous attempt");
    expect(gitIn(repo, "ls-tree", "-r", "--name-only", "main")).not.toContain("half.ts");
  });
});

describe("minimum budget to start an attempt", () => {
  it("does not start an attempt with less than the minimum left", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ spec: () => ({ costUsd: 0.95 }), build: write });
    const { job } = requestWork(ctx, { text: "health" });
    const waiting = await runJob(job.id, deps(ctx, agents.runner));
    expect(waiting).toMatchObject({ status: "waiting", question: { kind: "budget-exceeded" } });
    expect(agents.count.build).toBeUndefined();
  });

  it("starts it when enough is left, capped at what remains", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ spec: () => ({ costUsd: 0.5 }), build: write }, 0);
    const { job } = requestWork(ctx, { text: "health" });
    expect((await runJob(job.id, deps(ctx, agents.runner))).status).toBe("delivered");
    expect(builds(agents.calls)[0]!.maxBudgetUsd).toBeCloseTo(0.5);
  });

  it("does not stop a build on a subscription", async () => {
    const NOW = new Date(2026, 9, 29, 15, 0);
    const fine: QuotaReport = { billing: "subscription", windows: [{ name: "five_hour", label: "5 horas", utilization: 0.2, status: "ok", resetsAt: new Date(2026, 9, 29, 23, 20).toISOString() }] };
    const call = (store: Store, engine: string, quota: QuotaReport) =>
      new Tracer(store, () => NOW).start(AGENT_SPAN, { attrs: { "zero.engine": engine } }).end("ok", { "zero.cost.usd": 0, ...quotaAttrs(quota) });
    const { ctx } = factory({ engine: "claude", stations: { spec: { engine: "codex" } } }, () => NOW);
    call(ctx.store, "claude", fine);
    call(ctx.store, "codex", { billing: "api", windows: [] });
    const agents = fakeAgents({ spec: () => ({ costUsd: 5 }), build: write });
    const { job } = requestWork(ctx, { text: "health" });
    await runJob(job.id, deps(ctx, agents.runner));
    expect(builds(agents.calls)).toHaveLength(1);
    expect(builds(agents.calls)[0]).toMatchObject({ engine: { name: "claude" }, maxBudgetUsd: undefined });
  });
});
