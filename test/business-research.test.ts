import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { briefing, requestWork, type FactoryContext } from "../src/app.js";
import { businessSkills, ConfigError, parseFactory } from "../src/config.js";
import { touchesLegal } from "../src/line/policy.js";
import { researchPass } from "../src/line/research.js";
import { runJob, type RunnerDeps } from "../src/line/runner.js";
import { proposalAutonomy, scoutLine, scoutPass } from "../src/line/scout.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { Store } from "../src/state/store.js";
import { cleanup, fakeAgents, gitIn, gitRepo, simulatedBox, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const passes = `node -e "process.exit(0)"`;
const at = (h: number, day = 29) => new Date(2026, 9, day, h);
const draft = (topic: string) => ({ topic, findings: "algo concreto", sources: ["https://example.com/x"], serves: "build", maturity: "estable" });
const idea = (title: string, over: Record<string, unknown> = {}) => ({ title, why: "sirve", change: "cambiar algo", estimatedUsd: 0.5, paths: ["src/x.ts"], needsNewCredentials: false, ...over });
const scouting = (proposals: unknown[]) => fakeAgents({ scout: () => ({ output: { proposals } }) });

const TECH = "investigar-zero";
const BIZ = "investigar-monetizacion";
const twoSkills = (name = "zero") => ({ name, repo: gitRepo(), verify: [passes], stations: { research: { skills: [TECH, BIZ], business: [BIZ] } } });

function factory(over: Record<string, unknown> = {}, start = at(3)) {
  let clock = start;
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [twoSkills()], ...over }, () => clock);
  return { ctx, set: (d: Date) => (clock = d) };
}

const noteOf = (ctx: FactoryContext, topic: string, business: boolean) => ctx.store.createResearchNote({ line: "zero", ...draft(topic), skill: business ? BIZ : TECH, business });

describe("business skills in the line config", () => {
  const yaml = (research: string) => `lines:\n  - name: zero\n    repo: /tmp/zero\n    stations:\n      research: ${research}\n`;

  it("parses the business list", () => {
    const c = parseFactory(yaml(`{ skills: [${TECH}, ${BIZ}], business: [${BIZ}] }`));
    expect(c.lines[0]!.stations?.research?.business).toEqual([BIZ]);
    expect(businessSkills(c.lines[0]!)).toEqual([BIZ]);
  });

  it("defaults to empty", () => {
    expect(parseFactory(yaml(`{ skills: [${TECH}] }`)).lines[0]!.stations?.research?.business).toEqual([]);
  });

  it("tolerates names that are not research skills", () => {
    const c = parseFactory(yaml(`{ skills: [${TECH}], business: [gone] }`));
    expect(businessSkills(c.lines[0]!)).toEqual([]);
  });

  it("other stations refuse it", () => {
    expect(() => parseFactory("lines:\n  - name: zero\n    repo: /tmp/zero\n    stations:\n      scout: { skills: [x], business: [x] }\n")).toThrow(ConfigError);
  });
});

describe("notes record their skill", () => {
  it("business and technical notes", async () => {
    const { ctx } = factory();
    await researchPass(ctx, fakeAgents({ research: () => ({ output: { notes: [draft("Algo")] } }) }).runner, at(3));
    const notes = ctx.store.listResearchNotes({ line: "zero" });
    expect(notes.find((n) => n.skill === BIZ)).toMatchObject({ business: true });
    expect(notes.find((n) => n.skill === TECH)).toMatchObject({ business: false });
  });

  it("old databases read back as technical", () => {
    const path = join(tempDir(), "state.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE research_notes (id TEXT PRIMARY KEY, line TEXT NOT NULL, topic TEXT NOT NULL, findings TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', serves TEXT NOT NULL DEFAULT '', maturity TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)");
    old.exec("INSERT INTO research_notes (id, line, topic, findings, created_at) VALUES ('n1', 'zero', 't', 'f', '2026-10-01T00:00:00.000Z')");
    old.exec("CREATE TABLE proposals (id TEXT PRIMARY KEY, line TEXT NOT NULL, title TEXT NOT NULL, why TEXT NOT NULL, change TEXT NOT NULL, estimated_usd REAL NOT NULL DEFAULT 0, paths TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, note TEXT, job_id TEXT)");
    old.close();
    const store = new Store(path);
    const n = store.getResearchNote("n1")!;
    expect(n.business).toBe(false);
    expect(n.skill).toBeUndefined();
    expect(store.createProposal({ line: "zero", title: "x", why: "y", change: "z", estimatedUsd: 1, paths: [] })).toMatchObject({ business: false, commercial: false });
    store.close();
  });
});

