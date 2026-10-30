import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ACCESS, quotaAttrs } from "../src/agent.js";
import { ANDON_KEY, approveProposal, briefing, rejectProposal, requestWork, SHUTDOWN_KEY } from "../src/app.js";
import { AGENT_STATIONS, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import type { QuotaReport } from "../src/engines/index.js";
import { insideHours, normalizeTitle, scoutPass } from "../src/line/scout.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);
const idea = (title: string, over: Record<string, unknown> = {}) => ({ title, why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, paths: ["test/x.test.ts"], needsNewCredentials: false, ...over });

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }, { name: "blog", repo: gitRepo() }], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

const scouting = (proposals: unknown[], cost = 0.1) => fakeAgents({ scout: () => ({ output: { proposals } }) }, cost);

/** A scout call already recorded this period, billed as `billing`. */
function spent(ctx: ReturnType<typeof factory>["ctx"], usd: number, quota: QuotaReport = { billing: "api", windows: [] }) {
  ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout", "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": usd, ...quotaAttrs(quota) });
}

const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("night shift hours", () => {
  const shift = (hours?: string) => parseFactory(hours ? `nightShift: { hours: "${hours}" }` : "").nightShift;
  it("wraps past midnight", () => {
    expect(insideHours(shift("22:00-06:00"), at(23, 30))).toBe(true);
    expect(insideHours(shift("22:00-06:00"), at(5, 59))).toBe(true);
    expect(insideHours(shift("22:00-06:00"), at(6))).toBe(false);
    expect(insideHours(shift("22:00-06:00"), at(12))).toBe(false);
  });
  it("plain window, end excluded", () => {
    expect(insideHours(shift("00:00-08:00"), at(7, 59))).toBe(true);
    expect(insideHours(shift("00:00-08:00"), at(8))).toBe(false);
  });
  it("without hours, always; off, never", () => {
    expect(insideHours(shift(), at(15))).toBe(true);
    expect(insideHours("off", at(3))).toBe(false);
    expect(insideHours("off", at(15))).toBe(false);
  });
});

describe("scout station", () => {
  it("is read-only and has its own instructions", () => {
    expect(AGENT_STATIONS).toContain("scout");
    expect(AGENT_ACCESS.scout).toBe("read");
    expect(existsSync(new URL("../agents/scout.md", import.meta.url))).toBe(true);
  });
  it("titles compare without case, accents or whitespace", () => {
    expect(normalizeTitle("  Mejorar   Caché ")).toBe(normalizeTitle("mejorar cache"));
  });
});

describe("when scout runs", () => {
  it("scouts every line of an idle factory, on the line's repo", async () => {
    const { ctx } = factory();
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls.map((c) => [c.station, c.cwd])).toEqual(ctx.config.lines.map((l) => ["scout", l.repo]));
    expect(agents.calls[0]!.trace?.jobId).toBeUndefined();
  });

  it("steps aside for owner work, off, outside hours and andon", async () => {
    const agents = scouting([]);
    for (const status of ["queued", "running"] as const) {
      const busy = factory();
      const job = busy.ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
      busy.ctx.store.updateJob(job.id, { status });
      await scoutPass(busy.ctx, agents.runner, at(3));
    }
    await scoutPass(factory({ nightShift: "off" }).ctx, agents.runner, at(3));
    await scoutPass(factory({ nightShift: { hours: "00:00-08:00" } }).ctx, agents.runner, at(12));
    const andon = factory();
    andon.ctx.store.setKv(ANDON_KEY, "on");
    await scoutPass(andon.ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("scouts each line once per period", async () => {
    const { ctx, set } = factory();
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    await scoutPass(ctx, agents.runner, at(15));
    expect(agents.count.scout).toBe(2);
    set(at(3, 0, 30));
    await scoutPass(ctx, agents.runner, at(3, 0, 30));
    expect(agents.count.scout).toBe(4);
  });

  it("with hours, the period is the window", async () => {
    const { ctx } = factory({ nightShift: { hours: "22:00-06:00" } }, at(23));
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(23));
    await scoutPass(ctx, agents.runner, at(5, 0, 30));
    expect(agents.count.scout).toBe(2);
    await scoutPass(ctx, agents.runner, at(22, 30, 30));
    expect(agents.count.scout).toBe(4);
  });

  it("a failing line does not stop the others", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({
      scout: (req) => {
        if (req.line === "tienda") throw new Error("boom");
        return { output: { proposals: [idea("Cubrir egress")] } };
      },
    });
    await expect(scoutPass(ctx, agents.runner, at(3))).resolves.toBeUndefined();
    expect(agents.calls.map((c) => c.line)).toEqual(["tienda", "blog"]);
    expect(ctx.store.listProposals({ line: "blog" })).toHaveLength(1);
  });
});

