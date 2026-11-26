import { afterEach, describe, expect, it } from "vitest";
import { quotaAttrs } from "../src/agent.js";
import { requestWork } from "../src/app.js";
import { budgetState, jobBilledUsd } from "../src/budget.js";
import { coordPass, PROBE_KEY } from "../src/coord/pass.js";
import { memoryCoord, readSpendRecord, spendRef, type SpendRecord, type SpendSlot } from "../src/coord/protocol.js";
import { SPEND_KEY } from "../src/coord/spend.js";
import type { QuotaReport } from "../src/engines/index.js";
import { runJob } from "../src/line/runner.js";
import { scoutPass, scoutSpent } from "../src/line/scout.js";
import { machineIdentity } from "../src/machine.js";
import { AGENT_SPAN, startOfDay } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory, writeTree } from "./helpers.js";

afterEach(cleanup);

const REPOSITORY = "me/zero-coord";
/** In local time, so the day and the night are the same wherever the tests run. */
const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const api: QuotaReport = { billing: "api", windows: [] };
const subscription: QuotaReport = { billing: "subscription", windows: [] };

/** A factory of the distributed test, with its probe passed, and a clock that moves. */
function factory(machine: string, over: Record<string, unknown> = {}, start = at(12)) {
  let clock = start;
  const ctx = testFactory({ isolation: "worktree", distributed: { repository: REPOSITORY, machine }, lines: [], ...over }, () => clock);
  ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: start.toISOString(), ok: true }));
  return { ctx, set: (d: Date) => (clock = d) };
}
type Ctx = ReturnType<typeof factory>["ctx"];
type Coord = ReturnType<typeof memoryCoord>;

function call(ctx: Ctx, usd: number, opts: { quota?: QuotaReport; agent?: string; engine?: string; jobId?: string; attrs?: Record<string, unknown> } = {}) {
  ctx.tracer
    .start(AGENT_SPAN, { jobId: opts.jobId, attrs: { "gen_ai.agent.name": opts.agent ?? "build", "zero.engine": opts.engine ?? "claude", ...opts.attrs } })
    .end("ok", { "zero.cost.usd": usd, ...quotaAttrs(opts.quota) });
}

const slot = (when: Date, usd: number, over: Partial<SpendSlot> = {}): SpendSlot => ({ at: when.toISOString(), engine: "claude", billing: "api", idle: false, usd, ...over });
const record = (slots: SpendSlot[], jobs: SpendRecord["jobs"] = [], id = "otra"): SpendRecord => ({ id, at: at(12).toISOString(), slots, jobs });
/** What a pass left of the other machines. */
const others = (ctx: Ctx, ...records: SpendRecord[]) => ctx.store.setKv(SPEND_KEY, JSON.stringify(records));
const put = (coord: Coord, name: string, data: unknown) =>
  coord.refs.set(name, { name, sha: "a".repeat(40), data: typeof data === "string" ? data : JSON.stringify(data) });

const pass = (ctx: Ctx, coord: Coord, now = at(12)) => coordPass(ctx, coord, undefined, now);
const id = (ctx: Ctx) => machineIdentity(ctx.store, ctx.config).id;
const published = (ctx: Ctx, coord: Coord) => JSON.parse(coord.refs.get(spendRef(id(ctx)))!.data) as SpendRecord;
const writes = (ctx: Ctx, coord: Coord) => coord.calls.filter((c) => c === `write ${spendRef(id(ctx))}`).length;

