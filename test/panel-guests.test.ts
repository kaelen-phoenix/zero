import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guestList, guestLog, inviteGuest, LAUNCH_KEY, revokeGuest, type FactoryContext, type GuestInvitation, type GuestInvitationResult } from "../src/app.js";
import { formatGuestLog, formatGuests, formatInvitation } from "../src/format.js";
import { hashSecret } from "../src/mcp/oauth.js";
import { factoryConfig } from "../src/packages.js";
import { findGuestByCookie, findGuestByKey, getGuest, guestAccess, guestCookie, listGuests, recordGuestEvent, touchGuest, type Guest } from "../src/panel/guests.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { REMOTE_KEY, REMOTE_URL_KEY } from "../src/panel/tunnel.js";
import { GUEST_EVENTS_KEPT, Store } from "../src/state/store.js";
import { cleanup, tempDir, testFactory, writeTree } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const MODULE = { "stations/nota.mjs": "export async function pass() {}\n" };
const SCOPE = { name: "cuenta", title: "Cuenta" };
const OFFER = { tabs: ["novedades"], run: ["nota"] };

function packageDir(name: string, guests: unknown): string {
  const dir = tempDir("zero-pkg-");
  const manifest = {
    interface: 1,
    name,
    version: "1.0.0",
    tabs: [
      { name: "novedades", title: "Novedades", data: "items.json" },
      { name: "interno", title: "Interno", data: "interno.json" },
    ],
    stations: [
      { name: "nota", module: "stations/nota.mjs", onDemand: true },
      { name: "archivo", module: "stations/nota.mjs", onDemand: true, uploads: {} },
    ],
    ...(guests !== undefined && { guests }),
  };
  writeTree(dir, { "zero-package.yaml": stringify(manifest), ...MODULE });
  return dir;
}

/** A factory with a package per entry, each with its own `guests`. */
async function factory(packages: Record<string, unknown> = { hello: OFFER }, now?: () => Date): Promise<FactoryContext> {
  const dirs = Object.entries(packages).map(([name, guests]) => ({ path: packageDir(name, guests), allowCode: true }));
  const ctx = testFactory({ packages: dirs }, now);
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  return ctx;
}

type Invited = Extract<GuestInvitationResult, { ok: true }>;

function invite(ctx: FactoryContext, input: Partial<GuestInvitation> = {}): Invited & { record: Guest } {
  const r = inviteGuest(ctx, { name: "Ana", only: ["hello"], ...input });
  if (!r.ok) throw new Error(r.reason);
  return { ...r, record: getGuest(ctx.store, r.guest.id)! };
}

const offer = (ctx: FactoryContext) => ctx.config.loadedPackages!.packages[0]!;

const cli = (ctx: FactoryContext, ...args: string[]) => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "panel", ...args], { encoding: "utf8", env: { ...process.env, ZERO_HOME: ctx.home.root }, input: "", windowsHide: true });
  return { code: r.status, output: r.stdout + r.stderr };
};

