import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentName, quotaAttrs, type AgentRequest } from "../src/agent.js";
import { ANDON_KEY, requestPerformanceAudit, waitPerformanceAudit } from "../src/app.js";
import { ZERO_AGENTS_DIR } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import {
  acceptAudit,
  closeInterruptedAudit,
  PERFORMANCE_AUDIT_REQUEST_KEY,
  PERFORMANCE_AUDIT_RUN_KEY,
  performanceAuditPass,
  PROPOSALS_PER_AUDIT,
  readPerformanceAuditRequest,
  readPerformanceAuditRun,
} from "../src/line/performance.js";
import { proposalAutonomy, promotePending } from "../src/line/scout.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const at = (h: number, m = 0) => new Date(2026, 10, 26, h, m);
const factory = (over: Record<string, unknown> = {}, now = at(14)) => testFactory({ isolation: "worktree", lines: [{ name: "web", repo: gitRepo({ "src/db.ts": "export const q = 1;\n" }) }], ...over }, () => now);
type Ctx = ReturnType<typeof factory>;

const spend = (ctx: Ctx, usd: number) =>
  ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": usd, ...quotaAttrs({ billing: "api", windows: [] }) });

const idea = (title: string, impact: "high" | "medium" | "low", over: Record<string, unknown> = {}) => ({
  title,
  control: "PERF-01",
  impact,
  why: `${title} reads every order on each request`,
  change: "add LIMIT and a cursor to the orders query",
  estimatedUsd: 0.5,
  paths: ["src/db.ts"],
  ...over,
});
const auditing = (proposals: unknown[], onCall?: (req: AgentRequest<any>) => void) =>
  fakeAgents({ "performance-audit": (req) => (onCall?.(req), { output: { proposals } }) });