describe("publishing the spend", () => {
  it("goes out in 15-minute slots by engine, billing and idle time, and the other machine keeps it", async () => {
    const coord = memoryCoord();
    const a = factory("pc-a", {}, at(11, 2));
    const b = factory("pc-b");
    call(a.ctx, 1, { quota: api });
    call(a.ctx, 0.5, { quota: api });
    call(a.ctx, 0.25, { quota: api, agent: "scout" });
    call(a.ctx, 0.1, { quota: api, agent: "research", attrs: { "zero.on_demand": true } });
    call(a.ctx, 3, { quota: subscription, engine: "codex" });
    call(a.ctx, 7, { engine: "gemini" });
    a.set(at(11, 20));
    call(a.ctx, 2, { quota: api, agent: "package:plus/cm" });
    await pass(a.ctx, coord);
    await pass(b.ctx, coord);

    const own = published(a.ctx, coord);
    const first = at(11).toISOString();
    expect(own.slots).toHaveLength(5);
    expect(own.slots).toEqual(
      expect.arrayContaining([
        { at: first, engine: "claude", billing: "api", idle: false, usd: 1.6 },
        { at: first, engine: "claude", billing: "api", idle: true, usd: 0.25 },
        { at: first, engine: "codex", billing: "subscription", idle: false, usd: 3 },
        { at: first, engine: "gemini", billing: "unknown", idle: false, usd: 7 },
        { at: at(11, 15).toISOString(), engine: "claude", billing: "api", idle: true, usd: 2 },
      ]),
    );
    expect(JSON.parse(b.ctx.store.getKv(SPEND_KEY)!)).toEqual([own]);
    // Its own never counts as another machine's.
    await pass(a.ctx, coord);
    expect(JSON.parse(a.ctx.store.getKv(SPEND_KEY)!)).toEqual([]);
    expect(budgetState(a.ctx.store, a.ctx.config, at(12)).spentUsd).toBeCloseTo(3.85);
  });

  it("is written only when there is something new to say", async () => {
    const coord = memoryCoord();
    const { ctx, set } = factory("pc-a", {}, at(11));
    await pass(ctx, coord);
    expect(writes(ctx, coord)).toBe(0);
    call(ctx, 1, { quota: api });
    await pass(ctx, coord);
    await pass(ctx, coord, at(12, 1));
    expect(writes(ctx, coord)).toBe(1);
    set(at(12, 2));
    call(ctx, 1, { quota: api });
    await pass(ctx, coord, at(12, 3));
    expect(writes(ctx, coord)).toBe(2);
    // A slot that only grew old is not news, and it leaves with the next write.
    await pass(ctx, coord, at(11, 30, 31));
    expect(writes(ctx, coord)).toBe(2);
    set(at(11, 31, 31));
    call(ctx, 0.5, { quota: api });
    await pass(ctx, coord, at(11, 32, 31));
    expect(published(ctx, coord).slots.map((s) => s.usd)).toEqual([1, 0.5]);
  });

  it("carries what each unfinished or lately finished job was charged, and nothing of its text", async () => {
    const coord = memoryCoord();
    const { ctx, set } = factory("pc-a", { lines: [{ name: "demo", repo: gitRepo() }] });
    const job = (usd: number, quota = api) => {
      const created = requestWork(ctx, { text: `pedido en ${ctx.config.lines[0]!.repo}` }).job;
      call(ctx, usd, { quota, jobId: created.id });
      return created.id;
    };
    set(at(12, 0, 25));
    const old = job(9);
    ctx.store.finishJob(old, "delivered");
    // Waiting for days: it still has what it was charged.
    const waiting = job(2.5);
    ctx.store.updateJob(waiting, { status: "waiting" });
    set(at(11));
    const done = job(1);
    ctx.store.finishJob(done, "delivered");
    const onPlan = job(4, subscription);
    await pass(ctx, coord);
    expect(published(ctx, coord).jobs).toEqual([{ id: waiting, usd: 2.5 }, { id: done, usd: 1 }].sort((x, y) => (x.id < y.id ? -1 : 1)));
    const text = coord.refs.get(spendRef(id(ctx)))!.data;
    expect(text).not.toContain(onPlan);
    expect(text).not.toContain("pedido");
  });

  it("does nothing while the probe has not passed", async () => {
    const coord = memoryCoord();
    const { ctx } = factory("pc-a");
    ctx.store.setKv(PROBE_KEY, JSON.stringify({ repository: REPOSITORY, at: at(12).toISOString(), ok: false, problem: "x" }));
    call(ctx, 1, { quota: api });
    await pass(ctx, coord);
    expect(coord.calls.some((c) => c.includes("spend/"))).toBe(false);
    expect(ctx.store.getKv(SPEND_KEY)).toBeUndefined();
  });

  it("drops records that do not read, and keeps the rest, of a machine that is down too", async () => {
    const coord = memoryCoord();
    const { ctx } = factory("pc-a");
    call(ctx, 1, { quota: api });
    const before = budgetState(ctx.store, ctx.config, at(12));
    const good = slot(at(11), 2);
    put(coord, spendRef("roto"), "{no es json");
    put(coord, spendRef("negativo"), record([slot(at(11), -5)], [], "negativo"));
    put(coord, spendRef("infinito"), JSON.stringify(record([good], [], "infinito")).replace('"usd":2', '"usd":1e999'));
    put(coord, spendRef("fecha"), record([{ ...good, at: "ayer" }], [], "fecha"));
    put(coord, spendRef("trabajo"), record([good], [{ id: "../x", usd: 1 }], "trabajo"));
    put(coord, spendRef("cobro"), record([{ ...good, billing: "gratis" as never }], [], "cobro"));
    put(coord, spendRef("ajeno"), record([good], [], "otro-id"));
    await pass(ctx, coord);
    expect(JSON.parse(ctx.store.getKv(SPEND_KEY)!)).toEqual([]);
    expect(budgetState(ctx.store, ctx.config, at(12))).toEqual(before);

    put(coord, spendRef("caida"), { ...record([good], [], "caida"), at: at(1).toISOString(), extra: "texto" });
    await pass(ctx, coord);
    expect(budgetState(ctx.store, ctx.config, at(12)).spentUsd).toBe(3);
    expect(readSpendRecord(coord.refs.get(spendRef("caida"))!)).not.toHaveProperty("extra");
  });
});