describe("inviting a guest", () => {
  it("grants exactly what the package offers, with a key of their own", async () => {
    const ctx = await factory();
    const { record, key, links } = invite(ctx);
    expect(record.grants).toEqual([{ package: "hello", tabs: ["novedades"], run: ["nota"], upload: [] }]);
    expect(links.local).toBe(`http://127.0.0.1:${ctx.config.panel.port}/#k=${key}`);
    expect(links.remote).toBeUndefined();
    expect(key).not.toBe(panelKey(ctx.secrets));
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite(ctx, { name: "Beto" }).key).not.toBe(key);
  });

  it("adds the tunnel's link when it is open", async () => {
    const ctx = await factory();
    ctx.store.setKv(REMOTE_KEY, "on");
    ctx.store.setKv(REMOTE_URL_KEY, "https://algo.trycloudflare.com");
    const { key, links, stable } = invite(ctx);
    expect(links.remote).toBe(`https://algo.trycloudflare.com/#k=${key}`);
    expect(stable).toBe(false);
  });

  it("grants only the named part", async () => {
    const ctx = await factory({ hello: { tabs: ["novedades", "interno"], run: ["archivo"], upload: ["archivo"] } });
    expect(invite(ctx, { only: ["hello/novedades"] }).record.grants).toEqual([{ package: "hello", tabs: ["novedades"], run: [], upload: [] }]);
    expect(invite(ctx, { name: "Beto", only: ["hello/archivo"] }).record.grants).toEqual([{ package: "hello", tabs: [], run: ["archivo"], upload: ["archivo"] }]);
  });

  it("joins the parts of one package and keeps packages apart", async () => {
    const ctx = await factory({ hello: { tabs: ["novedades", "interno"], run: ["nota"] }, otro: { tabs: ["interno"] } });
    expect(invite(ctx, { only: ["hello/interno", "otro", "hello/nota", "hello/interno"] }).record.grants).toEqual([
      { package: "hello", tabs: ["interno"], run: ["nota"], upload: [] },
      { package: "otro", tabs: ["interno"], run: [], upload: [] },
    ]);
  });

  it.each<[string, Partial<GuestInvitation>, RegExp]>([
    ["an empty name", { name: "  " }, /falta el nombre/],
    ["a name of invisible characters", { name: "\u200b\u0007" }, /falta el nombre/],
    ["a long name", { name: "a".repeat(61) }, /60 caracteres/],
    ["no --solo", { only: [] }, /--solo/],
    ["an empty --solo", { only: [" "] }, /--solo/],
    ["an unknown package", { only: ["nadie"] }, /"nadie"/],
    ["a tab that is not offered", { only: ["hello/interno"] }, /no ofrece "interno".*novedades, nota/],
    ["a station that is not offered", { only: ["hello/archivo"] }, /no ofrece "archivo"/],
    ["one valid part and one that is not", { only: ["hello/novedades", "hello/otra"] }, /"otra"/],
    ["an empty part", { only: ["hello/"] }, /no es <paquete>/],
    ["too many parts", { only: ["hello/novedades/x"] }, /no es <paquete>/],
    ["a package without guests", { only: ["cerrado"] }, /cerrado no ofrece nada a invitados/],
    ["a scope value nobody declares", { values: ["norte"] }, /--alcance no corresponde/],
    ["--todo that nobody declares", { all: true }, /--todo no corresponde/],
    ["a scoped package without scope", { only: ["repartido"] }, /Cuenta.*--alcance.*--todo/],
    ["a scoped package with both", { only: ["repartido"], values: ["norte"], all: true }, /no los dos/],
    ["an empty scope value", { only: ["repartido"], values: ["norte", " "] }, /entre 1 y 100/],
    ["a long scope value", { only: ["repartido"], values: ["a".repeat(101)] }, /entre 1 y 100/],
  ])("is refused with %s", async (_what, input, reason) => {
    const ctx = await factory({ hello: OFFER, cerrado: undefined, repartido: { ...OFFER, scope: SCOPE } });
    expect(inviteGuest(ctx, { name: "Ana", only: ["hello"], ...input })).toEqual({ ok: false, reason: expect.stringMatching(reason) });
    expect(listGuests(ctx.store)).toEqual([]);
    expect(guestLog(ctx)).toEqual([]);
  });

  it("is refused when the name belongs to an active guest, however it is written", async () => {
    const ctx = await factory();
    invite(ctx, { name: "Ana  Pérez" });
    for (const name of ["Ana Pérez", " ana pérez "]) expect(inviteGuest(ctx, { name, only: ["hello"] })).toEqual({ ok: false, reason: expect.stringContaining("ya hay un invitado activo") });
    expect(listGuests(ctx.store)).toHaveLength(1);
    revokeGuest(ctx, "Ana Pérez");
    expect(inviteGuest(ctx, { name: "Ana Pérez", only: ["hello"] }).ok).toBe(true);
  });

  it("keeps the scope: its values, or all of them", async () => {
    const ctx = await factory({ hello: { ...OFFER, scope: SCOPE }, libre: OFFER });
    const limited = invite(ctx, { only: ["hello", "libre"], values: [" norte ", "sur", "norte"] }).record;
    expect(limited.grants.map((g) => g.scope)).toEqual([{ name: "cuenta", values: ["norte", "sur"] }, undefined]);
    expect(guestAccess(limited, ctx.config.loadedPackages).map((a) => a.values)).toEqual([["norte", "sur"], undefined]);
    const whole = invite(ctx, { name: "Beto", all: true }).record;
    expect(whole.grants[0]!.scope).toEqual({ name: "cuenta", values: "all" });
    expect(guestAccess(whole, ctx.config.loadedPackages)[0]).not.toHaveProperty("values");
  });
});

