import { mkdirSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { factoryStatus, requestUpdate, UPDATE_RUN_SHOWN_MS, type FactoryContext } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { createZeroMcpServer, type ZeroMcpOptions } from "../src/mcp/server.js";
import { overviewPage } from "../src/panel/html.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { resultPath } from "../src/self-update-switch.js";
import { importSwitchResult, readSelfUpdate, readUpdateRequest, recordSelfUpdate, SELF_UPDATE_LOOK_KEY, selfUpdateCheck, UPDATE_REQUEST_KEY, UPDATE_RUN_KEY, type SelfUpdateLook, type UpdateRunRecord } from "../src/self-update.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";
import { configure, installation } from "./installation.js";

const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const AT = new Date("2026-11-11T10:00:00.000Z");
const ASKED = AT.toISOString();
const [A, B] = ["a".repeat(40), "b".repeat(40)];
const SHORT = (commit: string) => commit.slice(0, 12);

const factory = (selfUpdate?: Record<string, unknown>) => testFactory({ isolation: "worktree", ...(selfUpdate && { selfUpdate }), lines: [{ name: "tienda", repo: gitRepo() }] }, () => AT);
const status = (ctx: FactoryContext) => formatStatus(factoryStatus(ctx), AT);
const summary = (ctx: FactoryContext) => overviewPage(factoryStatus(ctx), ["tienda"], "n");
/** What status and the panel's summary show: the same lines are in both. */
const both = (ctx: FactoryContext) => [status(ctx), summary(ctx)];
const look = (ctx: FactoryContext, over: Partial<SelfUpdateLook> = {}) => ctx.store.setKv(SELF_UPDATE_LOOK_KEY, JSON.stringify({ channel: "estable", checkedAt: ASKED, head: A, version: "1.0.0", ...over } satisfies SelfUpdateLook));
const run = (ctx: FactoryContext, over: Partial<UpdateRunRecord>) => ctx.store.setKv(UPDATE_RUN_KEY, JSON.stringify({ asked: ASKED, startedAt: ASKED, ...over } satisfies UpdateRunRecord));
const FORM = `action="/update"`;

describe("the channel in status and the panel", () => {
  it("shows the current version, the newer one and the way to update, as the look left them and without git", async () => {
    const z = installation();
    z.release("1.0.0", z.head());
    const to = z.merged("a");
    z.release("1.1.0", to);
    const ctx = z.factory({ channel: "estable" });
    await selfUpdateCheck(ctx, z.deps);
    const calls = z.calls.length;
    for (const text of both(ctx)) {
      expect(text).toContain(`Canal: estable · versión actual: v1.0.0 (${SHORT(z.head())}) · hay una versión nueva: v1.1.0 (${SHORT(to)}); para pasar a ella: zero actualizar`);
      expect(text).not.toContain("Autoactualización");
    }
    expect(z.calls.length).toBe(calls);
  });

  it("says there is no new version when the last look found none", () => {
    const ctx = factory({ channel: "estable" });
    look(ctx);
    for (const text of both(ctx)) {
      expect(text).toContain(`Canal: estable · versión actual: v1.0.0 (${SHORT(A)}) · no hay una versión nueva`);
      expect(text).not.toContain("zero actualizar");
    }
  });

  it("marks an installation that is not a release, only in estable", () => {
    const ctx = factory({ channel: "estable" });
    look(ctx, { version: undefined });
    for (const text of both(ctx)) expect(text).toContain(`versión actual: ${SHORT(A)} (no es una versión liberada)`);
    configure(ctx, { channel: "ultimo" });
    look(ctx, { channel: "ultimo", version: undefined, available: { commit: B } });
    for (const text of both(ctx)) expect(text).toContain(`Canal: ultimo · versión actual: ${SHORT(A)} · hay una versión nueva: ${SHORT(B)}; para pasar`);
  });

  it("says it was not checked yet, also with only the look of another channel", () => {
    const ctx = factory({ channel: "estable" });
    for (const text of both(ctx)) expect(text).toContain("Canal: estable · todavía no se comprobó");
    look(ctx, { channel: "ultimo", available: { commit: B } });
    for (const text of both(ctx)) {
      expect(text).toContain("Canal: estable · todavía no se comprobó");
      expect(text).not.toContain(SHORT(B));
    }
  });

  it("does not offer the version a switch just put in place", async () => {
    const ctx = factory({ channel: "estable" });
    look(ctx, { available: { commit: B, version: "1.1.0" } });
    recordSelfUpdate(ctx.store, { state: { status: "switching", from: A, to: B, channel: "estable", onDemand: true, switchingAt: ASKED } });
    mkdirSync(join(ctx.home.root, "self-update"), { recursive: true });
    writeFileSync(resultPath(ctx.home.root), JSON.stringify({ from: A, to: B, at: ASKED, outcome: "updated" }));
    await importSwitchResult(ctx);
    for (const text of both(ctx)) {
      expect(text).toContain(`versión actual: v1.1.0 (${SHORT(B)}) · no hay una versión nueva`);
      expect(text).toContain(`Autoactualización: de ${SHORT(A)} a ${SHORT(B)}`);
    }
  });

  it("tells the version that is ready by its own line", () => {
    const ctx = factory({ channel: "estable", enabled: true });
    look(ctx, { available: { commit: B, version: "1.1.0" } });
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: A, to: B, channel: "estable" } });
    for (const text of both(ctx)) {
      expect(text).toContain(`Autoactualización: ${SHORT(B)} está lista`);
      expect(text).toContain("v1.1.0");
      expect(text).not.toContain("para pasar a ella");
    }
  });

  it("does not announce a ready version that will be dropped, nor a retry nothing will make", () => {
    const ctx = factory({ channel: "estable", enabled: true });
    const retry = { commit: B, at: "2026-11-11T11:00:00.000Z", tries: 1 };
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: A, to: B, retry } });
    for (const text of both(ctx)) {
      expect(text).not.toContain("está lista");
      expect(text).toContain("vuelve a intentar");
    }
    configure(ctx, { enabled: false });
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: A, to: B, channel: "estable", retry } });
    for (const text of both(ctx)) {
      expect(text).not.toContain("está lista");
      expect(text).not.toContain("vuelve a intentar");
    }
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: A, to: B, channel: "estable", onDemand: true } });
    for (const text of both(ctx)) expect(text).toContain("está lista");
  });

  it("shows nothing without a channel when self-update never ran", () => {
    const ctx = factory();
    look(ctx, { available: { commit: B, version: "1.1.0" } });
    expect(factoryStatus(ctx).selfUpdate).toBeUndefined();
    for (const text of both(ctx)) {
      expect(text).not.toContain("Canal");
      expect(text).not.toContain("Autoactualización");
      expect(text).not.toContain("Actualización a pedido");
    }
  });

  it("adds no line to what automatic updates show without a channel", () => {
    const ctx = factory({ enabled: true });
    recordSelfUpdate(ctx.store, { state: { status: "ready", from: A, to: B }, entry: { from: B, to: A, at: ASKED, outcome: "updated" } });
    for (const text of both(ctx)) {
      expect(text).not.toContain("Canal");
      expect(text).toContain(`Autoactualización: ${SHORT(B)} está lista`);
    }
    expect(factoryStatus(ctx).selfUpdate).toEqual({ ready: { from: A, to: B }, last: { from: B, to: A, at: ASKED, outcome: "updated" }, offer: true });
  });
});

