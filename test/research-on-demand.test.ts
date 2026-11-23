import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { agentInstructions, createAgentRunner, quotaAttrs } from "../src/agent.js";
import { ANDON_KEY, briefing, factoryStatus, listResearchNotes, requestFromResearchNote, requestInvestigation, researchView, SHUTDOWN_KEY, waitResearchEnd, waitResearchStart } from "../src/app.js";
import { budgetState } from "../src/budget.js";
import { ConfigError, parseFactory } from "../src/config.js";
import { acquireDaemonLock } from "../src/daemon-lock.js";
import { runDaemon } from "../src/daemon.js";
import { formatResearchNotes, formatStatus } from "../src/format.js";
import {
  closeInterruptedResearch,
  readResearchRequest,
  readResearchRuns,
  RESEARCH_REQUEST_KEY,
  RESEARCH_RUNS_KEY,
  RESEARCH_TOLD_KEY,
  researchOnDemandPass,
  researchOnDemandReady,
  researchPass,
  researchTopicPrompt,
  type ResearchRunRecord,
} from "../src/line/research.js";
import { ON_DEMAND_ATTR, scoutSpent } from "../src/line/scout.js";
import { log } from "../src/log.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { Store } from "../src/state/store.js";
import { AGENT_SPAN, startOfDay } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m);
const TOPIC = "cómo viralizar un reel";

const factory = (over: Record<string, unknown> = {}, start = at(14)) => testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => start);
const twoLines = () => [
  { name: "tienda", repo: gitRepo() },
  { name: "blog", repo: gitRepo() },
];
type Ctx = ReturnType<typeof factory>;

const note = (topic: string, over: Record<string, unknown> = {}) => ({ topic, findings: "El gancho va en los primeros 3 segundos.", sources: ["https://example.com/reels"], serves: "contenido", maturity: "estable", ...over });
const researching = (notes: unknown[] = [note("Reels")]) => fakeAgents({ research: () => ({ output: { notes } }) });
const spend = (ctx: Ctx, station: string, usd: number, attrs: Record<string, boolean> = {}, engine = "claude") =>
  ctx.tracer.start(AGENT_SPAN, { attrs: { ...attrs, "gen_ai.agent.name": station, "zero.engine": engine } }).end("ok", { "zero.cost.usd": usd, ...quotaAttrs({ billing: "api", windows: [] }) });
