import { getConfiguredLeagueIds } from "./config.js";
import { decisionService } from "./decision-service.js";
import { gzipSync } from "node:zlib";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";
import { getProvider, requestProvider, isPrivateProvider } from "./providers/index.js";
import { privateRequest, privateIdentity, validPrivateLeagueId } from "./private/guard.js";
import { ProviderError, providerErrorResponse } from "./providers/contracts.js";

export function decisionResponse(data, request, { privateData = false } = {}) {
  const json = JSON.stringify(data);
  const accepted = request.headers.get("Accept-Encoding");
  const codings = Object.fromEntries((accepted || "gzip").split(",").map(part => {
    const [name, ...params] = part.trim().split(";");
    const quality = params.find(p => p.trim().startsWith("q="));
    return [name.toLowerCase(), quality ? Number(quality.trim().slice(2)) : 1];
  }));
  const gzip = (codings.gzip ?? codings["*"] ?? 0) > 0 && Buffer.byteLength(json) > 100000;
  return new Response(gzip ? gzipSync(json) : json, { headers: {
    "Content-Type": "application/json", "Cache-Control": privateData ? "private, no-store" : "public, s-maxage=60, stale-while-revalidate=60",
    "Vary": "Accept-Encoding", ...(gzip ? { "Content-Encoding": "gzip" } : {}),
  } });
}

export async function handleDecisionRequest(request, options = {}) {
  const state = {}, response = await decisionRequest(request, options, state);
  if (state.privateData) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function decisionRequest(request, { leagueIds = getConfiguredLeagueIds(), build = decisionService } = {}, state) {
  const params = new URL(request.url).searchParams;
  const principal = privateRequest(request);
  let provider; try { provider = requestProvider(params, { privateRequest: principal }); } catch(e) { return providerErrorResponse(e); }
  const privateData = state.privateData = !!principal && isPrivateProvider(provider), noStore = { "Cache-Control": "private, no-store" };
  const league = params.get("league") || (privateData ? null : leagueIds[0]);
  if (privateData && !validPrivateLeagueId(league)) return Response.json({ error: "Provide the private ESPN league id" }, { status: 400, headers: noStore });
  if (!privateData && !acceptedLeague(league, leagueIds)) return Response.json({ error: "Invalid or missing league id" }, { status: 400 });
  let identity;
  try { identity = privateData ? privateIdentity(params, principal) : requestIdentity(params, league, leagueIds); } catch (e) { return Response.json({ error: e.message }, { status: 400, ...(privateData ? { headers: noStore } : {}) }); }
  for (const key of ["week", "season"]) {
    const value = params.get(key);
    if (value !== null && (!/^\d+$/.test(value) || (key === "week" ? Number(value) < 1 || Number(value) > 18 : Number(value) < 2000 || Number(value) > 2100))) {
      return Response.json({ error: `Invalid ${key}` }, { status: 400, ...(privateData ? { headers: noStore } : {}) });
    }
  }
  try {
    // Private inputs are re-validated and identified before any cache lookup, so a changed or invalid config never gets a stale result.
    const revision = privateData ? await provider.getInputRevision() : null;
    const data = await build(league, { identity, provider: provider.providerId, ...(privateData ? { providerAdapter: provider, revision } : {}) });
    if (["week", "season"].some(key => params.has(key) && Number(params.get(key)) !== data.league[key])) return Response.json({ error: "Only the current league week is supported; refresh the league snapshot." }, { status: 409, ...(privateData ? { headers: noStore } : {}) });
    return decisionResponse(data, request, { privateData });
  } catch (error) {
    // Normalized provider refusals (e.g. UNSUPPORTED_FEATURE for missing league scoring) keep their code, as in /api/trade.
    if (error instanceof ProviderError) return providerErrorResponse(error);
    return Response.json({ error: "Decision support could not load league data. The league snapshot remains available.", ...(privateData ? {} : { league_id: league }) }, { status: 502, ...(privateData ? { headers: noStore } : {}) });
  }
}
