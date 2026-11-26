import { existsSync, readdirSync, readFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANDON_KEY, factoryStatus, guestLog, inviteGuest, packageList, requestStationRun, revokeGuest, uploadToStation, type GuestInvitation } from "../src/app.js";
import { formatPackages, formatStatus } from "../src/format.js";
import { onDemandPass, readStationGuest, readStationRun, stationOnDemandGuestKey, stationOnDemandKey, stationOnDemandRequestKey, stationRunKey, stationUploadKey } from "../src/line/packages.js";
import { log } from "../src/log.js";
import { factoryConfig, packageDataDir } from "../src/packages.js";
import { guestUpload } from "../src/panel/guest-actions.js";
import { listGuests } from "../src/panel/guests.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { Store } from "../src/state/store.js";
import { AGENT_SPAN } from "../src/telemetry/metrics.js";
import { cleanup, fakeAgents, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";
import { makeZip } from "./zip.js";

const servers: Server[] = [];
const stores: Store[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  for (const s of stores.splice(0)) s.close();
  cleanup();
});

const SCOPE = { name: "cuenta", title: "Cuenta <i>" };
const OFFER = { scope: SCOPE, tabs: ["novedades"], run: ["nota"], upload: ["archivo"] };
const zip = makeZip([{ name: "a.txt", data: "hola" }]);

/** A panel of a factory with a package whose stations note what their `pass` gets. */
async function panel(guests: Record<string, unknown> = OFFER, opts: { secrets?: string[]; module?: string; limits?: Record<string, number> } = {}) {
  const dir = tempDir("zero-pkg-");
  const marker = join(tempDir("zero-marker-"), "calls.txt");
  const station = (name: string) => ({ name, module: "a.mjs", onDemand: true });
  const manifest = {
    interface: 1,
    name: "hello",
    version: "1.0.0",
    tabs: [{ name: "novedades", title: "Novedades", data: "items.json" }],
    stations: [{ ...station("nota"), secrets: opts.secrets ?? [] }, { ...station("archivo"), uploads: { maxMb: 1 } }, { ...station("privada"), uploads: { maxMb: 5 } }],
    guests,
  };
  writeTree(dir, {
    "zero-package.yaml": stringify(manifest),
    "a.mjs": opts.module ?? `import { appendFileSync } from "node:fs";\nexport async function pass(ctx, arg) { appendFileSync(${JSON.stringify(marker)}, JSON.stringify(arg ?? null) + "\\n"); }\n`,
  });
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], packages: [{ path: dir, allowCode: true }], ...(opts.limits && { limits: opts.limits }) });
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = async (path: string, cookie: string) => (await fetch(base + path, { headers: { cookie }, redirect: "manual" })).text();
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  /** Invites and signs in. */
  const guest = async (input: Partial<GuestInvitation> = {}) => {
    const r = inviteGuest(ctx, { name: "Ana", only: ["hello"], ...(guests.scope && !input.all ? { values: ["norte"] } : {}), ...input });
    if (!r.ok) throw new Error(r.reason);
    const signed = await post("/login", { k: r.key });
    return { id: r.guest.id, key: r.key, cookie: signed.headers.get("set-cookie")!.split(";")[0]! };
  };
  /** What the guest reads at their home after asking for something. */
  const notice = async (r: Response, cookie: string) => {
    expect(r.status).toBe(303);
    const home = await get(r.headers.get("location")!, cookie);
    return /<div class="card flash">([^<]*)<\/div>/.exec(home)?.[1];
  };
  const run = async (cookie: string, form: Record<string, string>) => notice(await post("/packages/run", { station: "hello/nota", ...form }, { cookie, origin: base }), cookie);
  const upload = (cookie: string, fields: Record<string, string> = {}, o: { station?: string; file?: { name: string; data: Buffer } | null } = {}) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const file = o.file === undefined ? { name: "entrega.zip", data: zip } : o.file;
    if (file) body.set("file", new Blob([new Uint8Array(file.data)]), file.name);
    return fetch(`${base}/packages/upload?station=${encodeURIComponent(o.station ?? "hello/archivo")}`, { method: "POST", headers: { cookie, origin: base }, body, redirect: "manual" });
  };
  const stored = (name = "archivo") => {
    const d = join(packageDataDir(ctx.home, "hello"), "uploads", name);
    return existsSync(d) ? readdirSync(d) : [];
  };
  const pending = (name = "nota") => ctx.store.getKv(stationOnDemandKey("hello", name));
  const calls = () => (existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n").map((l) => JSON.parse(l) as unknown) : []);
  const pass = () => onDemandPass(ctx, fakeAgents({}).runner, new Date());
  /** The runs and uploads in the log, oldest first. */
  const asked = () => guestLog(ctx)!.reverse().filter((e) => e.kind === "run" || e.kind === "upload").map((e) => [e.kind, e.target, e.scope, e.text, e.accepted]);
  return { ctx, base, owner, get, post, guest, run, notice, upload, stored, pending, calls, pass, asked };
}

