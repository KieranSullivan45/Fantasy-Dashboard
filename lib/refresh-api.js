// POST /api/refresh (SLEEPER-REFRESH-01, ADR 0008): user-initiated refresh of public Sleeper league inputs.
// Read-only toward Sleeper, no-store, no history/archive write and no recommendation or prediction of record. It only
// refreshes the process-local committed inputs and returns the snapshot derived from them; it never runs a decision or trade.
import { getConfiguredLeagueIds } from "./config.js";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";
import { requestProvider, isPrivateProvider } from "./providers/index.js";
import { privateRequest, privateIdentity, validPrivateLeagueId } from "./private/guard.js";
import { ProviderError, providerErrorResponse } from "./providers/contracts.js";
import { SleeperResourceError } from "./sources/sleeper/inputs.js";

export const REFRESH_REQUEST_KEYS = Object.freeze(["provider", "league", "user", "roster", "season", "mode"]);
/** manual: force dynamic league resources (bounded by the coordinator's cooldown). due: refresh only resources past their window. */
export const REFRESH_MODES = Object.freeze(["manual", "due"]);
const CORE = ["league", "users", "rosters", "state", "players"];
const MAX_BODY_BYTES = 2048;
const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const reject = (error, status = 400, extra = {}) => Response.json({ error, ...extra }, { status, headers: NO_STORE });
const IDENTITY_ERRORS = /another season|does not exist in this league|was not found/;

async function readRequest(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return { response: reject("Content-Type must be application/json", 415) };
  let text;
  try { text = await request.text(); } catch { return { response: reject("Request body could not be read") }; }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { response: reject("Request body is too large", 413) };
  let body;
  try { body = JSON.parse(text); } catch { return { response: reject("Request body must be JSON") }; }
  if (!isObject(body)) return { response: reject("Request body must be a JSON object") };
  const unknown = Object.keys(body).filter(k => !REFRESH_REQUEST_KEYS.includes(k)).sort();
  if (unknown.length) return { response: reject(`Unknown refresh request field(s): ${unknown.join(", ")}.`) };
  const params = new URLSearchParams();
  for (const key of ["provider", "league", "user", "roster", "season"]) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || (["roster", "season"].includes(key) && Number.isSafeInteger(value))) params.set(key, String(value));
    else return { response: reject(`${key} must be a string`) };
  }
  const mode = body.mode ?? "manual";
  if (!REFRESH_MODES.includes(mode)) return { response: reject(`mode must be one of: ${REFRESH_MODES.join(", ")}`) };
  return { params, mode };
}

export async function handleRefreshRequest(request, { leagueIds = getConfiguredLeagueIds(), resolveProvider = requestProvider } = {}) {
  const read = await readRequest(request);
  if (read.response) return read.response;
  const { params, mode } = read;
  // Local private mode (ADR 0005/0013): only a guarded loopback request reaches the private ESPN provider.
  const principal = privateRequest(request);
  let provider; try { provider = resolveProvider(params, { privateRequest: principal }); } catch (e) { return providerErrorResponse(e); }
  if (principal && isPrivateProvider(provider)) return privateRefresh(provider, params, mode, principal);
  if (typeof provider.refreshInputs !== "function") return providerErrorResponse(new ProviderError("UNSUPPORTED_FEATURE", provider.providerId, "Self-service refresh is available for Sleeper leagues only."));
  const league = params.get("league");
  if (!league || !acceptedLeague(league, leagueIds)) return reject("Invalid or missing league id");
  let identity;
  try { identity = requestIdentity(params, league, leagueIds); } catch (e) { return reject(e.message); }

  let committed;
  try { committed = await provider.refreshInputs(league, { force: mode === "manual" }); }
  catch (e) {
    // Every tracked arbitrary league is mid-refresh: refused before any upstream work, retryable.
    if (e instanceof SleeperResourceError && e.code === "CAPACITY") return Response.json({ error: e.message, code: e.code, league_id: league }, { status: 503, headers: { ...NO_STORE, "Retry-After": "10" } });
    // First load with no last-known-good bundle: unavailable, never an empty league. Messages are fixed strings.
    return reject(e instanceof SleeperResourceError ? e.message : "Sleeper league data could not be refreshed.", 502,
      { code: e instanceof SleeperResourceError ? e.code : "PROVIDER_UNAVAILABLE", league_id: league });
  }
  let snapshot;
  try { snapshot = await provider.getSnapshot(league, { ...identity, freeAgentLimit: 100, inputs: committed }); }
  catch (e) {
    const known = e instanceof Error && IDENTITY_ERRORS.test(e.message);
    return reject(known ? e.message : "The refreshed league could not be prepared for this selection.", known ? 422 : 502, { league_id: league });
  }
  const report = committed.report;
  // Status reflects every UNRESOLVED resource (latest attempt failed or fetched-but-not-promoted), not only this call's
  // attempts: an immediate retry that the cooldown/backoff deferred must not read as a success.
  const unresolved = report.unresolved ?? report.failed;
  const status = unresolved.some(name => CORE.includes(name)) ? "failed" : unresolved.length ? "partial" : "ok";
  return Response.json({
    schema_version: "refresh-1", provider: provider.providerId, league_id: league, mode, status,
    served: status === "failed" ? "last_known_good" : "refreshed", guarantee: committed.freshness.guarantee,
    input_revision: committed.revision, previous_input_revision: report.previous_revision,
    revision_changed: report.previous_revision !== null && report.previous_revision !== committed.revision,
    attempted: report.attempted, failed: report.failed,
    unresolved, deferred: report.deferred ?? [], retry_after_seconds: report.retry_after_seconds ?? null, snapshot,
  }, { headers: NO_STORE });
}

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
/**
 * Private ESPN refresh (ADR 0013): reloads live Flaim facts (bounded by the provider's cooldown/TTL) and returns the private
 * snapshot. No history, archive or recommendation write; errors are fixed or normalized messages; always `private, no-store`.
 */
async function privateRefresh(provider, params, mode, principal) {
  const league = params.get("league");
  if (!validPrivateLeagueId(league)) return Response.json({ error: "Provide the private ESPN league id" }, { status: 400, headers: PRIVATE });
  let identity;
  try { identity = privateIdentity(params, principal); } catch (e) { return Response.json({ error: e.message }, { status: 400, headers: PRIVATE }); }
  const fail = error => {
    if (error instanceof ProviderError) { const response = providerErrorResponse(error, 502); response.headers.set("Cache-Control", "private, no-store"); return response; }
    return Response.json({ error: "Private league data could not be refreshed.", code: "PROVIDER_UNAVAILABLE" }, { status: 502, headers: PRIVATE });
  };
  let result, snapshot;
  try { result = await provider.refreshPrivate({ mode }); snapshot = await provider.getSnapshot(league, { rosterId: identity.rosterId, season: identity.season }); }
  catch (e) { return fail(e); }
  return Response.json({ schema_version: "refresh-1", provider: provider.providerId, league_id: league, mode, status: "ok", served: "refreshed", guarantee: null,
    input_revision: null, previous_input_revision: null, revision_changed: result.changed === true, attempted: result.reloaded ? ["league"] : [], failed: [], unresolved: [], deferred: [],
    retry_after_seconds: null, fetched_at: result.fetched_at ?? null, snapshot }, { headers: PRIVATE });
}
