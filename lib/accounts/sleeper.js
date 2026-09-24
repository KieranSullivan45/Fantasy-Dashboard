export const validLeagueId = id => /^\d{6,25}$/.test(String(id || ""));
export const validUserId = id => /^\d{6,25}$/.test(String(id || ""));
export function resolveSeason(value, state, now = new Date()) {
  const season = Number(value || process.env.NFL_SEASON || state?.season || now.getUTCFullYear());
  if (!Number.isInteger(season) || season < 2010 || season > now.getUTCFullYear() + 2) throw new Error("Season must be a supported NFL year, no more than two years ahead");
  return season;
}
export async function publicSleeper(path, fetcher = fetch) {
  const response = await fetcher(`https://api.sleeper.app/v1${path}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
  return response.json();
}
export async function discoverSleeper({ username, userId, season, leagueId }, fetchData = publicSleeper) {
  const state = await fetchData("/state/nfl"), selected = resolveSeason(season, state);
  if (leagueId) {
    if (!validLeagueId(leagueId)) throw new Error("Invalid league ID");
    const league = await fetchData(`/league/${leagueId}`);
    if (!league?.league_id || league.sport !== "nfl") throw new Error("NFL league not found");
    return { provider: "sleeper", account: null, season: Number(league.season), current_season: resolveSeason(null, state), leagues: [leagueSummary(league)], mode: "spectator" };
  }
  const input = String(userId || username || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(input)) throw new Error("Enter a valid Sleeper username or user ID");
  const user = await fetchData(`/user/${encodeURIComponent(input)}`);
  if (!user?.user_id) throw new Error("Sleeper user not found");
  const leagues = await fetchData(`/user/${user.user_id}/leagues/nfl/${selected}`);
  if (!Array.isArray(leagues)) throw new Error("League discovery unavailable");
  return { provider: "sleeper", account: { provider_user_id: String(user.user_id), username: user.username, display_name: user.display_name },
    season: selected, current_season: resolveSeason(null, state), leagues: leagues.filter(l => l.sport === "nfl").map(leagueSummary), mode: "account" };
}
const leagueSummary = l => ({ league_id: String(l.league_id), name: l.name, season: Number(l.season), status: l.status, teams: l.total_rosters, previous_league_id: l.previous_league_id || null });
