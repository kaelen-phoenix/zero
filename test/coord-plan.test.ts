import { afterEach, describe, expect, it } from "vitest";
import { quotaAttrs } from "../src/agent.js";
import { controlRoomView, factoryStatus, requestWork } from "../src/app.js";
import { budgetState, onSubscription, pickEngine } from "../src/budget.js";
import { coordPass, PROBE_KEY } from "../src/coord/pass.js";
import { memoryCoord, readSpendRecord, spendRef, type PlanReading, type SpendRecord, type SpendSlot } from "../src/coord/protocol.js";
import { SPEND_KEY } from "../src/coord/spend.js";
import { runDaemon } from "../src/daemon.js";
import type { QuotaReport, QuotaWindow } from "../src/engines/index.js";
import { budgetLine, formatStatus } from "../src/format.js";
import { machineIdentity } from "../src/machine.js";
import { controlRoomFragment } from "../src/panel/control-room.js";
import { overviewPage } from "../src/panel/html.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const REPOSITORY = "me/zero-coord";
const SHARED = /toda la fábrica \(todas las máquinas\)/;
/** In local time, so the day is the same wherever the tests run. */
const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const NOW = at(13);

function factory(machine: string, over: Record<string, unknown> = {}, start = NOW) {
  let clock = start;
  const ctx = testFactory({ isolation: "worktree", engine: "claude", distributed: { repository: REPOSITORY, machine }, lines: [], ...over }, () => clock);
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: start.toISOString(), ok: true }));
  return { ctx, set: (d: Date) => (clock = d) };
}
type Ctx = ReturnType<typeof factory>["ctx"];

function call(ctx: Ctx, usd: number, quota?: QuotaReport, engine = "claude") {
  ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": engine } }).end("ok", { "zero.cost.usd": usd, ...quotaAttrs(quota) });
}

const fiveHours = (utilization: number, over: Partial<QuotaWindow> = {}): QuotaWindow => ({
  name: "five_hour",
  label: "5 horas",
  utilization,
  status: utilization >= 1 ? "exhausted" : "ok",
  resetsAt: at(18).toISOString(),
  ...over,
});
const subscription = (...windows: QuotaWindow[]): QuotaReport => ({ billing: "subscription", windows });
const api: QuotaReport = { billing: "api", windows: [] };
const plan = (when: Date, windows: QuotaWindow[], over: Partial<PlanReading> = {}): PlanReading => ({ engine: "claude", at: when.toISOString(), limited: false, windows, ...over });
const slot = (usd: number, over: Partial<SpendSlot> = {}): SpendSlot => ({ at: at(9).toISOString(), engine: "claude", billing: "api", idle: false, usd, ...over });
const record = (plans: PlanReading[], slots: SpendSlot[] = [], id = "otra"): SpendRecord => ({ id, at: at(12).toISOString(), slots, jobs: [], plans });
/** What a pass left of the other machines. */
const others = (ctx: Ctx, ...records: SpendRecord[]) => ctx.store.setKv(SPEND_KEY, JSON.stringify(records));
const state = (ctx: Ctx, now = NOW) => budgetState(ctx.store, ctx.config, now);
const claude = (ctx: Ctx, now = NOW) => state(ctx, now).engines.find((e) => e.engine === "claude");

