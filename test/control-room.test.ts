import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, CONTROL_STATIONS, controlRoomView, DAEMON_KEY, type FactoryContext } from "../src/app.js";
import { quotaAttrs } from "../src/agent.js";
import type { QuotaReport } from "../src/engines/index.js";
import { unjamKey, type Diagnosis } from "../src/line/unjam.js";
import type { SpanRow } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

/** Noon, local time; the clock the factory reads. */
const NOON = new Date(2026, 10, 9, 12, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(NOON.getTime() - ms);

function factory(over: Record<string, unknown> = {}) {
  const clock = { at: NOON };
  const ctx = testFactory({ level: "L2", isolation: "worktree", engine: "claude", lines: [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }], ...over }, () => clock.at);
  // A live heartbeat: this process.
  ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid: process.pid, beatAt: NOON.toISOString() }));
  return { ctx, clock };
}

type Clock = { at: Date };

/** A job created at `at`; with a `status` it ends `endAfter` later. */
function job(ctx: FactoryContext, clock: Clock, at: Date, status?: "delivered" | "failed" | "stopped" | "queued" | "running" | "waiting", line = "tienda", endAfter = MIN) {
  clock.at = at;
  const j = ctx.store.createJob({ line, kind: "request", request: `pedido ${at.toISOString()}`, budgetUsd: 5 });
  let out = j;
  if (status === "running" || status === "waiting") out = ctx.store.updateJob(j.id, { status });
  else if (status && status !== "queued") {
    clock.at = new Date(at.getTime() + endAfter);
    out = ctx.store.finishJob(j.id, status);
  }
  clock.at = NOON;
  return out;
}

let seq = 0;
function span(ctx: FactoryContext, over: Partial<SpanRow> & { minutes?: number; open?: boolean }) {
  const start = over.start ?? ago(HOUR).toISOString();
  const end = over.open ? undefined : over.end ?? new Date(Date.parse(start) + (over.minutes ?? 1) * MIN).toISOString();
  const { minutes: _m, open: _o, ...rest } = over;
  ctx.store.insertSpan({ id: `s${++seq}`, name: AGENT_SPAN, ...(end && { status: "ok" as const }), ...rest, start, end, attrs: over.attrs ?? {} });
}

describe("control room topbar", () => {
  it("counts the stored jobs", () => {
    const { ctx, clock } = factory();
    job(ctx, clock, ago(10 * MIN), "queued");
    job(ctx, clock, ago(9 * MIN), "queued");
    job(ctx, clock, ago(8 * MIN), "running");
    job(ctx, clock, ago(7 * MIN), "waiting");
    job(ctx, clock, ago(2 * HOUR), "delivered");
    job(ctx, clock, ago(2 * HOUR), "failed");
    const v = controlRoomView(ctx, NOON);
    expect(v.topbar).toMatchObject({ queued: 2, running: 1, waiting: 1, delivered: 1, failed: 1, daemon: "running", daemonTone: "ok" });
    expect(v.clock).toBe("12:00:00");
  });

  it("shows the day's real cost", () => {
    const { ctx } = factory();
    const api: QuotaReport = { billing: "api", windows: [] };
    span(ctx, { start: ago(2 * HOUR).toISOString(), attrs: { "zero.engine": "claude", "zero.cost.usd": 1, ...quotaAttrs(api) } });
    span(ctx, { start: ago(HOUR).toISOString(), attrs: { "zero.engine": "claude", "zero.cost.usd": 0.25, ...quotaAttrs(api) } });
    expect(controlRoomView(ctx, NOON).topbar.spentUsd).toBeCloseTo(1.25);
  });

  it("marks a crashed daemon in red", () => {
    const { ctx } = factory();
    ctx.store.setKv(DAEMON_KEY, JSON.stringify({ pid: spawnSync(process.execPath, ["-e", ""]).pid, beatAt: ago(HOUR).toISOString() }));
    const v = controlRoomView(ctx, NOON);
    expect(v.topbar).toMatchObject({ daemon: "crashed", daemonText: "se cayó", daemonTone: "bad" });
    expect(v.alerts.map((a) => a.kind)).toContain("daemon");
  });
});

