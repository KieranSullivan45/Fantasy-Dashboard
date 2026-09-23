import { getConfiguredLeagueIds } from "./config.js";
import { buildDecisionContext } from "./decision/build-context.js";

export async function handleDecisionRequest(request, { leagueIds = getConfiguredLeagueIds(), build = buildDecisionContext } = {}) {
  const params = new URL(request.url).searchParams;
  const league = params.get("league") || leagueIds[0];
  if (!leagueIds.includes(league)) return Response.json({ error: "Unknown league id" }, { status: 400 });
  for (const key of ["week", "season"]) {
    const value = params.get(key);
    if (value !== null && (!/^\d+$/.test(value) || (key === "week" ? Number(value) < 1 || Number(value) > 18 : Number(value) < 2000 || Number(value) > 2100))) {
      return Response.json({ error: `Invalid ${key}` }, { status: 400 });
    }
  }
  try {
    const data = await build(league);
    if (["week", "season"].some(key => params.has(key) && Number(params.get(key)) !== data.league[key])) return Response.json({ error: "Only the current league week is supported; refresh the league snapshot." }, { status: 409 });
    return Response.json(data, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
  } catch {
    return Response.json({ error: "Decision support could not load league data. The league snapshot remains available.", league_id: league }, { status: 502 });
  }
}