describe("what a grant is worth", () => {
  const access = (ctx: FactoryContext, g: Guest) => guestAccess(g, ctx.config.loadedPackages).map((a) => ({ package: a.package, tabs: a.tabs.map((t) => t.name), run: a.run, upload: a.upload }));

  it("does not grow when the package offers more", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    offer(ctx).guests = { tabs: ["novedades", "interno"], run: ["nota", "archivo"], upload: ["archivo"] };
    expect(access(ctx, record)).toEqual([{ package: "hello", tabs: ["novedades"], run: ["nota"], upload: [] }]);
  });

  it("shrinks when the package offers less or goes away", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    offer(ctx).guests = { tabs: [], run: ["nota"], upload: [] };
    expect(access(ctx, record)).toEqual([{ package: "hello", tabs: [], run: ["nota"], upload: [] }]);
    expect(formatGuests(guestList(ctx))).toContain("ve novedades (ya no se ofrece) · pide corridas de nota");
    offer(ctx).guests = { tabs: ["interno"], run: [], upload: [] };
    expect(access(ctx, record)).toEqual([]);
    delete offer(ctx).guests;
    expect(access(ctx, record)).toEqual([]);
    ctx.config.loadedPackages!.packages = [];
    expect(access(ctx, record)).toEqual([]);
    expect(guestAccess(record, undefined)).toEqual([]);
  });

  it("ends when the package adds, renames or removes its scope", async () => {
    const ctx = await factory({ hello: OFFER });
    const free = invite(ctx).record;
    const before = offer(ctx).guests!;
    offer(ctx).guests = { ...before, scope: SCOPE };
    expect(access(ctx, free)).toEqual([]);
    const scoped = invite(ctx, { name: "Beto", values: ["norte"] }).record;
    const whole = invite(ctx, { name: "Caro", all: true }).record;
    expect(access(ctx, scoped)).toHaveLength(1);
    for (const scope of [{ name: "otra", title: "Cuenta" }, undefined]) {
      offer(ctx).guests = { ...before, ...(scope && { scope }) };
      expect(access(ctx, scoped)).toEqual([]);
      expect(access(ctx, whole)).toEqual([]);
    }
  });
});