describe("control room events", () => {
  it("has each kind, newest first", () => {
    const { ctx, clock } = factory();
    const j = job(ctx, clock, ago(3 * HOUR), "delivered", "tienda", 2 * HOUR);
    span(ctx, { name: "zero.station.build", jobId: j.id, start: ago(2 * HOUR).toISOString() });
    span(ctx, { name: "zero.merge", jobId: j.id, start: ago(30 * MIN).toISOString(), attrs: { "zero.merge.url": "https://github.com/o/r/pull/1" } });
    const events = controlRoomView(ctx, NOON).events;
    expect(events.map((e) => e.kind)).toEqual(["merged", "delivered", "station", "created"]);
    expect(events.find((e) => e.kind === "station")).toMatchObject({ job: j.id, line: "tienda", station: "build" });
    expect(events.find((e) => e.kind === "merged")).toMatchObject({ url: "https://github.com/o/r/pull/1", line: "tienda" });
  });

  it("keeps the last 24 hours, at most 40", () => {
    const { ctx, clock } = factory();
    job(ctx, clock, ago(30 * HOUR), "queued");
    for (let i = 0; i < 50; i++) job(ctx, clock, ago((i + 1) * MIN), "queued");
    const events = controlRoomView(ctx, NOON).events;
    expect(events).toHaveLength(40);
    expect(events.every((e) => Date.parse(e.at) >= ago(24 * HOUR).getTime())).toBe(true);
  });
});

describe("control room graph and decisions", () => {
  it("puts each unfinished job at its station", () => {
    const { ctx, clock } = factory();
    const running = job(ctx, clock, ago(10 * MIN), "running");
    ctx.store.updateJob(running.id, { station: "verify" });
    const queued = job(ctx, clock, ago(5 * MIN), "queued");
    const waiting = job(ctx, clock, ago(5 * MIN), "waiting");
    const dots = controlRoomView(ctx, NOON).dots;
    expect(dots.find((d) => d.job === running.id)).toMatchObject({ at: "verify", tone: "run" });
    expect(dots.find((d) => d.job === queued.id)).toMatchObject({ at: "queued" });
    expect(dots.find((d) => d.job === waiting.id)).toMatchObject({ tone: "warn" });
    expect(CONTROL_STATIONS).toEqual(["spec", "build", "verify", "review", "security", "integrate"]);
  });

  it("colours the last day's decisions and leaves older ones out", () => {
    const { ctx, clock } = factory();
    job(ctx, clock, ago(32 * HOUR), "delivered");
    job(ctx, clock, ago(4 * HOUR), "stopped");
    job(ctx, clock, ago(5 * HOUR), "failed");
    job(ctx, clock, ago(6 * HOUR), "delivered");
    const decisions = controlRoomView(ctx, NOON).decisions;
    expect(decisions.map((d) => [d.status, d.tone])).toEqual([["stopped", "warn"], ["failed", "bad"], ["delivered", "ok"]]);
  });
});

describe("control room series", () => {
  it("buckets jobs, cost and verify time per hour", () => {
    const { ctx, clock } = factory();
    const a = job(ctx, clock, ago(30 * MIN), "running");
    job(ctx, clock, ago(30 * MIN), "queued");
    job(ctx, clock, ago(5 * HOUR), "queued");
    span(ctx, { jobId: a.id, start: ago(20 * MIN).toISOString(), attrs: { "zero.cost.usd": 0.1 } });
    span(ctx, { jobId: a.id, start: ago(10 * MIN).toISOString(), attrs: { "zero.cost.usd": 0.3 } });
    span(ctx, { name: "zero.attempt", jobId: a.id, start: ago(25 * MIN).toISOString() });
    span(ctx, { name: "zero.station.verify", jobId: a.id, start: ago(40 * MIN).toISOString(), minutes: 2 });
    span(ctx, { name: "zero.station.verify", jobId: a.id, start: ago(30 * MIN).toISOString(), minutes: 4 });
    span(ctx, { name: "zero.station.verify", jobId: a.id, start: ago(20 * MIN).toISOString(), minutes: 1, attrs: { "zero.skipped": true } });
    const [tienda, blog] = controlRoomView(ctx, NOON).series;
    expect(tienda!.line).toBe("tienda");
    expect(tienda!.jobs).toHaveLength(24);
    expect(tienda!.jobs[23]).toBe(2);
    expect(tienda!.jobs[18]).toBe(1);
    expect(tienda!.jobs.reduce((x, y) => x + y)).toBe(3);
    expect(tienda!.attempts[23]).toBe(1);
    expect(tienda!.costUsd[23]).toBeCloseTo(0.4);
    expect(tienda!.verifyMs[23]).toBe(3 * MIN);
    expect(blog).toEqual({ line: "blog", jobs: Array(24).fill(0), attempts: Array(24).fill(0), costUsd: Array(24).fill(0), verifyMs: Array(24).fill(0) });
  });
});

