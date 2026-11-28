import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { agentName, quotaAttrs } from "../src/agent.js";
import { ANDON_KEY, briefing, factoryStatus, requestUnjam, waitUnjamStart } from "../src/app.js";
import { runDaemon } from "../src/daemon.js";
import { formatStatus } from "../src/format.js";
import { mergeKey } from "../src/line/automerge.js";
import { closeInterruptedUnjam, readDiagnosis, readUnjamRequest, readUnjamRun, UNJAM_REQUEST_KEY, UNJAM_RUN_KEY, unjamKey, unjamOnDemandPass, unjamPass, unjamPassKey, unjamUrgentKey, type UnjamRunRecord } from "../src/line/unjam.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const at = (h: number, m = 0, day = 29) => new Date(2026, 9, day, h, m);

const factory = (over: Record<string, unknown> = {}, start = at(14)) => testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => start);
const twoLines = () => [
  { name: "tienda", repo: gitRepo() },
  { name: "blog", repo: gitRepo() },
];
type Ctx = ReturnType<typeof factory>;

function failedJob(ctx: Ctx, line = "tienda", finishedAt = at(12)) {
  const job = ctx.store.createJob({ line, kind: "request", request: "arreglar el carrito", budgetUsd: 1 });
  return ctx.store.updateJob(job.id, { status: "failed", reason: "verify falló", attempt: 3, finishedAt: finishedAt.toISOString() });
}

const cause = (over: Record<string, unknown> = {}) => ({ title: "Checks de android rotos", kind: "ci", jams: [], diagnosis: "El workflow de android falla", action: "none", todo: "Revisá el workflow", ...over });
const fix = (over: Record<string, unknown> = {}) => cause({ title: "Actualizar el workflow", kind: "code", action: "fix", request: "Actualizá el workflow", paths: ["src/a.ts"], estimatedUsd: 0.5, needsNewCredentials: false, todo: null, ...over });
const diagnosing = (causes: unknown[] = [], cost = 0.1) => fakeAgents({ unjam: () => ({ output: { causes } }) }, cost);
const spend = (ctx: Ctx, station: string, usd: number, engine = "claude") =>
  ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": station, "zero.engine": engine, "zero.billing": "api" } }).end("ok", { "zero.cost.usd": usd, ...quotaAttrs({ billing: "api", windows: [] }) });
function ask(ctx: Ctx, line?: string, now = at(13)) {
  const r = requestUnjam(ctx, line, now);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("asking for an on-demand unjam run", () => {
  it("stores one pending request for a line, with its time", () => {
    const ctx = factory();
    expect(requestUnjam(ctx, "tienda", at(13))).toMatchObject({ ok: true, requestedAt: at(13).toISOString(), text: expect.stringContaining("tienda") });
    expect(readUnjamRequest(ctx.store)).toEqual({ requestedAt: at(13).toISOString(), line: "tienda" });
  });

  it("without a line it is for every line", () => {
    const ctx = factory();
    expect(requestUnjam(ctx, undefined, at(13))).toMatchObject({ ok: true, text: expect.stringContaining("todas las líneas") });
    expect(readUnjamRequest(ctx.store)).toEqual({ requestedAt: at(13).toISOString() });
  });

  it("keeps clear of a line's keys, whatever the line is called", () => {
    for (const key of [UNJAM_REQUEST_KEY, UNJAM_RUN_KEY]) expect(key).not.toContain(":");
  });

  it("refuses a second one for any line, and leaves the first as it was", () => {
    const ctx = factory();
    ask(ctx, "tienda");
    const stored = ctx.store.getKv(UNJAM_REQUEST_KEY);
    for (const line of ["tienda", undefined]) {
      const r = requestUnjam(ctx, line, at(15));
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("pendiente") });
      expect(r).toMatchObject({ reason: expect.stringContaining(at(13).toISOString()) });
    }
    expect(ctx.store.getKv(UNJAM_REQUEST_KEY)).toBe(stored);
  });

  it("refuses with the andon on, over the budget, with unjam off, and for an unknown or a package's line", () => {
    const refused = (ctx: Ctx, reason: RegExp, line?: string) => {
      expect(requestUnjam(ctx, line, at(14))).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
      expect(ctx.store.getKv(UNJAM_REQUEST_KEY)).toBeUndefined();
    };
    const andon = factory();
    andon.store.setKv(ANDON_KEY, "on");
    refused(andon, /andon/);
    const spent = factory({ limits: { usdPerDay: 1 } });
    spend(spent, "build", 5);
    refused(spent, /presupuesto/);
    refused(factory({ unjam: "off" }), /apagado/);
    refused(factory(), /no existe la línea "otra"/, "otra");
    const pack = factory();
    pack.config.lines.push({ ...pack.config.lines[0]!, name: "social", package: "redes" });
    refused(pack, /paquete/, "social");
  });
});

