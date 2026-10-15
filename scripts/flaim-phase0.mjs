#!/usr/bin/env node
// Phase 0 (ESPN-LIVE-01): can an ordinary local Node client authenticate to Flaim and call its MCP server?
// Node 22 built-ins only. Nothing is written to disk. Tokens, codes, owner names and payloads are never printed;
// the league/team identifiers are read from the private config and only compared, never printed.
// Usage: node flaim-phase0.mjs --config <espn-private-1 config path>   (or --league <id> --season <yyyy> --team <id>)
import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const ISSUER = process.env.FLAIM_PHASE0_BASE || "https://api.flaim.app";
const MCP_URL = `${ISSUER}/mcp`;
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
let league = args.league, season = args.season && Number(args.season), team = args.team && Number(args.team);
if (args.config) { const c = JSON.parse(readFileSync(args.config, "utf8")); league ??= c.league_id; season ??= c.season; team ??= c.team_id; }
if (!league || !season) { console.error("Need --config or --league/--season."); process.exit(2); }

const results = [];
const step = (name, ok, note = "") => { results.push({ step: name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `  (${note})` : ""}`); };
const stop = (name, note) => { step(name, false, note); finish(1); };
function finish(code) { console.log("\nPHASE0_SUMMARY " + JSON.stringify(results)); process.exit(code); }
const b64url = buf => buf.toString("base64url");
const oauthError = async res => { let j = {}; try { j = await res.json(); } catch {} return `HTTP ${res.status}${typeof j.error === "string" ? ` error=${j.error.slice(0, 60)}` : ""}`; };

// 1. Discovery
let meta, prm = null;
try { const r = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`); if (!r.ok) stop("discover authorization server metadata", `HTTP ${r.status}`); meta = await r.json(); }
catch (e) { stop("discover authorization server metadata", e.code || e.name); }
try { const r = await fetch(`${ISSUER}/.well-known/oauth-protected-resource/mcp`); if (r.ok) prm = await r.json(); else { const r2 = await fetch(`${ISSUER}/.well-known/oauth-protected-resource`); if (r2.ok) prm = await r2.json(); } } catch {}
step("discover authorization server metadata", !!(meta.authorization_endpoint && meta.token_endpoint),
  `S256=${(meta.code_challenge_methods_supported || []).includes("S256")} registration=${!!meta.registration_endpoint} auth_methods=${JSON.stringify(meta.token_endpoint_auth_methods_supported || null)} grants=${JSON.stringify(meta.grant_types_supported || null)} scopes=${JSON.stringify(meta.scopes_supported || null)} protected_resource_md=${!!prm}`);
if (!(meta.code_challenge_methods_supported || []).includes("S256")) stop("S256 advertised", "code_challenge_methods_supported lacks S256");
if (!meta.registration_endpoint) stop("dynamic registration endpoint advertised", "none");
const resource = prm?.resource || MCP_URL;

// 2. Loopback listener on 127.0.0.1 (ephemeral port)
const state = b64url(randomBytes(32)), verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
let deliver;
const callback = new Promise(r => (deliver = r));
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (u.pathname !== "/oauth/callback") { res.writeHead(404).end(); return; }
  const got = Buffer.from(u.searchParams.get("state") || ""), want = Buffer.from(state);
  const stateOk = got.length === want.length && timingSafeEqual(got, want);
  res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }).end(stateOk ? "Fantasy Dashboard: Flaim authorization received. You can close this tab." : "State mismatch; ignored.");
  if (stateOk) deliver({ code: u.searchParams.get("code"), error: u.searchParams.get("error") });
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
step("loopback listener on 127.0.0.1", true, "ephemeral port");

// 3. Dynamic client registration (public client, no secret)
const regRes = await fetch(meta.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Fantasy Dashboard (local)", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
if (!regRes.ok) stop("dynamic public-client registration", await oauthError(regRes));
const reg = await regRes.json();
if (typeof reg.client_id !== "string") stop("dynamic public-client registration", "no client_id");
step("dynamic public-client registration", true, `client_secret_issued=${"client_secret" in reg} auth_method=${reg.token_endpoint_auth_method ?? "unspecified"} redirect_accepted=${(reg.redirect_uris || [redirectUri]).includes(redirectUri)}`);

// 4. Authorization request (browser)
const scope = (meta.scopes_supported || []).includes("mcp:read") ? "mcp:read" : undefined;
const authUrl = new URL(meta.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, resource, ...(scope ? { scope } : {}) })) authUrl.searchParams.set(k, v);
console.log("\nOpen this URL in your browser and approve Flaim access (it contains only protocol parameters, no secrets):\n" + authUrl + "\n");
const opener = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", authUrl.toString()]] : [process.platform === "darwin" ? "open" : "xdg-open", [authUrl.toString()]];
try { const child = spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }); child.on("error", () => {}); child.unref(); } catch {}
const timeout = setTimeout(() => deliver({ error: "timeout" }), 10 * 60 * 1000);
const cb = await callback; clearTimeout(timeout); server.close();
if (cb.error || !cb.code) stop("authorization code + state validated", cb.error ? `error=${String(cb.error).slice(0, 40)}` : "no code");
step("authorization code + state validated", true);

