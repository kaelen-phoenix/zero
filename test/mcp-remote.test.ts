import { createHash } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { ANDON_KEY, confirmRemoteAction, pendingRemoteActions, remoteChatClients, requestWork, revokeRemoteChatClient, setRemoteMcp } from "../src/app.js";
import { askOwner } from "../src/line/finish.js";
import { ACCESS_TTL_MS, REMOTE_MCP_KEY } from "../src/mcp/oauth.js";
import { createZeroMcpServer, READ_TOOLS } from "../src/mcp/server.js";
import { panelKey, sessionFor } from "../src/panel/key.js";
import { createPanelServer } from "../src/panel/server.js";
import { REMOTE_URL_KEY } from "../src/panel/tunnel.js";
import { cleanup, gitRepo, testFactory } from "./helpers.js";

const TUNNEL = "https://ab-cd.trycloudflare.com";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER = "remote-chat-verifier-".repeat(3);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const servers: Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => (s.closeAllConnections(), s.close(r)))));
  cleanup();
});

async function panel(opts: { on?: boolean; tunnel?: boolean } = {}) {
  let at = new Date("2026-11-14T12:00:00Z").getTime();
  const ctx = testFactory({ level: "L2", isolation: "worktree", lines: [{ name: "tienda", repo: gitRepo() }] }, () => new Date(at));
  if (opts.on ?? true) setRemoteMcp(ctx, true);
  if (opts.tunnel ?? true) ctx.store.setKv(REMOTE_URL_KEY, TUNNEL);
  const server = createPanelServer(ctx, { key: () => panelKey(ctx.secrets) });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const cookie = `zero_panel=${sessionFor(panelKey(ctx.secrets))}`;
  const fetchAt = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: "manual", ...init });
  const form = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetchAt(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(body).toString() });
  return { ctx, base, port, cookie, fetchAt, form, tick: (ms: number) => (at += ms), now: () => new Date(at) };
}
type Panel = Awaited<ReturnType<typeof panel>>;

async function register(p: Panel, redirect = REDIRECT) {
  return p.fetchAt("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [redirect] }) });
}

const authParams = (client: string, scope: string) => ({
  client_id: client,
  redirect_uri: REDIRECT,
  response_type: "code",
  code_challenge: CHALLENGE,
  code_challenge_method: "S256",
  scope,
  state: "st-1",
});

/** Registers a client and walks the owner's approval and the code exchange. */
async function connect(p: Panel, scope = "zero:read zero:act") {
  const client = ((await (await register(p)).json()) as { client_id: string }).client_id;
  const approved = await p.form("/oauth/authorize", { ...authParams(client, scope), confirm: "1" }, { cookie: p.cookie, origin: p.base });
  expect(approved.status).toBe(302);
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  const tokens = (await (await p.form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: VERIFIER, client_id: client, redirect_uri: REDIRECT })).json()) as {
    access_token: string;
    refresh_token: string;
  };
  return { client, code, access: tokens.access_token, refresh: tokens.refresh_token };
}

async function mcpClient(p: Panel, token: string) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${p.base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return client;
}