describe("running it", () => {
  it("runs with jobs running and queued, outside the night shift's hours", async () => {
    const ctx = factory({ nightShift: { hours: "22:00-06:00" } });
    failedJob(ctx);
    ctx.store.updateJob(ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 }).id, { status: "running" });
    ctx.store.createJob({ line: "tienda", kind: "request", request: "y", budgetUsd: 1 });
    const agents = diagnosing();
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls.map((c) => [c.station, c.line])).toEqual([["unjam", "tienda"]]);
    expect(readDiagnosis(ctx.store, "tienda")).toMatchObject({ at: at(14).toISOString() });
  });

  it("runs with the night shift off", async () => {
    const ctx = factory({ nightShift: "off" });
    failedJob(ctx);
    const agents = diagnosing();
    ask(ctx, "tienda");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.unjam).toBe(1);
  });

  it("diagnoses again a line already diagnosed in the period", async () => {
    const ctx = factory();
    failedJob(ctx);
    const agents = diagnosing();
    await unjamPass(ctx, agents.runner, at(13));
    ask(ctx, "tienda");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.unjam).toBe(2);
  });

  it("only the line asked for", async () => {
    const ctx = factory({ lines: twoLines() });
    failedJob(ctx, "tienda");
    failedJob(ctx, "blog");
    const agents = diagnosing();
    ask(ctx, "blog");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls.map((c) => c.line)).toEqual(["blog"]);
    expect(readUnjamRun(ctx.store)).toMatchObject({ line: "blog", lines: [{ line: "blog", jams: 1, causes: 0 }] });
  });

  it("every line but the packages'", async () => {
    const ctx = factory({ lines: twoLines() });
    ctx.config.lines.push({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    for (const line of ["tienda", "blog", "social"]) failedJob(ctx, line);
    const agents = diagnosing();
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls.map((c) => c.line)).toEqual(["tienda", "blog"]);
  });

  it("leaves the marks of the regular and daytime passes alone, so the regular one still runs", async () => {
    const ctx = factory();
    failedJob(ctx);
    const agents = diagnosing();
    ask(ctx, "tienda");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(ctx.store.getKv(unjamPassKey("tienda"))).toBeUndefined();
    expect(ctx.store.getKv(unjamUrgentKey("tienda"))).toBeUndefined();
    await unjamPass(ctx, agents.runner, at(15));
    expect(agents.count.unjam).toBe(2);
    expect(ctx.store.getKv(unjamPassKey("tienda"))).toBeDefined();
  });

  it("does nothing without a request", async () => {
    const ctx = factory();
    failedJob(ctx);
    const agents = diagnosing();
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRun(ctx.store)).toBeUndefined();
  });
});