const subscription = (ctx: Ctx) => ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 0, ...quotaAttrs({ billing: "subscription", windows: [] }) });
function ask(ctx: Ctx, topic = TOPIC, line: string | undefined = "tienda", now = at(13)) {
  const r = requestInvestigation(ctx, topic, line, now);
  if (!r.ok) throw new Error(r.reason);
  return r;
}
const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("asking for an express run", () => {
  it("stores the topic, the line and when it was asked", () => {
    const ctx = factory({ lines: twoLines() });
    expect(requestInvestigation(ctx, ` ${TOPIC} `, "tienda", at(13))).toMatchObject({ ok: true, requestedAt: at(13).toISOString(), text: expect.stringContaining("tienda") });
    expect(readResearchRequest(ctx.store)).toEqual({ requestedAt: at(13).toISOString(), line: "tienda", topic: TOPIC });
  });

  it("without a line it is for the only one that is not a package's", () => {
    const ctx = factory();
    ctx.config.lines.unshift({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    expect(requestInvestigation(ctx, TOPIC, undefined, at(13))).toMatchObject({ ok: true });
    expect(readResearchRequest(ctx.store)).toMatchObject({ line: "tienda" });
  });

  it("scrubs local paths and tokens from the topic", () => {
    const ctx = factory();
    const token = `ghp_${"a1B2".repeat(9)}`;
    ask(ctx, `mirá C:\\Users\\ana\\x con ${token} y los reels`);
    const { topic } = readResearchRequest(ctx.store)!;
    expect(topic).not.toContain("ana");
    expect(topic).not.toContain(token);
    expect(topic).toContain("los reels");
  });

  it("refuses a second one for any line, and leaves the first as it was", () => {
    const ctx = factory({ lines: twoLines() });
    ask(ctx);
    const stored = ctx.store.getKv(RESEARCH_REQUEST_KEY);
    for (const line of ["tienda", "blog"]) {
      const r = requestInvestigation(ctx, "otro", line, at(15));
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("pendiente") });
      expect(r).toMatchObject({ reason: expect.stringContaining(at(13).toISOString()) });
    }
    expect(ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBe(stored);
  });

  it("keeps clear of the lines' research marks", () => {
    for (const key of [RESEARCH_REQUEST_KEY, RESEARCH_RUNS_KEY, RESEARCH_TOLD_KEY]) expect(key).not.toContain(":");
  });

  const refused = (ctx: Ctx, reason: RegExp, topic = TOPIC, line?: string) => {
    expect(requestInvestigation(ctx, topic, line, at(14))).toMatchObject({ ok: false, reason: expect.stringMatching(reason) });
    expect(ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBeUndefined();
  };

  it("refuses with the andon on, over the budget and with research off", () => {
    const andon = factory();
    andon.store.setKv(ANDON_KEY, "on");
    refused(andon, /andon/);
    const spent = factory({ limits: { usdPerDay: 1 } });
    spend(spent, "build", 5);
    refused(spent, /presupuesto/);
    refused(factory({ research: "off" }), /research: off/);
  });

  it("refuses a blank topic and one over 2000 characters", () => {
    refused(factory(), /tema/, "  \n ");
    refused(factory(), /2000/, "a".repeat(2001));
    expect(requestInvestigation(factory(), "a".repeat(2000), undefined, at(14))).toMatchObject({ ok: true });
  });

  it("refuses an unknown line, a package's, and none with several", () => {
    refused(factory(), /no existe la línea "otra"/, TOPIC, "otra");
    const pack = factory();
    pack.config.lines.push({ ...pack.config.lines[0]!, name: "social", package: "redes" });
    refused(pack, /paquete/, TOPIC, "social");
    refused(factory({ lines: twoLines() }), /varias líneas.*tienda, blog/);
  });
});

describe("running it", () => {
  it("runs once with jobs running and queued, outside the night shift's hours", async () => {
    const ctx = factory({ nightShift: { hours: "22:00-06:00" } });
    ctx.store.updateJob(ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 }).id, { status: "running" });
    ctx.store.createJob({ line: "tienda", kind: "request", request: "y", budgetUsd: 1 });
    const agents = researching();
    ask(ctx);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls.map((c) => [c.station, c.line, c.cwd])).toEqual([["research", "tienda", ctx.config.lines[0]!.repo]]);
    expect(agents.calls[0]!.prompt).toContain(TOPIC);
    expect(readResearchRequest(ctx.store)).toBeUndefined();
  });

  it("runs with the night shift off, a zero quota and no research skill", async () => {
    const ctx = factory({ nightShift: "off", research: { perLinePerDay: 0 } });
    ask(ctx);
    await researchOnDemandPass(ctx, researching().runner, at(14));
    expect(ctx.store.listResearchNotes({ line: "tienda" })).toHaveLength(1);
  });

  it("leaves the skill's regular run of the day alone", async () => {
    const ctx = factory({ lines: [{ name: "tienda", repo: gitRepo(), stations: { research: { skills: ["zero-research"], business: ["zero-research"] } } }] });
    const agents = researching();
    ask(ctx);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(ctx.store.listResearchNotes({})[0]).toMatchObject({ business: false });
    expect(ctx.store.listResearchNotes({})[0]!.skill).toBeUndefined();
    await researchPass(ctx, agents.runner, at(15));
    expect(agents.count.research).toBe(2);
    expect(agents.calls[1]!.prompt).toContain("Follow only the research skill `zero-research`");
  });

  it("does nothing without a request", async () => {
    const ctx = factory();
    const agents = researching();
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRuns(ctx.store)).toEqual([]);
  });
});

describe("what holds it back", () => {
  it("stays pending while the andon is on, and runs once it is lifted", async () => {
    const ctx = factory();
    const agents = researching();
    ask(ctx);
    ctx.store.setKv(ANDON_KEY, "on");
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRequest(ctx.store)).toBeDefined();
    expect(readResearchRuns(ctx.store)).toEqual([]);
    ctx.store.setKv(ANDON_KEY, "off");
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.count.research).toBe(1);
  });

  it("stays pending while the budget is reached", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 } });
    ask(ctx);
    spend(ctx, "build", 5);
    const agents = researching();
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRequest(ctx.store)).toBeDefined();
  });

  it("stays pending with the day's dollars spent on another engine than research's", async () => {
    const ctx = factory({ limits: { usdPerDay: 1 }, stations: { research: { engine: "codex" } } });
    ask(ctx);
    spend(ctx, "reply", 2, {}, "other");
    expect(budgetState(ctx.store, ctx.config, at(14)).reached).toBe(false);
    expect(researchOnDemandReady(ctx, at(14))).toBe(false);
  });

  it("stays pending without an engine for research", async () => {
    const ctx = factory({ stations: { research: { engine: "codex" } } });
    ask(ctx);
    // Only the research station works with this engine, so the budget itself is not reached.
    const end = { "zero.cost.usd": 0, ...quotaAttrs({ billing: "subscription", windows: [{ window: "five_hour", label: "5 horas", status: "exhausted", resetsAt: at(18).toISOString() } as never] }) };
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "research", "zero.engine": "codex" } }).end("ok", end);
    const agents = researching();
    expect(budgetState(ctx.store, ctx.config, at(14)).reached).toBe(false);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRequest(ctx.store)).toBeDefined();
    await researchOnDemandPass(ctx, agents.runner, at(19));
    expect(agents.count.research).toBe(1);
  });
});

