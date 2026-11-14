import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, holdRemoteAction, PENDING_TTL_MS, pendingRemoteActions, remoteChatView, setRemoteMcp } from "../src/app.js";
import { formatPendingActions, formatRemoteChat } from "../src/format.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { REMOTE_URL_KEY } from "../src/panel/tunnel.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const TUNNEL = "https://ab-cd.trycloudflare.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "remote-chat-panel-verifier-".repeat(3);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel() {
  let at = new Date("2026-11-14T12:00:00Z").getTime();
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }] }, () => new Date(at));
  setRemoteMcp(ctx, true);
  ctx.store.setKv(REMOTE_URL_KEY, TUNNEL);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const get = (path: string) => fetch(base + path, { redirect: "manual", headers: { cookie } });
  const form = (path: string, body: Record<string, string>, headers: Record<string, string> = { cookie, origin: base }) =>
    fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body).toString() });
  return { ctx, base, cookie, get, form, now: () => new Date(at), tick: (ms: number) => (at += ms) };
}
type Panel = Awaited<ReturnType<typeof panel>>;

/** Registers a chat, approves it with the panel's session and exchanges the code. */
async function connect(p: Panel, scope = "zero:read zero:act") {
  const registered = await fetch(`${p.base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }) });
  const client = ((await registered.json()) as { client_id: string }).client_id;
  const params = { client_id: client, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", scope, state: "s" };
  const approved = await p.form("/oauth/authorize", { ...params, confirm: "1" });
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  const tokens = (await (await p.form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: client, redirect_uri: REDIRECT }, {})).json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { client, access: tokens.access_token, refresh: tokens.refresh_token };
}

const callMcp = (p: Panel, token: string) =>
  fetch(`${p.base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

describe("the panel's remote chat page", () => {
  it("is in the menu and lists the connected clients with their permissions and approval date", async () => {
    const p = await panel();
    const c = await connect(p, "zero:read");
    const html = await (await p.get("/remote-chat")).text();
    expect(html).toContain(`href="/remote-chat"`);
    expect(html).toContain(`${TUNNEL}/mcp`);
    expect(html).toContain("Claude");
    expect(html).toContain(c.client);
    expect(html).toContain("solo leer");
    expect(html).toContain("2026-11-14 12:00");
    expect(html).toContain(`/remote-chat/clients/${c.client}/revoke`);
  });

  it("asks for the session", async () => {
    const p = await panel();
    expect((await fetch(`${p.base}/remote-chat`)).status).toBe(401);
  });

  it("says when it is off or the tunnel is closed", async () => {
    const p = await panel();
    p.ctx.store.deleteKv(REMOTE_URL_KEY);
    expect(await (await p.get("/remote-chat")).text()).toContain("el túnel no está abierto");
    setRemoteMcp(p.ctx, false);
    expect(await (await p.get("/remote-chat")).text()).toContain("zero mcp remote on");
  });

  it("revokes a client only after confirm=1, and its tokens stop working at once", async () => {
    const p = await panel();
    const c = await connect(p);
    expect((await callMcp(p, c.access)).status).toBe(200);

    const asked = await p.form(`/remote-chat/clients/${c.client}/revoke`, {});
    expect(asked.status).toBe(200);
    expect(await asked.text()).toContain(`name="confirm" value="1"`);
    expect(remoteChatView(p.ctx, p.now()).clients).toHaveLength(1);

    const done = await p.form(`/remote-chat/clients/${c.client}/revoke`, { confirm: "1" });
    expect(done.status).toBe(303);
    expect(decodeURIComponent(done.headers.get("location")!)).toContain("Chat revocado");
    expect(remoteChatView(p.ctx, p.now()).clients).toEqual([]);
    expect((await callMcp(p, c.access)).status).toBe(401);
    const refreshed = await p.form("/oauth/token", { grant_type: "refresh_token", refresh_token: c.refresh, client_id: c.client }, {});
    expect(refreshed.status).toBe(400);
    expect(((await refreshed.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("refuses a revocation from another site", async () => {
    const p = await panel();
    const c = await connect(p);
    const r = await p.form(`/remote-chat/clients/${c.client}/revoke`, { confirm: "1" }, { cookie: p.cookie, origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(remoteChatView(p.ctx, p.now()).clients).toHaveLength(1);
  });

  it("lists held actions and runs one once with Confirmar", async () => {
    const p = await panel();
    const held = holdRemoteAction(p.ctx, { tool: "zero_stop", args: {} }, undefined, p.now());
    const html = await (await p.get("/remote-chat")).text();
    expect(html).toContain("detener toda la fábrica");
    expect(html).toContain(`/remote-chat/pending/${held.id}/confirm`);
    expect(html).toContain("Confirmar");

    expect((await p.form(`/remote-chat/pending/${held.id}/confirm`, {})).status).toBe(303);
    expect(p.ctx.store.getKv(ANDON_KEY)).toBeUndefined();

    const done = await p.form(`/remote-chat/pending/${held.id}/confirm`, { confirm: "1" });
    expect(done.status).toBe(303);
    expect(p.ctx.store.getKv(ANDON_KEY)).toBe("on");
    const again = await p.form(`/remote-chat/pending/${held.id}/confirm`, { confirm: "1" });
    expect(decodeURIComponent(again.headers.get("location")!)).toContain("No hay ninguna acción pendiente");
  });

  it("does not run an expired action", async () => {
    const p = await panel();
    const held = holdRemoteAction(p.ctx, { tool: "zero_stop", args: {} }, undefined, p.now());
    p.tick(PENDING_TTL_MS + 1000);
    await p.form(`/remote-chat/pending/${held.id}/confirm`, { confirm: "1" });
    expect(p.ctx.store.getKv(ANDON_KEY)).toBeUndefined();
  });
});

describe("zero mcp in the terminal", () => {
  it("tells the switch, the address and each client", async () => {
    const p = await panel();
    await connect(p);
    const text = formatRemoteChat(remoteChatView(p.ctx, p.now()), p.now());
    expect(text).toContain(`Chat remoto encendido: conectá tu chat a ${TUNNEL}/mcp`);
    expect(text).toMatch(/· Claude · leer y actuar · aprobado hace 0 min · /);
    expect(text).toContain("zero mcp revoke");
    setRemoteMcp(p.ctx, false);
    expect(formatRemoteChat(remoteChatView(p.ctx, p.now()), p.now())).toContain("Chat remoto apagado");
  });

  it("lists held actions with the command that confirms them", async () => {
    const p = await panel();
    expect(formatPendingActions(pendingRemoteActions(p.ctx, p.now()))).toContain("No hay acciones");
    const held = holdRemoteAction(p.ctx, { tool: "zero_merge", args: { target: "abc12345" } }, undefined, p.now());
    const text = formatPendingActions(pendingRemoteActions(p.ctx, p.now()));
    expect(text).toContain(`${held.id} · fundir el pull request de abc12345`);
    expect(text).toContain("zero mcp confirmar <id>");
  });

  it("documents and dispatches every subcommand", () => {
    const cli = readFileSync("src/cli.ts", "utf8");
    for (const line of ["zero mcp remote on|off", "zero mcp clients", "zero mcp revoke <cliente>", "zero mcp pendientes", "zero mcp confirmar <id>"]) expect(cli).toContain(`  ${line}`);
    for (const action of ["remote", "clients", "revoke", "pendientes", "confirmar"]) expect(cli).toContain(`action === "${action}"`);
    expect(cli).toContain("setRemoteMcp(ctx, arg === \"on\")");
    expect(cli).toContain("confirmRemoteAction(ctx, arg)");
  });
});