describe("publishing the plan readings", () => {
  it("carries the latest reading of each subscription, and the other machine is paused by it", async () => {
    const coord = memoryCoord();
    const a = factory("pc-a", {}, at(12));
    const b = factory("pc-b");
    call(a.ctx, 1, subscription(fiveHours(0.4)));
    call(a.ctx, 1, subscription(fiveHours(1, { prompt: "texto privado" } as never), { name: "raro", label: "", status: "ok" }));
    call(a.ctx, 1, api, "codex");
    await coordPass(a.ctx, coord, undefined, at(12));
    const ref = spendRef(machineIdentity(a.ctx.store, a.ctx.config).id);
    expect(JSON.parse(coord.refs.get(ref)!.data).plans).toEqual([plan(at(12), [fiveHours(1)])]);
    expect(coord.refs.get(ref)!.data).not.toContain("texto privado");

    expect(state(b.ctx).reached).toBe(false);
    await coordPass(b.ctx, coord, undefined, at(12, 1));
    expect(state(b.ctx)).toMatchObject({ reached: true, until: at(18).toISOString() });

    // The reading of one machine is never published again as another's.
    call(b.ctx, 1, subscription(fiveHours(0.2)));
    others(b.ctx);
    await coordPass(b.ctx, coord, undefined, at(13));
    const own = JSON.parse(coord.refs.get(spendRef(machineIdentity(b.ctx.store, b.ctx.config).id))!.data) as SpendRecord;
    expect(own.plans).toEqual([plan(at(13), [fiveHours(0.2)])]);
  });

  it("is written only for a new reading, even of a call that cost nothing", async () => {
    const coord = memoryCoord();
    const { ctx, set } = factory("pc-a", {}, at(12));
    const writes = () => coord.calls.filter((c) => c.startsWith("write spend/")).length;
    call(ctx, 0, subscription(fiveHours(0.4)));
    await coordPass(ctx, coord, undefined, at(12));
    await coordPass(ctx, coord, undefined, at(12, 1));
    expect(writes()).toBe(1);
    set(at(12, 2));
    call(ctx, 0, subscription(fiveHours(0.5)));
    await coordPass(ctx, coord, undefined, at(12, 2));
    expect(writes()).toBe(2);
  });

  it("drops a record with a reading that does not read", () => {
    const read = (reading: unknown) => readSpendRecord({ name: spendRef("x"), sha: "a", data: JSON.stringify({ ...record([], [], "x"), plans: [reading] }) });
    const good = plan(at(12), [fiveHours(0.5)]);
    expect(read(good)?.plans).toEqual([good]);
    expect(read({ ...good, extra: 1 })?.plans).toEqual([good]);
    for (const bad of [null, { ...good, at: "ayer" }, { ...good, limited: "no" }, { ...good, windows: {} }, { ...good, engine: "" }]) expect(read(bad)).toBeUndefined();
    for (const w of [{ utilization: -1 }, { utilization: "0.5" }, { status: "otro" }, { resetsAt: "luego" }, { label: "a\nb" }]) expect(read({ ...good, windows: [{ ...fiveHours(0.5), ...w }] })).toBeUndefined();
  });
});

describe("one subscription for every machine", () => {
  it("a window used up on another machine pauses the engine here until it renews", () => {
    const { ctx, set } = factory("pc-a", {}, at(11));
    call(ctx, 1, subscription(fiveHours(0.5)));
    set(NOW);
    others(ctx, record([plan(at(12), [fiveHours(1)])]));
    expect(state(ctx)).toMatchObject({ billing: "subscription", reached: true, until: at(18).toISOString(), reason: expect.stringContaining("todo el cupo de 5 horas") });
    expect(claude(ctx)).toMatchObject({ billing: "subscription", paused: true });
    expect(state(ctx).windows).toEqual([{ ...fiveHours(1), engine: "claude" }]);
    expect(pickEngine(ctx.store, ctx.config, "build", NOW).available).toBe(false);
    expect(state(ctx, at(18, 1)).reached).toBe(false);
  });

  it("starts no jobs that only have that engine", async () => {
    const run = async (used: number) => {
      const { ctx, set } = factory("pc-a", { level: "L3", lines: [{ name: "demo", repo: gitRepo() }] }, at(12));
      call(ctx, 0.1, subscription(fiveHours(0.5)));
      const { job } = requestWork(ctx, { text: "x" });
      set(NOW);
      const coord = memoryCoord();
      coord.refs.set(spendRef("otra"), { name: spendRef("otra"), sha: "a".repeat(40), data: JSON.stringify(record([plan(at(12, 30), [fiveHours(used)])])) });
      await coordPass(ctx, coord, undefined, NOW);
      const agents = fakeAgents({});
      await runDaemon(ctx, { once: true, pollMs: 10, coord: () => coord, agentRunner: () => agents.runner });
      return { calls: agents.calls.length, status: ctx.store.getJob(job.id)?.status };
    };
    expect(await run(1)).toEqual({ calls: 0, status: "queued" });
    expect((await run(0.6)).calls).toBeGreaterThan(0);
  });

  it("the newest reading wins, whoever made it", () => {
    const { ctx } = factory("pc-a", {}, at(12));
    call(ctx, 1, subscription(fiveHours(1)));
    others(ctx, record([plan(at(11), [fiveHours(0.1)])]));
    expect(state(ctx).reached).toBe(true);
    others(ctx, record([plan(at(12, 30), [fiveHours(0.1)])]));
    expect(state(ctx).reached).toBe(false);
    others(ctx, record([plan(at(12, 30), [fiveHours(0.1)])]), record([plan(at(12, 40), [fiveHours(1)])], [], "tercera"));
    expect(state(ctx).reached).toBe(true);
  });

  it("a call refused on another machine, and one dated ahead or too old", () => {
    const { ctx } = factory("pc-a", {}, at(11));
    call(ctx, 1, subscription(fiveHours(0.5)));
    others(ctx, record([plan(at(12, 55), [], { limited: true })]));
    expect(state(ctx)).toMatchObject({ reached: true, until: at(13, 10).toISOString() });
    others(ctx, record([plan(at(14), [fiveHours(1)])]));
    expect(state(ctx).reached).toBe(false);
    others(ctx, record([plan(at(12, 0, 20), [fiveHours(1)])]));
    expect(state(ctx).reached).toBe(false);
  });

  it("the reserve counts the other machines' use", () => {
    const { ctx } = factory("pc-a", { limits: { reservePercent: 20 } }, at(11));
    call(ctx, 1, subscription(fiveHours(0.3)));
    others(ctx, record([plan(at(12), [fiveHours(0.79)])]));
    expect(state(ctx).reached).toBe(false);
    others(ctx, record([plan(at(12), [fiveHours(0.85)])]));
    expect(state(ctx)).toMatchObject({ reached: true, until: at(18).toISOString(), reason: expect.stringContaining("80% del cupo de 5 horas") });
  });

  it("does not touch an engine paid per use here", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } }, at(11));
    call(ctx, 6, api);
    others(ctx, record([plan(at(12), [fiveHours(1)])]));
    expect(state(ctx)).toMatchObject({ billing: "api", reached: false, spentUsd: 6, windows: [] });
    expect(onSubscription(ctx.store, "claude", NOW)).toBe(false);
    call(ctx, 4, api);
    expect(state(ctx)).toMatchObject({ billing: "api", reached: true, reason: expect.stringContaining("límite de gasto del día") });
  });

  it("with no reading here it may only pause: billing and dollar caps stay", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } }, at(11));
    others(ctx, record([plan(at(12), [fiveHours(0.1)])]));
    expect(claude(ctx)).toEqual({ engine: "claude", billing: "unknown", paused: false });
    expect(onSubscription(ctx.store, "claude", NOW)).toBe(false);
    others(ctx, record([plan(at(12), [fiveHours(0.1)])], [slot(10)]));
    expect(claude(ctx)).toMatchObject({ billing: "unknown", paused: true, reason: expect.stringContaining("límite de gasto del día") });
    others(ctx, record([plan(at(12), [fiveHours(1)])]));
    expect(claude(ctx)).toMatchObject({ billing: "unknown", paused: true, until: at(18).toISOString() });
    // Both at once: the day's cap, which is the longer wait.
    others(ctx, record([plan(at(12), [fiveHours(1)])], [slot(10)]));
    expect(claude(ctx)?.until).toBeUndefined();
  });
});