describe("the cap of a run", () => {
  it("is research.usdPerRun, whatever is left of the night's", async () => {
    const ctx = factory({ limits: { usdPerNight: 0.5, usdPerDay: 11 } });
    spend(ctx, "scout", 1);
    const agents = researching();
    ask(ctx);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls[0]!.maxBudgetUsd).toBe(2);
  });

  it("is what is left of the day when it is less", async () => {
    const ctx = factory({ limits: { usdPerDay: 10 } });
    spend(ctx, "build", 9.5);
    const agents = researching();
    ask(ctx);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls[0]!.maxBudgetUsd).toBe(0.5);
  });

  it("is none on a subscription", async () => {
    const ctx = factory();
    subscription(ctx);
    const agents = researching();
    ask(ctx);
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(agents.calls[0]!.maxBudgetUsd).toBeUndefined();
  });

  it("stops the run that reaches it, without notes", async () => {
    const ctx = factory();
    ask(ctx);
    await researchOnDemandPass(ctx, fakeAgents({ research: () => ({ output: { notes: [note("Reels")] }, budgetLimited: true }) }).runner, at(14));
    expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("research.usdPerRun"), notes: [] });
    expect(ctx.store.listResearchNotes({})).toEqual([]);
  });

  it("refuses zero or a negative number in the file", () => {
    for (const usd of [0, -1]) expect(() => parseFactory(`research: { usdPerRun: ${usd} }`)).toThrow(ConfigError);
    expect(parseFactory("research: { usdPerRun: 0.5 }").research).toMatchObject({ usdPerRun: 0.5 });
  });
});

describe("its spending", () => {
  it("is left out of the night's and counted in the day's", () => {
    const ctx = factory();
    spend(ctx, "research", 1.5, { [ON_DEMAND_ATTR]: true });
    spend(ctx, "research", 0.2);
    expect(scoutSpent(ctx.store, startOfDay(at(14)), at(14))).toBeCloseTo(0.2);
    expect(budgetState(ctx.store, ctx.config, at(14)).spentUsd).toBeCloseTo(1.7);
  });

  it("is told apart on the span of the call", async () => {
    const ctx = factory();
    ask(ctx);
    await researchOnDemandPass(ctx, researching().runner, at(14));
    expect(ctx.store.spansSince(AGENT_SPAN, startOfDay(at(14)))[0]!.attrs[ON_DEMAND_ATTR]).toBe(true);
    expect(scoutSpent(ctx.store, startOfDay(at(14)), at(14))).toBe(0);
  });

  it("is told apart on the real runner's span", async () => {
    const ctx = factory();
    const runner = createAgentRunner(ctx.config, { execute: async () => ({ ok: true, text: "{}", output: { notes: [] }, costUsd: 1 }) as never });
    ask(ctx);
    await researchOnDemandPass(ctx, runner, at(14));
    expect(ctx.store.spansSince(AGENT_SPAN, startOfDay(at(14)))[0]!.attrs).toMatchObject({ [ON_DEMAND_ATTR]: true, "gen_ai.agent.name": "research" });
  });
});

describe("its notes", () => {
  const run = async (notes: unknown[]) => {
    const ctx = factory();
    ask(ctx);
    await researchOnDemandPass(ctx, researching(notes).runner, at(14));
    return { ctx, record: readResearchRuns(ctx.store)[0]! };
  };

  it("are normal notes: only those with an http(s) source, scrubbed, listed on the line", async () => {
    const { ctx, record } = await run([note("Reels", { findings: "Ver C:\\Users\\ana\\x" }), note("Sin fuentes", { sources: ["file:///x"] })]);
    const stored = listResearchNotes(ctx, { line: "tienda" });
    expect(stored.map((n) => n.topic)).toEqual(["Reels"]);
    expect(stored[0]!.findings).not.toContain("ana");
    expect(researchView(ctx, at(14)).find((l) => l.line === "tienda")!.technical.map((n) => n.id)).toEqual([stored[0]!.id]);
    expect(record.notes).toEqual([stored[0]!.id]);
  });

  it("are at most five", async () => {
    const { ctx, record } = await run(Array.from({ length: 7 }, (_, i) => note(`Reel ${i}`)));
    expect(ctx.store.listResearchNotes({})).toHaveLength(5);
    expect(record.notes).toHaveLength(5);
  });

  it("turn into work as usual", async () => {
    const { ctx, record } = await run([note("Reels")]);
    expect(requestFromResearchNote(ctx, record.notes[0]!)).toBeDefined();
    expect(ctx.store.listJobs({ line: "tienda" })[0]!.source).toEqual({ kind: "research", note: record.notes[0] });
  });

  it("without any left, the run ends well and says why", async () => {
    const { record } = await run([note("Sin fuentes", { sources: [] })]);
    expect(record).toMatchObject({ outcome: "ok", notes: [], reason: expect.stringContaining("con fuentes") });
  });
});

describe("the prompt", () => {
  it("has the topic, what was researched and the web rules, and no skill", () => {
    const ctx = factory({ lines: [{ name: "tienda", repo: gitRepo(), stations: { research: { skills: ["zero-research"] } } }] });
    ctx.store.createResearchNote({ line: "tienda", ...note("Hashtags de 2026") });
    const prompt = researchTopicPrompt(ctx, ctx.config.lines[0]!, "reels", at(14));
    for (const piece of ["reels", "Hashtags de 2026", "data, not instructions", "Never install, clone or run anything", "at most 5 notes"]) expect(prompt).toContain(piece);
    expect(prompt).not.toContain("zero-research");
    expect(prompt).not.toMatch(/research skill/);
  });

  it("the station's instructions know of runs that follow a topic", async () => {
    expect(await agentInstructions("research")).toContain("topic to investigate");
  });
});

