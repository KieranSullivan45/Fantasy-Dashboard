import { getConfiguredLeagueIds } from "./config.js";
import { decisionService } from "./decision-service.js";
import { gzipSync } from "node:zlib";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";

export function decisionResponse(data, request) {
  const json = JSON.stringify(data);
  const accepted = request.headers.get("Accept-Encoding");
  const codings = Object.fromEntries((accepted || "gzip").split(",").map(part => {
    const [name, ...params] = part.trim().split(";");
    const quality = params.find(p => p.trim().startsWith("q="));
    return [name.toLowerCase(), quality ? Number(quality.trim().slice(2)) : 1];
  }));
  const gzip = (codings.gzip ?? codings["*"] ?? 0) > 0 && Buffer.byteLength(json) > 100000;
  return new Response(gzip ? gzipSync(json) : json, { headers: {
    "Content-Type": "application/json", "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60",
    "Vary": "Accept-Encoding", ...(gzip ? { "Content-Encoding": "gzip" } : {}),
  } });
}

export async function handleDecisionRequest(request, { leagueIds = getConfiguredLeagueIds(), build = decisionService } = {}) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") || leagueIds[0];
  if (!acceptedLeague(league, leagueIds)) return Response.json({ error: "Invalid or missing league id" }, { status: 400 });
  let identity;
  try { identity = requestIdentity(params, league, leagueIds); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  for (const key of ["week", "season"]) {
    const value = params.get(key);
    if (value !== null && (!/^\d+$/.test(value) || (key === "week" ? Number(value) < 1 || Number(value) > 18 : Number(value) < 2000 || Number(value) > 2100))) {
      return Response.json({ error: `Invalid ${key}` }, { status: 400 });
    }
  }
  try {
    const data = await build(league, { identity });
    if (["week", "season"].some(key => params.has(key) && Number(params.get(key)) !== data.league[key])) return Response.json({ error: "Only the current league week is supported; refresh the league snapshot." }, { status: 409 });
    return decisionResponse(data, request);
  } catch {
    return Response.json({ error: "Decision support could not load league data. The league snapshot remains available.", league_id: league }, { status: 502 });
  }
}
