import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { ProviderError } from "../contracts.js";

/**
 * Flaim OAuth for local private mode (ESPN-LIVE-01, ADR 0013). Server/CLI only. Follows Flaim's published connector contract:
 * authorization-server metadata, dynamic registration of a public client (no secret), Authorization Code + PKCE S256 with a
 * loopback redirect, 1-hour access tokens and rotating refresh tokens. Fantasy Dashboard authenticates to Flaim only; it never
 * sees ESPN credentials. Errors carry fixed messages and an OAuth error code at most: never tokens, codes or response bodies.
 */
export const FLAIM_ORIGIN = "https://api.flaim.app";
export const FLAIM_MCP_URL = `${FLAIM_ORIGIN}/mcp`;
export const FLAIM_CALLBACK_PATH = "/oauth/callback";
export const FLAIM_SCOPE = "mcp:read";
const TIMEOUT_MS = 20000;
const MAX_BODY = 256 * 1024;

export class FlaimAuthError extends ProviderError {
  constructor(code, message, oauthError = null) { super(code, "espn", message); this.name = "FlaimAuthError"; this.oauthError = oauthError; }
}
const RECONNECT = "Run `pnpm --silent flaim:connect --config <private config>` to reconnect Fantasy Dashboard to Flaim.";
export const authRequired = (detail = "Flaim authorization is missing or no longer valid.") => new FlaimAuthError("AUTH_REQUIRED", `${detail} ${RECONNECT}`);

export const base64url = buf => Buffer.from(buf).toString("base64url");
/** 256-bit random PKCE verifier, its S256 challenge, and a 256-bit random state. */
export function pkcePair(random = randomBytes) {
  const verifier = base64url(random(32)), state = base64url(random(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()), state };
}
/** Constant-time state comparison. */
export function stateMatches(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(received), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** True for the only redirect URIs this client registers: http://127.0.0.1:<port>/oauth/callback. */
export function loopbackRedirect(uri) {
  try { const u = new URL(uri); return u.protocol === "http:" && u.hostname === "127.0.0.1" && u.pathname === FLAIM_CALLBACK_PATH && !u.search && !u.hash && Number(u.port) > 0; }
  catch { return false; }
}

const flaimUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && u.origin === FLAIM_ORIGIN ? u.toString() : null; } catch { return null; } };
async function request(fetcher, url, init, what) {
  let res;
  try { res = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { throw new FlaimAuthError("PROVIDER_UNAVAILABLE", `Flaim could not be reached (${what}).`); }
  let text = "";
  try { text = await res.text(); } catch { /* treated as an empty body */ }
  if (text.length > MAX_BODY) throw new FlaimAuthError("PROVIDER_UNAVAILABLE", `Flaim returned an oversized response (${what}).`);
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, ok: res.ok, json, retryAfter: res.headers?.get?.("retry-after") ?? null };
}
const oauthCode = json => typeof json?.error === "string" && /^[a-z_]{1,40}$/.test(json.error) ? json.error : null;
function failure(res, what) {
  const code = oauthCode(res.json);
  if (res.status === 429) return new FlaimAuthError("RATE_LIMITED", `Flaim rate-limited the request (${what}).`, code);
  if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client") return authRequired(`Flaim rejected the stored authorization (${what}).`);
  if (res.status >= 500) return new FlaimAuthError("PROVIDER_UNAVAILABLE", `Flaim is temporarily unavailable (${what}).`, code);
  return new FlaimAuthError("AUTH_FAILED", `Flaim rejected the request (${what}${code ? `: ${code}` : ""}).`, code);
}

