import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Store } from "../state/store.js";

/**
 * zero as its own OAuth 2.1 authorization server for the remote chat: public
 * clients (dynamic registration, no secret), authorization codes bound to the
 * client, the exact redirect URI and an S256 challenge, short-lived access
 * tokens and rotating refresh tokens. Everything lives in kv; codes and tokens
 * are stored only as their SHA-256 hash, and nothing here logs them.
 */

export const REMOTE_MCP_KEY = "mcp.remote";
export const SCOPES = ["zero:read", "zero:act"] as const;
export type Scope = (typeof SCOPES)[number];

export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_REDIRECTS = 10;
const MAX_NAME = 100;

const CLIENT = "oauth-client:";
const CODE = "oauth-code:";
const GRANT = "oauth-grant:";
const ACCESS = "oauth-access:";
const REFRESH = "oauth-refresh:";

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

/** One approval by the owner: the tokens issued from one code, revoked together. */
interface Grant {
  id: string;
  client: string;
  scope: Scope[];
  approvedAt: string;
  lastUsedAt?: string;
  /** Hash of the code it came from. */
  code: string;
}

interface CodeRecord {
  client: string;
  redirectUri: string;
  challenge: string;
  scope: Scope[];
  expiresAt: string;
  /** Set once exchanged; a second exchange revokes this grant. */
  grant?: string;
}

interface TokenRecord {
  grant: string;
  client: string;
  scope: Scope[];
  expiresAt: string;
}

export interface OAuthError {
  error: string;
  description: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  challenge: string;
  scope: Scope[];
  state?: string;
}

export interface ConnectedClient {
  id: string;
  name: string;
  scope: Scope[];
  approvedAt: string;
  lastUsedAt?: string;
}

const fail = (error: string, description: string): OAuthError => ({ error, description });
export const isOAuthError = (v: unknown): v is OAuthError => typeof v === "object" && v !== null && "error" in v;

export const hashSecret = (value: string): string => createHash("sha256").update(value).digest("hex");
const newSecret = (): string => randomBytes(32).toString("base64url");

function read<T>(store: Store, key: string): T | undefined {
  const raw = store.getKv(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const write = (store: Store, key: string, value: unknown) => store.setKv(key, JSON.stringify(value));

function entries<T>(store: Store, prefix: string): [string, T][] {
  const out: [string, T][] = [];
  for (const [key, raw] of store.kvWithPrefix(prefix)) {
    try {
      out.push([key, JSON.parse(raw) as T]);
    } catch {
      store.deleteKv(key);
    }
  }
  return out;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https, or http to a loopback host; never a fragment or credentials. */
export function redirectProblem(uri: unknown): string | undefined {
  if (typeof uri !== "string") return "redirect_uri no es texto";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "redirect_uri no es una URL";
  }
  if (url.hash || uri.includes("#")) return "redirect_uri no puede tener fragmento";
  if (url.username || url.password) return "redirect_uri no puede llevar credenciales";
  if (url.protocol === "https:") return undefined;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return undefined;
  return "redirect_uri tiene que ser https (o http a 127.0.0.1)";
}

/** Dynamic client registration (RFC 7591), public clients only. */
export function registerClient(store: Store, input: unknown, now = new Date()): OAuthClient | OAuthError {
  const body = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return fail("invalid_redirect_uri", "faltan redirect_uris");
  if (uris.length > MAX_REDIRECTS) return fail("invalid_redirect_uri", `a lo sumo ${MAX_REDIRECTS} redirect_uris`);
  for (const uri of uris) {
    const problem = redirectProblem(uri);
    if (problem) return fail("invalid_redirect_uri", problem);
  }
  const method = body.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return fail("invalid_client_metadata", "solo clientes públicos (token_endpoint_auth_method none)");
  const rawName = typeof body.client_name === "string" ? body.client_name : "";
  const name = rawName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_NAME) || "cliente sin nombre";
  const client: OAuthClient = { id: randomUUID(), name, redirectUris: [...new Set(uris as string[])], createdAt: now.toISOString() };
  write(store, CLIENT + client.id, client);
  return client;
}

export const getClient = (store: Store, id: string): OAuthClient | undefined =>
  typeof id === "string" && id ? read<OAuthClient>(store, CLIENT + id) : undefined;

/** The registration answer: no secret, since clients are public. */
export function clientInfo(client: OAuthClient) {
  return {
    client_id: client.id,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
  };
}

/** Requested scopes; none asked means read only. */
export function parseScope(raw: unknown): Scope[] | undefined {
  if (raw === undefined || raw === null || raw === "") return ["zero:read"];
  if (typeof raw !== "string") return undefined;
  const asked = raw.split(/\s+/).filter(Boolean);
  if (asked.some((s) => !(SCOPES as readonly string[]).includes(s))) return undefined;
  return SCOPES.filter((s) => asked.includes(s));
}

/**
 * Checks an authorization request. `redirect` says whether an error may be sent
 * to the redirect URI: never when the client or the URI is not the registered one.
 */
export function checkAuthorize(store: Store, params: Record<string, string | undefined>): AuthorizeRequest | (OAuthError & { redirect: boolean }) {
  const client = getClient(store, params.client_id ?? "");
  if (!client) return { ...fail("invalid_client", "cliente desconocido"), redirect: false };
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { ...fail("invalid_request", "redirect_uri no registrada"), redirect: false };
  if (params.response_type !== "code") return { ...fail("unsupported_response_type", "solo response_type=code"), redirect: true };
  if (!params.code_challenge) return { ...fail("invalid_request", "falta code_challenge (PKCE)"), redirect: false };
  if (params.code_challenge_method !== "S256") return { ...fail("invalid_request", "code_challenge_method tiene que ser S256"), redirect: false };
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) return { ...fail("invalid_request", "code_challenge inválido"), redirect: false };
  const scope = parseScope(params.scope);
  if (!scope) return { ...fail("invalid_scope", "permisos desconocidos"), redirect: true };
  return { client, redirectUri, challenge: params.code_challenge, scope, state: params.state };
}