describe("the day's cap", () => {
  it("adds what the other machines were charged", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } });
    call(ctx, 6, { quota: api });
    expect(budgetState(ctx.store, ctx.config, at(13)).reached).toBe(false);
    others(ctx, record([slot(at(9), 5), slot(at(9), 30, { billing: "subscription" }), slot(at(9), 40, { billing: "unknown" }), slot(at(9, 0, 28), 50)]));
    const b = budgetState(ctx.store, ctx.config, at(13));
    expect(b).toMatchObject({ reached: true, spentUsd: 11, estimatedUsd: 81, reason: expect.stringContaining("límite de gasto del día") });
    expect(b.engines.find((e) => e.engine === "claude")).toMatchObject({ billing: "api", paused: true });
  });

  it("counts each engine on its own, and a slot that crosses midnight whole", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } });
    call(ctx, 6, { quota: api });
    others(ctx, record([slot(at(9), 5, { engine: "codex" })]));
    expect(budgetState(ctx.store, ctx.config, at(13))).toMatchObject({ reached: false, spentUsd: 11 });
    const midnight = startOfDay(at(13)).getTime();
    others(ctx, record([slot(new Date(midnight - 5 * 60_000), 1), slot(new Date(midnight - 15 * 60_000), 2)]));
    expect(budgetState(ctx.store, ctx.config, at(13)).spentUsd).toBe(7);
  });

  it("also stops an engine that has no reading here yet", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } });
    others(ctx, record([slot(at(9), 10)]));
    expect(budgetState(ctx.store, ctx.config, at(13))).toMatchObject({ billing: "unknown", reached: true, reason: expect.stringContaining("límite de gasto del día") });
  });

  it("does not touch an engine on a subscription", () => {
    const { ctx } = factory("pc-a", { limits: { usdPerDay: 10 } });
    call(ctx, 1, { quota: subscription });
    others(ctx, record([slot(at(9), 50)]));
    expect(budgetState(ctx.store, ctx.config, at(13)).reached).toBe(false);
  });
});

