import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus } from "../src/app.js";
import { formatStatus } from "../src/format.js";
import { stationOnDemandKey, stationOnDemandRequestKey, stationRunKey } from "../src/line/packages.js";
import { factoryConfig } from "../src/packages.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { cleanup, gitRepo, tempDir, testFactory, writeTree } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

/** A panel whose factory has a package with an onDemand station `pedible` and a regular station `normal`. */
async function panel() {
  const dir = tempDir("zero-pkg-");
  writeTree(dir, {
    "zero-package.yaml": stringify({ interface: 1, name: "hello", version: "1.0.0", stations: [{ name: "pedible", module: "a.mjs", onDemand: true }, { name: "normal", module: "a.mjs" }] }),
    "a.mjs": "export async function pass() {}\n",
  });
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], packages: [{ path: dir, allowCode: true }] });
  ctx.config = await factoryConfig(ctx.home);
  expect(ctx.config.loadedPackages!.problems).toEqual([]);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string, headers: Record<string, string> = { cookie }) => fetch(base + path, { headers, redirect: "manual" });
  const post = (path: string, form: Record<string, string>, headers: Record<string, string> = { cookie }) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(form).toString(), redirect: "manual" });
  return { ctx, get, post };
}

const message = (r: Response) => new URL(r.headers.get("location")!, "http://panel").searchParams.get("msg") ?? "";

describe("the packages page", () => {
  it("is linked in the side menu", async () => {
    const p = await panel();
    const nav = /<nav class="side"[\s\S]*?<\/nav>/.exec(await (await p.get("/")).text())![0];
    expect(nav).toContain(`href="/packages"`);
  });

  it("shows Pedir ahora only on the onDemand station", async () => {
    const p = await panel();
    const r = await p.get("/packages");
    expect(r.status).toBe(200);
    const html = await r.text();
    const forms = html.match(/<form method="post" action="\/packages\/run">[\s\S]*?<\/form>/g) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain(`value="hello/pedible"`);
    expect(forms[0]).toContain(`name="pedido"`);
    expect(forms[0]).toContain("Pedir ahora");
    expect(html).toContain("normal");
  });

  it("shows the pending request and the last outcome, escaped", async () => {
    const p = await panel();
    p.ctx.store.setKv(stationOnDemandKey("hello", "pedible"), new Date().toISOString());
    p.ctx.store.setKv(stationOnDemandRequestKey("hello", "pedible"), "revisar <precios>");
    p.ctx.store.setKv(stationRunKey("hello", "pedible"), JSON.stringify({ requestedAt: "2026-11-01T10:00:00.000Z", startedAt: "2026-11-01T10:00:01.000Z", state: "ended", outcome: "failed", finishedAt: "2026-11-01T10:00:05.000Z", error: "se cayó" }));
    const html = await (await p.get("/packages")).text();
    expect(html).toContain("revisar &lt;precios&gt;");
    expect(html).not.toContain("<precios>");
    expect(html).toContain("falló");
    expect(html).toContain("se cayó");
  });
});

describe("POST /packages/run", () => {
  it("records the request with its text and goes back to /packages", async () => {
    const p = await panel();
    const r = await p.post("/packages/run", { station: "hello/pedible", pedido: "revisar precios" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")!.startsWith("/packages?")).toBe(true);
    expect(message(r)).toContain("pedida");
    expect(p.ctx.store.getKv(stationOnDemandKey("hello", "pedible"))).toBeDefined();
    expect(p.ctx.store.getKv(stationOnDemandRequestKey("hello", "pedible"))).toBe("revisar precios");
  });

  it("goes back to /packages with the refusal for a station without onDemand", async () => {
    const p = await panel();
    const r = await p.post("/packages/run", { station: "hello/normal", pedido: "algo" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")!.startsWith("/packages?")).toBe(true);
    expect(message(r)).toContain("onDemand");
    expect(p.ctx.store.getKv(stationOnDemandKey("hello", "normal"))).toBeUndefined();
  });

  it("records nothing without a session", async () => {
    const p = await panel();
    const r = await p.post("/packages/run", { station: "hello/pedible", pedido: "algo" }, {});
    expect(r.status).toBe(401);
    expect(r.headers.get("location")).toBeNull();
    expect(p.ctx.store.getKv(stationOnDemandKey("hello", "pedible"))).toBeUndefined();
    expect(p.ctx.store.getKv(stationOnDemandRequestKey("hello", "pedible"))).toBeUndefined();
  });
});

describe("zero status", () => {
  it("shows the pending request text, the running run and the last failure", async () => {
    const p = await panel();
    p.ctx.store.setKv(stationOnDemandKey("hello", "pedible"), new Date().toISOString());
    p.ctx.store.setKv(stationOnDemandRequestKey("hello", "pedible"), "revisar precios");
    let out = formatStatus(factoryStatus(p.ctx));
    expect(out.split("\n").find((l) => l.startsWith("Corridas a demanda pendientes: "))).toContain("hello/pedible");
    expect(out).toContain("revisar precios");

    p.ctx.store.setKv(stationRunKey("hello", "pedible"), JSON.stringify({ requestedAt: "2026-11-01T10:00:00.000Z", startedAt: new Date().toISOString(), state: "running" }));
    out = formatStatus(factoryStatus(p.ctx));
    expect(out.split("\n").find((l) => l.includes("hello/pedible") && l.includes("en curso"))).toBeDefined();

    p.ctx.store.setKv(stationRunKey("hello", "pedible"), JSON.stringify({ requestedAt: "2026-11-01T10:00:00.000Z", state: "ended", outcome: "failed", finishedAt: new Date().toISOString(), error: "se cayó" }));
    const status = factoryStatus(p.ctx);
    expect(status.stationRuns).toMatchObject([{ station: "hello/pedible", outcome: "failed" }]);
    expect(formatStatus(status).split("\n").find((l) => l.includes("hello/pedible") && l.includes("falló"))).toContain("se cayó");
  });

  it("keeps the {station, since} shape without a request text", async () => {
    const p = await panel();
    const since = new Date().toISOString();
    p.ctx.store.setKv(stationOnDemandKey("hello", "pedible"), since);
    expect(factoryStatus(p.ctx).onDemand).toEqual([{ station: "hello/pedible", since }]);
    expect(JSON.stringify(factoryStatus(p.ctx).onDemand)).toBe(JSON.stringify([{ station: "hello/pedible", since }]));
    expect(factoryStatus(p.ctx).stationRuns).toEqual([]);
  });
});