describe("the regular pass's limits", () => {
  it("keeps unjam.maxJobsPerDay", async () => {
    const ctx = factory({ nightShift: { autonomy: "auto" }, unjam: { maxJobsPerDay: 1 } });
    const jams = [`job:${failedJob(ctx).id}`];
    ask(ctx);
    await unjamOnDemandPass(ctx, diagnosing([fix({ jams })]).runner, at(14));
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(1);
    ask(ctx);
    await unjamOnDemandPass(ctx, diagnosing([fix({ title: "Estabilizar el test", jams })]).runner, at(15));
    expect(ctx.store.listProposals({ line: "tienda" }).map((p) => [p.title, p.status]).sort()).toEqual([
      ["Actualizar el workflow", "approved"],
      ["Estabilizar el test", "pending"],
    ]);
    expect(ctx.store.listJobs({ status: ["queued"] })).toHaveLength(1);
  });

  it("repeats no title an unjam proposal still holds", async () => {
    const ctx = factory({ nightShift: { autonomy: "propose" } });
    const jams = [`job:${failedJob(ctx).id}`];
    ask(ctx);
    await unjamOnDemandPass(ctx, diagnosing([fix({ jams })]).runner, at(14));
    ask(ctx);
    await unjamOnDemandPass(ctx, diagnosing([fix({ title: "actualizar el  WORKFLOW", jams })]).runner, at(15));
    expect(ctx.store.listProposals({ line: "tienda" })).toHaveLength(1);
  });

  it("calls no agent for a line without jams, and drops its old diagnosis", async () => {
    const ctx = factory();
    ctx.store.setKv(unjamKey("tienda"), JSON.stringify({ at: at(2).toISOString(), causes: [] }));
    const agents = diagnosing();
    ask(ctx, "tienda");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readDiagnosis(ctx.store, "tienda")).toBeUndefined();
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok", reason: "la línea tienda no tiene trabas", lines: [{ line: "tienda", jams: 0, causes: 0 }] });
  });

  it("caps each call with what is left of usdPerNight", async () => {
    const ctx = factory({ limits: { usdPerNight: 1 } });
    failedJob(ctx);
    spend(ctx, "scout", 0.4);
    const agents = diagnosing();
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls[0]!.maxBudgetUsd).toBeCloseTo(0.6);
  });

  it("calls no agent with usdPerNight spent, and ends as stopped", async () => {
    const ctx = factory({ limits: { usdPerNight: 1 } });
    failedJob(ctx);
    spend(ctx, "scout", 1);
    const agents = diagnosing();
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRequest(ctx.store)).toBeUndefined();
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("usdPerNight"), lines: [] });
  });
});

describe("what holds a request back or cuts a run", () => {
  it("stays pending while the andon is on, and runs once it is lifted", async () => {
    const ctx = factory();
    failedJob(ctx);
    const agents = diagnosing();
    ask(ctx);
    ctx.store.setKv(ANDON_KEY, "on");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRequest(ctx.store)).toBeDefined();
    expect(readUnjamRun(ctx.store)).toBeUndefined();
    ctx.store.setKv(ANDON_KEY, "off");
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.unjam).toBe(1);
    expect(readUnjamRequest(ctx.store)).toBeUndefined();
  });

  it("stays pending while the budget is reached", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 } });
    failedJob(ctx);
    ask(ctx);
    spend(ctx, "build", 5);
    const agents = diagnosing();
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRequest(ctx.store)).toBeDefined();
    expect(readUnjamRun(ctx.store)).toBeUndefined();
  });

  it("an andon between lines stops it with the first line's result", async () => {
    const ctx = factory({ lines: twoLines() });
    failedJob(ctx, "tienda");
    failedJob(ctx, "blog");
    const agents = fakeAgents({
      unjam: () => {
        ctx.store.setKv(ANDON_KEY, "on");
        return { output: { causes: [] } };
      },
    });
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls.map((c) => c.line)).toEqual(["tienda"]);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("andon"), lines: [{ line: "tienda", jams: 1, causes: 0 }] });
  });

  it("the budget reached between lines stops it", async () => {
    const ctx = factory({ lines: twoLines(), limits: { usdPerDay: 1 } });
    failedJob(ctx, "tienda");
    failedJob(ctx, "blog");
    const agents = fakeAgents({
      unjam: () => {
        spend(ctx, "build", 5);
        return { output: { causes: [] } };
      },
    });
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.unjam).toBe(1);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("presupuesto") });
  });

  it("a missing engine stops it", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 }, stations: { unjam: { engine: "codex" } } });
    failedJob(ctx);
    ask(ctx);
    // Only the unjam station works with this engine, so the budget itself is not reached.
    spend(ctx, "reply", 2, "codex");
    const agents = diagnosing();
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("motor"), lines: [] });
  });

  it("a shutdown during a call stops it, without taking the line for failed", async () => {
    const ctx = factory({ lines: twoLines() });
    failedJob(ctx, "tienda");
    failedJob(ctx, "blog");
    const stop = new AbortController();
    const agents = fakeAgents({
      unjam: () => {
        stop.abort();
        return { ok: false, text: "cut" };
      },
    });
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14), { signal: stop.signal });
    expect(agents.count.unjam).toBe(1);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("apagó"), lines: [] });
  });
});