// 5. Token exchange (no client secret)
const tokenReq = params => fetch(meta.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(params) });
let tr = await tokenReq({ grant_type: "authorization_code", code: cb.code, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier, resource });
cb.code = null;
if (!tr.ok) stop("token exchange (PKCE, no secret)", await oauthError(tr));
let tok = await tr.json();
if (typeof tok.access_token !== "string") stop("token exchange (PKCE, no secret)", "no access_token");
step("token exchange (PKCE, no secret)", true, `token_type=${tok.token_type} expires_in=${tok.expires_in} refresh_token=${typeof tok.refresh_token === "string"} scope=${tok.scope ?? "unspecified"}`);

// 6. Refresh (and rotation)
if (typeof tok.refresh_token !== "string") stop("refresh token grant", "no refresh_token issued");
const oldRefresh = tok.refresh_token;
tr = await tokenReq({ grant_type: "refresh_token", refresh_token: oldRefresh, client_id: reg.client_id, resource });
if (!tr.ok) stop("refresh token grant", await oauthError(tr));
const refreshed = await tr.json();
if (typeof refreshed.access_token !== "string") stop("refresh token grant", "no access_token");
const rotated = typeof refreshed.refresh_token === "string" && refreshed.refresh_token !== oldRefresh;
tok = { ...refreshed, refresh_token: refreshed.refresh_token ?? oldRefresh };
step("refresh token grant", true, `rotated=${rotated} expires_in=${refreshed.expires_in}`);

// 7. MCP over Streamable HTTP, with the refreshed access token
let sessionId = null, rpcId = 0;
async function mcp(method, params, { notify = false } = {}) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}`, "mcp-protocol-version": "2025-06-18" };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const body = notify ? { jsonrpc: "2.0", method, ...(params ? { params } : {}) } : { jsonrpc: "2.0", id: ++rpcId, method, params: params ?? {} };
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  if (notify) return { status: res.status };
  if (!res.ok) return { status: res.status, wwwAuth: !!res.headers.get("www-authenticate") };
  const text = await res.text(), type = res.headers.get("content-type") || "";
  let msg = null;
  if (type.includes("text/event-stream")) { for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) { try { const m = JSON.parse(line.slice(5)); if (m.id === body.id) msg = m; } catch {} } }
  else { try { msg = JSON.parse(text); } catch {} }
  return { status: res.status, msg, type: type.split(";")[0] };
}
const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fantasy-dashboard-phase0", version: "0.0.0" } });
if (!init.msg?.result) stop("MCP initialize", `HTTP ${init.status} ${init.msg?.error ? `rpc_error=${init.msg.error.code}` : ""}`);
step("MCP initialize", true, `protocol=${init.msg.result.protocolVersion} session_header=${!!sessionId} transport=${init.type}`);
const n = await mcp("notifications/initialized", null, { notify: true });
step("MCP notifications/initialized", n.status >= 200 && n.status < 300, `HTTP ${n.status}`);
const list = await mcp("tools/list", {});
const names = (list.msg?.result?.tools || []).map(t => t.name);
step("MCP tools/list", names.length > 0, `tools=${names.join(",")}`);

const payload = r => { const res = r.msg?.result; if (!res || res.isError) return null; if (res.structuredContent) return res.structuredContent; const t = (res.content || []).find(c => c.type === "text")?.text; try { return JSON.parse(t); } catch { return null; } };
const sess = await mcp("tools/call", { name: "get_user_session", arguments: {} });
const sp = payload(sess);
if (!sp) stop("tools/call get_user_session", `HTTP ${sess.status} isError=${!!sess.msg?.result?.isError} rpc_error=${sess.msg?.error?.code ?? "none"}`);
const sdata = sp.success === true && sp.data ? sp.data : sp;
const leagues = Array.isArray(sdata.allLeagues) ? sdata.allLeagues : [];
const espnFb = leagues.filter(l => l.platform === "espn" && (l.sport == null || l.sport === "football"));
const match = espnFb.filter(l => String(l.leagueId) === String(league) && Number(l.seasonYear) === Number(season));
step("tools/call get_user_session", true, `envelope_success=${sp.success === true} leagues=${leagues.length} espn_football=${espnFb.length}`);
step("configured ESPN league (league+season) in authenticated session", match.length === 1, `matches=${match.length}`);
if (team != null) step("configured team equals session teamId (exact)", match.length === 1 && String(match[0].teamId) === String(team));
if (match.length !== 1) finish(1);

const li = await mcp("tools/call", { name: "get_league_info", arguments: { platform: "espn", sport: "football", league_id: String(league), season_year: Number(season) } });
const lp = payload(li);
const ld = lp?.success === true && lp.data ? lp.data : lp;
const ok = !!ld && Number(ld.id) === Number(league) && Number(ld.seasonId) === Number(season) && Array.isArray(ld.teams) && ld.teams.length > 0;
step("tools/call get_league_info (configured league)", ok, ld ? `envelope_success=${lp.success === true} id_match=${Number(ld.id) === Number(league)} season_match=${Number(ld.seasonId) === Number(season)} teams=${ld.teams?.length ?? 0} team_present=${team != null ? ld.teams?.some(t => t.teamId === team) : "n/a"} lineupSlotCounts=${!!ld.roster?.lineupSlotCounts}` : `HTTP ${li.status} isError=${!!li.msg?.result?.isError}`);

// 8. Clean up: revoke the proof's tokens (nothing was written to disk)
if (meta.revocation_endpoint) {
  const rv = await fetch(meta.revocation_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: tok.refresh_token, token_type_hint: "refresh_token", client_id: reg.client_id }) });
  step("revoke proof refresh token", rv.ok, `HTTP ${rv.status}`);
}
tok = null;
finish(results.every(r => r.ok) ? 0 : 1);
