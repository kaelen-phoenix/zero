import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { remoteChatClients, remoteMcpOn, revokeRemoteChatClient, setRemoteMcp } from "../src/app.js";
import {
  ACCESS_TTL_MS,
  checkAuthorize,
  CODE_TTL_MS,
  exchangeCode,
  isOAuthError,
  issueCode,
  REFRESH_TTL_MS,
  refreshTokens,
  registerClient,
  REMOTE_MCP_KEY,
  revokeToken,
  verifyAccess,
  type AuthorizeRequest,
  type OAuthClient,
  type TokenResponse,
} from "../src/mcp/oauth.js";
import { Store } from "../src/state/store.js";

const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER = "v".repeat(50);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const T0 = new Date("2026-11-14T12:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function client(store: Store, name = "ChatGPT"): OAuthClient {
  const c = registerClient(store, { client_name: name, redirect_uris: [REDIRECT] }, T0);
  if (isOAuthError(c)) throw new Error(c.description);
  return c;
}

function request(store: Store, c: OAuthClient, scope = "zero:read zero:act"): AuthorizeRequest {
  const r = checkAuthorize(store, { client_id: c.id, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256", scope, state: "s1" });
  if (isOAuthError(r)) throw new Error(r.description);
  return r;
}

function tokens(store: Store, c: OAuthClient, scope?: string): { code: string; tokens: TokenResponse } {
  const code = issueCode(store, request(store, c, scope), T0);
  const t = exchangeCode(store, { code, code_verifier: VERIFIER, client_id: c.id, redirect_uri: REDIRECT }, T0);
  if (isOAuthError(t)) throw new Error(t.description);
  return { code, tokens: t };
}

describe("oauth registration", () => {
  it("registers public clients with https or loopback redirects", () => {
    const store = new Store(":memory:");
    const c = client(store);
    expect(c.id).toBeTruthy();
    expect(c).not.toHaveProperty("secret");
    expect(isOAuthError(registerClient(store, { client_name: "local", redirect_uris: ["http://127.0.0.1:5000/cb"] }))).toBe(false);
  });

  it("refuses insecure redirects and stores nothing", () => {
    const store = new Store(":memory:");
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "https://a.example/cb#x", "https://u:p@a.example/cb"]) {
      const r = registerClient(store, { client_name: "x", redirect_uris: [uri] });
      expect(isOAuthError(r) && r.error).toBe("invalid_redirect_uri");
    }
    expect(isOAuthError(registerClient(store, { client_name: "x" }))).toBe(true);
    expect(store.kvWithPrefix("oauth-")).toEqual([]);
  });
});

describe("oauth authorize", () => {
  it("requires S256 PKCE and the registered redirect without redirecting", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const base = { client_id: c.id, redirect_uri: REDIRECT, response_type: "code", code_challenge: CHALLENGE, code_challenge_method: "S256" };
    const noPkce = checkAuthorize(store, { ...base, code_challenge: undefined });
    expect(noPkce).toMatchObject({ error: "invalid_request", redirect: false });
    expect(checkAuthorize(store, { ...base, code_challenge_method: "plain" })).toMatchObject({ redirect: false });
    expect(checkAuthorize(store, { ...base, redirect_uri: "https://other.example/cb" })).toMatchObject({ redirect: false });
    expect(checkAuthorize(store, { ...base, client_id: "nope" })).toMatchObject({ error: "invalid_client" });
    expect(checkAuthorize(store, { ...base, scope: "zero:admin" })).toMatchObject({ error: "invalid_scope" });
    expect(checkAuthorize(store, base)).toMatchObject({ scope: ["zero:read"], redirectUri: REDIRECT });
  });
});