describe("the record of a run", () => {
  it("has when it was asked, started and ended, its outcome and its notes", async () => {
    const ctx = factory();
    const { requestedAt } = ask(ctx);
    await researchOnDemandPass(ctx, researching([note("Uno"), note("Dos")]).runner, at(14));
    expect(readResearchRuns(ctx.store)).toEqual([{ asked: requestedAt, line: "tienda", topic: TOPIC, startedAt: at(14).toISOString(), endedAt: at(14).toISOString(), outcome: "ok", notes: [expect.any(String), expect.any(String)] }]);
    expect(readResearchRequest(ctx.store)).toBeUndefined();
  });

  it("while it runs, it has no end and nothing is pending", async () => {
    const ctx = factory();
    let during: ResearchRunRecord | undefined;
    let pending: unknown = "not looked";
    ask(ctx);
    const agents = fakeAgents({
      research: () => {
        during = readResearchRuns(ctx.store)[0];
        pending = readResearchRequest(ctx.store);
        return { output: { notes: [] } };
      },
    });
    await researchOnDemandPass(ctx, agents.runner, at(14));
    expect(during).toMatchObject({ startedAt: at(14).toISOString() });
    expect(during!.endedAt).toBeUndefined();
    expect(pending).toBeUndefined();
  });

  it("is failed for an invalid answer or a throw, and the topic stays out of the log", async () => {
    const warn = vi.spyOn(log, "warn");
    const info = vi.spyOn(log, "info");
    const fails = [
      () => ({ ok: false, text: `no pude con ${TOPIC}` }),
      () => {
        throw new Error(`argv: ${TOPIC}`);
      },
    ];
    for (const research of fails) {
      const ctx = factory();
      ask(ctx);
      await researchOnDemandPass(ctx, fakeAgents({ research }).runner, at(14));
      expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "failed", reason: expect.any(String), endedAt: expect.any(String), notes: [] });
    }
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([...warn.mock.calls, ...info.mock.calls])).not.toContain(TOPIC);
    warn.mockRestore();
    info.mockRestore();
  });

  it("is not-run with the line gone or research turned off before the start", async () => {
    const gone = factory();
    ask(gone);
    gone.config = { ...gone.config, lines: [] };
    const off = factory();
    ask(off);
    off.config = { ...off.config, research: "off" };
    const agents = researching();
    for (const ctx of [gone, off]) {
      await researchOnDemandPass(ctx, agents.runner, at(14));
      expect(readResearchRequest(ctx.store)).toBeUndefined();
      const run = readResearchRuns(ctx.store)[0]!;
      expect(run).toMatchObject({ outcome: "not-run", reason: expect.any(String), endedAt: expect.any(String), notes: [] });
      expect(run.startedAt).toBeUndefined();
    }
    expect(agents.calls).toHaveLength(0);
  });

  it("keeps the last ten, newest first", async () => {
    const ctx = factory();
    const agents = researching([]);
    for (let i = 0; i < 11; i++) {
      ask(ctx, `tema ${i}`, "tienda", at(13, i));
      await researchOnDemandPass(ctx, agents.runner, at(14));
    }
    expect(readResearchRuns(ctx.store).map((r) => r.topic)).toEqual(Array.from({ length: 10 }, (_, i) => `tema ${10 - i}`));
  });

  it("is stopped by a shutdown, even when the call throws or answers", async () => {
    const answers = [
      () => ({ output: { notes: [note("Reels")] } }),
      () => {
        throw new Error("aborted");
      },
    ];
    for (const answer of answers) {
      const ctx = factory();
      const stop = new AbortController();
      ask(ctx);
      const agents = fakeAgents({
        research: () => {
          stop.abort();
          return answer();
        },
      });
      await researchOnDemandPass(ctx, agents.runner, at(14), { signal: stop.signal });
      expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("apagó"), notes: [] });
      expect(ctx.store.listResearchNotes({})).toEqual([]);
    }
  });

  it("left without an end is closed as stopped; an ended one stays as it was", () => {
    const ctx = factory();
    const open = { asked: at(12).toISOString(), line: "tienda", topic: TOPIC, startedAt: at(13).toISOString(), notes: [] };
    const ended = { ...open, asked: at(10).toISOString(), endedAt: at(11).toISOString(), outcome: "ok" };
    ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([open, ended]));
    closeInterruptedResearch(ctx, at(14));
    expect(readResearchRuns(ctx.store)).toEqual([{ ...open, endedAt: at(14).toISOString(), outcome: "stopped", reason: expect.any(String) }, ended]);
  });

  it("that cannot be read is left out", () => {
    const ctx = factory();
    for (const raw of ["{", "null", "3", "{}", '[null, 1, {"asked": "x"}]']) {
      ctx.store.setKv(RESEARCH_RUNS_KEY, raw);
      ctx.store.setKv(RESEARCH_REQUEST_KEY, raw);
      expect(readResearchRuns(ctx.store)).toEqual([]);
      expect(readResearchRequest(ctx.store)).toBeUndefined();
    }
  });
});