describe("the record of a run", () => {
  it("has when it was asked, started and ended, its outcome and each line's jams and causes", async () => {
    const ctx = factory();
    const jams = [failedJob(ctx), failedJob(ctx)].map((j) => `job:${j.id}`);
    const { requestedAt } = ask(ctx, "tienda");
    await unjamOnDemandPass(ctx, diagnosing([cause({ jams })]).runner, at(14));
    expect(readUnjamRequest(ctx.store)).toBeUndefined();
    expect(readUnjamRun(ctx.store)).toEqual({ asked: requestedAt, line: "tienda", startedAt: at(14).toISOString(), endedAt: at(14).toISOString(), outcome: "ok", lines: [{ line: "tienda", jams: 2, causes: 1 }] });
  });

  it("while it runs, it has no end and nothing is pending, so another can be asked for", async () => {
    const ctx = factory();
    failedJob(ctx);
    let during: UnjamRunRecord | undefined;
    let pending: unknown = "not looked";
    const agents = fakeAgents({
      unjam: () => {
        during = readUnjamRun(ctx.store);
        pending = readUnjamRequest(ctx.store);
        ask(ctx, "tienda", at(15));
        return { output: { causes: [] } };
      },
    });
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(during).toMatchObject({ startedAt: at(14).toISOString() });
    expect(during!.endedAt).toBeUndefined();
    expect(pending).toBeUndefined();
    expect(readUnjamRequest(ctx.store)).toEqual({ requestedAt: at(15).toISOString(), line: "tienda" });
  });

  it("a line without a valid diagnosis makes it failed and is named", async () => {
    const ctx = factory({ lines: twoLines() });
    failedJob(ctx, "tienda");
    failedJob(ctx, "blog");
    const agents = fakeAgents({ unjam: (req) => (req.line === "tienda" ? { ok: false, text: "bad output" } : { output: { causes: [] } }) });
    ask(ctx);
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.unjam).toBe(2);
    expect(readUnjamRun(ctx.store)).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("tienda"),
      lines: [
        { line: "tienda", jams: 1, causes: 0, failed: true },
        { line: "blog", jams: 1, causes: 0 },
      ],
    });
  });

  it("a line gone, or unjam turned off, before the start clears the request as not run", async () => {
    const gone = factory();
    failedJob(gone);
    ask(gone, "tienda");
    gone.config = { ...gone.config, lines: [] };
    const off = factory();
    failedJob(off);
    ask(off);
    off.config = { ...off.config, unjam: "off" };
    const agents = diagnosing();
    for (const ctx of [gone, off]) {
      await unjamOnDemandPass(ctx, agents.runner, at(14));
      expect(readUnjamRequest(ctx.store)).toBeUndefined();
      const run = readUnjamRun(ctx.store)!;
      expect(run).toMatchObject({ outcome: "not-run", reason: expect.any(String), endedAt: expect.any(String) });
      expect(run.startedAt).toBeUndefined();
    }
    expect(agents.calls).toHaveLength(0);
  });

  it("a job closed between the request and the run is no jam", async () => {
    const ctx = factory();
    const job = failedJob(ctx);
    ask(ctx, "tienda");
    ctx.store.updateJob(job.id, { status: "stopped" });
    const agents = diagnosing();
    await unjamOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok", reason: expect.stringContaining("no tiene trabas") });
  });

  it("one left without an end is closed as stopped; an ended one stays as it was", () => {
    const ctx = factory();
    const record = { asked: at(12).toISOString(), startedAt: at(13).toISOString(), lines: [] };
    ctx.store.setKv(UNJAM_RUN_KEY, JSON.stringify(record));
    closeInterruptedUnjam(ctx, at(14));
    const closed = readUnjamRun(ctx.store);
    expect(closed).toMatchObject({ ...record, endedAt: at(14).toISOString(), outcome: "stopped", reason: expect.any(String) });
    closeInterruptedUnjam(ctx, at(15));
    expect(readUnjamRun(ctx.store)).toEqual(closed);
  });
});