type Panel = Awaited<ReturnType<typeof panel>>;

const CANNOT = "Eso no se puede pedir ahora. Probá de nuevo más tarde.";
const ASKED = "Pedido anotado: corre en cuanto se pueda.";
const UPLOADED = "Archivo recibido: se procesa en cuanto se pueda.";
const CHOOSE = "Elegí para cuál lo pedís.";
const BAD_FILE = "El archivo no se aceptó: revisá que esté, su tipo y su tamaño.";

const onDemandKeys = (p: Panel) => p.ctx.store.kvWithPrefix("").filter(([k]) => k.includes(":on-demand"));

describe("a guest's run", () => {
  it("within their scope reaches pass with who asked, set by zero, and the cleaned text", async () => {
    const p = await panel(OFFER, { secrets: ["CLAVE"] });
    p.ctx.secrets.set("CLAVE", "valor-secreto-1");
    const { id, cookie } = await p.guest();
    expect(await p.run(cookie, { alcance: "norte", pedido: "revisar valor-secreto-1 hoy", guest: "otra persona", name: "otra persona" })).toBe(ASKED);
    expect(readStationGuest(p.ctx, "hello", "nota")).toEqual({ id, name: "Ana", scope: "norte" });
    await p.pass();
    await p.pass();
    const text = (p.calls()[0] as { request: string }).request;
    expect(text).toMatch(/^revisar .+ hoy$/);
    expect(text).not.toContain("valor-secreto-1");
    expect(p.calls()).toEqual([{ onDemand: true, request: text, guest: { name: "Ana", scope: "norte" } }]);
    expect(p.pending()).toBeUndefined();
    expect(p.ctx.store.getKv(stationOnDemandGuestKey("hello", "nota"))).toBeUndefined();
    expect(readStationRun(p.ctx, "hello", "nota")).toMatchObject({ state: "ended", outcome: "done", guest: { id, name: "Ana" } });
    expect(p.asked()).toEqual([["run", "hello/nota", "norte", text, true]]);
  });

  it("takes their only value when the form has none", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    expect(await p.run(cookie, {})).toBe(ASKED);
    await p.pass();
    expect(p.calls()).toEqual([{ onDemand: true, guest: { name: "Ana", scope: "norte" } }]);
  });

  it.each(["sur", "Norte", "norte ", "norte,sur"])("for another value (%j) is refused and logged", async (alcance) => {
    const p = await panel();
    const { cookie } = await p.guest();
    expect(await p.run(cookie, { alcance, pedido: "hola" })).toBe(CANNOT);
    expect(onDemandKeys(p)).toEqual([]);
    expect(p.asked()).toEqual([["run", "hello/nota", alcance.trim(), "hola", false]]);
  });

  it("with several values has to choose one", async () => {
    const p = await panel();
    const { cookie } = await p.guest({ values: ["norte", "sur"] });
    expect(await p.run(cookie, {})).toBe(CHOOSE);
    expect(p.pending()).toBeUndefined();
    expect(p.asked()).toEqual([["run", "hello/nota", undefined, undefined, false]]);
    expect(await p.run(cookie, { alcance: "sur" })).toBe(ASKED);
    await p.pass();
    expect(p.calls()).toEqual([{ onDemand: true, guest: { name: "Ana", scope: "sur" } }]);
  });

  it.each<[string, Record<string, unknown>, Partial<GuestInvitation>]>([
    ["the guest has every scope", OFFER, { all: true }],
    ["the package declares none", { run: ["nota"] }, {}],
  ])("carries no scope when %s, and a made up one is refused", async (_what, guests, input) => {
    const p = await panel(guests);
    const { cookie } = await p.guest(input);
    expect(await p.run(cookie, { alcance: "norte" })).toBe(CANNOT);
    expect(p.pending()).toBeUndefined();
    expect(await p.run(cookie, {})).toBe(ASKED);
    await p.pass();
    expect(p.calls()).toEqual([{ onDemand: true, guest: { name: "Ana" } }]);
  });

  it.each(["hello/privada", "hello/archivo", "hello/nada", "otro/nota", " hello/nota", "", "hello/nota/x"])("of a station not granted for it (%j) is refused", async (station) => {
    const p = await panel();
    const { cookie } = await p.guest();
    expect(await p.run(cookie, { station, pedido: "hola" })).toBe(CANNOT);
    expect(onDemandKeys(p)).toEqual([]);
    expect(guestLog(p.ctx)![0]).toMatchObject({ kind: "run", accepted: false, text: "hola" });
  });

  it("is refused once the offer or the scope of the package changes", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const pkg = p.ctx.config.loadedPackages!.packages[0]!;
    const offer = pkg.guests!;
    for (const now of [{ ...offer, run: [] }, { ...offer, scope: { name: "marca", title: "Marca" } }, { ...offer, scope: undefined }, undefined]) {
      pkg.guests = now;
      expect(await p.run(cookie, {})).toBe(CANNOT);
      expect(p.pending()).toBeUndefined();
      expect(await p.get("/", cookie)).not.toContain(`action="/packages/run"`);
    }
  });

  it("leaves the owner's run exactly as it was, also right after a guest's", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    await p.run(cookie, { pedido: "del invitado" });
    await p.pass();
    await p.post("/packages/run", { station: "hello/nota" }, { cookie: p.owner });
    await p.pass();
    await p.post("/packages/run", { station: "hello/nota", pedido: "propio", alcance: "norte" }, { cookie: p.owner });
    await p.pass();
    expect(p.calls().slice(1)).toEqual([{ onDemand: true }, { onDemand: true, request: "propio" }]);
    expect(readStationRun(p.ctx, "hello", "nota")).not.toHaveProperty("guest");
    expect(p.asked()).toHaveLength(1);
  });

  it("whose record does not read is dropped, not run as the owner's", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    await p.run(cookie, {});
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    p.ctx.store.setKv(stationOnDemandGuestKey("hello", "nota"), "{");
    await p.pass();
    expect(p.calls()).toEqual([]);
    expect(p.pending()).toBeUndefined();
    expect(p.ctx.store.getKv(stationOnDemandGuestKey("hello", "nota"))).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("does not keep the guest's key when they paste it in the text or the file's name", async () => {
    const p = await panel();
    const { key, cookie } = await p.guest();
    expect(await p.run(cookie, { pedido: `mi clave es ${key}` })).toBe(ASKED);
    expect(await p.notice(await p.upload(cookie, {}, { file: { name: `${key}.zip`, data: zip } }), cookie)).toBe(UPLOADED);
    expect(p.ctx.store.getKv(stationOnDemandRequestKey("hello", "nota"))).toContain("mi clave es");
    expect(JSON.stringify([p.ctx.store.kvWithPrefix(""), guestLog(p.ctx), p.stored()])).not.toContain(key);
  });
});