const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("remote chat switch", () => {
  it("answers 404 on every remote route while off", async () => {
    const p = await panel({ on: false });
    expect((await p.fetchAt("/mcp", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await p.fetchAt("/.well-known/oauth-authorization-server")).status).toBe(404);
    expect((await p.fetchAt("/oauth/authorize", { headers: { cookie: p.cookie } })).status).toBe(404);
  });

  it("serves the protected resource metadata once on", async () => {
    const p = await panel();
    const r = await p.fetchAt("/.well-known/oauth-protected-resource");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe(`${TUNNEL}/mcp`);
    expect(body.authorization_servers).toEqual([TUNNEL]);
  });

  it("answers 503 without the tunnel's address", async () => {
    const p = await panel({ tunnel: false });
    const r = await p.fetchAt("/.well-known/oauth-authorization-server");
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("túnel");
    expect((await p.fetchAt("/mcp", { method: "POST", body: "{}" })).status).toBe(503);
    expect((await p.fetchAt("/oauth/register", { method: "POST", body: "{}" })).status).toBe(503);
  });

  it("offers no chat tool that turns it on", async () => {
    const p = await panel({ on: false });
    const server = createZeroMcpServer(p.ctx.home, { autoStart: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(a);
    clients.push(client);
    const { tools } = await client.listTools();
    for (const t of tools) {
      if (t.name === "zero_stop" || t.name === "zero_package_run") continue;
      await client.callTool({ name: t.name, arguments: t.name === "zero_request" ? { text: "algo" } : {} }).catch(() => undefined);
    }
    expect(p.ctx.store.getKv(REMOTE_MCP_KEY)).toBeUndefined();
    expect(tools.some((t) => /remote|remoto/i.test(t.name))).toBe(false);
  });
});

describe("remote chat OAuth", () => {
  it("publishes authorization server metadata with S256, public clients and both scopes", async () => {
    const p = await panel();
    const m = (await (await p.fetchAt("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(m.issuer).toBe(TUNNEL);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]));
    expect(m.token_endpoint_auth_methods_supported).toContain("none");
    expect(m.scopes_supported).toEqual(["zero:read", "zero:act"]);
    expect(m.registration_endpoint).toBe(`${TUNNEL}/oauth/register`);
  });

  it("registers a public client and refuses an insecure redirect", async () => {
    const p = await panel();
    const ok = await register(p);
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.client_id).toBeTruthy();
    expect(body).not.toHaveProperty("client_secret");
    const bad = await register(p, "http://evil.example/cb");
    expect(bad.status).toBe(400);
    expect(p.ctx.store.kvWithPrefix("oauth-client:")).toHaveLength(1);
  });

  it("asks for the panel's session and returns to the same URL after signing in", async () => {
    const p = await panel();
    const client = ((await (await register(p)).json()) as { client_id: string }).client_id;
    const query = new URLSearchParams(authParams(client, "zero:read")).toString();
    const r = await p.fetchAt(`/oauth/authorize?${query}`);
    expect(r.status).toBe(401);
    const html = await r.text();
    expect(html).toContain("Panel de tu fábrica");
    expect(html).toContain(`name="back" value="/oauth/authorize?${query.replaceAll("&", "&amp;")}"`);
    const login = await p.form("/login", { k: panelKey(p.ctx.secrets), back: `/oauth/authorize?${query}` });
    expect(login.status).toBe(303);
    expect(login.headers.get("location")).toBe(`/oauth/authorize?${query}`);
    // Never to another site.
    expect((await p.form("/login", { k: panelKey(p.ctx.secrets), back: "//evil.example/x" })).headers.get("location")).toBe("/");
  });

  it("shows the client, its redirect and scopes, and issues a code only on confirm", async () => {
    const p = await panel();
    const client = ((await (await register(p)).json()) as { client_id: string }).client_id;
    const page = await p.fetchAt(`/oauth/authorize?${new URLSearchParams(authParams(client, "zero:read zero:act"))}`, { headers: { cookie: p.cookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("form-action 'self' https://chatgpt.com");
    const html = await page.text();
    expect(html).toContain("ChatGPT");
    expect(html).toContain(REDIRECT);
    expect(html).toContain("actuar");
    expect(p.ctx.store.kvWithPrefix("oauth-code:")).toHaveLength(0);
    const unconfirmed = await p.form("/oauth/authorize", authParams(client, "zero:read"), { cookie: p.cookie, origin: p.base });
    expect(unconfirmed.status).toBe(200);
    expect(p.ctx.store.kvWithPrefix("oauth-code:")).toHaveLength(0);
    const foreign = await p.form("/oauth/authorize", { ...authParams(client, "zero:read"), confirm: "1" }, { cookie: p.cookie, origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const approved = await p.form("/oauth/authorize", { ...authParams(client, "zero:read"), confirm: "1" }, { cookie: p.cookie, origin: p.base });
    expect(approved.status).toBe(302);
    const to = new URL(approved.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe(REDIRECT);
    expect(to.searchParams.get("code")).toBeTruthy();
    expect(to.searchParams.get("state")).toBe("st-1");
  });

  it("refuses without PKCE, with plain or an unregistered redirect, and never redirects", async () => {
    const p = await panel();
    const client = ((await (await register(p)).json()) as { client_id: string }).client_id;
    const { code_challenge: _c, ...noPkce } = authParams(client, "zero:read");
    for (const params of [noPkce, { ...authParams(client, "zero:read"), code_challenge_method: "plain" }, { ...authParams(client, "zero:read"), redirect_uri: "https://other.example/cb" }]) {
      const r = await p.fetchAt(`/oauth/authorize?${new URLSearchParams(params)}`, { headers: { cookie: p.cookie } });
      expect(r.status).toBe(400);
      expect(r.headers.get("location")).toBeNull();
    }
  });

  it("refuses another verifier and revokes the tokens of a reused code", async () => {
    const p = await panel();
    const client = ((await (await register(p)).json()) as { client_id: string }).client_id;
    const approve = async () =>
      new URL((await p.form("/oauth/authorize", { ...authParams(client, "zero:read"), confirm: "1" }, { cookie: p.cookie, origin: p.base })).headers.get("location")!).searchParams.get("code")!;
    const exchange = (code: string, verifier = VERIFIER) => p.form("/oauth/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: client, redirect_uri: REDIRECT });
    const wrong = await exchange(await approve(), "x".repeat(50));
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");

    const code = await approve();
    const first = await exchange(code);
    expect(first.status).toBe(200);
    const { access_token, expires_in } = (await first.json()) as { access_token: string; expires_in: number };
    expect(expires_in).toBeLessThanOrEqual(3600);
    expect((await p.fetchAt("/mcp", { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status).toBe(200);
    const again = await exchange(code);
    expect(again.status).toBe(400);
    const after = await p.fetchAt("/mcp", { method: "POST", headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" }, body: "{}" });
    expect(after.status).toBe(401);
  });

  it("rotates refresh tokens and keeps only hashes", async () => {
    const p = await panel();
    const c = await connect(p);
    const renewed = await p.form("/oauth/token", { grant_type: "refresh_token", refresh_token: c.refresh, client_id: c.client });
    expect(renewed.status).toBe(200);
    const next = (await renewed.json()) as { access_token: string; refresh_token: string };
    const reused = await p.form("/oauth/token", { grant_type: "refresh_token", refresh_token: c.refresh, client_id: c.client });
    expect(((await reused.json()) as { error: string }).error).toBe("invalid_grant");
    const stored = p.ctx.store.kvWithPrefix("oauth-").flatMap(([k, v]) => [k, v]).join("\n");
    for (const secret of [c.code, c.access, c.refresh, next.access_token, next.refresh_token]) expect(stored).not.toContain(secret);
  });
});

describe("remote chat MCP", () => {
  it("answers 401 with the resource metadata without a token", async () => {
    const p = await panel();
    const r = await p.fetchAt("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${TUNNEL}/.well-known/oauth-protected-resource"`);
  });

  it("refuses an expired access token", async () => {
    const p = await panel();
    const c = await connect(p);
    p.tick(ACCESS_TTL_MS + 1000);
    const r = await p.fetchAt("/mcp", { method: "POST", headers: { authorization: `Bearer ${c.access}`, "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    const challenge = r.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain("resource_metadata=");
  });

  it("shows only the read tools to a zero:read token", async () => {
    const p = await panel();
    const c = await connect(p, "zero:read");
    const names = (await (await mcpClient(p, c.access)).listTools()).tools.map((t) => t.name);
    expect(names).toContain("zero_status");
    expect(names).not.toContain("zero_request");
    expect(names).not.toContain("zero_merge");
    expect(names).not.toContain("zero_stop");
    expect(new Set(names)).toEqual(READ_TOOLS);
  });

  it("queues a request with zero:act, as stdio does", async () => {
    const p = await panel();
    const c = await connect(p);
    const r = await (await mcpClient(p, c.access)).callTool({ name: "zero_request", arguments: { text: "agregar un botón de compra" } });
    expect(textOf(r)).toContain("Pedido");
    const jobs = p.ctx.store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("queued");
  });

  it("refuses a foreign Host and runs no tool", async () => {
    const p = await panel();
    const c = await connect(p);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "zero_request", arguments: { text: "no" } } });
    const status = await new Promise<number>((done, fail) => {
      const req = httpRequest(
        { host: "127.0.0.1", port: p.port, path: "/mcp", method: "POST", headers: { host: "evil.example", authorization: `Bearer ${c.access}`, "content-type": "application/json", accept: "application/json, text/event-stream" } },
        (res) => (res.resume(), done(res.statusCode ?? 0)),
      );
      req.on("error", fail);
      req.end(body);
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
    expect(p.ctx.store.listJobs()).toHaveLength(0);
  });

  it("lists connected clients and revokes them at once", async () => {
    const p = await panel();
    const c = await connect(p, "zero:read");
    const listed = remoteChatClients(p.ctx, p.now());
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: c.client, name: "ChatGPT", scope: ["zero:read"] });
    expect(listed[0]!.approvedAt).toBeTruthy();
    expect(revokeRemoteChatClient(p.ctx, c.client)).toBe(true);
    expect((await p.fetchAt("/mcp", { method: "POST", headers: { authorization: `Bearer ${c.access}`, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    const refreshed = await p.form("/oauth/token", { grant_type: "refresh_token", refresh_token: c.refresh, client_id: c.client });
    expect(((await refreshed.json()) as { error: string }).error).toBe("invalid_grant");
  });
});

describe("delicate actions from the remote chat", () => {
  it("holds a stop until the person in charge confirms it, once", async () => {
    const p = await panel();
    const c = await connect(p);
    const answer = textOf(await (await mcpClient(p, c.access)).callTool({ name: "zero_stop", arguments: {} }));
    expect(p.ctx.store.getKv(ANDON_KEY)).toBeUndefined();
    const [held] = pendingRemoteActions(p.ctx);
    expect(held).toMatchObject({ tool: "zero_stop", client: c.client, clientName: "ChatGPT" });
    expect(answer).toContain(held!.id);
    expect(answer).toContain(`zero mcp confirmar ${held!.id}`);
    expect(p.ctx.store.getKv(`mcp-pending:${held!.id}`)).toBeTruthy();

    const done = await confirmRemoteAction(p.ctx, held!.id);
    expect(done.ok).toBe(true);
    expect(p.ctx.store.getKv(ANDON_KEY)).toBe("on");
    const twice = await confirmRemoteAction(p.ctx, held!.id);
    expect(twice.ok).toBe(false);
    expect(twice.text).toContain("No hay ninguna acción pendiente");
  });

  it("does not run an expired action", async () => {
    const p = await panel();
    const c = await connect(p);
    await (await mcpClient(p, c.access)).callTool({ name: "zero_stop", arguments: {} });
    const [held] = pendingRemoteActions(p.ctx);
    const r = await confirmRemoteAction(p.ctx, held!.id, { now: new Date(Date.parse(held!.createdAt) + 16 * 60_000) });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("venció");
    expect(p.ctx.store.getKv(ANDON_KEY)).toBeUndefined();
  });

  it("holds merge, proposal decisions, egress blocks and protected-path approvals", async () => {
    const p = await panel();
    const c = await connect(p);
    const job = requestWork(p.ctx, { text: "tocar archivos protegidos" }).job;
    askOwner(p.ctx, job, { kind: "protected-path", text: "¿Apruebo los cambios en archivos protegidos?" });
    const other = requestWork(p.ctx, { text: "otra cosa" }).job;
    askOwner(p.ctx, other, { kind: "before-integrate", text: "¿Lo integro?" });
    const client = await mcpClient(p, c.access);
    await client.callTool({ name: "zero_merge", arguments: { target: job.id } });
    await client.callTool({ name: "zero_proposal_decide", arguments: { id: "deadbeef", decision: "approve" } });
    await client.callTool({ name: "zero_egress_block", arguments: { site: "example.com" } });
    await client.callTool({ name: "zero_answer", arguments: { job: job.id, decision: "approve" } });
    expect(pendingRemoteActions(p.ctx).map((a) => a.tool).sort()).toEqual(["zero_answer", "zero_egress_block", "zero_merge", "zero_proposal_decide"]);
    expect(p.ctx.store.getJob(job.id)!.status).toBe("waiting");
    // An ordinary answer is not delicate.
    await client.callTool({ name: "zero_answer", arguments: { job: other.id, decision: "approve" } });
    expect(p.ctx.store.getJob(other.id)!.status).not.toBe("waiting");
    expect(pendingRemoteActions(p.ctx)).toHaveLength(4);
  });

  it("leaves stdio as it was: zero_stop stops at once", async () => {
    const p = await panel();
    const server = createZeroMcpServer(p.ctx.home, { autoStart: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(a);
    clients.push(client);
    await client.callTool({ name: "zero_stop", arguments: {} });
    expect(p.ctx.store.getKv(ANDON_KEY)).toBe("on");
    expect(pendingRemoteActions(p.ctx)).toEqual([]);
  });
});
