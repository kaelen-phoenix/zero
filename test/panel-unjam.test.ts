import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, factoryStatus, requestUnjam } from "../src/app.js";
import { describeUnjamRun } from "../src/format.js";
import { readUnjamRequest, UNJAM_REQUEST_KEY, UNJAM_RUN_KEY, type UnjamRunRecord } from "../src/line/unjam.js";
import { esc, overviewPage } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m);
const factory = (over: Record<string, unknown> = {}) => testFactory({ isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...over }, () => at(14));
type Ctx = ReturnType<typeof factory>;

const overview = (ctx: Ctx) => overviewPage(factoryStatus(ctx), ctx.config.lines.map((l) => l.name), "n");
/** The form's own markup: the request form next to it lists lines too. */
const form = (html: string) => /<form method="post" action="\/unjam">.*?<\/form>/s.exec(html)?.[0] ?? "";
const recorded = (over: Partial<UnjamRunRecord> = {}): UnjamRunRecord => ({ asked: at(13).toISOString(), line: "tienda", startedAt: at(13, 5).toISOString(), endedAt: at(13, 7).toISOString(), outcome: "ok", lines: [{ line: "tienda", jams: 2, causes: 1 }], ...over });
function withRun(over: Partial<UnjamRunRecord> = {}, config: Record<string, unknown> = {}) {
  const ctx = factory(config);
  const run = recorded(over);
  ctx.store.setKv(UNJAM_RUN_KEY, JSON.stringify(run));
  return { html: overview(ctx), run };
}

async function panel(over: Record<string, unknown> = {}) {
  const ctx = factory(over);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const post = (fields: Record<string, string>, headers: Record<string, string> = { cookie }) =>
    fetch(`${base}/unjam`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString(), redirect: "manual" });
  return { ctx, base, cookie, post };
}
/** Where an answer goes back to, as its path and its message. */
function goesTo(r: Response) {
  const url = new URL(r.headers.get("location")!, "http://panel");
  return { path: url.pathname, msg: url.searchParams.get("msg") };
}

describe("the panel's summary", () => {
  it("has the form, with every line or one that is not a package's", () => {
    const ctx = factory({
      lines: [
        { name: "tienda", repo: gitRepo() },
        { name: "blog", repo: gitRepo() },
      ],
    });
    ctx.config.lines.push({ ...ctx.config.lines[0]!, name: "social", package: "redes" });
    const html = overview(ctx);
    expect(html).toContain("Destrabar ahora");
    expect([...form(html).matchAll(/<option value="([^"]*)">([^<]*)/g)].map((m) => [m[1], m[2]])).toEqual([
      ["", "Todas las líneas"],
      ["tienda", "tienda"],
      ["blog", "blog"],
    ]);
  });

  it("has no form with unjam off, though a run that could not start is still told", () => {
    const off = overview(factory({ unjam: "off" }));
    expect(off).not.toContain("Destrabar ahora");
    expect(off).not.toContain("<h2>Destrabador</h2>");
    const { html } = withRun({ startedAt: undefined, outcome: "not-run", reason: "el destrabador está apagado", lines: [] }, { unjam: "off" });
    expect(html).toContain("el destrabador está apagado");
    expect(html).not.toContain("Destrabar ahora");
  });

  it("shows the pending request", () => {
    const ctx = factory();
    expect(overview(ctx)).not.toContain("Corrida a demanda: ");
    requestUnjam(ctx, "tienda", at(13));
    expect(overview(ctx)).toContain("Corrida a demanda: pendiente para tienda desde");
  });

  it("shows a run under way and since when", () => {
    const { html } = withRun({ endedAt: undefined, outcome: undefined, lines: [] });
    expect(html).toMatch(/Última corrida a demanda: pedida para tienda [^<]*13:00, corriendo desde [^<]*13:05/);
  });

  it("shows when the last run started and how it ended", () => {
    const ok = withRun();
    expect(ok.html).toContain(`<p>Última corrida a demanda: ${esc(describeUnjamRun(ok.run))}</p>`);
    expect(ok.html).toMatch(/empezó [^<]*13:05, terminó bien [^<]*13:07\) · tienda: 2 trabas, 1 causa/);
    const failed = withRun({ outcome: "failed", reason: "no hubo un diagnóstico válido de <tienda>" });
    expect(failed.html).toMatch(/<p class="bad">Última corrida a demanda: [^<]*empezó [^<]*13:05, falló [^<]*13:07\)/);
    expect(failed.html).toContain("válido de &lt;tienda&gt;");
  });

  it("says which jobs the run closed because they were already resolved, escaped", () => {
    const { html, run } = withRun({ closed: [{ line: "<tienda>", job: "a1b2c3d4" }] });
    expect(html).toContain(`<p>Última corrida a demanda: ${esc(describeUnjamRun(run))}</p>`);
    expect(html).toContain("cerró 1 trabajo que ya estaba resuelto (&lt;tienda&gt;: a1b2c3d4)");
  });
});

describe("POST /unjam", () => {
  it("asks for the run of a line and goes back to the summary with the operation's text", async () => {
    const p = await panel();
    const r = await p.post({ line: "tienda" });
    expect(r.status).toBe(303);
    expect(goesTo(r)).toEqual({ path: "/", msg: expect.stringContaining("Corrida del destrabador pedida para tienda") });
    expect(readUnjamRequest(p.ctx.store)).toEqual({ requestedAt: at(14).toISOString(), line: "tienda" });
  });

  it("without a line it is for every line", async () => {
    const p = await panel();
    expect(goesTo(await p.post({ line: "" })).msg).toContain("todas las líneas");
    expect(readUnjamRequest(p.ctx.store)).toEqual({ requestedAt: at(14).toISOString() });
  });

  it("goes back with the reason of a refusal, and asks for nothing", async () => {
    const p = await panel();
    expect(goesTo(await p.post({ line: "otra" })).msg).toContain('no existe la línea "otra"');
    p.ctx.store.setKv(ANDON_KEY, "on");
    expect(goesTo(await p.post({ line: "tienda" }))).toEqual({ path: "/", msg: expect.stringContaining("andon") });
    expect(p.ctx.store.getKv(UNJAM_REQUEST_KEY)).toBeUndefined();
  });

  it("asks for nothing without a session, or from another site", async () => {
    const p = await panel();
    expect((await p.post({ line: "tienda" }, {})).status).toBe(401);
    expect((await p.post({ line: "tienda" }, { cookie: p.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await p.post({ line: "tienda" }, { cookie: p.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(p.ctx.store.getKv(UNJAM_REQUEST_KEY)).toBeUndefined();
    expect((await p.post({ line: "tienda" }, { cookie: p.cookie, origin: p.base })).status).toBe(303);
    expect(readUnjamRequest(p.ctx.store)).toMatchObject({ line: "tienda" });
  });
});

describe("the READMEs", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const section = (text: string, heading: string) => text.split(`\n${heading}\n`)[1]!.split("\n## ")[0]!;

  it("describe the command, the chat tool, the button and the limits in their unjam section", () => {
    for (const text of [section(read("README.md"), "## Unjam"), section(read("README.es.md"), "## Destrabador")]) {
      for (const word of ["`zero destrabar`", "zero destrabar [line]", "zero_unjam", "Destrabar ahora", "unjam.maxJobsPerDay", "limits.usdPerNight"]) expect(text).toContain(word);
    }
  });
});
