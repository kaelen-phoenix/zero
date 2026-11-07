import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { packageDataDir, factoryConfig } from "../src/packages.js";
import { safeUrl } from "../src/package-tabs.js";
import { loginPage } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const TAB = "/packages/hello/noticias";

/** A panel whose factory has one package with the given tab, and its data file when given. */
async function panel(opts: { tab?: Record<string, unknown>; data?: unknown } = {}) {
  const dir = tempDir("zero-pkg-");
  writeTree(dir, { "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", tabs: [{ name: "noticias", title: "Noticias <b>", data: "items.json", ...opts.tab }] }) });
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], packages: [{ path: dir }] });
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  const data = packageDataDir(ctx.home, "hello");
  mkdirSync(data, { recursive: true });
  if (opts.data !== undefined) writeFileSync(join(data, "items.json"), typeof opts.data === "string" ? opts.data : JSON.stringify(opts.data));
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const text = async (path: string) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    return r.text();
  };
  return { ctx, base, cookie, data, get, text };
}

const items = [
  { title: "Uno", url: "https://example.com/a", category: "a", description: "primero", date: "2026-11-01" },
  { title: "Dos", category: "b" },
];

const INVALID = "no son válidos";

describe("a package's tab in the menu", () => {
  it("is linked from every page with a menu, its title escaped", async () => {
    const p = await panel();
    for (const path of ["/", "/line", "/proposals", "/about", TAB]) {
      const html = await p.text(path);
      expect(html).toContain(`<a href="${TAB}">Noticias &lt;b&gt;</a>`);
    }
  });

  it("is not on the login page", async () => {
    const p = await panel();
    const r = await p.get("/", {});
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain(TAB);
  });
});

