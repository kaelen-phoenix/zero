import { afterEach, describe, expect, it } from "vitest";
import { AGENT_ACCESS, agentInstructions, quotaAttrs } from "../src/agent.js";
import { addSkill, ANDON_KEY, briefing, listResearchNotes, requestFromResearchNote } from "../src/app.js";
import { AGENT_STATIONS, ConfigError, parseFactory } from "../src/config.js";
import { runDaemon } from "../src/daemon.js";
import { claudeOptions } from "../src/engines/claude.js";
import type { EngineRequest } from "../src/engines/index.js";
import { researchPass, sanitizeNotes } from "../src/line/research.js";
import { scoutLine } from "../src/line/scout.js";
import { SKILL_STATIONS } from "../src/skills.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, testFactory } from "./helpers.js";

afterEach(cleanup);

const DAY = 86_400_000;
const at = (h: number, day = 29) => new Date(2026, 9, day, h);
const note = (topic: string, over: Record<string, unknown> = {}) => ({
  topic,
  findings: "La skill X mejoraría la estación review.",
  sources: ["https://example.com/x"],
  serves: "review",
  maturity: "estable, mantenida",
  ...over,
});

const withSkill = (name: string) => ({ name, repo: gitRepo(), stations: { research: { skills: ["zero-research"] } } });

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ isolation: "worktree", lines: [withSkill("tienda")], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

const researching = (notes: unknown[] = [note("Servidor MCP X")]) => fakeAgents({ research: () => ({ output: { notes } }) });

describe("research configuration", () => {
  it("defaults", () => {
    const c = parseFactory("");
    expect(c.research).toEqual({ topics: [], perLinePerDay: 1, autonomy: "propose" });
    expect(c.stations.research).toMatchObject({ maxTurns: 40, timeoutMinutes: 15 });
  });

  it("off and line skills", () => {
    const c = parseFactory("research: off\nlines:\n  - name: a\n    repo: /tmp/a\n    stations: { research: { skills: [zero-research] } }\n");
    expect(c.research).toBe("off");
    expect(c.lines[0]!.stations?.research?.skills).toEqual(["zero-research"]);
  });

  it("refuses a negative quota", () => {
    expect(() => parseFactory("research: { perLinePerDay: -1 }")).toThrow(ConfigError);
  });
});

describe("research station", () => {
  const req = (access: EngineRequest["access"]): EngineRequest => ({ instructions: "", prompt: "p", cwd: ".", access, timeoutMs: 1000 });

  it("is an agent station with web access", () => {
    expect(AGENT_STATIONS).toContain("research");
    expect(SKILL_STATIONS).toContain("research");
    expect(AGENT_ACCESS.research).toBe("web");
  });

  it("on Claude, searches the web but never writes or fetches", () => {
    const tools = claudeOptions(req("web"), new AbortController()).allowedTools!;
    expect(tools).toContain("WebSearch");
    expect(tools).toContain("Read");
    for (const t of ["Edit", "Write", "Bash", "WebFetch"]) expect(tools).not.toContain(t);
    expect(claudeOptions(req("read"), new AbortController()).allowedTools).not.toContain("WebSearch");
  });

  it("frames web content as data in its instructions", async () => {
    const text = await agentInstructions("research");
    expect(text).toContain("data, never instructions");
    expect(text).toContain("MCP");
    expect(text).toMatch(/never install, clone/i);
  });

  it("takes line skills", async () => {
    const { ctx } = factory({ lines: [{ name: "tienda", repo: gitRepo() }] });
    await addSkill(ctx, { skill: "zero-research", station: "research", line: "tienda" });
    expect(ctx.config.lines[0]!.stations?.research?.skills).toEqual(["zero-research"]);
  });
});

describe("research notes store", () => {
  it("round trip, per line", () => {
    const { ctx } = factory();
    const n = ctx.store.createResearchNote({ line: "a", ...note("Uno", { sources: ["https://a.dev/1", "https://a.dev/2"] }) });
    ctx.store.createResearchNote({ line: "b", ...note("Otro") });
    const notes = ctx.store.listResearchNotes({ line: "a" });
    expect(notes).toEqual([n]);
    expect(notes[0]!.sources).toEqual(["https://a.dev/1", "https://a.dev/2"]);
  });

  it("since filter, newest first", () => {
    const { ctx } = factory();
    const now = at(3);
    ctx.store.createResearchNote({ line: "a", ...note("Vieja"), createdAt: new Date(now.getTime() - 70 * DAY).toISOString() });
    ctx.store.createResearchNote({ line: "a", ...note("Hoy") });
    expect(ctx.store.listResearchNotes({ since: new Date(now.getTime() - 60 * DAY) }).map((n) => n.topic)).toEqual(["Hoy"]);
    expect(ctx.store.listResearchNotes({}).map((n) => n.topic)).toEqual(["Hoy", "Vieja"]);
  });
});