describe("oauth tokens", () => {
  it("exchanges a code only with its verifier, client and redirect", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const other = client(store, "otro");
    const code = issueCode(store, request(store, c), T0);
    expect(exchangeCode(store, { code, code_verifier: "w".repeat(50), client_id: c.id, redirect_uri: REDIRECT }, T0)).toMatchObject({ error: "invalid_grant" });
    expect(exchangeCode(store, { code, code_verifier: VERIFIER, client_id: other.id, redirect_uri: REDIRECT }, T0)).toMatchObject({ error: "invalid_grant" });
    expect(exchangeCode(store, { code, code_verifier: VERIFIER, client_id: c.id, redirect_uri: "https://x.example/cb" }, T0)).toMatchObject({ error: "invalid_grant" });
    const t = exchangeCode(store, { code, code_verifier: VERIFIER, client_id: c.id, redirect_uri: REDIRECT }, T0) as TokenResponse;
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, scope: "zero:read zero:act" });
    expect(ACCESS_TTL_MS).toBeLessThanOrEqual(60 * 60_000);
    expect(REFRESH_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60_000);
    expect(verifyAccess(store, t.access_token, T0)).toEqual({ client: c.id, scope: ["zero:read", "zero:act"] });
  });

  it("expires codes after 5 minutes", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const code = issueCode(store, request(store, c), T0);
    expect(exchangeCode(store, { code, code_verifier: VERIFIER, client_id: c.id }, later(CODE_TTL_MS + 1))).toMatchObject({ error: "invalid_grant" });
  });

  it("revokes the tokens of a code used twice", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const { code, tokens: t } = tokens(store, c);
    expect(exchangeCode(store, { code, code_verifier: VERIFIER, client_id: c.id, redirect_uri: REDIRECT }, T0)).toMatchObject({ error: "invalid_grant" });
    expect(verifyAccess(store, t.access_token, T0)).toBeUndefined();
    expect(refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id }, T0)).toMatchObject({ error: "invalid_grant" });
  });

  it("ends access after an hour and rotates refresh tokens", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const { tokens: t } = tokens(store, c);
    expect(verifyAccess(store, t.access_token, later(ACCESS_TTL_MS + 1))).toBeUndefined();
    const next = refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id }, later(ACCESS_TTL_MS + 1)) as TokenResponse;
    expect(next.access_token).toBeTruthy();
    expect(next.refresh_token).not.toBe(t.refresh_token);
    expect(refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id }, later(ACCESS_TTL_MS + 2))).toMatchObject({ error: "invalid_grant" });
    expect(verifyAccess(store, next.access_token, later(ACCESS_TTL_MS + 2))).toMatchObject({ client: c.id });
    expect(refreshTokens(store, { refresh_token: next.refresh_token, client_id: c.id }, later(ACCESS_TTL_MS + REFRESH_TTL_MS + 2))).toMatchObject({ error: "invalid_grant" });
  });

  it("only narrows scope on refresh", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const { tokens: t } = tokens(store, c, "zero:read");
    expect(refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id, scope: "zero:read zero:act" }, T0)).toMatchObject({ error: "invalid_scope" });
    expect(refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id, scope: "zero:read" }, T0)).toMatchObject({ scope: "zero:read" });
  });

  it("revokes a single token's connection", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const { tokens: t } = tokens(store, c);
    revokeToken(store, t.refresh_token);
    expect(verifyAccess(store, t.access_token, T0)).toBeUndefined();
  });

  it("stores only hashes of codes and tokens", () => {
    const store = new Store(":memory:");
    const c = client(store);
    const { code, tokens: t } = tokens(store, c);
    const next = refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id }, T0) as TokenResponse;
    const dump = JSON.stringify(store.kvWithPrefix(""));
    for (const secret of [code, t.access_token, t.refresh_token, next.access_token, next.refresh_token]) expect(dump).not.toContain(secret);
  });
});

describe("remote chat in app.ts", () => {
  it("turns the remote server on and off in kv", () => {
    const store = new Store(":memory:");
    expect(remoteMcpOn({ store })).toBe(false);
    setRemoteMcp({ store }, true);
    expect(store.getKv(REMOTE_MCP_KEY)).toBe("on");
    expect(remoteMcpOn({ store })).toBe(true);
    setRemoteMcp({ store }, false);
    expect(store.getKv(REMOTE_MCP_KEY)).toBeUndefined();
  });

  it("lists approved clients and revokes them at once", () => {
    const store = new Store(":memory:");
    const c = client(store);
    client(store, "sin aprobar");
    const { tokens: t } = tokens(store, c);
    verifyAccess(store, t.access_token, later(1000));
    const list = remoteChatClients({ store }, later(2000));
    expect(list).toEqual([{ id: c.id, name: "ChatGPT", scope: ["zero:read", "zero:act"], approvedAt: T0.toISOString(), lastUsedAt: later(1000).toISOString() }]);
    expect(revokeRemoteChatClient({ store }, c.id)).toBe(true);
    expect(verifyAccess(store, t.access_token, later(3000))).toBeUndefined();
    expect(refreshTokens(store, { refresh_token: t.refresh_token, client_id: c.id }, later(3000))).toMatchObject({ error: "invalid_grant" });
    expect(remoteChatClients({ store }, later(3000))).toEqual([]);
    expect(revokeRemoteChatClient({ store }, c.id)).toBe(false);
  });
});