describe("waiting for the start", () => {
  const noSleep = async () => undefined;
  const run = (ctx: Ctx, over: Partial<UnjamRunRecord>) => ctx.store.setKv(UNJAM_RUN_KEY, JSON.stringify({ asked: at(13).toISOString(), lines: [], ...over }));

  it("answers once the record of that request has a start, and says when", async () => {
    const ctx = factory();
    const { requestedAt } = ask(ctx);
    run(ctx, { asked: at(11).toISOString(), startedAt: at(11, 5).toISOString() });
    let polls = 0;
    const sleep = async () => {
      if (++polls === 2) run(ctx, { startedAt: at(14, 7).toISOString() });
    };
    expect(await waitUnjamStart(ctx, requestedAt, { timeoutMs: 1000, pollMs: 100, sleep })).toMatchObject({ started: true, text: expect.stringContaining("14:07") });
    expect(polls).toBe(2);
  });

  it("says it is still pending once the limit passes", async () => {
    const ctx = factory();
    expect(await waitUnjamStart(ctx, ask(ctx).requestedAt, { timeoutMs: 300, pollMs: 100, sleep: noSleep })).toMatchObject({ started: false, text: expect.stringContaining("sigue pendiente") });
  });

  it("says why at once when it ended without starting", async () => {
    const ctx = factory();
    const { requestedAt } = ask(ctx);
    run(ctx, { endedAt: at(14).toISOString(), outcome: "not-run", reason: "el destrabador está apagado" });
    const sleep = vi.fn(noSleep);
    expect(await waitUnjamStart(ctx, requestedAt, { timeoutMs: 300, sleep })).toMatchObject({ started: false, text: expect.stringContaining("apagado") });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("the daemon", () => {
  const once = { once: true, pollMs: 10, panel: false };
  const onDemand = { ...once, unjamOnDemand: true };

  it("runs a pending request, with the regular and daytime unjam off", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    failedJob(ctx, "tienda", now);
    ask(ctx, "tienda", now);
    const agents = diagnosing();
    await runDaemon(ctx, { ...onDemand, unjam: false, urgentUnjam: false, agentRunner: () => agents.runner });
    expect(agents.calls.map(agentName)).toEqual(["unjam"]);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok" });
  });

  it("leaves it pending in a once run without the option", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    failedJob(ctx, "tienda", now);
    ask(ctx, "tienda", now);
    const agents = diagnosing();
    await runDaemon(ctx, { ...once, agentRunner: () => agents.runner });
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRequest(ctx.store)).toBeDefined();
  });

  it("closes the record a crashed daemon left", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ctx.store.setKv(UNJAM_RUN_KEY, JSON.stringify({ asked: now.toISOString(), startedAt: now.toISOString(), lines: [] }));
    await runDaemon(ctx, { ...once, agentRunner: () => fakeAgents({}).runner });
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "stopped", endedAt: expect.any(String) });
  });

  it("a request that arrives during the idle run goes before its next step, and no two steps overlap", async () => {
    const now = new Date();
    const ctx = factory({ level: "L2", lines: [{ name: "tienda", repo: gitRepo(), stations: { research: { skills: ["investigar"] } } }] }, now);
    failedJob(ctx, "tienda", now);
    let busy = 0;
    let most = 0;
    const order: string[] = [];
    const step = async (name: string) => {
      order.push(`${name}+`);
      most = Math.max(most, ++busy);
      await new Promise((r) => setTimeout(r, 30));
      busy--;
      order.push(`${name}-`);
    };
    const agents = fakeAgents({
      scout: async () => {
        ask(ctx, "tienda", now);
        await step("scout");
        return {};
      },
      unjam: async () => {
        // The regular pass marks its period before its call; the one asked for does not.
        await step(ctx.store.getKv(unjamPassKey("tienda")) ? "unjam" : "on-demand");
        return { output: { causes: [] } };
      },
      research: async () => {
        await step("research");
        return {};
      },
    });
    await runDaemon(ctx, { ...onDemand, scout: true, unjam: true, research: true, agentRunner: () => agents.runner });
    expect(order).toEqual(["scout+", "scout-", "on-demand+", "on-demand-", "unjam+", "unjam-", "research+", "research-"]);
    expect(most).toBe(1);
  });

  it("goes ahead of the daytime pass, which does not run along with it", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
    ctx.store.updateJob(job.id, { status: "delivered", delivery: { mode: "pull-request", branch: `zero/${job.id}`, url: "https://github.com/acme/tienda/pull/1", autoMerge: true } });
    ctx.store.setKv(mergeKey(job.id), JSON.stringify({ status: "blocked", why: "x", blockedSince: new Date(now.getTime() - 3 * 3_600_000).toISOString() }));
    ask(ctx, "tienda", now);
    const agents = diagnosing();
    await runDaemon(ctx, { ...onDemand, unjam: false, urgentUnjam: true, merges: () => undefined, agentRunner: () => agents.runner });
    expect(agents.count.unjam).toBe(1);
    expect(ctx.store.getKv(unjamUrgentKey("tienda"))).toBeUndefined();
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok" });
  });

  it("takes no job's place: the running job is neither stopped nor sent back", async () => {
    const now = new Date();
    const ctx = factory({ concurrency: 1 }, now);
    failedJob(ctx, "tienda", now);
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "otro", budgetUsd: 1 });
    let duringUnjam: string | undefined;
    let aborted: boolean | undefined;
    let free = () => {};
    const unjammed = new Promise<void>((r) => (free = r));
    const agents = fakeAgents({
      spec: async (req, n) => {
        // A failed spec is tried again; only the first call asks.
        if (n === 1) ask(ctx, "tienda", now);
        await unjammed;
        aborted = req.signal?.aborted ?? false;
        return { ok: false, text: "no hay spec" };
      },
      unjam: () => {
        duringUnjam = ctx.store.getJob(job.id)!.status;
        free();
        return { output: { causes: [] } };
      },
    });
    await runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
    expect(agents.count.unjam).toBe(1);
    expect(duringUnjam).toBe("running");
    expect(aborted).toBe(false);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "ok" });
  });

  it("records as not run a request whose line was removed from the file", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, "tienda", now);
    writeFileSync(ctx.home.config, stringify({ isolation: "worktree", lines: [{ name: "otra", repo: gitRepo() }] }));
    const agents = diagnosing();
    await runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
    expect(agents.calls).toHaveLength(0);
    expect(readUnjamRun(ctx.store)).toMatchObject({ outcome: "not-run", reason: expect.stringContaining("tienda") });
  });
});