function ask(ctx: Ctx, line = "web", now = at(13)) {
  const r = requestPerformanceAudit(ctx, line, now);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("asking for a performance audit", () => {
  it("stores one pending request naming the line", () => {
    const ctx = factory();
    expect(requestPerformanceAudit(ctx, "web", at(13))).toMatchObject({ ok: true, requestedAt: at(13).toISOString(), text: expect.stringContaining("web") });
    expect(readPerformanceAuditRequest(ctx.store)).toEqual({ requestedAt: at(13).toISOString(), line: "web" });
  });

  it("refuses a second one, and leaves the first as it was", () => {
    const ctx = factory();
    ask(ctx);
    const stored = ctx.store.getKv(PERFORMANCE_AUDIT_REQUEST_KEY);
    expect(requestPerformanceAudit(ctx, "web", at(15))).toMatchObject({ ok: false, reason: expect.stringContaining("pendiente") });
    expect(ctx.store.getKv(PERFORMANCE_AUDIT_REQUEST_KEY)).toBe(stored);
  });

  it("refuses with the andon on, over the budget, without a line and for an unknown or a package's line, writing nothing", () => {
    const refused = (ctx: Ctx, reason: RegExp, line = "web") => {
      expect(requestPerformanceAudit(ctx, line, at(14))).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
      expect(ctx.store.getKv(PERFORMANCE_AUDIT_REQUEST_KEY)).toBeUndefined();
    };
    const andon = factory();
    andon.store.setKv(ANDON_KEY, "on");
    refused(andon, /andon/);
    const spent = factory({ limits: { usdPerDay: 1 } });
    spend(spent, 5);
    refused(spent, /presupuesto/);
    refused(factory(), /falta la línea/, " ");
    refused(factory(), /no existe la línea "otra"/, "otra");
    const pack = factory();
    pack.config.lines.push({ ...pack.config.lines[0]!, name: "social", package: "redes" });
    refused(pack, /paquete/, "social");
  });
});

describe("the audit's proposals", () => {
  it("are sorted from high to low impact, capped, without repeated titles or protected paths", () => {
    const ideas = [idea("Low one", "low"), idea("High one", "high"), idea("Medium one", "medium"), idea("high ONE", "high"), idea("Taken", "high"), idea("Workflow", "high", { paths: [".github/workflows/ci.yml"] })];
    expect(acceptAudit(ideas, ["Taken"], [".github/**"], { repo: "/w" }).map((i) => i.title)).toEqual(["High one", "Medium one", "Low one"]);
    const many = Array.from({ length: PROPOSALS_PER_AUDIT + 2 }, (_, i) => idea(`Fix ${i}`, "medium"));
    expect(acceptAudit(many, [], [], { repo: "/w" })).toHaveLength(PROPOSALS_PER_AUDIT);
  });
});

describe("the audit pass", () => {
  it("stores the line's proposals as pending, ordered high, medium, low, with origin performance and the impact in why", async () => {
    const ctx = factory();
    ask(ctx);
    const agents = auditing([idea("Paginate the order list", "low"), idea("Index orders by customer", "high", { control: "PERF-02" }), idea("Cache the catalog", "medium", { control: "PERF-04" })]);
    await performanceAuditPass(ctx, agents.runner, at(14));
    const stored = ctx.store.listProposals({ line: "web" });
    expect(stored.map((p) => p.title)).toEqual(["Index orders by customer", "Cache the catalog", "Paginate the order list"]);
    for (const p of stored) expect(p).toMatchObject({ origin: "performance", status: "pending", change: "add LIMIT and a cursor to the orders query", paths: ["src/db.ts"] });
    expect(stored.map((p) => p.why.split("\n")[0])).toEqual(["Impacto alto · PERF-02 · src/db.ts.", "Impacto medio · PERF-04 · src/db.ts.", "Impacto bajo · PERF-01 · src/db.ts."]);
  });

  it("makes one read-only call with zero's audit instructions and skill, even when the agent writes a file", async () => {
    const ctx = factory();
    ask(ctx);
    const agents = auditing([idea("Index orders", "high")], (req) => writeTree(req.cwd, { "scratch.txt": "x" }));
    await performanceAuditPass(ctx, agents.runner, at(14));
    expect(agents.calls.map(agentName)).toEqual(["performance-audit"]);
    const call = agents.calls[0]!;
    expect(call.cwd).toBe(ctx.config.lines[0]!.repo);
    expect(call.custom).toMatchObject({ name: "performance-audit", access: "read", skills: ["zero:performance"] });
    expect(call.custom!.instructions).toBe(readFileSync(join(ZERO_AGENTS_DIR, "performance-audit.md"), "utf8"));
    expect(call.prompt).toContain(".github/**");
  });

  it("drops a repeated title and a proposal that touches a protected path", async () => {
    const ctx = factory();
    ctx.store.createProposal({ line: "web", title: "Index orders by customer", why: "w", change: "c", estimatedUsd: 1, paths: [] });
    ask(ctx);
    const agents = auditing([idea("Index orders by customer", "high"), idea("Cache in CI", "high", { paths: [".github/workflows/ci.yml"] }), idea("Cache the catalog", "medium")]);
    await performanceAuditPass(ctx, agents.runner, at(14));
    expect(ctx.store.listProposals({ line: "web" }).map((p) => p.title)).toEqual(["Index orders by customer", "Cache the catalog"]);
    expect(agents.calls[0]!.prompt).toContain("- Index orders by customer");
  });

  it("clears the request and records the run with its times, outcome and proposals", async () => {
    const ctx = factory();
    const r = ask(ctx);
    await performanceAuditPass(ctx, auditing([idea("Index orders", "high"), idea("Cache the catalog", "low")]).runner, at(14));
    expect(ctx.store.getKv(PERFORMANCE_AUDIT_REQUEST_KEY)).toBeUndefined();
    expect(readPerformanceAuditRun(ctx.store)).toMatchObject({ asked: r.requestedAt, line: "web", startedAt: expect.any(String), endedAt: expect.any(String), outcome: "ok", proposals: 2 });
    expect((await waitPerformanceAudit(ctx, r.requestedAt, { timeoutMs: 0 })).text).toContain("2 propuestas");
  });

  it("records a failed call without proposals", async () => {
    const ctx = factory();
    ask(ctx);
    await performanceAuditPass(ctx, fakeAgents({ "performance-audit": () => ({ ok: false, text: "boom" }) }).runner, at(14));
    expect(readPerformanceAuditRun(ctx.store)).toMatchObject({ outcome: "failed", proposals: 0 });
    expect(ctx.store.listProposals({ line: "web" })).toEqual([]);
  });

  it("leaves the request pending with the andon on, and runs nothing without one", async () => {
    const ctx = factory();
    const agents = auditing([]);
    await performanceAuditPass(ctx, agents.runner, at(14));
    ask(ctx);
    ctx.store.setKv(ANDON_KEY, "on");
    await performanceAuditPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readPerformanceAuditRequest(ctx.store)).toBeDefined();
  });

  it("records a line that went away as not run", async () => {
    const ctx = factory();
    ask(ctx);
    ctx.config.lines = [];
    const agents = auditing([]);
    await performanceAuditPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readPerformanceAuditRun(ctx.store)).toMatchObject({ outcome: "not-run", reason: expect.stringContaining("no existe") });
  });

  it("closes the record a crashed daemon left", () => {
    const ctx = factory();
    ctx.store.setKv(PERFORMANCE_AUDIT_RUN_KEY, JSON.stringify({ asked: "x", line: "web", startedAt: at(13).toISOString(), proposals: 0 }));
    closeInterruptedAudit(ctx, at(14));
    expect(readPerformanceAuditRun(ctx.store)).toMatchObject({ outcome: "stopped", endedAt: at(14).toISOString() });
  });
});