/** Issues a one-use code once the owner approved the request. */
export function issueCode(store: Store, request: AuthorizeRequest, now = new Date()): string {
  prune(store, now);
  const code = newSecret();
  const record: CodeRecord = {
    client: request.client.id,
    redirectUri: request.redirectUri,
    challenge: request.challenge,
    scope: request.scope,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  };
  write(store, CODE + hashSecret(code), record);
  return code;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function issueTokens(store: Store, grant: Grant, scope: Scope[], now: Date): TokenResponse {
  const access = newSecret();
  const refresh = newSecret();
  const base = { grant: grant.id, client: grant.client, scope };
  write(store, ACCESS + hashSecret(access), { ...base, expiresAt: new Date(now.getTime() + ACCESS_TTL_MS).toISOString() } satisfies TokenRecord);
  write(store, REFRESH + hashSecret(refresh), { ...base, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString() } satisfies TokenRecord);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: scope.join(" ") };
}

/** Deletes a grant and every token issued under it. */
function revokeGrant(store: Store, grantId: string) {
  for (const prefix of [ACCESS, REFRESH]) {
    for (const [key, token] of entries<TokenRecord>(store, prefix)) if (token.grant === grantId) store.deleteKv(key);
  }
  store.deleteKv(GRANT + grantId);
}

/** authorization_code grant: the verifier, the client and the redirect URI must match the code. */
export function exchangeCode(store: Store, input: { code?: string; code_verifier?: string; client_id?: string; redirect_uri?: string }, now = new Date()): TokenResponse | OAuthError {
  if (!input.code || !input.code_verifier || !input.client_id) return fail("invalid_request", "faltan code, code_verifier o client_id");
  const key = CODE + hashSecret(input.code);
  const record = read<CodeRecord>(store, key);
  if (!record) return fail("invalid_grant", "código desconocido o vencido");
  if (record.grant) {
    revokeGrant(store, record.grant);
    store.deleteKv(key);
    return fail("invalid_grant", "código ya usado; se revocaron sus tokens");
  }
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    store.deleteKv(key);
    return fail("invalid_grant", "código vencido");
  }
  if (record.client !== input.client_id) return fail("invalid_grant", "el código es de otro cliente");
  if ((input.redirect_uri ?? record.redirectUri) !== record.redirectUri) return fail("invalid_grant", "redirect_uri distinta de la del pedido");
  if (!sameText(s256(input.code_verifier), record.challenge)) return fail("invalid_grant", "code_verifier no corresponde");
  if (!getClient(store, record.client)) return fail("invalid_grant", "cliente revocado");
  const grant: Grant = { id: randomUUID(), client: record.client, scope: record.scope, approvedAt: now.toISOString(), code: hashSecret(input.code) };
  write(store, GRANT + grant.id, grant);
  // Kept until it would have expired as a refresh, so a replay can still be caught.
  write(store, key, { ...record, grant: grant.id, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS).toISOString() } satisfies CodeRecord);
  return issueTokens(store, grant, record.scope, now);
}

