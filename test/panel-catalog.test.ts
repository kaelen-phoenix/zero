import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NewCatalogEntry } from "../src/catalog.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const entry = (over: Partial<NewCatalogEntry> = {}): NewCatalogEntry => ({
  name: "a11y-reviewer",
  description: "Reviews accessibility.",
  type: "review",
  source: "https://github.com/acme/agents",
  license: "MIT",
  engines: ["claude", "codex"],
  instructions: "Check accessibility of changed HTML files.",
  reviewedAt: "2026-11-10T03:00:00.000Z",
  status: "listed",
  ...over,
});

async function panel() {
  const repo = gitRepo();
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "demo", repo, verify: ["true"] }] });
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = async (path: string) => (await fetch(base + path, { headers: { cookie } })).text();
  const post = (path: string, body: Record<string, string>) =>
    fetch(base + path, { method: "POST", headers: { cookie, origin: base, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), redirect: "manual" });
  const factoryFile = () => readFileSync(ctx.home.config, "utf8");
  return { ctx, repo, base, cookie, get, post, factoryFile };
}

describe("catálogo en el panel", () => {
  it("muestra cada entrada con sus campos, la propuesta primero", async () => {
    const p = await panel();
    p.ctx.store.createCatalogEntry(entry({ name: "listed-one", source: "https://github.com/acme/listed" }));
    p.ctx.store.createCatalogEntry(entry({ name: "proposed-one", source: "https://github.com/acme/proposed", type: "build", status: "proposed", line: "demo", gap: "nadie escribe traducciones" }));
    const html = await p.get("/agents");
    const catalog = html.split("<h2>Catálogo</h2>")[1]!;
    expect(catalog.indexOf("proposed-one")).toBeLessThan(catalog.indexOf("listed-one"));
    for (const text of ["Reviews accessibility.", "https://github.com/acme/listed", "MIT", "claude, codex", "2026-11-10", "build", "review", "nadie escribe traducciones", "demo"]) expect(catalog).toContain(text);
    expect(catalog).toContain('action="/agents/catalog/add"');
    expect(catalog).toContain('action="/agents/catalog/reject"');
  });

  it("con el catálogo vacío lo dice", async () => {
    const p = await panel();
    expect(await p.get("/agents")).toContain("El catálogo todavía no tiene agentes");
  });

  it("escapa el texto de terceros", async () => {
    const p = await panel();
    p.ctx.store.createCatalogEntry(entry({ description: "Nice <script>alert(1)</script>" }));
    const html = await p.get("/agents");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("sin confirm=1 muestra la página de confirmación y no escribe nada", async () => {
    const p = await panel();
    const e = p.ctx.store.createCatalogEntry(entry());
    const before = p.factoryFile();
    const r = await p.post("/agents/catalog/add", { id: e.id, line: "demo" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("¿Sumar a11y-reviewer a la línea demo?");
    expect(html).toContain("Check accessibility of changed HTML files.");
    expect(html).toContain('name="confirm" value="1"');
    expect(p.factoryFile()).toBe(before);
    expect(existsSync(join(p.repo, ".zero"))).toBe(false);
    expect(p.ctx.store.getCatalogEntry(e.id)?.status).toBe("listed");
  });

  it("con confirm=1 suma el agente a la línea y lo marca agregado", async () => {
    const p = await panel();
    const e = p.ctx.store.createCatalogEntry(entry());
    const r = await p.post("/agents/catalog/add", { id: e.id, line: "demo", confirm: "1" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toMatch(/^\/agents/);
    expect(p.factoryFile()).toContain("a11y-reviewer");
    expect(readFileSync(join(p.repo, ".zero", "agents", "a11y-reviewer.md"), "utf8")).toContain("https://github.com/acme/agents");
    expect(readFileSync(join(p.repo, "THIRD-PARTY-NOTICES.md"), "utf8")).toContain("- License: MIT");
    expect(p.ctx.store.getCatalogEntry(e.id)).toMatchObject({ status: "added", line: "demo" });
    expect(await p.get("/agents")).not.toContain(`<input type="hidden" name="id" value="${e.id}">`);
  });

  it("rechaza una entrada y después no la suma", async () => {
    const p = await panel();
    const e = p.ctx.store.createCatalogEntry(entry());
    const r = await p.post("/agents/catalog/reject", { id: e.id, note: "no nos sirve" });
    expect(r.status).toBe(303);
    expect(p.ctx.store.getCatalogEntry(e.id)).toMatchObject({ status: "rejected", note: "no nos sirve" });
    const before = p.factoryFile();
    const again = await p.post("/agents/catalog/add", { id: e.id, line: "demo", confirm: "1" });
    expect(again.status).toBe(303);
    expect(decodeURIComponent(again.headers.get("location") ?? "")).toMatch(/^\/agents/);
    expect(p.factoryFile()).toBe(before);
    expect(existsSync(join(p.repo, ".zero"))).toBe(false);
  });

  it("rechaza un pedido de otro sitio", async () => {
    const p = await panel();
    const e = p.ctx.store.createCatalogEntry(entry());
    const r = await fetch(`${p.base}/agents/catalog/add`, {
      method: "POST",
      headers: { cookie: p.cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
      body: `id=${e.id}&line=demo&confirm=1`,
      redirect: "manual",
    });
    expect(r.status).toBe(403);
    expect(p.ctx.store.getCatalogEntry(e.id)?.status).toBe("listed");
  });
});
