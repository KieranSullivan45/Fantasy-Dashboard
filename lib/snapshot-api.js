import { getConfiguredLeagueIds } from "./config.js";
import { loadFantasySnapshot } from "./providers/index.js";
import { getProvider, requestProvider, isPrivateProvider } from "./providers/index.js";
import { ProviderError, providerErrorResponse } from "./providers/contracts.js";
import { privateRequest, privateIdentity, validPrivateLeagueId } from "./private/guard.js";
import { compactSnapshot } from "./compact.js";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";

export async function handleSnapshotRequest(request, { buildSnapshot = loadFantasySnapshot, leagueIds = getConfiguredLeagueIds() } = {}) {
  const { searchParams } = new URL(request.url);
  const principal = privateRequest(request);
  let provider; try { provider = requestProvider(searchParams, { privateRequest: principal }); } catch(e) { return providerErrorResponse(e); }
  if (principal && isPrivateProvider(provider)) return privateSnapshot(provider, searchParams, principal);
  const requested = searchParams.get("league") || leagueIds[0];
  const compact = searchParams.get("compact") !== "0";
  if (requested !== "all" && !acceptedLeague(requested, leagueIds)) return Response.json({ error: "Invalid or missing league id", configured_league_ids: leagueIds }, { status: 400 });
  let identity;
  try { identity = requestIdentity(searchParams, requested, leagueIds); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  const build = async id => {
    const selected = requested === "all" ? requestIdentity(searchParams, id, leagueIds) : identity;
    const snapshot = await buildSnapshot(id, { freeAgentLimit: compact ? 35 : 100, ...selected, provider: provider.providerId });
    return compact ? compactSnapshot(snapshot) : snapshot;
  };
  try {
    const data = requested === "all" ? { schema_version: "0.2", leagues: await Promise.all(leagueIds.map(build)) } : await build(requested);
    return Response.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error", league_id: requested }, { status: 502 });
  }
}

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
/** Local private mode (ADR 0005): the configured ESPN league only, never publicly cached, errors never echo internals. */
async function privateSnapshot(provider, params, principal) {
  const league = params.get("league"), compact = params.get("compact") !== "0";
  if (!validPrivateLeagueId(league)) return Response.json({ error: "Provide the private ESPN league id" }, { status: 400, headers: PRIVATE });
  let identity;
  try { identity = privateIdentity(params, principal); } catch (e) { return Response.json({ error: e.message }, { status: 400, headers: PRIVATE }); }
  try {
    const snapshot = await provider.getSnapshot(league, { rosterId: identity.rosterId, season: identity.season });
    return Response.json(compact ? compactSnapshot(snapshot) : snapshot, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof ProviderError) { const response = providerErrorResponse(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
    return Response.json({ error: "Private league data could not be loaded." }, { status: 502, headers: PRIVATE });
  }
}