describe("research quota per skill", () => {
  it("one quota per skill, each prompt naming its skill", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ research: () => ({ output: { notes: [draft("Uno"), draft("Dos")] } }) });
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(2);
    const prompts = agents.calls.map((c) => c.prompt);
    expect(prompts.filter((p) => p.includes(`\`${TECH}\``))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes(`\`${BIZ}\``))).toHaveLength(1);
    const notes = ctx.store.listResearchNotes({ line: "zero" });
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((n) => n.skill))).toEqual(new Set([TECH, BIZ]));
  });

  it("the same skill is not rerun on the same day", async () => {
    const { ctx } = factory();
    const agents = fakeAgents({ research: () => ({ output: { notes: [] } }) });
    await researchPass(ctx, agents.runner, at(3));
    await researchPass(ctx, agents.runner, at(15));
    expect(agents.count.research).toBe(2);
  });

  it("rotates when the night cap covers only one call", async () => {
    const { ctx, set } = factory();
    const agents = fakeAgents({ research: (req) => ({ output: { notes: [draft(`Nota ${req.prompt.includes(BIZ) ? "negocio" : "técnica"}`)] }, costUsd: req.maxBudgetUsd }) });
    await researchPass(ctx, agents.runner, at(3));
    expect(agents.calls).toHaveLength(1);
    const first = agents.calls[0]!.prompt.includes(`\`${BIZ}\``) ? BIZ : TECH;
    set(at(3, 30));
    await researchPass(ctx, agents.runner, at(3, 30));
    expect(agents.calls).toHaveLength(2);
    expect(agents.calls[1]!.prompt).toContain(`\`${first === BIZ ? TECH : BIZ}\``);
  });
});

describe("business-born proposals", () => {
  const auto = () => factory({ nightShift: { autonomy: "auto" }, research: { autonomy: "auto" } });

  it("wait for the owner on an auto line", async () => {
    const { ctx } = auto();
    const n = noteOf(ctx, "Precios de productos comparables", true);
    await scoutPass(ctx, scouting([idea("Agregar planes", { researchNote: n.id })]).runner, at(3));
    const [p] = ctx.store.listProposals();
    expect(p).toMatchObject({ status: "pending", business: true });
    expect(ctx.store.listJobs()).toHaveLength(0);
    expect(proposalAutonomy(ctx.config, ctx.config.lines[0]!, p!)).toBe("propose");
  });

  it("technical notes are unaffected", async () => {
    const { ctx } = auto();
    const n = noteOf(ctx, "Skill de tests", false);
    await scoutPass(ctx, scouting([idea("Usar la skill", { researchNote: n.id })]).runner, at(3));
    expect(ctx.store.listProposals()[0]).toMatchObject({ status: "approved", decidedBy: "night-shift", business: false });
  });

  it("are never promoted", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const n = noteOf(ctx, "Licencias", true);
    const p = ctx.store.createProposal({ ...idea("Cambiar algo"), line: "zero", researchNote: n.id, business: true });
    ctx.config.lines[0]!.nightShift = { autonomy: "build" };
    await scoutPass(ctx, scouting([]).runner, at(3));
    expect(ctx.store.getProposal(p.id)!.status).toBe("pending");
    expect(ctx.store.listJobs()).toHaveLength(0);
  });
});