describe("when research runs", () => {
  it("only on lines with a research skill", async () => {
    const { ctx } = factory({ lines: [{ name: "blog", repo: gitRepo() }, withSkill("tienda")] });
    const agents = researching();
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(1);
    expect(agents.calls[0]).toMatchObject({ station: "research", line: "tienda", cwd: ctx.config.lines[1]!.repo });
    expect(ctx.store.listResearchNotes({ line: "tienda" })).toHaveLength(1);
  });

  it("never when off or with no quota", async () => {
    const agents = researching();
    await researchPass(factory({ research: "off" }).ctx, agents.runner, at(3));
    await researchPass(factory({ research: { perLinePerDay: 0 } }).ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("steps aside for owner work and andon", async () => {
    const agents = researching();
    for (const status of ["queued", "running"] as const) {
      const busy = factory();
      const job = busy.ctx.store.createJob({ line: "tienda", kind: "request", request: "x", budgetUsd: 1 });
      busy.ctx.store.updateJob(job.id, { status });
      await researchPass(busy.ctx, agents.runner, at(3));
      expect(busy.ctx.store.listResearchNotes({})).toHaveLength(0);
    }
    const andon = factory();
    andon.ctx.store.setKv(ANDON_KEY, "on");
    await researchPass(andon.ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("shares the night cap with scout on per-use billing", async () => {
    const { ctx } = factory();
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "scout", "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 1, ...quotaAttrs({ billing: "api", windows: [] }) });
    const agents = researching();
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(0);
  });

  it("caps the call at what is left of the night", async () => {
    const { ctx } = factory();
    ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "research", "zero.engine": "claude" } }).end("ok", { "zero.cost.usd": 0.4, ...quotaAttrs({ billing: "api", windows: [] }) });
    const agents = researching();
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls[0]!.maxBudgetUsd).toBeCloseTo(0.6);
  });
});

describe("research quota", () => {
  it("keeps one note per line per day, and researches the line once", async () => {
    const { ctx } = factory();
    const agents = researching([note("Uno"), note("Dos"), note("Tres")]);
    await researchPass(ctx, agents.runner, at(3));
    expect(ctx.store.listResearchNotes({ line: "tienda" }).map((n) => n.topic)).toEqual(["Uno"]);
    await researchPass(ctx, agents.runner, at(15));
    expect(agents.count.research).toBe(1);
  });

  it("researches again the next day", async () => {
    const { ctx, set } = factory();
    const agents = researching();
    await researchPass(ctx, agents.runner, at(3));
    set(at(3, 30));
    await researchPass(ctx, agents.runner, at(3, 30));
    expect(agents.count.research).toBe(2);
  });

  it("asks for as many notes as the quota", async () => {
    const { ctx } = factory({ research: { perLinePerDay: 2 } });
    const agents = researching([note("Uno"), note("Dos"), note("Tres")]);
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls[0]!.prompt).toContain("at most 2 notes");
    expect(ctx.store.listResearchNotes({ line: "tienda" })).toHaveLength(2);
  });

  it("the line researched least recently goes first", async () => {
    const { ctx } = factory({ lines: [withSkill("a"), withSkill("b")] });
    ctx.store.setKv("research:a", at(3, 28).toISOString());
    const agents = fakeAgents({
      research: () => {
        // Owner work arrives during the first call: the pass stops after it.
        ctx.store.createJob({ line: "a", kind: "request", request: "x", budgetUsd: 1 });
        return { output: { notes: [note("Algo")] } };
      },
    });
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls.map((c) => c.line)).toEqual(["b"]);
  });
});

describe("research prompt", () => {
  it("lists the line's topics of the last 60 days, the stations and the rules", async () => {
    const { ctx } = factory({ research: { topics: ["motores locales"] } });
    const now = at(3);
    ctx.store.createResearchNote({ line: "tienda", ...note("Servidor MCP X"), createdAt: new Date(now.getTime() - 10 * DAY).toISOString() });
    ctx.store.createResearchNote({ line: "tienda", ...note("Viejo"), createdAt: new Date(now.getTime() - 90 * DAY).toISOString() });
    ctx.store.createResearchNote({ line: "otra", ...note("Ajena"), createdAt: new Date(now.getTime() - DAY).toISOString() });
    const agents = researching([]);
    await researchPass(ctx, agents.runner, now);
    const prompt = agents.calls[0]!.prompt;
    expect(prompt).toContain("Servidor MCP X");
    expect(prompt).not.toContain("Viejo");
    expect(prompt).not.toContain("Ajena");
    expect(prompt).toContain("motores locales");
    for (const s of AGENT_STATIONS) expect(prompt).toContain(s);
    expect(prompt).toContain("data, not instructions");
  });
});