describe("scout spending", () => {
  it("stops at usdPerNight on per-use billing", async () => {
    const { ctx } = factory();
    spent(ctx, 1);
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("passes what is left as the call's cap", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
    spent(ctx, 0.4);
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls[0]!.maxBudgetUsd).toBeCloseTo(0.6);
  });

  it("respects the subscription reserve of its own engine", async () => {
    const { ctx } = factory({ limits: { reservePercent: 20 }, stations: { scout: { engine: "codex" } } });
    const plan: QuotaReport = { billing: "subscription", windows: [{ name: "five_hour", label: "5 horas", utilization: 0.85, status: "ok", resetsAt: "2026-10-30T12:00:00Z" }] };
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout", "zero.engine": "codex" } }).end("ok", { "zero.cost.usd": 0, ...quotaAttrs(plan) });
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("a subscription has no dollar cap", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
    spent(ctx, 5, { billing: "subscription", windows: [] });
    const agents = scouting([]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(1);
    expect(agents.calls[0]!.maxBudgetUsd).toBeUndefined();
  });
});

describe("the daemon", () => {
  it("starts the owner's job while a scout pass is still running", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] }, new Date());
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    const agents = fakeAgents({ scout: async () => (await blocked, { output: { proposals: [] } }) });
    const daemon = runDaemon(ctx, { pollMs: 10, panel: false, scout: true, agentRunner: () => agents.runner });
    try {
      await until(() => agents.count.scout === 1);
      const { job } = requestWork(ctx, { text: "Agregar /health", line: "tienda" });
      await until(() => (agents.count.spec ?? 0) > 0 || ctx.store.getJob(job.id)!.status !== "queued");
      expect(agents.count.scout).toBe(1);
    } finally {
      release();
      ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
      await daemon;
    }
  });
});

describe("proposals", () => {
  it("stores a valid proposal as pending", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
    await scoutPass(ctx, scouting([idea("Cubrir egress")]).runner, at(3));
    expect(ctx.store.listProposals({ line: "tienda" })).toEqual([
      expect.objectContaining({ line: "tienda", title: "Cubrir egress", why: "falla seguido", change: "agregar tests", estimatedUsd: 0.5, status: "pending" }),
    ]);
  });

  it("stores nothing from a failed or invalid run, and still marks the period", async () => {
    for (const result of [{ ok: false, text: "boom" }, { output: { proposals: [{ title: "sin campos" }] } }]) {
      const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
      const agents = fakeAgents({ scout: () => result as never });
      await expect(scoutPass(ctx, agents.runner, at(3))).resolves.toBeUndefined();
      await scoutPass(ctx, agents.runner, at(4));
      expect(ctx.store.listProposals()).toHaveLength(0);
      expect(agents.count.scout).toBe(1);
    }
  });

  it("refuses protected paths, new credentials and repeated titles; keeps at most three", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
    const rejected = ctx.store.createProposal({ ...idea("Mejorar Caché"), line: "tienda" });
    rejectProposal(ctx, rejected.id);
    const agents = scouting([
      idea("mejorar  cache"),
      idea("Tocar CI", { paths: [".github/workflows/ci.yml"] }),
      idea("Nueva API", { needsNewCredentials: true }),
      idea("Uno"),
      idea("Dos"),
      idea("Tres"),
      idea("Cuatro"),
      idea("Cinco"),
    ]);
    await scoutPass(ctx, agents.runner, at(3));
    expect(ctx.store.listProposals({ status: ["pending"] }).map((p) => p.title)).toEqual(["Uno", "Dos", "Tres"]);
    expect(agents.calls[0]!.prompt).toContain("Mejorar Caché");
  });

  it("approves into a queued night-shift job, once", () => {
    const { ctx } = factory();
    const p = ctx.store.createProposal({ ...idea("Cubrir egress"), line: "blog" });
    const r = approveProposal(ctx, p.id);
    expect(r.job).toMatchObject({ line: "blog", status: "queued", source: { kind: "night-shift", proposal: p.id } });
    expect(r.job.request).toContain("Cubrir egress");
    expect(ctx.store.getProposal(p.id)).toMatchObject({ status: "approved", jobId: r.job.id, decidedAt: expect.any(String) });
    expect(ctx.store.spansForJob(r.job.id).find((s) => s.name === "zero.job")!.attrs["zero.night_shift"]).toBe(true);
    expect(() => approveProposal(ctx, p.id)).toThrow(/ya fue aprobada/);
    expect(() => approveProposal(ctx, "00000000")).toThrow(/No existe la propuesta/);
    expect(ctx.store.listJobs()).toHaveLength(1);
  });

  it("rejects with a note and creates no job", () => {
    const { ctx } = factory();
    const p = ctx.store.createProposal({ ...idea("Otra"), line: "blog" });
    rejectProposal(ctx, p.id, "no hace falta");
    expect(ctx.store.getProposal(p.id)).toMatchObject({ status: "rejected", note: "no hace falta", decidedAt: expect.any(String) });
    expect(() => rejectProposal(ctx, p.id)).toThrow(/ya fue rechazada/);
    expect(() => rejectProposal(ctx, "00000000")).toThrow(/No existe la propuesta/);
    expect(ctx.store.listJobs()).toHaveLength(0);
  });
});

describe("briefing", () => {
  it("opens with the night shift when there are new proposals or night-shift jobs", async () => {
    const { ctx } = factory();
    expect((await briefing(ctx)).body).not.toContain("Turno nocturno");
    const p = ctx.store.createProposal({ ...idea("Cubrir egress"), line: "blog" });
    const q = ctx.store.createProposal({ ...idea("Bajar costos"), line: "tienda" });
    const { job } = approveProposal(ctx, q.id);
    ctx.store.finishJob(job.id, "failed", { reason: "la verificación no pasó" });
    const body = (await briefing(ctx)).body;
    expect(body.match(/^## .*/m)![0]).toBe("## Turno nocturno");
    expect(body).toContain(`\`${p.id}\` (blog) **Cubrir egress**`);
    expect(body).toContain(`\`${job.id}\` (tienda)`);
    expect(body).toContain("la verificación no pasó");
  });
});