describe("what a guest reads of a refusal", () => {
  it.each<[string, (p: Panel) => unknown]>([
    ["the andon is on", (p) => p.ctx.store.setKv(ANDON_KEY, "on")],
    ["the budget is reached", (p) => p.ctx.tracer.start(AGENT_SPAN, { attrs: { "gen_ai.agent.name": "build", "zero.engine": "claude", "zero.billing": "api" } }).end("ok", { "zero.cost.usd": 5 })],
    ["the station cannot run", (p) => (p.ctx.config.loadedPackages!.stations = [])],
    ["the owner's run is pending", (p) => requestStationRun(p.ctx, "hello/nota", new Date(), "asunto reservado")],
  ])("says nothing of the cause when %s", async (_what, prepare) => {
    const p = await panel(OFFER, { limits: { usdPerDay: 1 } });
    const { cookie } = await p.guest();
    prepare(p);
    const before = p.pending();
    expect(await p.run(cookie, { pedido: "hola" })).toBe(CANNOT);
    expect(p.pending()).toBe(before);
    expect(readStationGuest(p.ctx, "hello", "nota")).toBeUndefined();
    const home = await p.get("/", cookie);
    for (const cause of ["andon", "detenida", "presupuesto", "problemas", "asunto reservado", "Tu último pedido"]) expect(home).not.toContain(cause);
    expect(p.asked()).toEqual([["run", "hello/nota", "norte", "hola", false]]);
  });

  it("nor when a secret is missing, and nothing stays pending", async () => {
    const p = await panel(OFFER, { secrets: ["CLAVE_AUSENTE"] });
    const { cookie } = await p.guest();
    expect(await p.run(cookie, {})).toBe(CANNOT);
    expect(p.pending()).toBeUndefined();
    expect(await p.get("/", cookie)).not.toContain("CLAVE_AUSENTE");
  });

  it("is only a known notice, whatever the address says", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    for (const aviso of ["cut", "toString", "<b>hola", ""]) expect(await p.get(`/?aviso=${encodeURIComponent(aviso)}&msg=hola`, cookie)).not.toContain(`card flash`);
  });
});