describe("a guest's key", () => {
  it("is kept only as hashes, of the key and of the session", async () => {
    const ctx = await factory();
    const { record, key } = invite(ctx);
    const token = sessionFor(key);
    recordGuestEvent(ctx.store, record, { kind: "sign-in" });
    touchGuest(ctx.store, record);
    expect(record).toMatchObject({ keyHash: hashSecret(key), sessionHash: hashSecret(token) });
    const kept = JSON.stringify([ctx.store.kvWithPrefix(""), guestLog(ctx), guestList(ctx)]) + formatGuests(guestList(ctx)) + formatGuestLog(guestLog(ctx)!);
    for (const secret of [key, token]) expect(kept).not.toContain(secret);
    expect(JSON.stringify(guestList(ctx))).not.toMatch(/hash/i);
  });

  it("identifies its guest, and so does the cookie made from it", async () => {
    const ctx = await factory();
    const ana = invite(ctx);
    const beto = invite(ctx, { name: "Beto" });
    expect(findGuestByKey(ctx.store, ana.key)?.name).toBe("Ana");
    expect(findGuestByKey(ctx.store, beto.key)?.name).toBe("Beto");
    for (const key of ["", panelKey(ctx.secrets), ana.record.keyHash, ana.key.slice(1)]) expect(findGuestByKey(ctx.store, key)).toBeUndefined();
    const cookie = guestCookie(ana.record, ana.key);
    expect(cookie).not.toContain(ana.key);
    expect(findGuestByCookie(ctx.store, cookie)?.name).toBe("Ana");
    for (const bad of ["", sessionFor(ana.key), guestCookie(beto.record, ana.key), `g.${ana.record.id}.${ana.record.sessionHash}`, `g.${ana.record.id}.${ana.record.keyHash}`, `${cookie}0`]) expect(findGuestByCookie(ctx.store, bad)).toBeUndefined();
  });

  it("gives nothing when the record does not read", async () => {
    const ctx = await factory();
    const { record, key } = invite(ctx);
    const { sessionHash: _drop, ...partial } = record;
    for (const raw of ["no es json", JSON.stringify(partial), JSON.stringify({ ...record, grants: [{ ...record.grants[0], scope: { name: "cuenta", values: [] } }] })]) {
      ctx.store.setKv(`panel-guest:${record.id}`, raw);
      expect(findGuestByKey(ctx.store, key)).toBeUndefined();
      expect(findGuestByCookie(ctx.store, guestCookie(record, key))).toBeUndefined();
      expect(guestList(ctx)).toEqual([]);
    }
  });
});

describe("the last use", () => {
  it("is written at most once a minute and never brings back a revoked guest", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    const used = () => getGuest(ctx.store, record.id)?.lastUsedAt;
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 24, 12, 0, seconds));
    touchGuest(ctx.store, record, at(0));
    touchGuest(ctx.store, record, at(59));
    expect(used()).toBe(at(0).toISOString());
    touchGuest(ctx.store, record, at(60));
    expect(used()).toBe(at(60).toISOString());
    revokeGuest(ctx, "Ana");
    touchGuest(ctx.store, record, at(300));
    expect(ctx.store.kvWithPrefix("panel-guest:")).toEqual([]);
  });

  it("does not fail the request when it cannot be written", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ctx.store, "transaction").mockImplementation(() => {
      throw new Error("disco lleno");
    });
    expect(() => touchGuest(ctx.store, record)).not.toThrow();
    expect(error.mock.calls.join()).toContain("disco lleno");
  });
});

describe("revoking", () => {
  it("cuts the key and the session at once, only theirs, also from another process", async () => {
    const ctx = await factory();
    const ana = invite(ctx);
    const beto = invite(ctx, { name: "Beto" });
    const owner = panelKey(ctx.secrets);
    const other = new Store(ctx.home.db);
    try {
      expect(revokeGuest({ store: other }, " ana ")).toEqual({ ok: true, text: expect.stringContaining("Ana") });
    } finally {
      other.close();
    }
    expect(findGuestByKey(ctx.store, ana.key)).toBeUndefined();
    expect(findGuestByCookie(ctx.store, guestCookie(ana.record, ana.key))).toBeUndefined();
    expect(findGuestByCookie(ctx.store, guestCookie(beto.record, beto.key))?.name).toBe("Beto");
    expect(panelKey(ctx.secrets)).toBe(owner);
    expect(revokeGuest(ctx, "Ana").ok).toBe(false);
  });
});