describe("a package's tab page", () => {
  it("shows valid data", async () => {
    const html = await (await panel({ data: { items } })).text(TAB);
    expect(html).toContain("Uno");
    expect(html).toContain("Dos");
    expect(html).toContain("primero");
    expect(html).not.toContain(INVALID);
  });

  it("says there is no data yet when the file is missing", async () => {
    const html = await (await panel()).text(TAB);
    expect(html).toContain("Todavía no hay datos");
  });

  it.each([
    ["broken JSON", "{ items: ["],
    ["an item without title", { items: [{ url: "https://example.com" }] }],
    ["a title of 301 characters", { items: [{ title: "x".repeat(301) }, { title: "Visible" }] }],
    ["more than 500 items", { items: Array.from({ length: 501 }, (_, i) => ({ title: `t${i}` })) }],
    ["a file over 1 MiB", JSON.stringify({ items: [{ title: "Visible", description: "x".repeat(1024 * 1024) }] })],
  ])("warns about %s and shows no item", async (_what, data) => {
    const html = await (await panel({ data })).text(TAB);
    expect(html).toContain(INVALID);
    expect(html).not.toContain("Visible");
    expect(html).not.toContain("<li>");
  });

  it("does not follow a link out of the data folder", async (t) => {
    const p = await panel();
    const outside = join(tempDir(), "outside.json");
    writeFileSync(outside, JSON.stringify({ items: [{ title: "Secreto" }] }));
    try {
      symlinkSync(outside, join(p.data, "items.json"));
    } catch {
      return t.skip();
    }
    const html = await p.text(TAB);
    expect(html).toContain(INVALID);
    expect(html).not.toContain("Secreto");
  });

  it("does not follow a folder link out of the data folder", async (t) => {
    const p = await panel({ tab: { data: "sub/items.json" } });
    const outside = tempDir();
    writeFileSync(join(outside, "items.json"), JSON.stringify({ items: [{ title: "Secreto" }] }));
    try {
      symlinkSync(outside, join(p.data, "sub"), "junction");
    } catch {
      return t.skip();
    }
    const html = await p.text(TAB);
    expect(html).toContain(INVALID);
    expect(html).not.toContain("Secreto");
  });

  it("escapes every text of the data", async () => {
    const html = await (await panel({ data: { items: [{ title: "<script>alert(1)</script>", description: "<img src=x onerror=y>", category: "<i>c</i>", date: "<u>d</u>" }] } })).text(TAB);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<i>c</i>");
    expect(html).not.toContain("<u>d</u>");
  });

  it("links only http and https urls, in a new tab", async () => {
    const data = {
      items: [
        { title: "Segura", url: "https://example.com/a" },
        { title: "Plana", url: "http://example.com/b" },
        { title: "Peligrosa", url: "javascript:alert(1)" },
        { title: "Datos", url: "data:text/html,hi" },
        { title: "Relativa", url: "/job/x" },
        { title: "Rota", url: "http//" },
      ],
    };
    const html = await (await panel({ data })).text(TAB);
    expect(html).toContain(`<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">Segura</a>`);
    expect(html).toContain(`href="http://example.com/b"`);
    expect(html).not.toContain(`href="javascript:`);
    expect(html).not.toContain(`href="data:`);
    expect(html).not.toContain(`href="/job/x"`);
    for (const title of ["Peligrosa", "Datos", "Relativa", "Rota"]) expect(html).toContain(`<b>${title}</b>`);
  });

  it("filters by categoria, and shows everything without it", async () => {
    const p = await panel({ tab: { categories: undefined }, data: { items } });
    const filtered = await p.text(`${TAB}?categoria=a`);
    expect(filtered).toContain("Uno");
    expect(filtered).not.toContain("Dos");
    expect(filtered).toContain(`<option value="a" selected>a</option>`);
    expect(filtered).toContain(`<option value="b">b</option>`);
    for (const path of [TAB, `${TAB}?categoria=`]) {
      const all = await p.text(path);
      expect(all).toContain("Uno");
      expect(all).toContain("Dos");
    }
  });

  it("offers the manifest's categories even when no item uses them", async () => {
    const html = await (await panel({ tab: { categories: ["x", "y"] }, data: { items } })).text(TAB);
    expect(html).toContain(`<option value="x">x</option>`);
    expect(html).toContain(`<option value="y">y</option>`);
    expect(html).not.toContain(`<option value="a"`);
  });

  it("asks for the session", async () => {
    const p = await panel({ data: { items } });
    const r = await p.get(TAB, {});
    expect(r.status).toBe(401);
    const html = await r.text();
    expect(html).toContain("Panel de tu fábrica");
    expect(html).not.toContain("Uno");
  });

  it("answers 404 for a tab or a package that does not exist", async () => {
    const p = await panel();
    for (const path of ["/packages/hello/otra", "/packages/otro/noticias", "/packages/hello", "/packages/hello/noticias/x"]) expect((await p.get(path)).status).toBe(404);
  });

  it("takes no action", async () => {
    const p = await panel({ data: { items } });
    const r = await fetch(p.base + TAB, { method: "POST", headers: { cookie: p.cookie, origin: p.base, "content-type": "application/x-www-form-urlencoded" }, body: "categoria=a", redirect: "manual" });
    expect(r.status).toBe(404);
  });
});

describe("a shared link", () => {
  it("goes back to its own page after the key is exchanged", () => {
    const html = loginPage("n");
    expect(html).toContain(`const here = location.pathname + location.search;`);
    expect(html).toContain(`here.startsWith("/") && !here.startsWith("//") ? here : "/"`);
    expect(html).toContain(`history.replaceState(null, "", to)`);
    expect(html).toContain(`location.replace(to)`);
    expect(html).not.toContain(`location.replace("/")`);
  });
});

describe("safeUrl", () => {
  it("keeps only absolute http and https urls", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("HTTP://example.com")).toBe("http://example.com/");
    for (const url of ["javascript:alert(1)", "data:x", "/a", "//example.com", "nada", "", undefined]) expect(safeUrl(url)).toBeUndefined();
  });
});
