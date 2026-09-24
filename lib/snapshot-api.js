import { getConfiguredLeagueIds } from "./config.js";
import { buildLeagueSnapshot } from "./sleeper.js";
import { compactSnapshot } from "./compact.js";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";

export async function handleSnapshotRequest(request, { buildSnapshot = buildLeagueSnapshot, leagueIds = getConfiguredLeagueIds() } = {}) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("league") || leagueIds[0];
  const compact = searchParams.get("compact") !== "0";
  if (requested !== "all" && !acceptedLeague(requested, leagueIds)) return Response.json({ error: "Invalid or missing league id", configured_league_ids: leagueIds }, { status: 400 });
  let identity;
  try { identity = requestIdentity(searchParams, requested, leagueIds); } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  const build = async id => {
    const selected = requested === "all" ? requestIdentity(searchParams, id, leagueIds) : identity;
    const snapshot = await buildSnapshot(id, { freeAgentLimit: compact ? 35 : 100, ...selected });
    return compact ? compactSnapshot(snapshot) : snapshot;
  };
  try {
    const data = requested === "all" ? { schema_version: "0.2", leagues: await Promise.all(leagueIds.map(build)) } : await build(requested);
    return Response.json(data, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error", league_id: requested }, { status: 502 });
  }
}