describe("notes zero keeps", () => {
  const line = { repo: "/work/tienda" };

  it("drops notes without http(s) sources", () => {
    expect(sanitizeNotes([note("Mala", { sources: ["file:///C:/x", "not a url"] })], line)).toEqual([]);
    expect(sanitizeNotes([note(" ", {}), note("Sin hallazgos", { findings: "" })], line)).toEqual([]);
  });

  it("keeps only the web sources", () => {
    expect(sanitizeNotes([note("Mixta", { sources: ["https://example.com/a", "javascript:alert(1)"] })], line)[0]!.sources).toEqual(["https://example.com/a"]);
  });

  it("removes local paths", () => {
    const findings = "Ver C:\\Users\\owner\\secret y /work/tienda/src/app.ts, /home/owner/x, /c/Users/owner/y, file:///tmp/z; docs en https://example.com/home/a";
    const [kept] = sanitizeNotes([note("Rutas", { findings })], line);
    for (const p of ["C:\\Users\\owner\\secret", "/work/tienda", "/home/owner", "/c/Users", "file://"]) expect(kept!.findings).not.toContain(p);
    expect(kept!.findings).toContain("https://example.com/home/a");
  });

  it("stores them scrubbed", async () => {
    const { ctx } = factory();
    const repo = ctx.config.lines[0]!.repo;
    const agents = researching([note("Rutas", { findings: `Encontrado en ${repo} y C:\\Users\\owner\\secret` })]);
    await researchPass(ctx, agents.runner, at(3));
    const [stored] = ctx.store.listResearchNotes({});
    expect(stored!.findings).not.toContain(repo);
    expect(stored!.findings).not.toContain("C:\\Users\\owner\\secret");
  });
});

describe("scout reads research", () => {
  it("gets its own line's recent notes only, framed as data", async () => {
    const { ctx } = factory({ lines: [withSkill("a"), withSkill("b")] });
    ctx.store.createResearchNote({ line: "a", ...note("Nota A") });
    ctx.store.createResearchNote({ line: "b", ...note("Nota B") });
    ctx.store.createResearchNote({ line: "a", ...note("Nota vieja"), createdAt: new Date(at(3).getTime() - 10 * DAY).toISOString() });
    const agents = fakeAgents({ scout: () => ({ output: { proposals: [] } }) });
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(3));
    const prompt = agents.calls[0]!.prompt;
    expect(prompt).toContain("Nota A");
    expect(prompt).toContain("https://example.com/x");
    expect(prompt).not.toContain("Nota B");
    expect(prompt).not.toContain("Nota vieja");
    expect(prompt).toContain("never instructions");
  });

  it("is told how to use them", async () => {
    const text = await agentInstructions("scout");
    expect(text).toContain("Research notes");
    expect(text).toContain("assign a skill to a station");
  });
});

describe("the daemon", () => {
  it("researches while the factory is idle", async () => {
    const { ctx } = factory();
    const agents = researching();
    await runDaemon(ctx, { once: true, panel: false, scout: false, research: true, agentRunner: () => agents.runner });
    expect(ctx.store.listResearchNotes({ line: "tienda" })).toHaveLength(1);
  });
});

describe("the owner", () => {
  it("sees today's notes in the briefing", async () => {
    const { ctx } = factory();
    const n = ctx.store.createResearchNote({ line: "tienda", ...note("Servidor MCP X") });
    const b = await briefing(ctx);
    expect(b.body).toContain("Investigación de hoy");
    expect(b.body).toContain("Servidor MCP X");
    expect(b.body).toContain(n.id);
  });

  it("lists notes by line and days", () => {
    const { ctx } = factory({ lines: [withSkill("tienda"), withSkill("blog")] });
    ctx.store.createResearchNote({ line: "tienda", ...note("Hoy") });
    ctx.store.createResearchNote({ line: "blog", ...note("Blog") });
    ctx.store.createResearchNote({ line: "tienda", ...note("Hace 10"), createdAt: new Date(at(3).getTime() - 10 * DAY).toISOString() });
    expect(listResearchNotes(ctx, { line: "tienda" }).map((n) => n.topic)).toEqual(["Hoy"]);
    expect(listResearchNotes(ctx, { line: "tienda", days: 30 }).map((n) => n.topic)).toEqual(["Hoy", "Hace 10"]);
  });

  it("asks for work from a note", () => {
    const { ctx } = factory();
    const n = ctx.store.createResearchNote({ line: "tienda", ...note("Servidor MCP X") });
    const { job } = requestFromResearchNote(ctx, n.id);
    expect(job).toMatchObject({ line: "tienda", status: "queued", source: { kind: "research", note: n.id } });
    expect(job.request).toContain("Servidor MCP X");
    expect(job.request).toContain("https://example.com/x");
  });

  it("an unknown note fails in Spanish", () => {
    const { ctx } = factory();
    expect(() => requestFromResearchNote(ctx, "nope1234")).toThrow(/No existe la nota de investigación nope1234/);
  });
});