describe("control room agent bus", () => {
  it("has a row per engine and agent, open calls to now and nothing older than 6 hours", () => {
    const { ctx } = factory();
    span(ctx, { start: ago(2 * HOUR).toISOString(), attrs: { "zero.engine": "claude", "gen_ai.agent.name": "build" } });
    span(ctx, { start: ago(HOUR).toISOString(), status: "error", attrs: { "zero.engine": "codex", "gen_ai.agent.name": "review" } });
    span(ctx, { start: ago(10 * MIN).toISOString(), open: true, attrs: { "zero.engine": "claude", "gen_ai.agent.name": "spec" } });
    span(ctx, { start: ago(8 * HOUR).toISOString(), minutes: 60, attrs: { "zero.engine": "antigravity", "gen_ai.agent.name": "scout" } });
    const bus = controlRoomView(ctx, NOON).bus;
    expect(bus.rows.map((r) => r.row)).toEqual(["claude", "codex", "build", "review", "spec"]);
    const open = bus.rows.find((r) => r.row === "spec")!.segments[0]!;
    expect(open.tone).toBe("run");
    expect(open.left + open.width).toBeCloseTo(1);
    expect(bus.rows.find((r) => r.row === "review")!.segments[0]!.tone).toBe("bad");
    expect(bus.rows.find((r) => r.row === "build")!.segments[0]!.tone).toBe("ok");
  });
});

describe("control room trace", () => {
  it("lists the last 20 ended spans, newest first", () => {
    const { ctx } = factory();
    for (let i = 0; i < 25; i++) span(ctx, { name: `zero.test.${i}`, start: ago((30 - i) * MIN).toISOString(), ...(i === 24 && { jobId: "abcd1234", attrs: { "zero.cost.usd": 0.5 } }) });
    const trace = controlRoomView(ctx, NOON).trace;
    expect(trace).toHaveLength(20);
    expect(trace[0]).toMatchObject({ name: "zero.test.24", job: "abcd1234", costUsd: 0.5, ms: MIN, status: "ok" });
  });
});

describe("control room engines", () => {
  it("shows plan use and a pause with its reason", () => {
    const { ctx } = factory({ fallback: ["codex"], limits: { usdPerDay: 10 } });
    const plan: QuotaReport = { billing: "subscription", windows: [{ name: "five_hour", label: "5 horas", utilization: 0.4, status: "ok", resetsAt: new Date(NOON.getTime() + HOUR).toISOString() }] };
    span(ctx, { attrs: { "zero.engine": "claude", "zero.cost.usd": 1, ...quotaAttrs(plan) } });
    span(ctx, { attrs: { "zero.engine": "codex", "zero.cost.usd": 10, ...quotaAttrs({ billing: "api", windows: [] }) } });
    const engines = controlRoomView(ctx, NOON).engines;
    expect(engines.find((e) => e.engine === "claude")).toMatchObject({ billing: "subscription", paused: false, tone: "ok", windows: [{ label: "5 horas", percent: 40 }] });
    const codex = engines.find((e) => e.engine === "codex")!;
    expect(codex).toMatchObject({ paused: true, tone: "bad" });
    expect(codex.reason).toBeTruthy();
  });
});

describe("control room alerts", () => {
  it("shows a jam and the andon in red", () => {
    const { ctx } = factory();
    const diagnosis: Diagnosis = { at: NOON.toISOString(), causes: [{ title: "test que se cuelga", kind: "flaky-test", jams: ["j1", "j2"], diagnosis: "d", action: "none", paths: [], estimatedUsd: 0, needsNewCredentials: false, todo: "mirarlo", who: "owner" }] };
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify(diagnosis));
    ctx.store.setKv(ANDON_KEY, "on");
    const alerts = controlRoomView(ctx, NOON).alerts;
    expect(alerts.every((a) => a.tone === "bad")).toBe(true);
    expect(alerts.find((a) => a.kind === "jam")!.text).toContain("test que se cuelga");
    expect(alerts.find((a) => a.kind === "jam")!.text).toContain("qué falta: mirarlo");
    expect(alerts.find((a) => a.kind === "andon")!.text).toContain("Andon");
  });

  it("is empty with nothing wrong", () => {
    const { ctx } = factory();
    expect(controlRoomView(ctx, NOON).alerts).toEqual([]);
  });
});

describe("control room is read-only", () => {
  it("writes nothing and gives the same view twice", () => {
    const { ctx, clock } = factory();
    const j = job(ctx, clock, ago(HOUR), "running");
    job(ctx, clock, ago(2 * HOUR), "delivered");
    span(ctx, { jobId: j.id, attrs: { "zero.engine": "claude", "gen_ai.agent.name": "build", "zero.cost.usd": 0.2 } });
    const counts = () => [ctx.store.listJobs({ limit: -1 }).length, ctx.store.spansSinceAny(new Date(0)).length, ctx.store.kvWithPrefix("").length];
    const before = counts();
    const first = controlRoomView(ctx, NOON);
    const second = controlRoomView(ctx, NOON);
    expect(counts()).toEqual(before);
    expect(second).toEqual(first);
  });
});
