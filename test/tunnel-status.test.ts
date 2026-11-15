import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { factoryStatus, remoteChatView, setRemoteMcp, setRemotePanel } from "../src/app.js";
import { formatRemoteChat, formatStatus } from "../src/format.js";
import { panelKey } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { REMOTE_URL_KEY, TUNNEL_STATE_KEY, type TunnelState } from "../src/panel/tunnel.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

const STABLE = "https://zero.example.com";
const QUICK = "https://ab-cd.trycloudflare.com";

function factory(hostname?: string) {
  const at = new Date("2026-11-15T12:00:00Z");
  return testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }], ...(hostname && { panel: { tunnel: { hostname } } }) }, () => at);
}

const setState = (ctx: ReturnType<typeof factory>, state: TunnelState) => ctx.store.setKv(TUNNEL_STATE_KEY, JSON.stringify(state));

describe("remote chat view stability", () => {
  it("is stable when the open address is the configured hostname", () => {
    const ctx = factory("zero.example.com");
    setRemoteMcp(ctx, true);
    ctx.store.setKv(REMOTE_URL_KEY, STABLE);
    const view = remoteChatView(ctx);
    expect(view.stable).toBe(true);
    expect(view.url).toBe(`${STABLE}/mcp`);
    expect(formatRemoteChat(view)).toContain("dirección fija");
  });

  it("is not stable on a quick tunnel address, configured hostname or not", () => {
    for (const hostname of ["zero.example.com", undefined]) {
      const ctx = factory(hostname);
      setRemoteMcp(ctx, true);
      ctx.store.setKv(REMOTE_URL_KEY, QUICK);
      const view = remoteChatView(ctx);
      expect(view.stable).toBe(false);
      expect(formatRemoteChat(view)).toContain("cambia si el túnel se reinicia");
    }
  });

  it("serves the stable address as the OAuth issuer", async () => {
    const ctx = factory("zero.example.com");
    setRemoteMcp(ctx, true);
    ctx.store.setKv(REMOTE_URL_KEY, STABLE);
    const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const m = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(m.issuer).toBe(STABLE);
    expect(remoteChatView(ctx).url).toBe("https://zero.example.com/mcp");
  });
});

describe("tunnel status", () => {
  it("is absent while the remote panel is off, so no Túnel: line shows", () => {
    const ctx = factory("zero.example.com");
    setState(ctx, { mode: "named", failures: 0, connectedSince: "2026-11-15T11:00:00.000Z" });
    const s = factoryStatus(ctx);
    expect(s.tunnel).toBeUndefined();
    expect(formatStatus(s)).not.toMatch(/^Túnel:/m);
  });

  it("shows a named, connected tunnel with its hostname", () => {
    const ctx = factory("zero.example.com");
    setRemotePanel(ctx, true);
    setState(ctx, { mode: "named", failures: 0, connectedSince: "2026-11-15T11:00:00.000Z" });
    const s = factoryStatus(ctx);
    expect(s.tunnel).toMatchObject({ mode: "named", failures: 0, hostname: "zero.example.com", connectedSince: "2026-11-15T11:00:00.000Z" });
    const line = formatStatus(s, new Date("2026-11-15T12:00:00Z")).split("\n").find((l) => l.startsWith("Túnel:"));
    expect(line).toContain("fijo (zero.example.com)");
    expect(line).toContain("conectado desde");
  });

  it("shows a quick, disconnected tunnel with its failures and problem", () => {
    const ctx = factory("zero.example.com");
    setRemotePanel(ctx, true);
    setState(ctx, { mode: "quick", failures: 2, lastExitAt: "2026-11-15T11:59:00.000Z", problem: "falta el secreto CLOUDFLARE_TUNNEL_TOKEN" });
    const line = formatStatus(factoryStatus(ctx)).split("\n").find((l) => l.startsWith("Túnel:"));
    expect(line).toContain("temporal");
    expect(line).toContain("desconectado");
    expect(line).toContain("2");
    expect(line).toContain("CLOUDFLARE_TUNNEL_TOKEN");
  });

  it("reads a remote panel the daemon has not opened yet as a disconnected quick tunnel", () => {
    const ctx = factory();
    setRemotePanel(ctx, true);
    expect(factoryStatus(ctx).tunnel).toEqual({ mode: "quick", failures: 0 });
  });
});

describe("docs/adr/0008-tunel-con-nombre.md", () => {
  const dir = fileURLToPath(new URL("../docs/adr/", import.meta.url));
  const path = fileURLToPath(new URL("../docs/adr/0008-tunel-con-nombre.md", import.meta.url));

  it("covers the manual steps, deployment, recovery and security", () => {
    expect(existsSync(path)).toBe(true);
    const file = readFileSync(path, "utf8");
    expect(file.split(/\r?\n/)[0]).toMatch(/^# ADR 0008/);
    for (const piece of ["CLOUDFLARE_TUNNEL_TOKEN", "panel.tunnel", "/mcp", "Acción manual de quien está a cargo", "Despliegue", "Recuperación", "Seguridad", "no verificado", "zero secret set CLOUDFLARE_TUNNEL_TOKEN", "http://127.0.0.1:<puerto>", "OAuth", "TLS", "Host"]) expect(file).toContain(piece);
  });

  it("is the only ADR numbered 0008", () => {
    expect(readdirSync(dir).filter((name) => name.startsWith("0008-"))).toEqual(["0008-tunel-con-nombre.md"]);
  });
});