describe("license, pricing, payments and legal text", () => {
  it("recognises legal paths", () => {
    for (const p of ["LICENSE", "LICENSE.md", "docs/legal/terms.md", "PRIVACY.md", "src/licenses.ts", "COPYING", "./NOTICE", "docs\\terms-of-service.md", "EULA.txt", "web/privacy-policy.html"]) expect(touchesLegal([p])).toBe(true);
    for (const p of ["src/app.ts", "README.md", "docs/notes.md"]) expect(touchesLegal([p])).toBe(false);
  });

  it("scout's commercial flag waits on an auto line", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "auto" } });
    await scoutPass(ctx, scouting([idea("Cobrar por uso", { commercial: true })]).runner, at(3));
    expect(ctx.store.listProposals()[0]).toMatchObject({ status: "pending", commercial: true });
    expect(ctx.store.listJobs()).toHaveLength(0);
  });

  it("a license path waits on an auto line", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "auto" } });
    await scoutPass(ctx, scouting([idea("Cambiar la licencia", { paths: ["LICENSE"] })]).runner, at(3));
    expect(ctx.store.listProposals()[0]).toMatchObject({ status: "pending" });
    expect(ctx.store.listJobs()).toHaveLength(0);
  });

  it("commercial and legal pending proposals are never promoted", async () => {
    const { ctx } = factory({ nightShift: { autonomy: "propose" } });
    const flagged = ctx.store.createProposal({ ...idea("Cobros"), line: "zero", commercial: true });
    const legal = ctx.store.createProposal({ ...idea("Términos"), line: "zero", paths: ["docs/legal/terms.md"] });
    ctx.config.lines[0]!.nightShift = { autonomy: "auto" };
    await scoutPass(ctx, scouting([]).runner, at(3));
    expect(ctx.store.getProposal(flagged.id)!.status).toBe("pending");
    expect(ctx.store.getProposal(legal.id)!.status).toBe("pending");
  });

  it("an auto job that ends up changing LICENSE parks before integrating", async () => {
    const repo = gitRepo();
    const ctx = testFactory({ level: "L3", isolation: "container", approvals: { timeoutHours: 1, onTimeout: "approve" }, lines: [{ name: "demo", repo, verify: [passes] }] });
    const head = () => gitIn(repo, "rev-parse", "main").trim();
    const before = head();
    const proposal = ctx.store.createProposal({ ...idea("Agregar /health"), line: "demo" });
    const { job } = requestWork(ctx, { text: "Agregar /health", line: "demo", source: { kind: "night-shift", proposal: proposal.id, autonomy: "auto" } });
    ctx.store.updateProposal(proposal.id, { status: "approved", jobId: job.id, decidedBy: "night-shift" });
    const agents = fakeAgents({ build: (req) => void writeTree(req.cwd, { LICENSE: "MIT\n", "src/x.ts": "ok" }) });
    const deps: RunnerDeps = { ...ctx, runAgent: agents.runner, box: simulatedBox(agents.runner).box };
    const waiting = await runJob(job.id, deps);
    expect(waiting).toMatchObject({ status: "waiting", question: { kind: "before-integrate", onTimeout: "reject" } });
    expect(waiting.question!.text).toMatch(/licencia o textos legales/);
    expect(head()).toBe(before);
  });
});

describe("scout sees business notes", () => {
  it("labels them and explains commercial", async () => {
    const { ctx } = factory();
    noteOf(ctx, "Precios comparables", true);
    noteOf(ctx, "Skill nueva", false);
    const agents = scouting([]);
    await scoutLine(ctx, ctx.config.lines[0]!, agents.runner, at(3));
    const prompt = agents.calls[0]!.prompt;
    expect(prompt).toMatch(/### Precios comparables \([^)]*business note\)/);
    expect(prompt).not.toMatch(/### Skill nueva \([^)]*business note\)/);
    expect(prompt).toContain("`commercial`");
    expect(prompt).toContain("wait for the owner");
  });
});

describe("briefing", () => {
  it("separates business and technical notes", async () => {
    const { ctx } = factory();
    noteOf(ctx, "Precios comparables", true);
    noteOf(ctx, "Skill nueva", false);
    const body = (await briefing(ctx)).body;
    const biz = body.indexOf("### Negocio");
    const tech = body.indexOf("### Técnica");
    expect(biz).toBeGreaterThan(-1);
    expect(tech).toBeGreaterThan(biz);
    expect(body.indexOf("Precios comparables")).toBeGreaterThan(biz);
    expect(body.indexOf("Precios comparables")).toBeLessThan(tech);
    expect(body.indexOf("Skill nueva")).toBeGreaterThan(tech);
  });

  it("only technical", async () => {
    const { ctx } = factory();
    noteOf(ctx, "Skill nueva", false);
    const body = (await briefing(ctx)).body;
    expect(body).not.toContain("Negocio");
    expect(body).toContain("### Técnica");
  });
});

describe("panel research tab", () => {
  it("groups business and technical notes, with their skill", async () => {
    const { ctx } = factory();
    noteOf(ctx, "Precios comparables", true);
    noteOf(ctx, "Skill nueva", false);
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const html = await (await fetch(`${base}/research`, { headers: { cookie: `zero_panel=${sessionFor(panelKey(ctx.secrets))}` } })).text();
    const biz = html.indexOf("<h3>Negocio</h3>");
    const tech = html.indexOf("<h3>Técnica</h3>");
    expect(biz).toBeGreaterThan(-1);
    expect(tech).toBeGreaterThan(biz);
    const bizCard = html.indexOf("Precios comparables");
    expect(bizCard).toBeGreaterThan(biz);
    expect(bizCard).toBeLessThan(tech);
    expect(html.indexOf("Skill nueva")).toBeGreaterThan(tech);
    expect(html).toContain(`skill ${BIZ}`);
    expect(html).toContain(`skill ${TECH}`);
  });
});

describe("README", () => {
  it("documents business research", () => {
    for (const [file, perSkill, business] of [["README.md", "per research skill", "business"], ["README.es.md", "por cada skill", "de negocio"]]) {
      const readme = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const example = readme.slice(readme.indexOf("research:                 #"));
      expect(example.slice(0, example.indexOf("```")), file).toContain("business:");
      expect(readme, file).toContain(perSkill);
      expect(readme, file).toContain(business);
    }
  });
});
