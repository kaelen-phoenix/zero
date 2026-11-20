import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { remoteMcpOn, type FactoryContext, type MergeApiFactory } from "../app.js";
import { log } from "../log.js";
import { authorizePage, loginPage } from "../panel/html.js";
import { REMOTE_URL_KEY } from "../panel/tunnel.js";
import { checkAuthorize, clientInfo, exchangeCode, isOAuthError, issueCode, refreshTokens, registerClient, revokeToken, SCOPES, verifyAccess, type OAuthError } from "./oauth.js";
import { createZeroMcpServer } from "./server.js";

/**
 * The remote chat over HTTP, served by the daemon's panel server and reached through its tunnel: OAuth metadata,
 * dynamic registration, the owner's approval in the panel, the token endpoint and MCP streamable HTTP (stateless)
 * with the same tools as stdio. Off (404) unless kv `mcp.remote` is on; 503 while the tunnel has no address.
 */

const MAX_FORM = 64 * 1024;
const MAX_MCP_BODY = 1024 * 1024;
/** The parameters of an authorization request carried from the approval page to its POST. */
const AUTHORIZE_PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const;

export const isRemoteMcpPath = (path: string) => path === "/mcp" || path.startsWith("/mcp/") || path.startsWith("/oauth/") || path.startsWith("/.well-known/oauth-");

/** What the panel already knows about the request, and how it sends its own pages. */
export interface PanelSide {
  authed: boolean;
  sameOrigin: boolean;
  nonce: string;
  /** Sends a panel page; `formTargets` are origins its forms may be redirected to (the chat's redirect URI). */
  page: (status: number, html: string, formTargets?: string[]) => void;
}

export interface RemoteMcpOptions {
  merges?: MergeApiFactory;
  /** The clock for codes and tokens; the factory's by default. */
  now?: () => Date;
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw new Error("pedido demasiado grande");
  }
  return body;
}

const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", ...extra });
  res.end(JSON.stringify(body));
};
const plain = (res: ServerResponse, status: number, text: string) => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(text);
};
const oauthError = (res: ServerResponse, e: OAuthError, status = 400) => json(res, status, { error: e.error, error_description: e.description });

