import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guestLog, inviteGuest, requestWork, revokeGuest, setRemoteMcp, type GuestInvitation } from "../src/app.js";
import { askOwner } from "../src/line/finish.js";
import { log } from "../src/log.js";
import { factoryConfig, packageDataDir } from "../src/packages.js";
import { listGuests } from "../src/panel/guests.js";
import { panelKey, rotatePanelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { REMOTE_URL_KEY } from "../src/panel/tunnel.js";
import { Store } from "../src/state/store.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
const stores: Store[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  for (const s of stores.splice(0)) s.close();
  cleanup();
});

const TAB = "/packages/hello/novedades";
const SCOPE = { name: "cuenta", title: "Cuenta" };
const OFFER = { tabs: ["novedades"], run: ["nota"], upload: ["archivo"] };

const items = [
  { title: "Del norte", category: "frio", scope: "norte", file: "out/norte.zip" },
  { title: "Del sur", category: "calor", scope: "sur", file: "out/sur.zip" },
  { title: "De nadie", category: "suelto", file: "out/nadie.zip" },
];

/** A panel of a factory with a line and a package that offers `guests`, with data in its tabs. */
async function panel(guests: Record<string, unknown> = OFFER) {
  const dir = tempDir("zero-pkg-");
  const manifest = {
    interface: 1,
    name: "hello",
    version: "1.0.0",
    tabs: [
      { name: "novedades", title: "Novedades <b>", data: "items.json", categories: ["frio", "calor", "suelto"] },
      { name: "interno", title: "Pestaña interna", data: "interno.json" },
    ],
    stations: [
      { name: "nota", module: "stations/nota.mjs", onDemand: true },
      { name: "archivo", module: "stations/nota.mjs", onDemand: true, uploads: {} },
    ],
    guests,
  };
  writeTree(dir, { "zero-package.yaml": stringify(manifest), "stations/nota.mjs": "export async function pass() {}\n" });
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], packages: [{ path: dir, allowCode: true }] });
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  const data = packageDataDir(ctx.home, "hello");
  mkdirSync(join(data, "out"), { recursive: true });
  writeFileSync(join(data, "items.json"), JSON.stringify({ items }));
  writeFileSync(join(data, "interno.json"), JSON.stringify({ items: [{ title: "Reservado", file: "out/reservado.zip" }] }));
  for (const name of ["norte", "sur", "nadie", "reservado"]) writeFileSync(join(data, "out", `${name}.zip`), `bytes de ${name}`);
  let clock = 0;
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets), now: () => clock });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, cookie: string) => fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  const invite = (input: Partial<GuestInvitation> = {}) => {
    const r = inviteGuest(ctx, { name: "Ana", only: ["hello"], ...input });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  /** Invites and signs in; the cookie is the one the browser would send back. */
  const guest = async (input: Partial<GuestInvitation> = {}) => {
    const { key } = invite(input);
    const r = await post("/login", { k: key });
    expect(r.status).toBe(303);
    return { key, cookie: r.headers.get("set-cookie")!.split(";")[0]! };
  };
  return { ctx, base, owner, get, post, invite, guest, tick: (ms: number) => (clock += ms) };
}

const menuOf = (html: string) => /<nav class="side"[\s\S]*?<\/nav>/.exec(html)![0];