describe("the guests' log", () => {
  it("keeps what a guest did in order, newest first, and outlives the access", async () => {
    let at = Date.UTC(2026, 10, 24, 12);
    const ctx = await factory(undefined, () => new Date((at += 1000)));
    const { record } = invite(ctx);
    recordGuestEvent(ctx.store, record, { kind: "sign-in" });
    recordGuestEvent(ctx.store, record, { kind: "view", target: "hello/novedades" });
    recordGuestEvent(ctx.store, record, { kind: "download", target: "hello/novedades/a.zip" });
    recordGuestEvent(ctx.store, record, { kind: "run", target: "hello/nota", scope: "norte", text: "una nota", accepted: true });
    recordGuestEvent(ctx.store, record, { kind: "denied", target: "/egress?days=3#x" });
    revokeGuest(ctx, "Ana");
    const events = guestLog(ctx)!;
    expect(events.map((e) => e.kind)).toEqual(["revoked", "denied", "run", "download", "view", "sign-in", "invited"]);
    expect(events.every((e) => e.name === "Ana" && e.guest === record.id)).toBe(true);
    expect(events[1]).toMatchObject({ target: "/egress" });
    expect(events[2]).toMatchObject({ target: "hello/nota", scope: "norte", text: "una nota", accepted: true });
    expect(events[6]).toMatchObject({ target: "hello: ve novedades · pide corridas de nota" });
    expect(events[0]!.at > events[6]!.at).toBe(true);
    expect(guestLog(ctx, "ana")).toEqual(events);
    expect(guestLog(ctx, "Beto")).toBeUndefined();
    expect(formatGuestLog(events).split("\n")[2]).toMatch(/^2026-11-24 \d\d:\d\d:\d\d UTC · Ana · pidió una corrida de hello\/nota · alcance: norte · «una nota»$/);
  });

  it("shows only the asked guest's events", async () => {
    const ctx = await factory();
    invite(ctx);
    invite(ctx, { name: "Beto" });
    expect(guestLog(ctx, "Beto")!.map((e) => e.name)).toEqual(["Beto"]);
    expect(guestLog(ctx)!.map((e) => e.name)).toEqual(["Beto", "Ana"]);
  });

  it("prunes a guest's views and denials past the limit, never invitations, accepted actions or revocations", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    const beto = invite(ctx, { name: "Beto" }).record;
    recordGuestEvent(ctx.store, beto, { kind: "sign-in" });
    for (const kind of ["run", "upload"] as const) for (const accepted of [true, false]) recordGuestEvent(ctx.store, record, { kind, target: "hello/nota", accepted });
    ctx.store.transaction(() => {
      for (let i = 0; i < GUEST_EVENTS_KEPT + 5; i++) recordGuestEvent(ctx.store, record, { kind: (["sign-in", "view", "download", "denied"] as const)[i % 4]!, target: `/t${i}` });
    });
    const events = guestLog(ctx, "Ana")!;
    expect(GUEST_EVENTS_KEPT).toBe(500);
    expect(events.filter((e) => !["invited", "run", "upload"].includes(e.kind)).map((e) => e.target)).toEqual(Array.from({ length: 500 }, (_, i) => `/t${504 - i}`));
    expect(events.filter((e) => ["invited", "run", "upload"].includes(e.kind)).map((e) => [e.kind, e.accepted])).toEqual([["upload", true], ["run", true], ["invited", undefined]]);
    expect(guestLog(ctx, "Beto")!.map((e) => e.kind)).toEqual(["sign-in", "invited"]);
    revokeGuest(ctx, "Ana");
    expect(guestLog(ctx, "Ana")!.map((e) => e.kind)).toContain("invited");
    expect(guestLog(ctx, "Ana")).toHaveLength(504);
  });

  it("never keeps the guest's key or session token, wherever they put it", async () => {
    const ctx = await factory();
    const { record, key } = invite(ctx);
    const token = sessionFor(key);
    recordGuestEvent(ctx.store, record, { kind: "denied", target: `/x${key}y` });
    recordGuestEvent(ctx.store, record, { kind: "run", target: "hello/nota", text: `mi clave es ${key}, y ${token}`, accepted: true });
    const kept = JSON.stringify(guestLog(ctx));
    expect(kept).not.toContain(key);
    expect(kept).not.toContain(token);
    expect(kept).toContain("mi clave es [clave], y [clave]");
    recordGuestEvent(ctx.store, record, { kind: "download", target: "hello/novedades/un-nombre-largo-de-archivo-que-no-es-ninguna-clave.zip" });
    expect(guestLog(ctx)![0]!.target).toBe("hello/novedades/un-nombre-largo-de-archivo-que-no-es-ninguna-clave.zip");
  });

  it("bounds what it keeps and shows it on one clean line", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    recordGuestEvent(ctx.store, record, { kind: "denied", target: `/${"a".repeat(5000)}` });
    expect(guestLog(ctx)![0]!.target).toHaveLength(300);
    recordGuestEvent(ctx.store, record, { kind: "run", target: "hello/nota", text: "una\n\u001b[31mdos", accepted: false });
    expect(formatGuestLog(guestLog(ctx)!).split("\n")).toHaveLength(3);
    expect(formatGuestLog(guestLog(ctx)!)).not.toContain("\u001b");
    expect(formatGuestLog(guestLog(ctx)!)).toContain("no se aceptó");
  });

  it("does not throw when an event cannot be written", async () => {
    const ctx = await factory();
    const { record } = invite(ctx);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(ctx.store, "addGuestEvent").mockImplementation(() => {
      throw new Error("disco lleno");
    });
    expect(() => recordGuestEvent(ctx.store, record, { kind: "view", target: "hello/novedades" })).not.toThrow();
    expect(error.mock.calls.join()).toContain("disco lleno");
    expect(revokeGuest(ctx, "Ana").ok).toBe(true);
    expect(listGuests(ctx.store)).toEqual([]);
  });
});