describe("the night's cap", () => {
  it("adds the idle spend of the other machines, so scout calls no engine billed per use", async () => {
    const { ctx } = factory("pc-a", { limits: { usdPerNight: 1 }, lines: [{ name: "tienda", repo: gitRepo() }] }, at(3));
    const agents = fakeAgents({ scout: () => ({ output: { proposals: [] } }) });
    others(ctx, record([slot(at(2), 1, { idle: true })]));
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);

    others(ctx, record([slot(at(2), 0.4, { idle: true }), slot(at(2), 9), slot(at(2), 9, { idle: true, billing: "subscription" })]));
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls[0]!.maxBudgetUsd).toBeCloseTo(0.6);
  });

  it("counts calls whose billing is unknown, as it does its own", () => {
    const { ctx } = factory("pc-a");
    others(ctx, record([slot(at(2), 0.3, { idle: true, billing: "unknown" })]));
    expect(scoutSpent(ctx.store, startOfDay(at(3)), at(3), ctx.config)).toBeCloseTo(0.3);
  });
});

describe("the job's cap", () => {
  it("adds what the machine that had the job before was charged for it", async () => {
    const passes = `node -e "process.exit(0)"`;
    const { ctx } = factory("pc-a", { engine: "fake", level: "L2", limits: { usdPerJob: 3 }, lines: [{ name: "demo", repo: gitRepo(), verify: [passes] }] });
    const { job } = requestWork(ctx, { text: "x" });
    others(ctx, record([], [{ id: job.id, usd: 2.5 }, { id: "otro", usd: 9 }]));
    expect(jobBilledUsd(ctx.store, ctx.config, job.id, at(13))).toBe(2.5);
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { "src/x.ts": "ok" }) }, 0);
    await runJob(job.id, { ...ctx, runAgent: agents.runner });
    expect(agents.calls.find((c) => c.station === "build")!.maxBudgetUsd).toBeCloseTo(0.5);
  });

  it("reaches the other machine through the passes", async () => {
    const coord = memoryCoord();
    const a = factory("pc-a", { lines: [{ name: "demo", repo: gitRepo() }] });
    const b = factory("pc-b", { lines: [{ name: "demo", repo: gitRepo() }] });
    const { job } = requestWork(a.ctx, { text: "x" });
    call(a.ctx, 2, { quota: api, jobId: job.id });
    await pass(a.ctx, coord);
    await pass(b.ctx, coord);
    call(b.ctx, 0.5, { quota: api, jobId: job.id });
    expect(jobBilledUsd(b.ctx.store, b.ctx.config, job.id, at(13))).toBe(2.5);
    // Each machine publishes only its own share.
    await pass(b.ctx, coord);
    expect(published(b.ctx, coord).jobs).toEqual([{ id: job.id, usd: 0.5 }]);
    await pass(a.ctx, coord);
    expect(jobBilledUsd(a.ctx.store, a.ctx.config, job.id, at(13))).toBe(2.5);
  });
});

describe("without distributed", () => {
  it("what was kept of the other machines counts for nothing", () => {
    const { ctx } = factory("pc-a", { distributed: undefined, limits: { usdPerDay: 10 } });
    call(ctx, 6, { quota: api });
    const before = budgetState(ctx.store, ctx.config, at(13));
    others(ctx, record([slot(at(9), 50, { idle: true })], [{ id: "abc", usd: 9 }]));
    expect(budgetState(ctx.store, ctx.config, at(13))).toEqual(before);
    expect(scoutSpent(ctx.store, startOfDay(at(13)), at(13), ctx.config)).toBe(0);
    expect(jobBilledUsd(ctx.store, ctx.config, "abc", at(13))).toBe(0);
  });
});