describe("waiting for it", () => {
  const noSleep = async () => undefined;
  const asked = at(13).toISOString();
  const run = (ctx: Ctx, over: Partial<ResearchRunRecord>) => ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([{ asked, line: "tienda", topic: TOPIC, notes: [], ...over }]));

  it("answers once the record of that request has a start, and says when", async () => {
    const ctx = factory();
    run(ctx, { asked: at(11).toISOString(), startedAt: at(11, 5).toISOString() });
    let polls = 0;
    const sleep = async () => {
      if (++polls === 2) run(ctx, { startedAt: at(14, 7).toISOString() });
    };
    expect(await waitResearchStart(ctx, asked, { timeoutMs: 1000, pollMs: 100, sleep })).toMatchObject({ started: true, text: expect.stringContaining("14:07") });
    expect(polls).toBe(2);
  });

  it("says it is still pending once the limit passes, and why at once when it could not run", async () => {
    const ctx = factory();
    expect(await waitResearchStart(ctx, asked, { timeoutMs: 300, pollMs: 100, sleep: noSleep })).toMatchObject({ started: false, text: expect.stringContaining("sigue pendiente") });
    run(ctx, { endedAt: at(14).toISOString(), outcome: "not-run", reason: "la investigación está apagada" });
    const sleep = vi.fn(noSleep);
    expect(await waitResearchStart(ctx, asked, { timeoutMs: 300, sleep })).toMatchObject({ started: false, text: expect.stringContaining("apagada") });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("for its end, answers how it ended with its notes as zero research shows them", async () => {
    const ctx = factory();
    const n = ctx.store.createResearchNote({ line: "tienda", ...note("Reels") });
    run(ctx, { startedAt: at(14).toISOString() });
    const sleep = async () => run(ctx, { startedAt: at(14).toISOString(), endedAt: at(14, 5).toISOString(), outcome: "ok", notes: [n.id] });
    const r = await waitResearchEnd(ctx, asked, { sleep });
    expect(r).toMatchObject({ ended: true, outcome: "ok", text: expect.stringContaining("terminó bien") });
    expect(r.text).toContain(formatResearchNotes([n]));
  });

  it("for its end, says why it stopped, without notes", async () => {
    const ctx = factory();
    run(ctx, { startedAt: asked, endedAt: asked, outcome: "stopped", reason: "la fábrica se detuvo (andon)" });
    expect(await waitResearchEnd(ctx, asked, { sleep: noSleep })).toEqual({ ended: true, outcome: "stopped", text: "La investigación se cortó: la fábrica se detuvo (andon)." });
  });

  it("for its end, gives up a little after the station's timeout and says where to look", async () => {
    const ctx = factory({ stations: { research: { timeoutMinutes: 2 } } });
    run(ctx, { startedAt: asked });
    let slept = 0;
    const sleep = async (ms: number) => void (slept += ms);
    const r = await waitResearchEnd(ctx, asked, { pollMs: 10_000, sleep });
    expect(r).toMatchObject({ ended: false, text: expect.stringMatching(/sigue.*zero status.*zero research/) });
    expect(slept).toBe(3 * 60_000);
  });
});

describe("the daemon", () => {
  const once = { once: true, pollMs: 10, panel: false };
  const onDemand = { ...once, researchOnDemand: true };

  it("runs it while a job runs, without stopping the job or taking its place", async () => {
    const now = new Date();
    const ctx = factory({ concurrency: 1 }, now);
    const job = ctx.store.createJob({ line: "tienda", kind: "request", request: "otro", budgetUsd: 1 });
    let during: string | undefined;
    let aborted: boolean | undefined;
    let free = () => {};
    const researched = new Promise<void>((r) => (free = r));
    const agents = fakeAgents({
      spec: async (req, n) => {
        // A failed spec is tried again; only the first call asks.
        if (n === 1) ask(ctx, TOPIC, "tienda", now);
        await researched;
        aborted = req.signal?.aborted ?? false;
        return { ok: false, text: "no hay spec" };
      },
      research: () => {
        during = ctx.store.getJob(job.id)!.status;
        free();
        return { output: { notes: [note("Reels")] } };
      },
    });
    await runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
    expect(agents.count.research).toBe(1);
    expect(during).toBe("running");
    expect(aborted).toBe(false);
    expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "ok", notes: [expect.any(String)] });
  });

  it("does not wait for the idle run", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    let free = () => {};
    const researched = new Promise<void>((r) => (free = r));
    const agents = fakeAgents({
      scout: async () => {
        ask(ctx, TOPIC, "tienda", now);
        await researched;
        return {};
      },
      research: () => {
        free();
        return { output: { notes: [] } };
      },
    });
    const daemon = runDaemon(ctx, { pollMs: 10, panel: false, scout: true, unjam: false, urgentUnjam: false, recruit: false, packages: false, issues: () => undefined, merges: () => undefined, autostart: () => ({ status: "unchanged" }) as never, install: { root: ctx.home.root, git: async () => ({ code: 1, stdout: "", stderr: "" }) as never }, agentRunner: () => agents.runner });
    try {
      await until(() => readResearchRuns(ctx.store)[0]?.outcome === "ok");
    } finally {
      free();
      ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
      await daemon;
    }
  });

  it("cuts it when the andon is turned on, even with a factory file that does not load", async () => {
    for (const broken of [false, true]) {
      const now = new Date();
      const ctx = factory({}, now);
      ask(ctx, TOPIC, "tienda", now);
      let aborted: unknown;
      const agents = fakeAgents({
        research: async (req) => {
          if (broken) writeFileSync(ctx.home.config, "lines: 3");
          ctx.store.setKv(ANDON_KEY, "on");
          await until(() => req.signal!.aborted);
          aborted = req.signal!.reason;
          return { output: { notes: [note("Reels")] } };
        },
      });
      const daemon = runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
      await until(() => Boolean(readResearchRuns(ctx.store)[0]?.endedAt));
      ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
      await daemon;
      expect(aborted).toBe("andon");
      expect(ctx.store.listResearchNotes({})).toEqual([]);
      expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("andon"), notes: [] });
    }
  });

  it("cuts it on a shutdown", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, TOPIC, "tienda", now);
    const agents = fakeAgents({
      research: async (req) => {
        ctx.store.setKv(SHUTDOWN_KEY, new Date().toISOString());
        await until(() => req.signal!.aborted);
        return { ok: false, text: "cut" };
      },
    });
    await runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
    expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "stopped", reason: expect.stringContaining("apagó") });
  });

  it("leaves it pending in a once run without the option", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, TOPIC, "tienda", now);
    const agents = researching();
    await runDaemon(ctx, { ...once, agentRunner: () => agents.runner });
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRequest(ctx.store)).toBeDefined();
  });

  it("closes the record a crashed daemon left", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([{ asked: now.toISOString(), line: "tienda", topic: TOPIC, startedAt: now.toISOString(), notes: [] }]));
    await runDaemon(ctx, { ...once, agentRunner: () => fakeAgents({}).runner });
    expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "stopped", endedAt: expect.any(String), reason: expect.any(String) });
  });

  it("records as not run a request whose line was removed from the file", async () => {
    const now = new Date();
    const ctx = factory({}, now);
    ask(ctx, TOPIC, "tienda", now);
    writeFileSync(ctx.home.config, stringify({ isolation: "worktree", lines: [{ name: "otra", repo: gitRepo() }] }));
    const agents = researching();
    await runDaemon(ctx, { ...onDemand, agentRunner: () => agents.runner });
    expect(agents.calls).toHaveLength(0);
    expect(readResearchRuns(ctx.store)[0]).toMatchObject({ outcome: "not-run", reason: expect.stringContaining("tienda") });
  });
});

