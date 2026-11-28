import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { guestLog, inviteGuest, revokeGuest, type GuestInvitation } from "../src/app.js";
import { factoryConfig } from "../src/packages.js";
import { listGuests, recordGuestEvent } from "../src/panel/guests.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { REMOTE_URL_KEY } from "../src/panel/tunnel.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const OFFER = { tabs: ["novedades"], run: ["nota"], upload: ["archivo"] };
const SCOPE = { name: "cuenta", title: "Cuenta <i>" };

/** The owner's panel, with a package per entry that offers those `guests` (undefined: nothing). */
async function panel(packages: Record<string, Record<string, unknown> | undefined> = { hello: OFFER }) {
  const entries = Object.entries(packages).map(([name, guests]) => {
    const dir = tempDir("zero-pkg-");
    const manifest = {
      interface: 1,
      name,
      version: "1.0.0",
      tabs: [
        { name: "novedades", title: "Novedades <b>", data: "items.json" },
        { name: "interno", title: "Pestaña interna", data: "interno.json" },
      ],
      stations: [
        { name: "nota", module: "a.mjs", onDemand: true },
        { name: "archivo", module: "a.mjs", onDemand: true, uploads: {} },
      ],
      ...(guests && { guests }),
    };
    writeTree(dir, { "zero-package.yaml": stringify(manifest), "a.mjs": "export async function pass() {}\n" });
    return { path: dir, allowCode: true };
  });
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], packages: entries });
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path = "/guests", cookie = owner) => fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const html = async (path = "/guests") => {
    const r = await get(path);
    expect(r.status).toBe(200);
    return r.text();
  };
  const post = (path: string, form: [string, string][] | Record<string, string>, headers: Record<string, string> = { cookie: owner, origin: base }) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  const invite = (input: Partial<GuestInvitation> = {}) => {
    const r = inviteGuest(ctx, { name: "Ana", only: ["hello"], ...input });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  const signIn = async (key: string) => (await post("/login", { k: key }, {})).headers.get("set-cookie")!.split(";")[0]!;
  return { ctx, base, owner, get, html, post, invite, signIn };
}

/** The text an action sends the owner back with. */
const said = (r: Response) => {
  expect(r.status).toBe(303);
  const to = new URL(r.headers.get("location")!, "http://panel");
  expect(to.pathname).toBe("/guests");
  return to.searchParams.get("msg");
};

