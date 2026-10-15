import { ProviderError } from "../contracts.js";
import { FLAIM_MCP_URL, FlaimAuthError, authRequired, refreshTokens } from "./oauth.js";
import { readFlaimAuth, writeFlaimAuth } from "./auth-store.js";

/**
 * Bounded server-only Flaim MCP client (ESPN-LIVE-01, ADR 0013). Streamable HTTP POST to Flaim's MCP endpoint with the stored
 * bearer token; JSON or `text/event-stream` responses. Flaim issues no MCP session id (verified in Phase 0), so no session state
 * is kept beyond echoing one if it ever appears. Only the explicitly allowed read-only tools can be called; there is no generic
 * tool route and nothing here is reachable from the browser. Expired access tokens are refreshed (rotated refresh token
 * persisted first); a 401 refreshes and retries exactly once. Errors are normalized with fixed messages.
 */
export const FLAIM_READ_TOOLS = Object.freeze(["get_user_session", "get_league_info", "get_roster", "get_standings", "get_matchups", "get_free_agents", "get_transactions"]);
export const MCP_PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 25000;
const MAX_RESPONSE = 8 * 1024 * 1024;
const EXPIRY_SKEW_MS = 60 * 1000;

const transport = (message, code = "PROVIDER_UNAVAILABLE") => new ProviderError(code, "espn", `Flaim ${message}`);

/** The JSON-RPC message answering `id` from a JSON or SSE body (data lines may be split across `data:` lines per event). */
export function parseMcpBody(text, contentType, id) {
  if (/text\/event-stream/i.test(contentType || "")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      let msg; try { msg = JSON.parse(data); } catch { continue; }
      if (msg?.id === id) return msg;
    }
    return null;
  }
  let msg; try { msg = JSON.parse(text); } catch { return null; }
  if (Array.isArray(msg)) return msg.find(m => m?.id === id) ?? null;
  return msg?.id === id ? msg : null;
}

/** A tool result → its payload object (`structuredContent`, else the JSON text content). Tool-level errors are normalized. */
export function toolPayload(result, name) {
  if (!result || typeof result !== "object") throw transport(`returned no result for ${name}.`);
  if (result.isError === true) throw transport(`reported an error for ${name}.`, "PROVIDER_UNAVAILABLE");
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = Array.isArray(result.content) ? result.content.find(c => c?.type === "text")?.text : null;
  try { const value = JSON.parse(text); if (value && typeof value === "object") return value; } catch { /* below */ }
  throw transport(`returned an unreadable result for ${name}.`);
}

/**
 * `authPath`: the `flaim-auth-1` file. `fetcher` / `now` are injectable for tests. Refreshes are serialized in-process and
 * always start from the file on disk, so a token rotated by another process (for example `flaim:connect`) is picked up.
 */
export function createFlaimMcpClient({ authPath, root = process.cwd(), fetcher = fetch, now = Date.now, read = readFlaimAuth, write = writeFlaimAuth } = {}) {
  let refreshing = null, rpcId = 0, sessionId = null, initializing = null;
  const load = () => read(authPath, { root });
  async function refresh(stale) {
    refreshing ??= (async () => {
      const auth = load();
      // Another caller or process already rotated the tokens: use the newer ones.
      if (stale && auth.access_token !== stale && Date.parse(auth.access_expires_at) - now() > EXPIRY_SKEW_MS) return auth;
      const tokens = await refreshTokens({ token_endpoint: auth.token_endpoint }, { clientId: auth.client_id, refreshToken: auth.refresh_token }, { fetcher, now });
      // Persist the rotated refresh token before anything uses the new access token.
      return write(authPath, { ...auth, ...tokens }, { root, now });
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function token() {
    const auth = load();
    return Date.parse(auth.access_expires_at) - now() > EXPIRY_SKEW_MS ? auth.access_token : (await refresh(auth.access_token)).access_token;
  }
  async function post(body, retried = false) {
    const access = await token();
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${access}`, "mcp-protocol-version": MCP_PROTOCOL_VERSION };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    let res;
    try { res = await fetcher(FLAIM_MCP_URL, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw transport("could not be reached."); }
    if (res.status === 401) {
      if (retried) throw authRequired("Flaim did not accept the refreshed authorization.");
      await refresh(access);
      return post(body, true);
    }
    if (res.status === 403) throw new FlaimAuthError("AUTH_FAILED", "Flaim refused access for this authorization (insufficient scope or a revoked connection).");
    if (res.status === 429) throw transport("rate-limited the request; try again shortly.", "RATE_LIMITED");
    if (res.status === 404 && sessionId) { sessionId = null; initializing = null; }
    if (!res.ok) throw transport(`returned HTTP ${res.status}.`);
    sessionId = res.headers.get("mcp-session-id") ?? sessionId;
    if (!("id" in body)) return null;
    let text;
    try { text = await res.text(); } catch { throw transport("response could not be read."); }
    if (text.length > MAX_RESPONSE) throw transport("returned an oversized response.");
    const msg = parseMcpBody(text, res.headers.get("content-type"), body.id);
    if (!msg) throw transport("returned no matching JSON-RPC response.");
    if (msg.error) throw transport(`returned a JSON-RPC error (${Number.isInteger(msg.error.code) ? msg.error.code : "unknown"}).`);
    return msg.result;
  }
  const rpc = (method, params = {}) => post({ jsonrpc: "2.0", id: ++rpcId, method, params });
  function initialize() {
    initializing ??= (async () => {
      const result = await rpc("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "fantasy-dashboard", version: "1" } });
      if (!result || typeof result.protocolVersion !== "string") throw transport("did not complete MCP initialization.");
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch(error => { initializing = null; throw error; });
    return initializing;
  }
  return {
    /** Calls one allowed read-only tool and returns its payload object. */
    async callTool(name, args = {}) {
      if (!FLAIM_READ_TOOLS.includes(name)) throw transport(`tool ${JSON.stringify(String(name).slice(0, 40))} is not an allowed read-only operation.`, "UNSUPPORTED_FEATURE");
      await initialize();
      return toolPayload(await rpc("tools/call", { name, arguments: args }), name);
    },
    /** Starts a new MCP handshake on the next call (used per league load). */
    reset() { initializing = null; sessionId = null; },
  };
}
