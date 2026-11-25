import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, factoryStatus, requestInvestigation, researchOnDemand, researchView } from "../src/app.js";
import { describeResearchRun } from "../src/format.js";
import { readResearchRequest, RESEARCH_REQUEST_KEY, RESEARCH_RUNS_KEY, type ResearchRunRecord } from "../src/line/research.js";
import { esc, overviewPage, researchPage } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m);
const TOPIC = "cómo viralizar un reel";
const factory = (over: Record<string, unknown> = {}) => testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => at(14));
type Ctx = ReturnType<typeof factory>;

const research = (ctx: Ctx) => researchPage(researchView(ctx, at(14)), researchOnDemand(ctx), "n");
const overview = (ctx: Ctx) => overviewPage(factoryStatus(ctx), ctx.config.lines.map((l) => l.name), "n");
const form = (html: string) => /<form method="post" action="\/research">.*?<\/form>/s.exec(html)?.[0] ?? "";
const recorded = (over: Partial<ResearchRunRecord> = {}): ResearchRunRecord => ({ asked: at(13).toISOString(), line: "tienda", topic: TOPIC, startedAt: at(13, 5).toISOString(), endedAt: at(13, 7).toISOString(), outcome: "ok", notes: [], ...over });
const record = (ctx: Ctx, ...runs: ResearchRunRecord[]) => ctx.store.setKv(RESEARCH_RUNS_KEY, JSON.stringify(runs));
const ask = (ctx: Ctx) => expect(requestInvestigation(ctx, TOPIC, "tienda", at(13)).ok).toBe(true);
const note = (ctx: Ctx) => ctx.store.createResearchNote({ line: "tienda", topic: "Gancho", findings: "Los primeros 3 segundos.", sources: ["https://example.com/reels"], serves: "contenido", maturity: "estable" });

async function panel(over: Record<string, unknown> = {}) {
  const ctx = factory(over);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = async (path: string) => (await fetch(base + path, { headers: { cookie } })).text();
  const post = (fields: Record<string, string>, headers: Record<string, string> = { cookie }) =>
    fetch(`${base}/research`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString(), redirect: "manual" });
  return { ctx, base, cookie, get, post };
}
/** Where an answer goes back to, as its path and its message. */
function goesTo(r: Response) {
  const url = new URL(r.headers.get("location")!, "http://panel");
  return { path: url.pathname, msg: url.searchParams.get("msg") };
}