describe("what the person in charge reads", () => {
  it("lists each guest with what they may do and their last use", async () => {
    const ctx = await factory({ hello: { ...OFFER, scope: SCOPE } });
    expect(formatGuests(guestList(ctx))).toBe("No hay invitados al panel.");
    expect(formatGuestLog(guestLog(ctx)!)).toBe("No hay nada en el registro de invitados.");
    const { record } = invite(ctx, { values: ["norte", "sur"] });
    expect(formatGuests(guestList(ctx))).toContain("Ana · acceso creado hace 0 min · sin uso todavía\n  hello: ve novedades · pide corridas de nota · Cuenta: norte, sur");
    touchGuest(ctx.store, record, new Date(Date.now() - 3 * 60_000));
    expect(formatGuests(guestList(ctx))).toContain("último uso hace 3 min");
  });

  it("tells how to reach the panel and that the link is shown once", async () => {
    const ctx = await factory();
    const r = invite(ctx);
    const off = formatInvitation(r, false);
    expect(off).toContain(r.links.local!);
    expect(off).toContain("zero start --detach");
    expect(off).toContain("zero panel remote on");
    expect(off).toContain("una sola vez");
    expect(off).toContain("túnel temporal cambia");
    expect(formatInvitation(r, true)).not.toContain("zero start");
    const fixed = formatInvitation({ ...r, stable: true, links: { ...r.links, remote: `https://panel.ejemplo.com/#k=${r.key}` } }, true);
    expect(fixed).toContain(`Desde afuera: https://panel.ejemplo.com/#k=${r.key}`);
    expect(fixed).not.toContain("túnel temporal cambia");
    expect(formatInvitation({ ...r, links: { remoteOn: false } }, true)).toContain(r.key);
  });
});