describe("the update asked for in status and the panel", () => {
  it("shows the pending request, also without a channel", () => {
    for (const ctx of [factory({ channel: "estable" }), factory()]) {
      requestUpdate(ctx, AT);
      for (const text of both(ctx)) expect(text).toContain("Actualización a pedido: pendiente desde");
    }
  });

  it("shows the run under way", () => {
    const ctx = factory({ channel: "estable" });
    run(ctx, {});
    for (const text of both(ctx)) expect(text).toMatch(/Última actualización a pedido: pedida [^\n<]*, buscando la versión nueva desde/);
    run(ctx, { target: { commit: B, version: "1.1.0" } });
    for (const text of both(ctx)) expect(text).toMatch(/Última actualización a pedido: pedida [^\n<]*, preparando v1\.1\.0 \(b{12}\) desde/);
  });

  it.each([
    { end: { outcome: "up-to-date" as const }, says: /no había una versión nueva/, bad: false },
    { end: { outcome: "failed" as const, reason: "sin <red>" }, says: /falló \([^)]*\): sin (<red>|&lt;red&gt;)/, bad: true },
    { end: { outcome: "stopped" as const, reason: "se cerró" }, says: /quedó sin terminar \([^)]*\): se cerró/, bad: true },
    { end: { outcome: "ready" as const, target: { commit: B, version: "1.1.0" } }, says: /v1\.1\.0 \(b{12}\) quedó lista/, bad: false },
  ])("shows that the last one ended $end.outcome", ({ end, says, bad }) => {
    const ctx = factory({ channel: "estable" });
    run(ctx, { endedAt: ASKED, ...end });
    for (const text of both(ctx)) expect(text).toMatch(says);
    expect(summary(ctx).includes(`<span class="bad">Última actualización a pedido`)).toBe(bad);
    expect(summary(ctx)).not.toContain("<red>");
  });

  it.each([
    { outcome: "updated" as const, says: "pasó a v1.1.0" },
    { outcome: "rolled-back" as const, says: "no pudo pasar a v1.1.0" },
  ])("says what its switch did ($outcome)", ({ outcome, says }) => {
    const ctx = factory({ channel: "estable" });
    run(ctx, { endedAt: ASKED, outcome: "ready", target: { commit: B, version: "1.1.0" } });
    // One of before the run is not its own.
    recordSelfUpdate(ctx.store, { entry: { from: A, to: B, at: "2026-11-10T10:00:00.000Z", outcome } });
    for (const text of both(ctx)) expect(text).toContain("quedó lista");
    recordSelfUpdate(ctx.store, { entry: { from: A, to: B, at: ASKED, outcome } });
    for (const text of both(ctx)) expect(text).toContain(`, ${says}`);
  });

  it("forgets one that ended long ago", () => {
    const ctx = factory({ channel: "estable" });
    run(ctx, { endedAt: new Date(AT.getTime() - UPDATE_RUN_SHOWN_MS).toISOString(), outcome: "up-to-date" });
    for (const text of both(ctx)) expect(text).not.toContain("actualización a pedido");
    configure(ctx, { channel: undefined });
    expect(factoryStatus(ctx).selfUpdate).toBeUndefined();
  });
});

