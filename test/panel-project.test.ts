import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInput, ProjectResult } from "../src/app.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, tempDir, testFactory } from "./helpers.js";

const servers: Server[] = [];
beforeEach(() => void vi.stubEnv("GH_TOKEN", "ghp_fake"));
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel(result: ProjectResult | Error = { ok: true, created: true, text: "Creé el repositorio demo-x.", line: "demo-x", job: "abcd1234" }) {
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: tempDir() }] });
  const calls: ProjectInput[] = [];
  const project = async (_ctx: unknown, input: ProjectInput) => {
    calls.push(input);
    if (result instanceof Error) throw result;
    return result;
  };
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), project });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = async (path: string) => (await fetch(base + path, { headers: { cookie } })).text();
  const post = (form: Record<string, string>, headers: Record<string, string> = { cookie, origin: base }) =>
    fetch(`${base}/projects`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, calls, cookie, get, post };
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** The fields the confirmation page's form would send back. */
const hiddenFields = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1]!, unescape(m[2]!)]));

describe("new project in the panel", () => {
  it("offers the form, linked from Resumen and Pedidos", async () => {
    const p = await panel();
    const html = await p.get("/projects");
    expect(html).toContain("<h1>Proyecto nuevo</h1>");
    expect(html).toContain('<form method="post" action="/projects">');
    for (const field of ["name", "publico", "pedido", "verify"]) expect(html).toMatch(new RegExp(`<(input|textarea)[^>]* name="${field}"`));
    expect(html).not.toContain('name="confirm"');
    for (const path of ["/", "/requests"]) expect(await p.get(path)).toContain('<a href="/projects">Proyecto nuevo</a>');
  });

  it("without confirm=1 only shows the confirmation page, private by default", async () => {
    const p = await panel();
    const before = readFileSync(p.ctx.home.config, "utf8");
    const r = await p.post({ name: " demo-x ", pedido: 'Demo para "X" <b>', verify: "npm test" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("¿Creo el repositorio demo-x (privado) en GitHub?");
    expect(html).toContain(p.ctx.home.projects);
    expect(html).toContain("<pre>npm test</pre>");
    expect(html).not.toContain("<b>");
    expect(hiddenFields(html)).toEqual({ name: "demo-x", pedido: 'Demo para "X" <b>', verify: "npm test", confirm: "1" });
    for (const confirm of ["", "0", "true"]) await p.post({ name: "demo-x", confirm });
    expect(p.calls).toEqual([]);
    expect(readFileSync(p.ctx.home.config, "utf8")).toBe(before);
    expect(existsSync(p.ctx.home.projects)).toBe(false);
  });

  it("says when the repository would be public", async () => {
    const p = await panel();
    const html = await (await p.post({ name: "yo/demo-x", publico: "1" })).text();
    expect(html).toContain("¿Creo el repositorio yo/demo-x (público) en GitHub?");
    expect(hiddenFields(html)).toMatchObject({ publico: "1" });
    expect(p.calls).toEqual([]);
  });

  it("creates it once with the confirmed form and shows the result text", async () => {
    const p = await panel();
    const fields = hiddenFields(await (await p.post({ name: "demo-x", publico: "1", pedido: "Demo con turnos", verify: "npm test\r\nnpm run build\r\n\r\n" })).text());
    const r = await p.post(fields);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Creé el repositorio demo-x.");
    expect(html).toContain('href="/job/abcd1234"');
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]).toMatchObject({ name: "demo-x", publico: true, pedido: "Demo con turnos", verify: ["npm test", "npm run build"] });
    expect(await p.calls[0]!.confirm!("")).toBe(true);
  });

  it("leaves out what was not given, so the repository is private and the commands are detected", async () => {
    const p = await panel();
    await p.post({ name: "demo-x", pedido: "  ", verify: " \r\n", confirm: "1" });
    expect(p.calls).toHaveLength(1);
    const { confirm, ...input } = p.calls[0]!;
    expect(confirm).toBeTypeOf("function");
    expect(input).toEqual({ name: "demo-x" });
  });

  it("shows why a check fails over the kept form, before asking", async () => {
    const p = await panel();
    const bad = await (await p.post({ name: "mi demo!", publico: "1", pedido: "Demo con turnos" })).text();
    expect(bad).toContain("no es un nombre de repositorio válido");
    expect(bad).toContain('value="mi demo!"');
    expect(bad).toContain('value="1" checked>');
    expect(bad).toContain("Demo con turnos</textarea>");
    const taken = await (await p.post({ name: "tienda" })).text();
    expect(taken).toContain("Ya existe la línea &quot;tienda&quot;");
    for (const html of [bad, taken]) expect(html).not.toContain('name="confirm"');
    expect(p.calls).toEqual([]);
  });

  it("shows a failure in full, not cut as a flash message", async () => {
    const text = `Creé el repositorio me/demo-x, pero no pude clonarlo: ${"x".repeat(700)} <fin>`;
    const p = await panel({ ok: false, created: true, text });
    const html = await (await p.post({ name: "demo-x", confirm: "1" })).text();
    expect(html).toContain(text.replace("<fin>", "&lt;fin&gt;"));
    expect(html).toContain("El repositorio se creó, pero falta un paso");
  });

  it("goes back to the form with an unexpected error", async () => {
    const p = await panel(new Error("se cortó"));
    const r = await p.post({ name: "demo-x", confirm: "1" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/projects?msg=${encodeURIComponent("se cortó")}`);
    expect(await p.get(r.headers.get("location")!)).toContain("se cortó");
  });

  it("refuses a confirmed post from another site or without a session", async () => {
    const p = await panel();
    expect((await p.post({ name: "demo-x", confirm: "1" }, { cookie: p.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await p.post({ name: "demo-x", confirm: "1" }, { cookie: p.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await p.post({ name: "demo-x", confirm: "1" }, {})).status).toBe(401);
    expect(p.calls).toEqual([]);
  });

  it("never creates anything from a GET", async () => {
    const p = await panel();
    await p.get("/projects?name=demo-x&confirm=1");
    expect(p.calls).toEqual([]);
  });
});