describe("a guest's upload", () => {
  it("is stored and asks for the run with who sent it", async () => {
    const p = await panel();
    const { id, cookie } = await p.guest();
    expect(await p.notice(await p.upload(cookie, { alcance: "norte", pedido: "usalo", station: "hello/privada" }), cookie)).toBe(UPLOADED);
    expect(p.stored()).toHaveLength(1);
    expect(p.stored("privada")).toEqual([]);
    expect(JSON.parse(p.ctx.store.getKv(stationUploadKey("hello", "archivo"))!)).toMatchObject({ name: "entrega.zip", sizeBytes: zip.length });
    expect(readStationGuest(p.ctx, "hello", "archivo")).toEqual({ id, name: "Ana", scope: "norte" });
    await p.pass();
    expect(p.calls()).toEqual([{ onDemand: true, request: "usalo", guest: { name: "Ana", scope: "norte" } }]);
    expect(p.asked()).toEqual([["upload", "hello/archivo", "norte", "usalo", true]]);
  });

  it.each<[string, string, Record<string, string>]>([
    ["a station not granted", "hello/privada", {}],
    ["a station granted only for runs", "hello/nota", {}],
    ["no station in the address", "", { station: "hello/archivo" }],
    ["another value", "hello/archivo", { alcance: "sur" }],
  ])("to %s is refused, storing nothing", async (_what, station, fields) => {
    const p = await panel();
    const { cookie } = await p.guest();
    expect(await p.notice(await p.upload(cookie, fields, { station }), cookie)).toBe(CANNOT);
    for (const name of ["archivo", "privada", "nota"]) expect(p.stored(name)).toEqual([]);
    expect(onDemandKeys(p)).toEqual([]);
    expect(guestLog(p.ctx)![0]).toMatchObject({ kind: "upload", accepted: false });
  });

  it("with several values has to choose one", async () => {
    const p = await panel();
    const { cookie } = await p.guest({ values: ["norte", "sur"] });
    expect(await p.notice(await p.upload(cookie), cookie)).toBe(CHOOSE);
    expect(p.stored()).toEqual([]);
    expect(await p.notice(await p.upload(cookie, { alcance: "sur" }), cookie)).toBe(UPLOADED);
  });

  it.each<[string, { name: string; data: Buffer } | null]>([
    ["is missing", null],
    ["has another extension", { name: "a.exe", data: zip }],
    ["is not what its extension says", { name: "a.zip", data: Buffer.from("MZ") }],
    ["is over the station's size by a little", { name: "a.zip", data: Buffer.concat([zip, Buffer.alloc(1_200_000)]) }],
  ])("whose file %s reads a fixed text", async (_what, file) => {
    const p = await panel();
    const { cookie } = await p.guest();
    expect(await p.notice(await p.upload(cookie, {}, { file }), cookie)).toBe(BAD_FILE);
    expect(p.stored()).toEqual([]);
    expect(p.pending("archivo")).toBeUndefined();
    expect(p.asked()).toEqual([["upload", "hello/archivo", "norte", undefined, false]]);
  });

  it("is read only up to its own station's size, not the largest one's", async () => {
    const p = await panel();
    for (const values of [["norte"], ["norte", "sur"]]) {
      const { cookie } = await p.guest({ name: values.join(" "), values });
      const r = await p.upload(cookie, {}, { file: { name: "a.zip", data: Buffer.alloc(3 * 1024 * 1024) } });
      expect(r.status).toBe(413);
      const html = await r.text();
      expect(html).toContain("pasa del máximo");
      expect(html).not.toContain(`href="/packages"`);
    }
    expect(p.stored()).toEqual([]);
    expect(p.asked().map((e) => e[4])).toEqual([false, false]);
  });

  it("from another site is refused", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const headers = { cookie, origin: "https://evil.example" };
    expect((await fetch(`${p.base}/packages/upload?station=hello%2Farchivo`, { method: "POST", headers, body: "x" })).status).toBe(403);
    expect((await p.post("/packages/run", { station: "hello/nota" }, headers)).status).toBe(403);
    expect(p.asked()).toEqual([]);
    expect(onDemandKeys(p)).toEqual([]);
  });
});