describe("zero panel (CLI)", () => {
  it("invites, lists, shows the log and revokes, without starting the factory", async () => {
    const ctx = await factory({ hello: { ...OFFER, scope: SCOPE } });
    expect(cli(ctx, "invitados")).toEqual({ code: 0, output: expect.stringContaining("No hay invitados al panel.") });

    const missing = cli(ctx, "invitar", "Ana Pérez", "--solo", "hello");
    expect(missing.code).toBe(1);
    expect(missing.output).toMatch(/Cuenta.*--alcance.*--todo/);
    expect(listGuests(ctx.store)).toEqual([]);

    const made = cli(ctx, "invitar", "Ana Pérez", "--solo", "hello/novedades", "--alcance", "norte", "--alcance", "sur");
    expect(made.code).toBe(0);
    expect(made.output).toContain("hello: ve novedades · Cuenta: norte, sur");
    const key = /\/#k=([A-Za-z0-9_-]{43})/.exec(made.output)![1]!;
    expect(findGuestByKey(ctx.store, key)?.grants).toEqual([{ package: "hello", tabs: ["novedades"], run: [], upload: [], scope: { name: "cuenta", values: ["norte", "sur"] } }]);
    expect(ctx.store.getKv(LAUNCH_KEY)).toBeUndefined();

    const list = cli(ctx, "invitados");
    expect(list.output).toContain("Ana Pérez · acceso creado");
    expect(list.output).not.toContain(key);

    const gone = cli(ctx, "revocar", "ana pérez");
    expect(gone).toEqual({ code: 0, output: expect.stringContaining("Acceso de Ana Pérez revocado") });
    expect(findGuestByKey(ctx.store, key)).toBeUndefined();

    const again = cli(ctx, "revocar", "Ana Pérez");
    expect(again.code).toBe(1);
    expect(again.output).toContain("No hay ningún invitado activo");

    const log = cli(ctx, "registro", "Ana Pérez");
    expect(log.code).toBe(0);
    expect(log.output).toMatch(/acceso revocado[\s\S]*acceso creado · hello: ve novedades/);
    expect(log.output).not.toContain(key);
    expect(cli(ctx, "registro").output).toContain("acceso revocado");
    expect(cli(ctx, "registro", "Nadie").code).toBe(1);
  }, 120_000);

  it("refuses with code 1 and the reason, creating nothing", async () => {
    const ctx = await factory();
    for (const [args, reason] of [
      [["invitar", "Ana"], "--solo"],
      [["invitar", "Ana", "--solo", "hello", "--todo"], "--todo no corresponde"],
      [["invitar", "Ana", "--solo", "hello/novedades", "hello/nota"], "Sobran palabras"],
      [["revocar"], "Indicá el invitado"],
    ] as const) {
      const r = cli(ctx, ...args);
      expect(r.code).toBe(1);
      expect(r.output).toContain(reason);
    }
    expect(listGuests(ctx.store)).toEqual([]);
  }, 120_000);

  it("is in the help", () => {
    const usage = readFileSync(join(import.meta.dirname, "..", "src", "cli.ts"), "utf8");
    for (const line of ["zero panel invitar <nombre> --solo <paquete | paquete/nombre>... [--alcance <valor>]... [--todo]", "zero panel invitados", "zero panel revocar <nombre>", "zero panel registro [<nombre>]"]) expect(usage).toContain(`\n  ${line}`);
  });
});

describe("guest access in the code", () => {
  const src = (path: string) => readFileSync(join(import.meta.dirname, "..", "src", path), "utf8");

  it("has no chat tool", () => {
    expect(src("mcp/server.ts")).not.toMatch(/inviteGuest|revokeGuest|guestList|guestLog/);
    expect([...src("mcp/server.ts").matchAll(/"(zero_[a-z_]+)"/g)].map((m) => m[1]).filter((t) => /guest|invit|revoc/.test(t!))).toEqual([]);
  });

  it("names no package", () => {
    expect(src("panel/guests.ts")).not.toMatch(/plus|community|\bcm\b|marca/i);
  });
});