describe("the research page", () => {
  it("has the form, with the topic and the lines that are not a package's", () => {
    const ctx = factory({
      lines: [
        { name: "tienda", repo: gitRepo() },
        { name: "blog", repo: gitRepo() },
      ],
    });
    ctx.config.lines.push({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    const html = form(research(ctx));
    expect(html).toContain("Investigar ahora");
    expect(html).toContain(`name="topic" maxlength="2000" required`);
    expect([...html.matchAll(/<option value="([^"]*)">([^<]*)/g)].map((m) => [m[1], m[2]])).toEqual([
      ["tienda", "tienda"],
      ["blog", "blog"],
    ]);
  });

  it("has no form with research off, though what was recorded is still told", () => {
    const ctx = factory({ research: "off" });
    expect(research(ctx)).not.toContain(`action="/research"`);
    expect(research(ctx)).not.toContain("Investigar a demanda");
    record(ctx, recorded({ startedAt: undefined, outcome: "not-run", reason: "la investigación está apagada" }));
    expect(research(ctx)).toContain("la investigación está apagada");
    expect(research(ctx)).not.toContain(`action="/research"`);
  });

  it("has no form without a line it can be asked for", () => {
    const ctx = factory();
    ctx.config.lines[0]!.package = "redes";
    expect(form(research(ctx))).toBe("");
  });

  it("shows the pending request, and refreshes itself only while there is something to wait for", () => {
    const ctx = factory();
    record(ctx, recorded());
    expect(research(ctx)).not.toContain("Investigación a demanda: ");
    expect(research(ctx)).not.toContain("location.reload");
    ask(ctx);
    expect(research(ctx)).toContain(`Investigación a demanda: pendiente para tienda desde`);
    expect(research(ctx)).toContain("location.reload");
    const running = factory();
    record(running, recorded({ endedAt: undefined, outcome: undefined }));
    expect(research(running)).toMatch(/corriendo desde [^<]*13:05/);
    expect(research(running)).toContain("location.reload");
  });

  it("links a run to its notes' cards, and only names a note that is no longer shown", () => {
    const ctx = factory();
    const n = note(ctx);
    const run = recorded({ notes: [n.id, "0badcafe"] });
    record(ctx, run, recorded({ asked: at(12).toISOString(), outcome: "stopped", reason: "la fábrica se apagó" }));
    const html = research(ctx);
    expect(html).toContain(`<li>${esc(describeResearchRun(run))} · <a href="#note-${n.id}">${n.id}</a>, 0badcafe</li>`);
    expect(html).toContain(`<div class="card" id="note-${n.id}">`);
    expect(html).toMatch(/se cortó [^<]*la fábrica se apagó/);
  });

  it("escapes the topics, the reasons, the ids and the lines", () => {
    const ctx = factory();
    record(ctx, recorded({ topic: "reels <script>alert(1)</script>", outcome: "failed", reason: "<b>no</b>", notes: ["<i>x</i>"] }));
    ctx.store.setKv(RESEARCH_REQUEST_KEY, JSON.stringify({ requestedAt: at(13).toISOString(), line: "<u>l</u>", topic: "<script>alert(2)</script>" }));
    ctx.config.lines[0]!.name = `"><em>`;
    for (const html of [research(ctx), overview(ctx)]) {
      for (const raw of ["<script>alert", "<b>no</b>", "<i>x</i>", "<u>l</u>", `value=""><em>`]) expect(html).not.toContain(raw);
      expect(html).toContain("reels &lt;script&gt;alert(1)");
      expect(html).toMatch(/<span class="bad">[^<]*falló/);
    }
    expect(research(ctx)).toContain("&lt;i&gt;x");
  });
});

describe("the panel's summary", () => {
  it("shows the pending request and the last run, with a link to the research page", () => {
    const ctx = factory();
    expect(overview(ctx)).not.toContain("Ver la investigación");
    const run = recorded({ notes: ["aaaaaaaa", "bbbbbbbb"] });
    record(ctx, run, recorded({ asked: at(12).toISOString(), topic: "otro tema" }));
    ask(ctx);
    const html = overview(ctx);
    expect(html).toMatch(/Investigación a demanda: pendiente para tienda desde [^<]*cómo viralizar un reel/);
    expect(html).toContain(`Última investigación a demanda: ${esc(describeResearchRun(run))}`);
    expect(html).toMatch(/terminó bien [^<]* · 2 notas/);
    expect(html).not.toContain("otro tema");
    expect(html).toContain(`<a href="/research">Ver la investigación</a>`);
  });
});

describe("POST /research", () => {
  it("asks for the run and goes back to the page, which shows the confirmation and the request", async () => {
    const p = await panel();
    const r = await p.post({ topic: ` ${TOPIC} `, line: "tienda" });
    expect(r.status).toBe(303);
    expect(goesTo(r)).toEqual({ path: "/research", msg: expect.stringContaining("Investigación pedida para tienda") });
    expect(readResearchRequest(p.ctx.store)).toEqual({ requestedAt: at(14).toISOString(), line: "tienda", topic: TOPIC });
    const html = await p.get(r.headers.get("location")!);
    expect(html).toContain("Investigación pedida para tienda");
    expect(html).toContain("Investigación a demanda: pendiente para tienda");
  });

  it("counts a line break of the form as one character", async () => {
    const p = await panel();
    const lines = `${"a".repeat(999)}\r\n${"b".repeat(1000)}`;
    expect(goesTo(await p.post({ topic: lines, line: "tienda" })).msg).toContain("Investigación pedida");
    expect(readResearchRequest(p.ctx.store)!.topic).toHaveLength(2000);
  });

  it("goes back with the reason of a refusal, and asks for nothing", async () => {
    const p = await panel();
    expect(goesTo(await p.post({ topic: TOPIC, line: "otra" }))).toEqual({ path: "/research", msg: expect.stringContaining('no existe la línea "otra"') });
    expect(goesTo(await p.post({ topic: "  ", line: "tienda" })).msg).toContain("falta el tema");
    expect(goesTo(await p.post({ line: "tienda" })).msg).toContain("falta el tema");
    p.ctx.store.setKv(ANDON_KEY, "on");
    expect(goesTo(await p.post({ topic: TOPIC, line: "tienda" })).msg).toContain("andon");
    expect(p.ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBeUndefined();
  });

  it("refuses with research off, and with one already pending", async () => {
    const off = await panel({ research: "off" });
    expect(goesTo(await off.post({ topic: TOPIC, line: "tienda" })).msg).toContain("research: off");
    expect(off.ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBeUndefined();
    const p = await panel();
    ask(p.ctx);
    expect(goesTo(await p.post({ topic: "otro", line: "tienda" })).msg).toContain("ya hay una investigación pendiente");
    expect(readResearchRequest(p.ctx.store)).toMatchObject({ topic: TOPIC });
  });

  it("asks for nothing without a session, or from another site", async () => {
    const p = await panel();
    const fields = { topic: TOPIC, line: "tienda" };
    expect((await p.post(fields, {})).status).toBe(401);
    expect((await p.post(fields, { cookie: p.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await p.post(fields, { cookie: p.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(p.ctx.store.getKv(RESEARCH_REQUEST_KEY)).toBeUndefined();
    expect((await p.post(fields, { cookie: p.cookie, origin: p.base })).status).toBe(303);
    expect(readResearchRequest(p.ctx.store)).toMatchObject({ line: "tienda" });
  });

  it("the agents page tells of it", async () => {
    const p = await panel();
    expect(await p.get("/agents")).toContain("zero investigar o el formulario de Investigación");
  });
});

describe("the READMEs", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const section = (text: string, heading: string) => text.split(`\n${heading}\n`)[1]!.split("\n## ")[0]!;

  it("describe the command, the chat tool, the form and the cap in their research section", () => {
    for (const text of [section(read("README.md"), "## Research"), section(read("README.es.md"), "## Investigación")]) {
      for (const word of ["zero investigar ", "--esperar", "zero_investigate", "Investigar ahora", "research.usdPerRun", "usdPerRun: 2", "limits.usdPerNight"]) expect(text).toContain(word);
    }
  });
});