describe("a guest revoked while asking", () => {
  /** Sends the start of the body, waits for `meanwhile` and sends the rest. */
  const slowly = (p: Panel, path: string, headers: Record<string, string>, body: Buffer, meanwhile: () => void) =>
    new Promise<{ status: number; text: string }>((done, fail) => {
      const req = request(p.base + path, { method: "POST", headers: { origin: p.base, "content-length": String(body.length), ...headers } }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c)).on("end", () => done({ status: res.statusCode!, text }));
      });
      req.on("error", fail);
      req.write(body.subarray(0, 40));
      setTimeout(() => {
        meanwhile();
        req.end(body.subarray(40));
      }, 150);
    });
  const revoked = (p: Panel) => () => {
    const other = new Store(p.ctx.home.db);
    stores.push(other);
    expect(revokeGuest({ store: other }, "Ana").ok).toBe(true);
  };

  it("keeps no file and asks for no run when the upload was under way", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const body = Buffer.concat([Buffer.from(`--x\r\nContent-Disposition: form-data; name="file"; filename="a.zip"\r\n\r\n`), zip, Buffer.from("\r\n--x--\r\n")]);
    const r = await slowly(p, "/packages/upload?station=hello%2Farchivo", { cookie, "content-type": "multipart/form-data; boundary=x" }, body, revoked(p));
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("Novedades");
    expect(p.stored()).toEqual([]);
    expect(onDemandKeys(p)).toEqual([]);
  });

  it("asks for no run when the form was under way", async () => {
    const p = await panel();
    const { cookie } = await p.guest();
    const body = Buffer.from(new URLSearchParams({ station: "hello/nota", pedido: "x".repeat(100) }).toString());
    const r = await slowly(p, "/packages/run", { cookie, "content-type": "application/x-www-form-urlencoded" }, body, revoked(p));
    expect(r.status).toBe(401);
    expect(onDemandKeys(p)).toEqual([]);
  });

  it("keeps no file when it was being written", async () => {
    const p = await panel();
    await p.guest();
    const sending = guestUpload(p.ctx, listGuests(p.ctx.store)[0]!, { station: "hello/archivo", file: { name: "a.zip", content: zip } });
    revoked(p)();
    expect(await sending).toBe("cut");
    expect(p.stored()).toEqual([]);
    expect(onDemandKeys(p)).toEqual([]);
  });

  it("is checked again right when the request is written", async () => {
    const p = await panel();
    const asker = { id: "deadbeef", name: "Ana" };
    expect(requestStationRun(p.ctx, "hello/nota", new Date(), "x", { ...asker, allowed: () => false })).toMatchObject({ ok: false });
    let left = 1;
    expect(await uploadToStation(p.ctx, "hello/archivo", { name: "a.zip", content: zip, guest: { ...asker, allowed: () => left-- > 0 } })).toMatchObject({ ok: false });
    expect(left).toBe(-1);
    expect(p.stored()).toEqual([]);
    expect(onDemandKeys(p)).toEqual([]);
  });
});