describe("the shared budget on screen", () => {
  it("says the sum is of every machine, with the other machines' spend of today", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 20 } }, at(11));
    call(ctx, 6, api);
    others(ctx, record([], [slot(5)]));
    ctx.now = () => NOW;
    const line = formatStatus(factoryStatus(ctx), NOW).split("\n").find((l) => l.startsWith("Presupuesto"));
    expect(line).toContain("$11.00 de $20.00");
    expect(line).toMatch(SHARED);
    const html = overviewPage(factoryStatus(ctx), [], "n");
    expect(html).toMatch(SHARED);
    expect(html).toContain("de $20.00 hoy · todas las máquinas");
    expect(controlRoomFragment(controlRoomView(ctx, NOW))).toContain("costo del día (todas las máquinas)");
  });

  it("says it on a subscription, with another machine's reading", () => {
    const { ctx } = factory("pc-a", {}, at(11));
    call(ctx, 1, subscription(fiveHours(0.3)));
    others(ctx, record([plan(at(12), [fiveHours(0.85)])]));
    expect(budgetLine(state(ctx), NOW)).toMatch(/5 horas al 85%.*toda la fábrica/);
  });

  it("stays as always with nothing of today from the other machines, or without distributed", () => {
    const alone = factory("pc-a", {}, at(11)).ctx;
    call(alone, 1, api);
    const before = { state: state(alone), line: budgetLine(state(alone), NOW) };
    others(alone, record([], [slot(5, { at: at(9, 0, 28).toISOString() })]));
    expect(state(alone)).toEqual(before.state);
    expect(budgetLine(state(alone), NOW)).toBe(before.line);
    expect(controlRoomFragment(controlRoomView(alone, NOW))).not.toContain("todas las máquinas");

    const off = factory("pc-a", { distributed: undefined }, at(11)).ctx;
    call(off, 1, subscription(fiveHours(0.3)));
    const same = { state: state(off), text: formatStatus(factoryStatus(off), NOW), html: overviewPage(factoryStatus(off), [], "n") };
    others(off, record([plan(at(12), [fiveHours(1)])], [slot(50)]));
    expect(state(off)).toEqual(same.state);
    expect(formatStatus(factoryStatus(off), NOW)).toBe(same.text);
    expect(overviewPage(factoryStatus(off), [], "n")).toBe(same.html);
  });
});
