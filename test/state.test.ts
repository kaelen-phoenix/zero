import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store.js";
import { computeMetrics, dailyBudgetReached, spentToday, AGENT_SPAN, APPROVAL_SPAN } from "../src/telemetry/metrics.js";
import { renderTrace, Tracer } from "../src/telemetry/tracer.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("store", () => {
  it("creates, updates and finishes jobs", () => {
    const store = new Store(":memory:");
    const job = store.createJob({ line: "api", kind: "request", request: "add health", budgetUsd: 3 });
    expect(job).toMatchObject({ status: "queued", checkpoint: "none", attempt: 0, costUsd: 0, approvals: {} });
    const updated = store.updateJob(job.id, { status: "running", station: "build", approvals: { spec: true }, spec: { title: "x" } });
    expect(updated).toMatchObject({ status: "running", station: "build", approvals: { spec: true }, spec: { title: "x" } });
    const cleared = store.updateJob(job.id, { station: null });
    expect(cleared.station).toBeUndefined();
    const done = store.finishJob(job.id, "delivered");
    expect(done.status).toBe("delivered");
    expect(done.finishedAt).toBeTruthy();
    expect(store.listJobs({ status: ["queued", "running"] })).toEqual([]);
  });

  it("shares state between connections to the same file", () => {
    const path = join(tempDir(), "state.db");
    const a = new Store(path);
    const b = new Store(path);
    const job = a.createJob({ line: "api", kind: "request", request: "x", budgetUsd: 1 });
    expect(b.getJob(job.id)?.request).toBe("x");
    b.setKv("andon", "on");
    expect(a.getKv("andon")).toBe("on");
    a.close();
    b.close();
  });

  it("adds the proposal issue columns to factories created before them", () => {
    const path = join(tempDir(), "state.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE proposals (id TEXT PRIMARY KEY, line TEXT NOT NULL, title TEXT NOT NULL, why TEXT NOT NULL, change TEXT NOT NULL, estimated_usd REAL NOT NULL DEFAULT 0, paths TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, note TEXT, job_id TEXT)");
    old.close();
    const store = new Store(path);
    const p = store.createProposal({ line: "api", title: "x", why: "y", change: "z", estimatedUsd: 1, paths: [] });
    store.setProposalIssue(p.id, { number: 3, url: "https://github.com/a/b/issues/3" });
    store.updateProposal(p.id, { status: "rejected", note: "no" });
    store.markProposalIssueTold(p.id, "rejected");
    expect(store.getProposal(p.id)).toMatchObject({ issueNumber: 3, issueUrl: "https://github.com/a/b/issues/3", issueTold: "rejected" });
    store.close();
  });

  it("adds the research note issue columns to factories created before them", () => {
    const path = join(tempDir(), "state.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE research_notes (id TEXT PRIMARY KEY, line TEXT NOT NULL, topic TEXT NOT NULL, findings TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', serves TEXT NOT NULL DEFAULT '', maturity TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
    old.close();
    const store = new Store(path);
    const n = store.createResearchNote({ line: "api", topic: "t", findings: "f", sources: ["https://a.b"], serves: "s", maturity: "m" });
    expect(store.getResearchNote(n.id)!.issueNumber).toBeUndefined();
    store.setResearchNoteIssue(n.id, { number: 4, url: "https://github.com/a/b/issues/4" });
    expect(store.getResearchNote(n.id)).toMatchObject({ issueNumber: 4, issueUrl: "https://github.com/a/b/issues/4" });
    store.close();
  });

  it("lists a line's rejections, most recently decided first", () => {
    let clock = new Date("2030-01-01T00:00:00Z");
    const store = new Store(":memory:", () => clock);
    const make = (title: string, line = "api") => store.createProposal({ line, title, why: "y", change: "z", estimatedUsd: 1, paths: [] });
    const [a, b, other] = [make("a"), make("b"), make("d", "web")];
    make("c");
    for (const p of [b, a, other]) {
      clock = new Date(clock.getTime() + 60_000);
      store.updateProposal(p!.id, { status: "rejected" });
    }
    expect(store.recentRejected("api", 20).map((p) => p.title)).toEqual(["a", "b"]);
    expect(store.recentRejected("api", 1).map((p) => p.title)).toEqual(["a"]);
  });
});

describe("tracing and metrics", () => {
  const at = (iso: string) => () => new Date(iso);

  it("renders a job trace as a tree with durations and cost", () => {
    let clock = Date.parse("2026-10-26T10:00:00Z");
    const now = () => new Date((clock += 1000));
    const store = new Store(":memory:", now);
    const tracer = new Tracer(store, now);
    const job = tracer.start("zero.job", { id: "job-1", jobId: "1" });
    const station = tracer.start("zero.station.build", { jobId: "1", parentId: job.id, attrs: { "zero.station": "build" } });
    const agent = tracer.start(AGENT_SPAN, { jobId: "1", parentId: station.id, attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude" } });
    agent.end("ok", { "zero.cost.usd": 0.25, "zero.cost.source": "reported" });
    station.end();
    job.end("ok", { "zero.outcome": "delivered" });
    const out = renderTrace(store.spansForJob("1"));
    expect(out).toContain("✓ zero.job");
    expect(out).toContain("  ✓ zero.station.build");
    expect(out).toMatch(/    ✓ gen_ai\.invoke_agent  1\.0 s  build vía claude · \$0\.250/);
  });

  it("computes metrics once from jobs and spans", () => {
    const store = new Store(":memory:", at("2026-10-26T10:00:00Z"));
    const tracer = new Tracer(store, at("2026-10-26T10:00:00Z"));
    const a = store.createJob({ line: "api", kind: "request", request: "a", budgetUsd: 3 });
    const b = store.createJob({ line: "api", kind: "request", request: "b", budgetUsd: 3 });
    const c = store.createJob({ line: "api", kind: "request", request: "c", budgetUsd: 3 });
    store.finishJob(a.id, "delivered");
    store.finishJob(b.id, "failed");
    store.finishJob(c.id, "stopped");
    tracer.start(AGENT_SPAN, { jobId: a.id, attrs: { "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 1.5, "zero.cost.source": "reported" });
    tracer.start(AGENT_SPAN, { jobId: b.id, attrs: { "zero.engine": "codex" } }).end("ok", { "zero.cost.usd": 0, "zero.cost.source": "unknown" });
    tracer.start(APPROVAL_SPAN, { jobId: a.id }).end("ok");

    const m = computeMetrics(store, new Date("2026-10-26T00:00:00Z"), new Date("2026-10-27T00:00:00Z"));
    expect(m).toMatchObject({ delivered: 1, failed: 1, stopped: 1, successRate: 0.5, costUsd: 1.5, costPerDeliveryUsd: 1.5, unknownCostCalls: 1 });
    expect(m.byEngine).toEqual({ claude: { calls: 1, costUsd: 1.5, unknownCostCalls: 0 }, codex: { calls: 1, costUsd: 0, unknownCostCalls: 1 } });
    expect(spentToday(store, new Date("2026-10-26T12:00:00Z"))).toBe(1.5);
  });

  it("treats a daily limit of 0 as free engines only", () => {
    expect(dailyBudgetReached(0, 0)).toBe(false);
    expect(dailyBudgetReached(0.01, 0)).toBe(true);
    expect(dailyBudgetReached(9.99, 10)).toBe(false);
    expect(dailyBudgetReached(10, 10)).toBe(true);
  });
});