describe("a guest's home", () => {
  it("has only the granted forms, escaped, with the scope to choose when there are several", async () => {
    const p = await panel();
    const one = await p.guest();
    const several = await p.guest({ name: "Beto", values: [`nor"te`, "<u>sur"] });
    const html = await p.get("/", one.cookie);
    expect([...html.matchAll(/action="([^"]+)"/g)].map((m) => m[1])).toEqual(["/logout", "/packages/run", "/packages/upload?station=hello%2Farchivo"]);
    expect(html).toContain(`name="station" value="hello/nota"`);
    expect(html).toContain(`accept=".zip"`);
    expect(html).not.toContain("privada");
    expect(html).not.toContain(`name="alcance"`);
    const choosing = await p.get("/", several.cookie);
    expect(choosing.match(/<select [^>]*name="alcance" required>/g)).toHaveLength(2);
    expect(choosing).toContain(`<option value="nor&quot;te">`);
    expect(choosing).toContain("&lt;u&gt;sur");
    expect(choosing).toContain(">Cuenta &lt;i&gt;</label>");
    expect(choosing).not.toContain("<u>sur");
  });

  it("has only the part granted", async () => {
    const p = await panel();
    const { cookie } = await p.guest({ only: ["hello/nota"] });
    const html = await p.get("/", cookie);
    expect(html).toContain(`action="/packages/run"`);
    for (const other of ["/packages/upload", "archivo", "novedades"]) expect(html).not.toContain(other);
  });

  it("shows the state of their own runs and nothing of anyone else's", async () => {
    const p = await panel(OFFER, { module: `export async function pass() { throw new Error("se cayó por dentro"); }\n` });
    const ana = await p.guest();
    const beto = await p.guest({ name: "Beto" });
    const state = async (cookie: string) => /Tu último pedido: ([^<]*)/.exec(await p.get("/", cookie))?.[1];
    const othersSeeNothing = async () => {
      const html = await p.get("/", beto.cookie);
      for (const secret of ["Tu último pedido", "asunto de Ana", "se cayó", "Ana"]) expect(html).not.toContain(secret);
    };
    expect(await state(ana.cookie)).toBeUndefined();
    await p.run(ana.cookie, { pedido: "asunto de Ana" });
    expect(await state(ana.cookie)).toBe("en espera");
    expect(await p.run(beto.cookie, {})).toBe(CANNOT);
    await othersSeeNothing();
    await p.pass();
    expect(await state(ana.cookie)).toBe("falló");
    expect(await p.get("/", ana.cookie)).not.toContain("se cayó");
    await othersSeeNothing();
    const record = { requestedAt: new Date().toISOString(), request: "asunto de Ana", guest: { id: ana.id, name: "Ana" } };
    for (const [over, text] of [[{ state: "running" }, "en curso"], [{ state: "ended", outcome: "done" }, "terminó"], [{ state: "ended", outcome: "timeout", error: "se cayó" }, "falló"]] as const) {
      p.ctx.store.setKv(stationRunKey("hello", "nota"), JSON.stringify({ ...record, ...over }));
      expect(await state(ana.cookie)).toBe(text);
      await othersSeeNothing();
    }
    requestStationRun(p.ctx, "hello/nota", new Date(), "otro asunto");
    expect(await state(ana.cookie)).toBe("falló");
    await p.pass();
    expect(await state(ana.cookie)).toBeUndefined();
  });
});

describe("the owner sees which guest asked", () => {
  it("of a pending run and of a recorded one, escaped, in the packages page and the status", async () => {
    const p = await panel();
    const { cookie } = await p.guest({ name: "Ana <script>" });
    await p.run(cookie, {});
    const texts = async () => [formatStatus(await factoryStatus(p.ctx)), formatPackages(packageList(p.ctx))];
    expect(await p.get("/packages", p.owner)).toMatch(/pendiente desde [^<]*, la pidió Ana &lt;script&gt; \(invitado\)/);
    for (const text of await texts()) expect(text).toMatch(/desde [^·\n]*, la pidió Ana <script> \(invitado\)/);
    await p.pass();
    const html = await p.get("/packages", p.owner);
    expect(html).toMatch(/Última corrida a demanda: terminó bien[^<]*la pidió Ana &lt;script&gt; \(invitado\)/);
    expect(html).not.toContain("Ana <script>");
    for (const text of await texts()) expect(text).toMatch(/terminó bien[^\n]*la pidió Ana <script> \(invitado\)/);
  });

  it("and nothing of it for their own runs", async () => {
    const p = await panel();
    requestStationRun(p.ctx, "hello/nota");
    expect((await factoryStatus(p.ctx)).onDemand).toEqual([{ station: "hello/nota", since: p.pending() }]);
    await p.pass();
    expect(await p.get("/packages", p.owner)).not.toContain("invitado)");
  });
});