/** Authorization-server metadata. Endpoints must stay on Flaim's HTTPS origin and advertise PKCE S256 and registration. */
export async function discoverFlaim({ fetcher = fetch } = {}) {
  const res = await request(fetcher, `${FLAIM_ORIGIN}/.well-known/oauth-authorization-server`, { headers: { accept: "application/json" } }, "discovery");
  if (!res.ok || !res.json || typeof res.json !== "object") throw failure(res, "discovery");
  const m = res.json, meta = { authorization_endpoint: flaimUrl(m.authorization_endpoint), token_endpoint: flaimUrl(m.token_endpoint),
    registration_endpoint: flaimUrl(m.registration_endpoint), revocation_endpoint: m.revocation_endpoint ? flaimUrl(m.revocation_endpoint) : null };
  if (!meta.authorization_endpoint || !meta.token_endpoint) throw new FlaimAuthError("AUTH_FAILED", "Flaim's OAuth metadata is missing required endpoints on its own origin.");
  if (!Array.isArray(m.code_challenge_methods_supported) || !m.code_challenge_methods_supported.includes("S256")) throw new FlaimAuthError("AUTH_FAILED", "Flaim's OAuth metadata does not advertise PKCE S256.");
  if (!meta.registration_endpoint) throw new FlaimAuthError("AUTH_FAILED", "Flaim's OAuth metadata does not advertise client registration.");
  meta.scope = Array.isArray(m.scopes_supported) && m.scopes_supported.includes(FLAIM_SCOPE) ? FLAIM_SCOPE : null;
  return meta;
}

/** Dynamic registration of a public loopback client. A returned client secret is refused (this design never stores one). */
export async function registerClient(meta, redirectUri, { fetcher = fetch } = {}) {
  if (!loopbackRedirect(redirectUri)) throw new FlaimAuthError("AUTH_FAILED", "Only a 127.0.0.1 loopback redirect is registered.");
  const res = await request(fetcher, meta.registration_endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_name: "Fantasy Dashboard (local)", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) }, "client registration");
  if (!res.ok) throw failure(res, "client registration");
  const reg = res.json;
  if (typeof reg?.client_id !== "string" || !reg.client_id || reg.client_id.length > 512) throw new FlaimAuthError("AUTH_FAILED", "Flaim's client registration returned no client id.");
  if (reg.client_secret != null) throw new FlaimAuthError("AUTH_FAILED", "Flaim issued a client secret; this local public-client design does not store one.");
  if (Array.isArray(reg.redirect_uris) && !reg.redirect_uris.includes(redirectUri)) throw new FlaimAuthError("AUTH_FAILED", "Flaim did not accept the loopback redirect.");
  return { client_id: reg.client_id };
}

export function authorizationUrl(meta, { clientId, redirectUri, challenge, state, resource = FLAIM_MCP_URL }) {
  const url = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, resource, ...(meta.scope ? { scope: meta.scope } : {}) })) url.searchParams.set(k, v);
  return url.toString();
}

/** Validated token response → stored token fields. Expiry is computed from expires_in (default 1 hour when absent). */
export function tokenFields(json, { now = Date.now(), previousRefresh = null } = {}) {
  if (!json || typeof json !== "object" || typeof json.access_token !== "string" || !json.access_token || json.access_token.length > 8192) throw new FlaimAuthError("AUTH_FAILED", "Flaim returned a malformed token response.");
  if (json.token_type != null && String(json.token_type).toLowerCase() !== "bearer") throw new FlaimAuthError("AUTH_FAILED", "Flaim returned an unsupported token type.");
  const refresh = json.refresh_token ?? previousRefresh;
  if (typeof refresh !== "string" || !refresh || refresh.length > 8192) throw new FlaimAuthError("AUTH_FAILED", "Flaim returned no refresh token.");
  const ttl = Number.isFinite(json.expires_in) && json.expires_in > 0 ? Math.min(json.expires_in, 86400) : 3600;
  return { access_token: json.access_token, access_expires_at: new Date(now + ttl * 1000).toISOString(), refresh_token: refresh, scope: typeof json.scope === "string" ? json.scope.slice(0, 200) : null };
}
const tokenRequest = (fetcher, meta, params, what) => request(fetcher, meta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(params) }, what);

export async function exchangeCode(meta, { clientId, code, redirectUri, verifier, resource = FLAIM_MCP_URL }, { fetcher = fetch, now = Date.now } = {}) {
  const res = await tokenRequest(fetcher, meta, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource }, "token exchange");
  if (!res.ok) throw failure(res, "token exchange");
  return tokenFields(res.json, { now: now() });
}
/** Refresh grant. Flaim rotates refresh tokens: the caller must persist the returned refresh token before using the access token. */
export async function refreshTokens(meta, { clientId, refreshToken, resource = FLAIM_MCP_URL }, { fetcher = fetch, now = Date.now } = {}) {
  const res = await tokenRequest(fetcher, meta, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource }, "token refresh");
  if (!res.ok) throw failure(res, "token refresh");
  return tokenFields(res.json, { now: now(), previousRefresh: refreshToken });
}