describe("seeing it", () => {
  const stored = (over: Partial<UnjamRunRecord> = {}): UnjamRunRecord => ({ asked: at(13).toISOString(), line: "tienda", startedAt: at(13, 5).toISOString(), endedAt: at(13, 7).toISOString(), outcome: "ok", lines: [{ line: "tienda", jams: 2, causes: 1 }], ...over });
  const recorded = (over: Partial<UnjamRunRecord> = {}, start = at(14)) => {
    const ctx = factory({}, start);
    ctx.store.setKv(UNJAM_RUN_KEY, JSON.stringify(stored(over)));
    return ctx;
  };
  const shown = (ctx: Ctx, now = at(14)) => formatStatus(factoryStatus(ctx), now).split("\n").filter((l) => l.includes("destrabador"));

  it("the status carries whether it is on, the lines that are not a package's, the request and the last run", () => {
    const ctx = factory({ lines: twoLines() });
    ctx.config.lines.push({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    expect(factoryStatus(ctx).unjam).toEqual({ enabled: true, lines: ["tienda", "blog"] });
    ask(ctx, "tienda");
    expect(factoryStatus(ctx).unjam.pending).toEqual({ requestedAt: at(13).toISOString(), line: "tienda" });
    expect(factoryStatus(recorded()).unjam.last).toEqual(stored());
    expect(factoryStatus(factory({ unjam: "off" })).unjam.enabled).toBe(false);
  });

  it("zero status says nothing without a request or a run", () => {
    expect(shown(factory())).toEqual([]);
  });

  it("zero status shows the pending request, for which line and since when", () => {
    const ctx = factory();
    ask(ctx, "tienda");
    expect(shown(ctx)).toEqual(["Corrida a demanda del destrabador: pendiente para tienda desde 13:00"]);
    const all = factory();
    ask(all);
    expect(shown(all)).toEqual(["Corrida a demanda del destrabador: pendiente para todas las líneas desde 13:00"]);
  });

  it("zero status shows a run under way and since when", () => {
    expect(shown(recorded({ endedAt: undefined, outcome: undefined, lines: [] }))).toEqual(["Última corrida a demanda del destrabador: pedida para tienda 13:00, corriendo desde 13:05"]);
  });

  it("zero status shows how it ended, when, and each line's jams and causes", () => {
    expect(shown(recorded())).toEqual(["Última corrida a demanda del destrabador: pedida para tienda 13:00, empezó 13:05, terminó bien (13:07) · tienda: 2 trabas, 1 causa"]);
    const lines = [
      { line: "tienda", jams: 0, causes: 0 },
      { line: "blog", jams: 1, causes: 0, failed: true },
    ];
    expect(shown(recorded({ line: undefined, outcome: "failed", reason: "no hubo un diagnóstico válido de blog", lines }))[0]).toContain("pedida para todas las líneas 13:00, empezó 13:05, falló (13:07): no hubo un diagnóstico válido de blog · tienda: sin trabas · blog: 1 traba, sin diagnóstico válido");
    expect(shown(recorded({ outcome: "stopped", reason: "la fábrica se detuvo (andon)", lines: [] }))[0]).toContain("se cortó (13:07): la fábrica se detuvo (andon)");
    expect(shown(recorded({ startedAt: undefined, outcome: "not-run", reason: "no existe la línea", lines: [] }))[0]).toContain("pedida para tienda 13:00, no pudo correr (13:07): no existe la línea");
  });

  it("zero status names the jobs it closed because they were already resolved", () => {
    const one = [{ line: "tienda", job: "a1b2c3d4" }];
    expect(shown(recorded({ closed: one, lines: [{ line: "tienda", jams: 0, causes: 0 }] }))).toEqual([
      "Última corrida a demanda del destrabador: pedida para tienda 13:00, empezó 13:05, terminó bien (13:07) · cerró 1 trabajo que ya estaba resuelto (tienda: a1b2c3d4) · tienda: sin trabas",
    ]);
    const two = [
      { line: "tienda", job: "a1b2c3d4" },
      { line: "blog", job: "12345678" },
      { line: "tienda", job: "e5f6a7b8" },
    ];
    expect(shown(recorded({ closed: two }))[0]).toContain("terminó bien (13:07) · cerró 3 trabajos que ya estaban resueltos (tienda: a1b2c3d4, e5f6a7b8; blog: 12345678) · tienda: 2 trabas");
    const seven = Array.from({ length: 7 }, (_, i) => ({ line: "tienda", job: `0000000${i}` }));
    expect(shown(recorded({ closed: seven }))[0]).toContain("cerró 7 trabajos que ya estaban resueltos (tienda: 00000000, 00000001, 00000002, 00000003, 00000004 y 2 más)");
    expect(shown(recorded({ outcome: "stopped", reason: "se alcanzó el presupuesto", closed: one }))[0]).toContain("se cortó (13:07): se alcanzó el presupuesto · cerró 1 trabajo que ya estaba resuelto (tienda: a1b2c3d4)");
  });

  it("zero status reads an older record without closed as before", () => {
    const before = "Última corrida a demanda del destrabador: pedida para tienda 13:00, empezó 13:05, terminó bien (13:07) · tienda: 2 trabas, 1 causa";
    const old = recorded();
    expect(readUnjamRun(old.store)).not.toHaveProperty("closed");
    expect(shown(old)).toEqual([before]);
    expect(shown(recorded({ closed: "x" as unknown as UnjamRunRecord["closed"] }))).toEqual([before]);
    expect(shown(recorded({ closed: [] }))).toEqual([before]);
  });

  it("zero status dates a run of more than a few days ago", () => {
    expect(shown(recorded({}, new Date(2026, 10, 20, 9)), new Date(2026, 10, 20, 9))[0]).toContain("29/10/2026 13:07");
  });

  it("the briefing lists the run that started or ended in its period, and what is pending", async () => {
    const ctx = recorded({ outcome: "failed", reason: "no hubo un diagnóstico válido de tienda" });
    let body = (await briefing(ctx, 1)).body;
    expect(body).toContain("## Corridas a demanda");
    expect(body).toMatch(/^- destrabador: pedida para tienda 13:00, empezó 13:05, falló \(13:07\)/m);
    ask(ctx, "tienda");
    body = (await briefing(ctx, 1)).body;
    expect(body).toMatch(/^- destrabador: pendiente para tienda desde 13:00$/m);
    const running = recorded({ endedAt: undefined, outcome: undefined, lines: [] });
    expect((await briefing(running, 1)).body).toMatch(/^- destrabador: .*corriendo desde 13:05$/m);
  });

  it("the briefing says nothing of a run of another period", async () => {
    expect((await briefing(recorded({}, at(14, 0, 31)), 1)).body).not.toContain("Corridas a demanda");
  });
});

describe("asking from the terminal and the chat", () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  });
  const zero = (ctx: Ctx, ...args: string[]) => {
    const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
    return { code: r.status, output: r.stdout + r.stderr };
  };
  async function chat(ctx: Ctx, opts: ZeroMcpOptions = {}) {
    const server = createZeroMcpServer(ctx.home, { autoStart: false, stationWaitMs: 0, ...opts });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    clients.push(client);
    const names = async () => (await client.listTools()).tools.map((t) => t.name);
    const unjam = async (args: Record<string, unknown> = {}) => ((await client.callTool({ name: "zero_unjam", arguments: args })) as { content: { text: string }[] }).content[0]!.text;
    return { names, unjam };
  }

  it("the usage lists zero destrabar", () => {
    expect(zero(factory(), "help").output).toContain("zero destrabar [línea]");
  }, 60_000);

  it("zero destrabar with the andon on tells the reason and exits 1", () => {
    const ctx = factory();
    ctx.store.setKv(ANDON_KEY, "on");
    const r = zero(ctx, "destrabar");
    expect(r.code).toBe(1);
    expect(r.output).toContain("andon");
    expect(readUnjamRequest(ctx.store)).toBeUndefined();
  }, 60_000);

  it("zero destrabar starts the factory and waits as zero package run does", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    const command = cli.slice(cli.indexOf('case "destrabar"'), cli.indexOf('case "resume"'));
    expect(command).toContain("await ensureDaemon(ctx)");
    expect(command).toContain("waitUnjamStart(ctx, r.requestedAt, { timeoutMs: STATION_WAIT_MS })");
  });

  it("zero_unjam asks for the run of a line and says it is still pending", async () => {
    const ctx = factory();
    const { names, unjam } = await chat(ctx);
    expect(await names()).toContain("zero_unjam");
    const text = await unjam({ line: "tienda" });
    expect(text).toContain("Corrida del destrabador pedida para tienda");
    expect(text).toContain("sigue pendiente");
    expect(readUnjamRequest(ctx.store)).toMatchObject({ line: "tienda" });
  });

  it("zero_unjam without a line asks for every line, and says when the factory was off", async () => {
    const ctx = factory();
    const start = vi.fn(async () => true);
    const text = await (await chat(ctx, { autoStart: true, start })).unjam();
    expect(text).toContain("todas las líneas");
    expect(text).toContain("La fábrica estaba apagada: la encendí.");
    expect(readUnjamRequest(ctx.store)).toEqual({ requestedAt: expect.any(String) });
  });

  it("zero_unjam answers the refusal and changes nothing with one already pending", async () => {
    const ctx = factory();
    ask(ctx, "tienda");
    const before = ctx.store.getKv(UNJAM_REQUEST_KEY);
    const text = await (await chat(ctx)).unjam();
    expect(text).toContain("ya hay una corrida del destrabador pendiente");
    expect(text).toContain(at(13).toISOString());
    expect(ctx.store.getKv(UNJAM_REQUEST_KEY)).toBe(before);
  });

  it("a remote chat has it only with zero:act", async () => {
    const ctx = factory();
    expect(await (await chat(ctx, { remote: { scope: ["zero:read"], client: "c" } })).names()).not.toContain("zero_unjam");
    const acting = await chat(ctx, { remote: { scope: ["zero:read", "zero:act"], client: "c" } });
    expect(await acting.unjam({ line: "tienda" })).toContain("pedida para tienda");
    expect(readUnjamRequest(ctx.store)).toMatchObject({ line: "tienda" });
  });
});