describe("the audit never builds without approval", () => {
  it("keeps its proposals pending on a line whose autonomy is auto, and opens no job", async () => {
    const ctx = factory({ nightShift: { autonomy: "auto" } });
    ask(ctx);
    await performanceAuditPass(ctx, auditing([idea("Index orders", "high")]).runner, at(14));
    const [proposal] = ctx.store.listProposals({ line: "web" });
    expect(proposalAutonomy(ctx.config, ctx.config.lines[0]!, proposal!)).toBe("propose");
    expect(promotePending(ctx, at(14))).toBe(0);
    expect(ctx.store.getProposal(proposal!.id)).toMatchObject({ status: "pending" });
    expect(ctx.store.listJobs({ limit: -1 })).toEqual([]);
  });
});

describe("the daemon and the command", () => {
  it("runs a pending audit in its own pass", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, "web", now);
    const agents = auditing([idea("Index orders", "high")]);
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, performanceAudit: true, agentRunner: () => agents.runner });
    expect(agents.calls.map(agentName)).toEqual(["performance-audit"]);
    expect(readPerformanceAuditRun(ctx.store)).toMatchObject({ outcome: "ok", proposals: 1 });
  });

  it("leaves it pending in a once run without the option", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, "web", now);
    const agents = auditing([]);
    await runDaemon(ctx, { once: true, pollMs: 10, panel: false, agentRunner: () => agents.runner });
    expect(agents.calls).toHaveLength(0);
    expect(readPerformanceAuditRequest(ctx.store)).toBeDefined();
  });

  it("zero rendimiento is in the usage, and refuses with the andon on", () => {
    const ctx = factory();
    ctx.store.setKv(ANDON_KEY, "on");
    const zero = (...args: string[]) => {
      const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
      return { code: r.status, output: r.stdout + r.stderr };
    };
    expect(zero("help").output).toContain("zero rendimiento <línea>");
    const r = zero("rendimiento", "web");
    expect(r.code).toBe(1);
    expect(r.output).toContain("andon");
    expect(readPerformanceAuditRequest(ctx.store)).toBeUndefined();
  }, 120_000);

  it("zero rendimiento starts the factory and waits for the audit", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    const command = cli.slice(cli.indexOf('case "rendimiento"'), cli.indexOf('case "resume"'));
    expect(command).toContain("await ensureDaemon(ctx)");
    expect(command).toContain("waitPerformanceAudit(ctx, r.requestedAt, { timeoutMs: STATION_WAIT_MS })");
  });
});