const keysIn = (text: string) => [...text.matchAll(/#k=([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);

describe("the owner's guests section", () => {
  it("is in the menu and offers what the loaded packages offer, escaped", async () => {
    const p = await panel({ hello: { ...OFFER, scope: SCOPE }, otro: { tabs: ["interno"] }, cerrado: undefined });
    const html = await p.html();
    expect(html).toContain(`<a href="/guests" aria-current="page"`);
    expect([...html.matchAll(/name="solo" value="([^"]+)"/g)].map((m) => m[1])).toEqual(["hello/novedades", "hello/nota", "hello/archivo", "otro/interno"]);
    expect(html).toContain("ver la pestaña «Novedades &lt;b&gt;»");
    expect(html).toContain("pedir corridas de nota");
    expect(html).toContain("subir archivos a archivo");
    expect(html).toContain("hello (Cuenta &lt;i&gt;)");
    expect(html).toContain(`name="alcance"`);
    expect(html).toContain(`name="todo"`);
    expect(html).not.toContain("<script");
  });

  it("asks for no scope when no package declares one", async () => {
    const html = await (await panel()).html();
    expect(html).not.toContain(`name="alcance"`);
    expect(html).not.toContain(`name="todo"`);
  });

  it("says when there is nothing to offer, nobody invited and nothing in the log", async () => {
    const html = await (await panel({ cerrado: undefined })).html();
    expect(html).toContain("Ningún paquete instalado ofrece algo a invitados.");
    expect(html).toContain("No hay invitados al panel.");
    expect(html).toContain("No hay nada en el registro de invitados.");
    expect(html).not.toContain(`action="/guests"`);
  });

  it("is only for the owner's session", async () => {
    const p = await panel();
    const guest = await p.signIn(p.invite().key);
    const before = guestLog(p.ctx)!.length;
    expect((await p.get("/guests", "")).status).toBe(401);
    expect((await p.post("/guests", { nombre: "Beto", solo: "hello/novedades" }, {})).status).toBe(401);
    expect((await p.get("/guests", guest)).status).toBe(404);
    const id = listGuests(p.ctx.store)[0]!.id;
    expect((await p.post("/guests", { nombre: "Beto", solo: "hello/novedades" }, { cookie: guest, origin: p.base })).status).toBe(404);
    expect((await p.post(`/guests/${id}/revoke`, { confirm: "1" }, { cookie: guest, origin: p.base })).status).toBe(404);
    expect((await p.post("/guests", { nombre: "Beto", solo: "hello/novedades" }, { cookie: p.owner, origin: "https://otro.example" })).status).toBe(403);
    expect((await p.post(`/guests/${id}/revoke`, { confirm: "1" }, { cookie: p.owner, origin: "https://otro.example" })).status).toBe(403);
    expect(listGuests(p.ctx.store).map((g) => g.name)).toEqual(["Ana"]);
    expect(guestLog(p.ctx)!.slice(0, -before).every((e) => e.kind === "denied")).toBe(true);
  });
});

describe("inviting from the panel", () => {
  it("answers with the link once, and never shows the key again", async () => {
    const p = await panel();
    p.ctx.store.setKv(REMOTE_URL_KEY, "https://algo.trycloudflare.com");
    const r = await p.post("/guests", { nombre: "Ana <b>", solo: "hello/novedades" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("no-store");
    const html = await r.text();
    expect(html).toContain("Ana &lt;b&gt;");
    expect(html).not.toContain("Ana <b>");
    expect(html).not.toContain("<script");
    expect(html).toContain("<pre>https://algo.trycloudflare.com/#k=");
    expect(html).toContain("cambia cada vez que se reinicia");
    const [key, ...rest] = [...new Set(keysIn(html))];
    expect(rest).toEqual([]);
    expect(key).not.toBe(panelKey(p.ctx.secrets));
    expect(listGuests(p.ctx.store).map((g) => [g.name, g.grants])).toEqual([["Ana <b>", [{ package: "hello", tabs: ["novedades"], run: [], upload: [] }]]]);
    const after = await p.html();
    expect(after).toContain("Ana &lt;b&gt;");
    expect(after).not.toContain(key);
    expect(after).not.toContain("#k=");
    // The link works, and only for what was marked.
    const cookie = await p.signIn(key!);
    expect((await p.get("/packages/hello/novedades", cookie)).status).toBe(200);
    expect((await p.get("/packages/hello/interno", cookie)).status).toBe(404);
  });

  it("shows the key alone while there is no tunnel", async () => {
    const p = await panel();
    const html = await (await p.post("/guests", { nombre: "Ana", solo: "hello/nota" })).text();
    expect(html).toContain("zero panel remote on");
    const key = /<pre>([A-Za-z0-9_-]{43})<\/pre>/.exec(html)![1]!;
    expect((await p.get("/", await p.signIn(key))).status).toBe(200);
  });

  it("takes several parts and one scope value per line, or everything", async () => {
    const p = await panel({ hello: { ...OFFER, scope: SCOPE }, otro: OFFER });
    const limited = await p.post("/guests", [["nombre", "Ana"], ["solo", "hello/novedades"], ["solo", "hello/nota"], ["solo", "otro/archivo"], ["alcance", " norte \r\n\r\nsur\r\n"]]);
    expect(limited.status).toBe(200);
    expect((await p.post("/guests", { nombre: "Beto", solo: "hello/nota", todo: "1" })).status).toBe(200);
    expect(listGuests(p.ctx.store).map((g) => g.grants)).toEqual([
      [
        { package: "hello", tabs: ["novedades"], run: ["nota"], upload: [], scope: { name: "cuenta", values: ["norte", "sur"] } },
        { package: "otro", tabs: [], run: [], upload: ["archivo"] },
      ],
      [{ package: "hello", tabs: [], run: ["nota"], upload: [], scope: { name: "cuenta", values: "all" } }],
    ]);
    const html = await p.html();
    expect(html).toContain("hello: ve novedades · pide corridas de nota · Cuenta &lt;i&gt;: norte, sur");
    expect(html).toContain("hello: pide corridas de nota · Cuenta &lt;i&gt;: todo");
  });

  it.each<[string, [string, string][], RegExp]>([
    ["no name", [["solo", "otro/nota"]], /falta el nombre/],
    ["a long name", [["nombre", "a".repeat(61)], ["solo", "otro/nota"]], /60 caracteres/],
    ["a repeated name", [["nombre", " ANA "], ["solo", "otro/nota"]], /ya hay un invitado activo con el nombre "ANA"/],
    ["nothing marked", [["nombre", "Beto"]], /marcá al menos una pestaña o acción/],
    ["something not offered", [["nombre", "Beto"], ["solo", "otro/interno"]], /no ofrece "interno"/],
    ["no scope", [["nombre", "Beto"], ["solo", "hello/nota"], ["alcance", " \r\n"]], /falta el alcance de hello \(Cuenta <i>\): indicá «Alcance».*«Todo»/],
    ["both scopes", [["nombre", "Beto"], ["solo", "hello/nota"], ["alcance", "norte"], ["todo", "1"]], /elegí «Alcance» o «Todo», no los dos/],
    ["a scope nobody declares", [["nombre", "Beto"], ["solo", "otro/nota"], ["alcance", "norte"]], /«Alcance» no corresponde/],
    ["a long scope value", [["nombre", "Beto"], ["solo", "hello/nota"], ["alcance", "a".repeat(101)]], /entre 1 y 100/],
  ])("is refused with %s, going back with the reason", async (_what, form, reason) => {
    const p = await panel({ hello: { ...OFFER, scope: SCOPE }, otro: OFFER });
    p.invite({ only: ["otro"] });
    const r = await p.post("/guests", form);
    const text = said(r)!;
    expect(text).toMatch(reason);
    expect(text).not.toContain("--");
    expect(r.headers.get("location")).not.toContain("k=");
    expect(listGuests(p.ctx.store).map((g) => g.name)).toEqual(["Ana"]);
    expect(guestLog(p.ctx)).toHaveLength(1);
    expect(await p.html(r.headers.get("location")!)).toContain(`class="card flash"`);
  });
});

describe("the list in the panel", () => {
  it("shows each guest with their grant, scope and last use", async () => {
    const p = await panel({ hello: { ...OFFER, scope: SCOPE } });
    const { key } = p.invite({ values: ["norte"] });
    expect(await p.html()).toContain("sin uso todavía");
    await p.signIn(key);
    const html = await p.html();
    expect(html).toContain("<h3>Ana</h3>");
    expect(html).toContain("hello: ve novedades · pide corridas de nota · sube archivos a archivo · Cuenta &lt;i&gt;: norte");
    expect(html).toMatch(/Acceso creado [^·]+ · último uso /);
    const { keyHash, sessionHash } = listGuests(p.ctx.store)[0]!;
    for (const secret of [key, keyHash, sessionHash]) expect(html).not.toContain(secret);
  });

  it("marks what the package no longer offers", async () => {
    const p = await panel();
    p.invite();
    p.ctx.config.loadedPackages!.packages[0]!.guests = { tabs: ["novedades"], run: [], upload: [] };
    expect(await p.html()).toContain("pide corridas de nota (ya no se ofrece)");
  });
});

describe("revoking from the panel", () => {
  it("asks to confirm first, and then cuts the access at once", async () => {
    const p = await panel();
    const cookie = await p.signIn(p.invite().key);
    const other = await p.signIn(p.invite({ name: "Beto" }).key);
    const id = listGuests(p.ctx.store).find((g) => g.name === "Ana")!.id;
    const first = await p.post(`/guests/${id}/revoke`, {});
    expect(first.status).toBe(200);
    const page = await first.text();
    expect(page).toContain("¿Revocar el acceso de «Ana»?");
    expect(page).toContain("no se cancela");
    expect(page).toContain(`name="confirm" value="1"`);
    expect((await p.get("/", cookie)).status).toBe(200);
    expect(said(await p.post(`/guests/${id}/revoke`, { confirm: "1" }))).toContain("Acceso de Ana revocado");
    expect((await p.get("/", cookie)).status).toBe(401);
    expect((await p.get("/", other)).status).toBe(200);
    expect((await p.get("/", p.owner)).status).toBe(200);
    const html = await p.html();
    expect(html).not.toContain("<h3>Ana</h3>");
    expect(html).toContain("acceso revocado");
    // A confirmation left open does not reach whoever is invited later with the same name.
    p.invite();
    expect(said(await p.post(`/guests/${id}/revoke`, { confirm: "1" }))).toBe("Ese invitado ya no tiene acceso.");
    expect(listGuests(p.ctx.store).map((g) => g.name)).toEqual(["Ana", "Beto"]);
  });

  it("says so when the guest does not exist", async () => {
    const p = await panel();
    for (const form of [{}, { confirm: "1" }] as Record<string, string>[]) expect(said(await p.post("/guests/deadbeef/revoke", form))).toBe("Ese invitado ya no tiene acceso.");
  });
});

describe("the log in the panel", () => {
  it("is newest first, escaped, and stays after revoking", async () => {
    const p = await panel();
    const cookie = await p.signIn(p.invite({ name: "Ana <b>" }).key);
    await p.get("/packages/hello/novedades", cookie);
    await p.post("/packages/run", { station: "hello/nota", pedido: "una <i>nota</i>" }, { cookie, origin: p.base });
    await p.get("/egress?clave=valorprivado", cookie);
    revokeGuest(p.ctx, "Ana <b>");
    const html = await p.html();
    const rows = [...html.matchAll(/<tr><td>(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>/g)].map((m) => [m[2], m[3]]);
    expect(rows.map(([who]) => who)).toEqual(Array(6).fill("Ana &lt;b&gt;"));
    expect(rows.map(([, what]) => what)).toEqual([
      "acceso revocado",
      "acceso denegado · /egress",
      "pidió una corrida de hello/nota · «una &lt;i&gt;nota&lt;/i&gt;»",
      "abrió hello/novedades",
      "entró al panel",
      "acceso creado · hello: ve novedades · pide corridas de nota · sube archivos a archivo",
    ]);
    expect(html).not.toContain("valorprivado");
  });

  it("is shown by pages that reach every event", async () => {
    const p = await panel();
    p.invite();
    const guest = listGuests(p.ctx.store)[0]!;
    for (let i = 0; i < 250; i++) recordGuestEvent(p.ctx.store, guest, { kind: "view", target: `hello/pestaña-${i}.` });
    const first = await p.html();
    expect(first.match(/abrió hello/g)).toHaveLength(200);
    expect(first).toContain("pestaña-249.");
    const next = /<a href="(\/guests\?antes=\d+)">Ver anteriores<\/a>/.exec(first)![1]!;
    const second = await p.html(next);
    expect(second.match(/abrió hello/g)).toHaveLength(50);
    expect(second).toContain("acceso creado");
    expect(second).not.toContain("Ver anteriores");
    expect(await p.html("/guests?antes=cualquiera")).toContain("pestaña-249.");
  });
});

describe("guest access in the panel's code", () => {
  it("names no package", () => {
    for (const file of ["guest-admin", "guest-pages", "guest-actions", "guests"]) expect(readFileSync(join(import.meta.dirname, "..", "src", "panel", `${file}.ts`), "utf8")).not.toMatch(/plus|community|\bcm\b|marca\b/i);
  });
});