/** The tunnel's address, or 127.0.0.1 itself: a request naming any other host is refused. */
function hostAllowed(host: string | undefined, remote: URL): boolean {
  if (!host) return false;
  if (host.toLowerCase() === remote.host.toLowerCase()) return true;
  try {
    return new URL(`http://${host}`).hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** A form or a JSON object, as the token and registration endpoints may receive either. */
function parseBody(req: IncomingMessage, raw: string): Record<string, string> {
  if (String(req.headers["content-type"] ?? "").includes("application/json")) {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string")) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

/** Handles every remote chat route; the panel calls it before its own session check. */
export function createRemoteMcp(ctx: FactoryContext, opts: RemoteMcpOptions = {}) {
  const now = () => opts.now?.() ?? ctx.now?.() ?? new Date();

  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL, panel: PanelSide): Promise<void> {
    if (!remoteMcpOn(ctx)) return plain(res, 404, "No existe.");
    const address = ctx.store.getKv(REMOTE_URL_KEY);
    if (!address) return plain(res, 503, "El túnel del panel no está abierto: el chat remoto necesita su dirección pública (zero panel remoto on).");
    const remote = new URL(address);
    if (!hostAllowed(req.headers.host, remote)) return plain(res, 421, "Host no permitido.");
    const issuer = remote.origin;
    const resource = `${issuer}/mcp`;
    const resourceMetadata = `${issuer}/.well-known/oauth-protected-resource`;
    const path = url.pathname;

    try {
      if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
        return json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`,
          registration_endpoint: `${issuer}/oauth/register`,
          revocation_endpoint: `${issuer}/oauth/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          revocation_endpoint_auth_methods_supported: ["none"],
          scopes_supported: [...SCOPES],
        });
      }
      if (req.method === "GET" && (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp")) {
        return json(res, 200, { resource, authorization_servers: [issuer], scopes_supported: [...SCOPES], bearer_methods_supported: ["header"], resource_name: "zero" });
      }
      if (path === "/oauth/register") {
        if (req.method !== "POST") return plain(res, 405, "Solo POST.");
        let body: unknown;
        try {
          body = JSON.parse((await readBody(req, MAX_FORM)) || "{}");
        } catch {
          return oauthError(res, { error: "invalid_client_metadata", description: "el cuerpo no es JSON" });
        }
        const client = registerClient(ctx.store, body, now());
        if (isOAuthError(client)) return oauthError(res, client);
        log.info("remote chat client registered", { client: client.id, name: client.name });
        return json(res, 201, clientInfo(client));
      }
      if (path === "/oauth/authorize") return await authorize(req, res, url, panel, issuer);
      if (path === "/oauth/token") {
        if (req.method !== "POST") return plain(res, 405, "Solo POST.");
        const body = parseBody(req, await readBody(req, MAX_FORM));
        const result =
          body.grant_type === "authorization_code"
            ? exchangeCode(ctx.store, body, now())
            : body.grant_type === "refresh_token"
              ? refreshTokens(ctx.store, body, now())
              : ({ error: "unsupported_grant_type", description: "solo authorization_code y refresh_token" } satisfies OAuthError);
        if (isOAuthError(result)) return oauthError(res, result);
        return json(res, 200, result);
      }
      if (path === "/oauth/revoke") {
        if (req.method !== "POST") return plain(res, 405, "Solo POST.");
        revokeToken(ctx.store, parseBody(req, await readBody(req, MAX_FORM)).token);
        return json(res, 200, {});
      }
      if (path === "/mcp") return await mcp(req, res, resourceMetadata);
      return plain(res, 404, "No existe.");
    } catch (err) {
      // Never the request itself: a body may carry codes or tokens.
      log.warn("remote chat error", { path, error: err instanceof Error ? err.message : String(err) });
      if (res.headersSent) return void res.end();
      return json(res, 500, { error: "server_error", error_description: "error interno" });
    }
  };

  /** The owner's approval: only with the panel's session, and a code only on a same-origin POST with confirm=1. */
  async function authorize(req: IncomingMessage, res: ServerResponse, url: URL, panel: PanelSide, issuer: string): Promise<void> {
    if (req.method !== "GET" && req.method !== "POST") return plain(res, 405, "Solo GET o POST.");
    if (!panel.authed) return panel.page(401, loginPage(panel.nonce, false, url.pathname + url.search));
    let source: URLSearchParams = url.searchParams;
    if (req.method === "POST") {
      if (!panel.sameOrigin) return plain(res, 403, "Pedido de otro sitio rechazado.");
      source = new URLSearchParams(await readBody(req, MAX_FORM));
    }
    const params: Record<string, string> = {};
    for (const k of AUTHORIZE_PARAMS) {
      const v = source.get(k);
      if (v !== null) params[k] = v;
    }
    const checked = checkAuthorize(ctx.store, params);
    if (isOAuthError(checked)) {
      if (!checked.redirect) return plain(res, 400, `Pedido de conexión rechazado: ${checked.description}.`);
      const to = new URL(checked.redirectUri);
      to.searchParams.set("error", checked.error);
      to.searchParams.set("error_description", checked.description);
      if (params.state) to.searchParams.set("state", params.state);
      res.writeHead(302, { Location: to.toString(), "Cache-Control": "no-store" });
      return void res.end();
    }
    const target = new URL(checked.redirectUri);
    if (req.method === "POST" && (source.get("deny") === "1" || source.get("confirm") === "1")) {
      if (source.get("deny") === "1") {
        target.searchParams.set("error", "access_denied");
      } else {
        target.searchParams.set("code", issueCode(ctx.store, checked, now()));
        log.info("remote chat connection approved", { client: checked.client.id, scope: checked.scope.join(" ") });
      }
      if (checked.state) target.searchParams.set("state", checked.state);
      target.searchParams.set("iss", issuer);
      res.writeHead(302, { Location: target.toString(), "Cache-Control": "no-store" });
      return void res.end();
    }
    const page = authorizePage({ clientName: checked.client.name, clientId: checked.client.id, redirectUri: checked.redirectUri, scope: checked.scope, params: { ...params, redirect_uri: checked.redirectUri } }, panel.nonce);
    return panel.page(200, page, [target.origin]);
  }

  /** MCP streamable HTTP without sessions: one server and one transport per request, scoped by the token. */
  async function mcp(req: IncomingMessage, res: ServerResponse, resourceMetadata: string): Promise<void> {
    const bearer = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
    const who = verifyAccess(ctx.store, bearer, now());
    if (!who) {
      const challenge = `Bearer resource_metadata="${resourceMetadata}"${bearer ? `, error="invalid_token"` : ""}`;
      return json(res, 401, { error: bearer ? "invalid_token" : "unauthorized", error_description: "hace falta un token de acceso válido" }, { "WWW-Authenticate": challenge });
    }
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", "Content-Type": "application/json" });
      return void res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Solo POST: este servidor no tiene sesiones." }, id: null }));
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_MCP_BODY));
    } catch {
      return json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "JSON inválido" }, id: null });
    }
    const server = createZeroMcpServer(ctx.home, { autoStart: false, merges: opts.merges, remote: { scope: who.scope, client: who.client } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