/** refresh_token grant: the old refresh token stops working, and the scope may only narrow. */
export function refreshTokens(store: Store, input: { refresh_token?: string; client_id?: string; scope?: string }, now = new Date()): TokenResponse | OAuthError {
  if (!input.refresh_token || !input.client_id) return fail("invalid_request", "faltan refresh_token o client_id");
  const key = REFRESH + hashSecret(input.refresh_token);
  const record = read<TokenRecord>(store, key);
  if (!record || Date.parse(record.expiresAt) <= now.getTime()) {
    if (record) store.deleteKv(key);
    return fail("invalid_grant", "token de renovación desconocido, vencido o revocado");
  }
  if (record.client !== input.client_id) return fail("invalid_grant", "el token es de otro cliente");
  const grant = read<Grant>(store, GRANT + record.grant);
  if (!grant || !getClient(store, record.client)) {
    store.deleteKv(key);
    return fail("invalid_grant", "conexión revocada");
  }
  let scope = record.scope;
  if (input.scope) {
    const asked = parseScope(input.scope);
    if (!asked || asked.some((s) => !record.scope.includes(s))) return fail("invalid_scope", "no se puede ampliar el permiso");
    scope = asked;
  }
  store.deleteKv(key);
  return issueTokens(store, grant, scope, now);
}

/** The client and scope behind a valid access token, recording its use; undefined otherwise. */
export function verifyAccess(store: Store, token: string | undefined, now = new Date()): { client: string; scope: Scope[] } | undefined {
  if (!token) return undefined;
  const key = ACCESS + hashSecret(token);
  const record = read<TokenRecord>(store, key);
  if (!record) return undefined;
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    store.deleteKv(key);
    return undefined;
  }
  const grant = read<Grant>(store, GRANT + record.grant);
  if (!grant || !getClient(store, record.client)) {
    store.deleteKv(key);
    return undefined;
  }
  write(store, GRANT + grant.id, { ...grant, lastUsedAt: now.toISOString() } satisfies Grant);
  return { client: record.client, scope: record.scope };
}

/** RFC 7009: revokes one token (access or refresh) and, with it, its grant. Unknown tokens are not an error. */
export function revokeToken(store: Store, token: string | undefined) {
  if (!token) return;
  const hash = hashSecret(token);
  const record = read<TokenRecord>(store, ACCESS + hash) ?? read<TokenRecord>(store, REFRESH + hash);
  if (record) revokeGrant(store, record.grant);
}

/** Clients with a live grant: name, id, scopes, first approval and last use. */
export function connectedClients(store: Store, now = new Date()): ConnectedClient[] {
  prune(store, now);
  const live = new Set(entries<TokenRecord>(store, REFRESH).map(([, t]) => t.grant));
  const byClient = new Map<string, ConnectedClient>();
  for (const [, grant] of entries<Grant>(store, GRANT)) {
    if (!live.has(grant.id)) continue;
    const client = getClient(store, grant.client);
    if (!client) continue;
    const seen = byClient.get(client.id);
    if (!seen) {
      byClient.set(client.id, { id: client.id, name: client.name, scope: [...grant.scope], approvedAt: grant.approvedAt, lastUsedAt: grant.lastUsedAt });
      continue;
    }
    seen.scope = SCOPES.filter((s) => seen.scope.includes(s) || grant.scope.includes(s));
    if (grant.approvedAt < seen.approvedAt) seen.approvedAt = grant.approvedAt;
    if (grant.lastUsedAt && (!seen.lastUsedAt || grant.lastUsedAt > seen.lastUsedAt)) seen.lastUsedAt = grant.lastUsedAt;
  }
  return [...byClient.values()].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt));
}

/** Removes a client with its codes, grants and tokens at once. False when it was not registered. */
export function revokeClient(store: Store, id: string): boolean {
  const client = getClient(store, id);
  if (!client) return false;
  for (const prefix of [ACCESS, REFRESH, CODE, GRANT]) {
    for (const [key, record] of entries<{ client: string }>(store, prefix)) if (record.client === id) store.deleteKv(key);
  }
  store.deleteKv(CLIENT + id);
  return true;
}

/** Drops expired codes and tokens, and grants with no token left. */
function prune(store: Store, now: Date) {
  const at = now.getTime();
  const live = new Set<string>();
  for (const prefix of [CODE, ACCESS, REFRESH]) {
    for (const [key, record] of entries<{ expiresAt: string; grant?: string }>(store, prefix)) {
      if (Date.parse(record.expiresAt) <= at) store.deleteKv(key);
      else if (record.grant && prefix !== CODE) live.add(record.grant);
    }
  }
  for (const [key, grant] of entries<Grant>(store, GRANT)) if (!live.has(grant.id)) store.deleteKv(key);
}