describe("a guest's sign-in", () => {
  it("through the tunnel gives a Secure, HttpOnly, SameSite=Strict cookie that opens their home", async () => {
    const p = await panel();
    const { key } = p.invite();
    const r = await p.post("/login", { k: key }, { "x-forwarded-proto": "https" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
    expect(r.headers.get("set-cookie")).toMatch(/^zero_panel=g\.[0-9a-f]{8}\.[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
    const home = await p.get("/", r.headers.get("set-cookie")!.split(";")[0]!);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Hola, Ana");
    expect((await p.post("/login", { k: key })).headers.get("set-cookie")).not.toContain("Secure");
  });

  it("is refused with a key that is nobody's", async () => {
    const p = await panel();
    p.invite();
    const r = await p.post("/login", { k: "otra" });
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
    for (const cookie of ["zero_panel=", "zero_panel=g..", `zero_panel=g.deadbeef.${"a".repeat(64)}`]) expect((await p.get("/", cookie)).status).toBe(401);
  });

  it("replaces the browser's session, whoever signs in", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const r = await p.post("/login", { k: panelKey(p.ctx.secrets) }, { cookie });
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie")!.split(";")[0]).toBe(p.owner);
    const back = await p.post("/login", { k: p.invite({ name: "Beto" }).key }, { cookie: p.owner });
    expect(back.headers.get("set-cookie")).toMatch(/^zero_panel=g\./);
  });

  it("is independent of the owner's key", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    rotatePanelKey(p.ctx.secrets);
    p.tick(11_000);
    expect((await p.get(TAB, cookie)).status).toBe(200);
    expect((await p.get("/", p.owner)).status).toBe(401);
  });

  it("leaves the key and the session's token out of the state and the log", async () => {
    const p = await panel();
    const { key, cookie } = await p.guest();
    const token = cookie.split(".").pop()!;
    for (const secret of [key, token]) await p.get(`/no-esta/${secret}`, cookie);
    const state = JSON.stringify([p.ctx.store.kvWithPrefix(""), guestLog(p.ctx)]);
    expect(state).toContain("/no-esta/");
    expect(state).not.toContain(key);
    expect(state).not.toContain(token);
  });

  it("ends with the sign-out", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const r = await p.post("/logout", {}, { cookie, origin: p.base });
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie")).toMatch(/^zero_panel=;.*Max-Age=0/);
  });
});

describe("a guest's session is denied by default", () => {
  it("no page of the owner exists", async () => {
    const p = await panel();
    const job = requestWork(p.ctx, { text: "Arreglar la vidriera" }).job;
    const { cookie } = await p.guest();
    const missing = await (await p.get("/no-existe-ninguna", cookie)).text();
    expect(missing).toContain("Esa página no existe.");
    for (const secret of ["tienda", "vidriera", job.id, "Pestaña interna", "Reservado", "1.0.0", `href="/line"`, `href="/packages"`, "Resumen", "Propuestas"]) expect(missing).not.toContain(secret);
    const paths = ["/line", "/line?fragment=1", "/line/events", "/requests", `/job/${job.id}`, "/egress", "/proposals", "/research", "/control-room", "/control-room?fragment=1", "/control-room/events", "/monitor", "/report", "/report/export?line=tienda&format=md", "/briefing", "/about", "/agents", "/packages", "/remote-chat", "/guests"];
    const more = ["/login", "/logout", "/request", "/packages/hello/interno", "/packages/hello/interno/files/out/reservado.zip", "/packages/hello", "/packages/otro/novedades", "/packages/HELLO/novedades", `${TAB}/x`, `${TAB}/`, "//line"];
    for (const path of [...paths, ...more]) {
      const r = await p.get(path, cookie);
      expect([path, r.status, r.headers.get("content-type")]).toEqual([path, 404, "text/html; charset=utf-8"]);
      expect(await r.text()).toBe(missing);
    }
  });

  it("covers every section of the owner's menu", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const hrefs = [...menuOf(await (await p.get("/", p.owner)).text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]!).filter((h) => h !== "/" && h !== TAB);
    expect(hrefs).toContain("/egress");
    for (const href of hrefs) expect([href, (await p.get(href, cookie)).status]).toEqual([href, 404]);
  });

  it("no other method answers, even on their own pages", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    for (const method of ["HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"]) for (const path of ["/", TAB]) expect((await fetch(p.base + path, { method, headers: { cookie } })).status).toBe(404);
  });

  it("an address that does not parse is no page", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const status = await new Promise((done, fail) => request(p.base, { path: "//", headers: { cookie } }, (r) => (r.resume(), done(r.statusCode))).on("error", fail).end());
    expect(status).toBe(404);
  });

  it("no action of the owner runs", async () => {
    const p = await panel();
    const { id } = requestWork(p.ctx, { text: "Arreglar la vidriera" }).job;
    askOwner(p.ctx, p.ctx.store.getJob(id)!, { kind: "before-integrate", text: "¿Lo integro?" });
    const { cookie } = await p.guest();
    const missing = await (await p.get("/no-existe-ninguna", cookie)).text();
    const state = () => JSON.stringify([p.ctx.store.kvWithPrefix("").filter(([k]) => !k.startsWith("panel-guest:")), p.ctx.store.listJobs(), p.ctx.store.listProposals(), listGuests(p.ctx.store).map((g) => g.name), readFileSync(p.ctx.home.config, "utf8")]);
    const before = state();
    const confirm = { confirm: "1" };
    const posts: [string, Record<string, string>][] = [
      ["/request", { text: "algo" }],
      ["/requests", { type: "bug", title: "t", description: "d" }],
      [`/requests/${id}/answer`, { decision: "approve" }],
      [`/requests/${id}/stop`, confirm],
      ["/andon", { state: "on" }],
      ["/unjam", {}],
      ["/research", { topic: "un tema" }],
      [`/job/${id}/merge`, confirm],
      [`/job/${id}/answer`, { decision: "approve" }],
      [`/job/${id}/stop`, {}],
      [`/job/${id}/discard`, { motivo: "x" }],
      ["/proposals/deadbeef/approve", confirm],
      ["/proposals/deadbeef/reject", {}],
      ["/research/deadbeef/request", confirm],
      ["/egress/rule", { site: "example.com", action: "allow" }],
      ["/egress/mode", { mode: "blocklist" }],
      ["/agents/catalog/add", { id: "x", line: "tienda", ...confirm }],
      ["/agents/catalog/reject", { id: "x" }],
      ["/remote-chat/pending/deadbeef/confirm", confirm],
      ["/remote-chat/clients/00000000-0000-0000-0000-000000000000/revoke", confirm],
      ["/guests", { name: "Otra", solo: "hello" }],
      ["/guests/deadbeef/revoke", confirm],
      ["/", {}],
      [TAB, {}],
    ];
    for (const [path, form] of posts) {
      const r = await p.post(path, form, { cookie, origin: p.base });
      expect([path, r.status]).toEqual([path, 404]);
      expect(await r.text()).toBe(missing);
    }
    expect(state()).toBe(before);
    const denied = guestLog(p.ctx)!.filter((e) => e.kind === "denied").map((e) => e.target);
    expect(denied.reverse()).toEqual(["/no-existe-ninguna", ...posts.map(([path]) => path)]);
  });

  it("an action that comes from another site is refused", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    for (const path of ["/logout", "/packages/run", "/andon"]) {
      const r = await p.post(path, {}, { cookie, origin: "https://evil.example" });
      expect(r.status).toBe(403);
      expect(r.headers.get("set-cookie")).toBeNull();
      expect(await r.text()).not.toContain("<nav");
    }
  });

  it("is not signed in for the remote chat's approval", async () => {
    const p = await panel();
    setRemoteMcp(p.ctx, true);
    p.ctx.store.setKv(REMOTE_URL_KEY, "https://ab-cd.trycloudflare.com");
    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const registered = await fetch(`${p.base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }) });
    const { client_id } = (await registered.json()) as { client_id: string };
    const params = { client_id, redirect_uri: redirect, response_type: "code", code_challenge: createHash("sha256").update("v".repeat(50)).digest("base64url"), code_challenge_method: "S256", scope: "zero:read", state: "s" };
    const address = `/oauth/authorize?${new URLSearchParams(params)}`;
    expect((await p.get(address, p.owner)).status).toBe(200);
    const { cookie } = await p.guest();
    const shown = await p.get(address, cookie);
    expect(shown.status).toBe(401);
    expect(await shown.text()).toContain("Panel de tu fábrica");
    expect((await p.post("/oauth/authorize", { ...params, confirm: "1" }, { cookie, origin: p.base })).status).toBe(401);
    expect(p.ctx.store.kvWithPrefix("oauth-code:")).toEqual([]);
    expect(guestLog(p.ctx)![0]).toMatchObject({ kind: "denied", target: "/oauth/authorize" });
  });
});

describe("a guest's pages", () => {
  it("have only the granted tabs and a sign-out form in their menu", async () => {
    const p = await panel({ ...OFFER, tabs: ["novedades", "interno"] });
    const { cookie } = await p.guest({ only: ["hello/novedades"] });
    for (const path of ["/", TAB, "/nada"]) {
      const html = await (await p.get(path, cookie)).text();
      const nav = menuOf(html);
      const links = nav.slice(nav.indexOf(`<ul class="links">`));
      expect([...links.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([TAB]);
      expect(links).toContain(`<span class="lb">Novedades &lt;b&gt;</span>`);
      expect(links).toContain(`<form method="post" action="/logout">`);
      expect(links.includes(`aria-current="page"`)).toBe(path === TAB);
      const elsewhere = [...html.matchAll(/(?:href|action)="(\/[^"]*)"/g)].map((m) => m[1]!).filter((h) => h !== "/" && h !== "/logout" && !h.startsWith(TAB));
      expect(elsewhere).toEqual([]);
      for (const secret of ["/interno", "Pestaña interna", "tienda", "zero:tabs", "Resumen"]) expect(html).not.toContain(secret);
      expect(html).toContain(`name="viewport"`);
    }
  });

  it("escape the guest's name and scope", async () => {
    const p = await panel({ ...OFFER, scope: { name: "cuenta", title: "Cuenta <i>" } });
    const { cookie } = await p.guest({ name: "Ana <script>", values: ["<u>norte"] });
    const html = await (await p.get("/", cookie)).text();
    expect(html).toContain("Hola, Ana &lt;script&gt;");
    expect(html).toContain("Cuenta &lt;i&gt;: &lt;u&gt;norte");
  });

  it("say nothing of an internal error, which goes to the daemon's log", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    p.ctx.now = () => {
      throw new Error("detalle interno");
    };
    for (const r of [await p.get(`${TAB}?categoria=x`, cookie), await p.post("/logout", {}, { cookie, origin: p.base })]) {
      expect(r.status).toBe(500);
      const html = await r.text();
      expect(html).toContain("Algo falló");
      expect(html).not.toContain("detalle interno");
      expect(html).not.toContain("<nav");
    }
    expect(warn).toHaveBeenCalledWith("panel error", { path: TAB, error: "detalle interno" });
  });

  it("nor does an error before signing in show the panel", async () => {
    const p = await panel();
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const r = await p.get("/", "x=%E0%A4%A");
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("<nav");
  });
});

describe("the data a guest sees", () => {
  const scoped = { ...OFFER, scope: SCOPE };

  it("is only their scope's, categories included", async () => {
    const p = await panel(scoped);
    const { cookie } = await p.guest({ values: ["norte"] });
    for (const path of [TAB, `${TAB}?categoria=frio`]) {
      const html = await (await p.get(path, cookie)).text();
      expect(html).toContain("Del norte");
      for (const other of ["Del sur", "De nadie", "calor", "suelto", "sur.zip", "nadie.zip"]) expect(html).not.toContain(other);
    }
    expect(await (await p.get(`${TAB}?categoria=calor`, cookie)).text()).not.toContain("Del sur");
  });

  it("matches the scope exactly", async () => {
    const p = await panel(scoped);
    const { cookie } = await p.guest({ values: ["Norte", "nor", "norte sur"] });
    const html = await (await p.get(TAB, cookie)).text();
    for (const i of items) expect(html).not.toContain(i.title);
  });

  it("includes only the files of their items", async () => {
    const p = await panel(scoped);
    const { cookie } = await p.guest({ values: ["norte"] });
    const own = await p.get(`${TAB}/files/out/norte.zip`, cookie);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toBe(`attachment; filename="norte.zip"`);
    expect(await own.text()).toBe("bytes de norte");
    for (const file of ["out/sur.zip", "out/nadie.zip", "out/reservado.zip", "items.json", "out/%E0%A4%A.zip", "..%2Fitems.json"]) {
      const r = await p.get(`${TAB}/files/${file}`, cookie);
      expect([file, r.status]).toEqual([file, 404]);
      expect(await r.text()).not.toContain("bytes de");
    }
  });

  it.each<[string, Record<string, unknown>, Partial<GuestInvitation>]>([
    ["the guest has every scope", scoped, { all: true }],
    ["the package declares none", OFFER, {}],
  ])("is everything when %s", async (_what, guests, input) => {
    const p = await panel(guests);
    const { cookie } = await p.guest(input);
    const html = await (await p.get(TAB, cookie)).text();
    for (const i of items) expect(html).toContain(i.title);
    expect((await p.get(`${TAB}/files/out/sur.zip`, cookie)).status).toBe(200);
  });

  it("does not change what the owner sees", async () => {
    const p = await panel(scoped);
    await p.guest({ values: ["norte"] });
    const html = await (await p.get(TAB, p.owner)).text();
    for (const i of items) expect(html).toContain(i.title);
    expect((await p.get(`${TAB}/files/out/sur.zip`, p.owner)).status).toBe(200);
  });

  it("never widens, and ends when the offer is withdrawn or its scope changes", async () => {
    const p = await panel(scoped);
    const { cookie } = await p.guest({ values: ["norte"] });
    const pkg = p.ctx.config.loadedPackages!.packages[0]!;
    const offer = pkg.guests!;
    pkg.guests = { ...offer, tabs: ["novedades", "interno"] };
    expect((await p.get("/packages/hello/interno", cookie)).status).toBe(404);
    expect((await p.get(TAB, cookie)).status).toBe(200);
    for (const now of [{ ...offer, tabs: [] }, { ...offer, scope: { name: "marca", title: "Cuenta" } }, { ...offer, scope: undefined }, undefined]) {
      pkg.guests = now;
      expect((await p.get(TAB, cookie)).status).toBe(404);
      expect((await p.get(`${TAB}/files/out/norte.zip`, cookie)).status).toBe(404);
      expect(await (await p.get("/", cookie)).text()).not.toContain(TAB);
    }
    pkg.guests = offer;
    expect((await p.get(TAB, cookie)).status).toBe(200);
    p.ctx.config.loadedPackages!.packages = [];
    expect((await p.get(TAB, cookie)).status).toBe(404);
  });
});

describe("revoking a guest", () => {
  it("cuts the open session at once, from another process, and nobody else's", async () => {
    const p = await panel();
    const ana = await p.guest();
    const beto = await p.guest({ name: "Beto" });
    expect((await p.get(TAB, ana.cookie)).status).toBe(200);
    const other = new Store(p.ctx.home.db);
    stores.push(other);
    expect(revokeGuest({ store: other }, "Ana").ok).toBe(true);
    for (const path of ["/", TAB, "/line"]) {
      const r = await p.get(path, ana.cookie);
      expect(r.status).toBe(401);
      expect(await r.text()).not.toContain("Novedades");
    }
    expect((await p.post("/login", { k: ana.key })).status).toBe(401);
    expect((await p.get(TAB, beto.cookie)).status).toBe(200);
    expect((await p.get("/", p.owner)).status).toBe(200);
    expect(guestLog(p.ctx, "Ana")!.map((e) => e.kind)).toEqual(["revoked", "view", "sign-in", "invited"]);
  });
});

describe("the log of a guest", () => {
  it("has what they did, in order, without the query of what was denied", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    await p.get("/", cookie);
    await p.get(`${TAB}?categoria=frio`, cookie);
    await (await p.get(`${TAB}/files/out/norte.zip`, cookie)).text();
    await p.get("/egress?days=3", cookie);
    expect(guestLog(p.ctx)!.reverse().map((e) => [e.name, e.kind, e.target])).toEqual([
      ["Ana", "invited", expect.any(String)],
      ["Ana", "sign-in", undefined],
      ["Ana", "view", "hello/novedades"],
      ["Ana", "download", "hello/novedades/out/norte.zip"],
      ["Ana", "denied", "/egress"],
    ]);
    expect(listGuests(p.ctx.store)[0]!.lastUsedAt).toBeDefined();
  });

  it("does not make the request fail when it cannot be written", async () => {
    const p = await panel();
    const { cookie, key } = await p.guest();
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    vi.spyOn(p.ctx.store, "addGuestEvent").mockImplementation(() => {
      throw new Error("disco lleno");
    });
    expect((await p.get(TAB, cookie)).status).toBe(200);
    expect((await p.get(`${TAB}/files/out/norte.zip`, cookie)).status).toBe(200);
    expect((await p.get("/egress", cookie)).status).toBe(404);
    expect((await p.post("/login", { k: key })).status).toBe(303);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("does not record what the owner does", async () => {
    const p = await panel();
    await p.get(TAB, p.owner);
    expect(guestLog(p.ctx)).toEqual([]);
  });
});