describe("updating from the panel", () => {
  async function panel(selfUpdate?: Record<string, unknown>) {
    const ctx = factory(selfUpdate);
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
    const post = (headers: Record<string, string> = { cookie, origin: base }) =>
      fetch(`${base}/update`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: "", redirect: "manual" });
    const goesTo = (r: Response) => {
      const url = new URL(r.headers.get("location")!, "http://panel");
      return { path: url.pathname, msg: url.searchParams.get("msg") };
    };
    return { ctx, cookie, post, goesTo };
  }

  it("has the form with a channel or with automatic updates, and not otherwise", () => {
    for (const on of [{ channel: "estable" }, { channel: "ultimo" }, { enabled: true }]) {
      const html = summary(factory(on));
      expect(html).toContain(FORM);
      expect(html).toContain("Actualizar ahora");
    }
    const off = factory();
    expect(summary(off)).not.toContain(FORM);
    // Nor with something on record of when it was on.
    recordSelfUpdate(off.store, { entry: { from: A, to: B, at: ASKED, outcome: "updated" } });
    run(off, { endedAt: ASKED, outcome: "up-to-date" });
    expect(summary(off)).toContain("Autoactualización");
    expect(summary(off)).not.toContain(FORM);
  });

  it("records the request and goes back to the summary with its text", async () => {
    const p = await panel({ channel: "estable" });
    const r = await p.post();
    expect(r.status).toBe(303);
    expect(p.goesTo(r)).toEqual({ path: "/", msg: expect.stringContaining("canal estable") });
    expect(readUpdateRequest(p.ctx.store)).toEqual({ requestedAt: ASKED });
  });

  it("goes back with the reason of a refusal, changing nothing", async () => {
    const p = await panel({ channel: "estable" });
    await p.post();
    expect(p.goesTo(await p.post())).toEqual({ path: "/", msg: expect.stringContaining("ya hay una actualización pendiente") });
    expect(readUpdateRequest(p.ctx.store)).toEqual({ requestedAt: ASKED });
  });

  it("records nothing without a session, or from another site", async () => {
    const p = await panel({ channel: "estable" });
    expect((await p.post({})).status).toBe(401);
    expect((await p.post({ cookie: p.cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await p.post({ cookie: p.cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(p.ctx.store.getKv(UPDATE_REQUEST_KEY)).toBeUndefined();
  });
});

describe("updating from the chat", () => {
  async function chat(ctx: FactoryContext, opts: ZeroMcpOptions = {}) {
    const server = createZeroMcpServer(ctx.home, { autoStart: false, stationWaitMs: 0, ...opts });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    clients.push(client);
    const update = async () => ((await client.callTool({ name: "zero_update", arguments: {} })) as { content: { text: string }[] }).content[0]!.text;
    return { client, update };
  }

  it("takes no arguments", async () => {
    const { client } = await chat(factory());
    const tool = (await client.listTools()).tools.find((t) => t.name === "zero_update")!;
    expect(tool.inputSchema.properties ?? {}).toEqual({});
  });

  it("records the request and says it is still pending", async () => {
    const ctx = factory({ channel: "estable" });
    const start = vi.fn(async () => true);
    const text = await (await chat(ctx, { autoStart: true, start })).update();
    expect(text).toContain("Actualización pedida a la última versión del canal estable");
    expect(text).toContain("La fábrica estaba apagada: la encendí.");
    expect(text).toContain("sigue pendiente");
    expect(readUpdateRequest(ctx.store)).toEqual({ requestedAt: expect.any(String) });
  });

  it("says what was found while it waits", async () => {
    const ctx = factory({ channel: "estable" });
    const start = async (c: FactoryContext) => {
      const { requestedAt } = readUpdateRequest(c.store)!;
      c.store.deleteKv(UPDATE_REQUEST_KEY);
      run(c, { asked: requestedAt, target: { commit: B, version: "1.1.0" } });
      return false;
    };
    expect(await (await chat(ctx, { autoStart: true, start })).update()).toMatch(/Preparando la versión v1\.1\.0 .*cuando no haya trabajos corriendo/);
  });

  it("answers the refusal and changes nothing with one already pending", async () => {
    const ctx = factory();
    requestUpdate(ctx, AT);
    expect(await (await chat(ctx)).update()).toContain("ya hay una actualización pendiente");
    expect(readUpdateRequest(ctx.store)).toEqual({ requestedAt: ASKED });
    expect(readSelfUpdate(ctx.store).history).toEqual([]);
  });
});