const stored = (over: Partial<ResearchRunRecord> = {}): ResearchRunRecord => ({ asked: at(13).toISOString(), line: "tienda", topic: TOPIC, startedAt: at(13, 5).toISOString(), endedAt: at(13, 9).toISOString(), outcome: "ok", notes: ["n1", "n2"], ...over });
const recorded = (over: Partial<ResearchRunRecord> = {}, start = at(14)) => {
  const ctx = factory({}, start);
  ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([stored(over)]));
  return ctx;
};

describe("seeing it", () => {
  const shown = (ctx: Ctx, now = at(14)) => formatStatus(factoryStatus(ctx), now).split("\n").filter((l) => /investigación a demanda/i.test(l));

  it("the status carries whether it is on, the lines that are not a package's, the request and the runs", () => {
    const ctx = factory({ lines: twoLines() });
    ctx.config.lines.push({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    expect(factoryStatus(ctx).research).toEqual({ enabled: true, lines: ["tienda", "blog"], runs: [] });
    ask(ctx);
    expect(factoryStatus(ctx).research.pending).toEqual({ requestedAt: at(13).toISOString(), line: "tienda", topic: TOPIC });
    expect(factoryStatus(recorded()).research.runs).toEqual([stored()]);
    expect(factoryStatus(factory({ research: "off" })).research.enabled).toBe(false);
  });

  it("zero status says nothing without a request or a run", () => {
    expect(shown(factory())).toEqual([]);
  });

  it("zero status shows the pending request and the last run", () => {
    const ctx = factory();
    ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([stored(), stored({ asked: at(9).toISOString(), topic: "otro" })]));
    ask(ctx, "hashtags");
    expect(shown(ctx)).toEqual([
      'Investigación a demanda: pendiente para tienda desde 13:00 · "hashtags"',
      `Última investigación a demanda: pedida para tienda 13:00, empezó 13:05, terminó bien (13:09) · 2 notas · "${TOPIC}"`,
    ]);
  });

  it("zero status shows a run under way, and why one did not end well", () => {
    expect(shown(recorded({ endedAt: undefined, outcome: undefined, notes: [] }))).toEqual([`Última investigación a demanda: pedida para tienda 13:00, corriendo desde 13:05 · "${TOPIC}"`]);
    expect(shown(recorded({ outcome: "stopped", reason: "la fábrica se detuvo (andon)", notes: [] }))[0]).toContain("se cortó (13:09): la fábrica se detuvo (andon) · sin notas");
    expect(shown(recorded({ startedAt: undefined, outcome: "not-run", reason: "no existe la línea", notes: [] }))[0]).toContain("pedida para tienda 13:00, no pudo correr (13:09): no existe la línea");
  });

  it("zero status shows at most 120 characters of the topic, in one line", () => {
    const topic = `reels\n${"a".repeat(300)}`;
    const quoted = shown(recorded({ topic }))[0]!.match(/"(.*)"$/)![1]!;
    expect(quoted).toMatch(/^reels a+…$/);
    expect(quoted).toHaveLength(120);
    const ctx = factory();
    ask(ctx, topic);
    expect(shown(ctx)[0]!.match(/"(.*)"$/)![1]).toHaveLength(120);
  });

  it("the briefing lists what is pending and the runs of its period", async () => {
    const ctx = recorded();
    let body = (await briefing(ctx, 1)).body;
    expect(body).toContain("## Corridas a demanda");
    expect(body).toContain(`- investigación: pedida para tienda 13:00, empezó 13:05, terminó bien (13:09) · 2 notas · "${TOPIC}"`);
    ask(ctx, "hashtags");
    body = (await briefing(ctx, 1)).body;
    expect(body).toContain('- investigación: pendiente para tienda desde 13:00 · "hashtags"');
    // A run that could not start still ended in the period.
    expect((await briefing(recorded({ startedAt: undefined, outcome: "not-run", notes: [] }), 1)).body).toMatch(/^- investigación: .*no pudo correr/m);
  });

  it("the briefing says nothing of a run that ended before its period", async () => {
    expect((await briefing(recorded({}, new Date(2026, 9, 31, 14)), 1)).body).not.toContain("Corridas a demanda");
  });
});

describe("asking from the terminal", () => {
  const env = (ctx: Ctx) => ({ ...process.env, ZERO_HOME: ctx.home.root });
  const args = (...rest: string[]) => ["--import", "tsx", "src/cli.ts", ...rest];
  const zero = (ctx: Ctx, ...rest: string[]) => {
    const r = spawnSync(process.execPath, args(...rest), { encoding: "utf8", env: env(ctx), input: "", windowsHide: true });
    return { code: r.status, output: r.stdout + r.stderr };
  };

  it("the usage lists zero investigar with its options", () => {
    expect(zero(factory(), "help").output).toMatch(/zero investigar "<tema>" \[--line <nombre>\] \[--esperar\]/);
  }, 60_000);

  it("an empty topic tells the reason and exits 1", () => {
    const ctx = factory();
    const r = zero(ctx, "investigar", "");
    expect(r.code).toBe(1);
    expect(r.output).toContain("falta el tema a investigar");
    expect(readResearchRequest(ctx.store)).toBeUndefined();
  }, 60_000);

  it("joins the unquoted words, and waits for the end with --esperar", async () => {
    const ctx = factory();
    // With the daemon's lock taken, the command starts no daemon.
    const lock = acquireDaemonLock(ctx.home)!;
    try {
      const child = spawn(process.execPath, args("investigar", "cómo", "viralizar", "un", "reel", "--line", "tienda", "--esperar"), { env: env(ctx), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => (output += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (output += d));
      const closed = new Promise<number | null>((done) => child.on("close", done));
      await until(() => readResearchRequest(ctx.store) !== undefined, 40_000);
      const { requestedAt, line, topic } = readResearchRequest(ctx.store)!;
      expect({ line, topic }).toEqual({ line: "tienda", topic: TOPIC });
      const started = { asked: requestedAt, line, topic, startedAt: new Date().toISOString(), notes: [] };
      ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([started]));
      await until(() => output.includes("La investigación empezó"), 20_000);
      const n = ctx.store.createResearchNote({ line: "tienda", ...note("Reels") });
      ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([{ ...started, endedAt: new Date().toISOString(), outcome: "ok", notes: [n.id] }]));
      expect(await closed).toBe(0);
      expect(output).toContain("La investigación terminó bien.");
      expect(output).toContain(n.id);
    } finally {
      lock.release();
    }
  }, 90_000);

  it("starts the factory and waits as zero destrabar does", () => {
    const cli = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    const command = cli.slice(cli.indexOf('case "investigar"'), cli.indexOf('case "resume"'));
    expect(command).toContain("await ensureDaemon(ctx)");
    expect(command).toContain("waitResearchStart(ctx, r.requestedAt, { timeoutMs: STATION_WAIT_MS })");
  });
});

describe("asking from the chat", () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  });
  async function chat(ctx: Ctx, opts: ZeroMcpOptions = {}) {
    const server = createZeroMcpServer(ctx.home, { autoStart: false, stationWaitMs: 0, ...opts });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    clients.push(client);
    const names = async () => (await client.listTools()).tools.map((t) => t.name);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      return { text: r.content.map((c) => c.text).join("\n"), blocks: r.content.map((c) => c.text), isError: r.isError ?? false };
    };
    return { names, call };
  }
  const readOnly: ZeroMcpOptions = { remote: { scope: ["zero:read"], client: "c" } };
  const acting: ZeroMcpOptions = { remote: { scope: ["zero:read", "zero:act"], client: "c" } };

  it("zero_investigate asks for the run on a line and says it is still pending", async () => {
    const ctx = factory({ lines: twoLines() });
    const { text } = await (await chat(ctx)).call("zero_investigate", { topic: TOPIC, line: "tienda" });
    expect(text).toContain("Investigación pedida para tienda");
    expect(text).toContain("sigue pendiente");
    expect(readResearchRequest(ctx.store)).toMatchObject({ line: "tienda", topic: TOPIC });
  });

  it("zero_investigate says when the factory was off", async () => {
    const start = vi.fn(async () => true);
    const { text } = await (await chat(factory(), { autoStart: true, start })).call("zero_investigate", { topic: TOPIC });
    expect(text).toContain("La fábrica estaba apagada: la encendí.");
    expect(start).toHaveBeenCalledOnce();
  });

  it("zero_investigate answers the refusal and changes nothing with one already pending", async () => {
    const ctx = factory();
    ask(ctx);
    const before = ctx.store.getKv(RESEARCH_REQUEST_KEY);
    const { text } = await (await chat(ctx)).call("zero_investigate", { topic: "otro" });
    expect(text).toContain("ya hay una investigación pendiente");
    expect(text).toContain(at(13).toISOString());
    expect(ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBe(before);
  });

  it("a remote chat has it only with zero:act, and it is not held", async () => {
    const ctx = factory();
    expect(await (await chat(ctx, readOnly)).names()).not.toContain("zero_investigate");
    expect((await (await chat(ctx, acting)).call("zero_investigate", { topic: TOPIC })).text).toContain("pedida para tienda");
    expect(readResearchRequest(ctx.store)).toMatchObject({ topic: TOPIC });
  });

  it("the next answer after a run ended carries its notice, once", async () => {
    const ctx = recorded();
    const { call } = await chat(ctx);
    const first = await call("zero_status");
    expect(first.blocks[1]).toBe(`Aviso de la fábrica: la investigación a demanda sobre "${TOPIC}" en tienda terminó bien: 2 notas. Se leen con zero_research.`);
    expect((await call("zero_status")).text).not.toContain("Aviso de la fábrica");
    expect((await (await chat(ctx, acting)).call("zero_status")).text).not.toContain("Aviso de la fábrica");
    // A later run has its own notice; the first one is not told again.
    ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([stored({ asked: at(15).toISOString(), topic: "hashtags", outcome: "failed", reason: "el motor no respondió", notes: [] }), stored()]));
    const later = (await call("zero_lines")).blocks;
    expect(later.slice(1)).toEqual(['Aviso de la fábrica: la investigación a demanda sobre "hashtags" en tienda falló (el motor no respondió): sin notas.']);
    // The answer itself stays as it was.
    expect(JSON.parse(later[0]!)).toBeTypeOf("object");
  });

  it("a run under way has no notice, and neither a failed answer nor a read-only chat uses one up", async () => {
    const ctx = recorded({ endedAt: undefined, outcome: undefined, notes: [] });
    const local = await chat(ctx);
    expect((await local.call("zero_status")).text).not.toContain("Aviso de la fábrica");
    ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify([stored()]));
    expect(await local.call("zero_status", { job: "nope" })).toMatchObject({ isError: true, text: expect.not.stringContaining("Aviso de la fábrica") });
    expect((await (await chat(ctx, readOnly)).call("zero_status")).text).not.toContain("Aviso de la fábrica");
    expect(ctx.store.getKv(RESEARCH_TOLD_KEY)).toBeUndefined();
    expect((await local.call("zero_status")).text).toContain("Aviso de la fábrica");
  });

  it("what cannot be read never breaks an answer", async () => {
    const ctx = factory();
    ctx.store.setKv(RESEARCH_RUNS_KEY, "{no json");
    expect(await (await chat(ctx)).call("zero_status")).toMatchObject({ isError: false, text: expect.not.stringContaining("Aviso de la fábrica") });
    const marks = recorded();
    marks.store.setKv(RESEARCH_TOLD_KEY, "{no json");
    const { call } = await chat(marks);
    expect((await call("zero_status")).text).toContain("Aviso de la fábrica");
    expect((await call("zero_status")).text).not.toContain("Aviso de la fábrica");
  });

  it("a mark that cannot be stored is only logged", async () => {
    const ctx = recorded();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const transaction = vi.spyOn(Store.prototype, "transaction").mockImplementation(() => {
      throw new Error("busy");
    });
    try {
      expect((await (await chat(ctx)).call("zero_status")).isError).toBe(false);
      expect(transaction).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith("cannot tell the ended research runs", expect.anything());
    } finally {
      transaction.mockRestore();
      warn.mockRestore();
    }
  });
});
