import { getConfiguredUsername } from "./config.js";
import { createPlayerCache } from "./sources/sleeper/player-cache.js";
import {
  buildFreeAgents,
  buildRosterViews,
  buildStandings,
  summarizeTransactions,
  trimFreeAgents,
  normalizePlayer,
} from "./derive.js";

const API = "https://api.sleeper.app/v1";
const playerCatalog = createPlayerCache();

async function sleeperFetch(path, revalidate = 60) {
  if (path === "/players/nfl") return playerCatalog(async () => {
    const response = await fetch(`${API}${path}`, { cache: "no-store", signal: AbortSignal.timeout(20000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Sleeper player request failed (${response.status})`);
    return response.json();
  });
  const response = await fetch(`${API}${path}`, {
    next: { revalidate },
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Sleeper request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

export async function buildLeagueSnapshot(leagueId, { freeAgentLimit = 50, fetchData = sleeperFetch, userId = getConfiguredUsername() || null, rosterId = null, season = null } = {}) {
  const username = userId;
  const warnings = [];
  async function optional(path, revalidate, resource) {
    try {
      const result = await fetchData(path, revalidate);
      if (!Array.isArray(result)) throw new Error("Expected an array");
      return result;
    } catch {
      warnings.push({ code: "UPSTREAM_UNAVAILABLE", resource, message: `${resource} could not be loaded; empty results do not mean no activity.` });
      return [];
    }
  }

  const [user, league, rosters, users, state, players, trending] = await Promise.all([
    username ? fetchData(`/user/${encodeURIComponent(username)}`, 3600) : Promise.resolve(null),
    fetchData(`/league/${leagueId}`, 60),
    fetchData(`/league/${leagueId}/rosters`, 30),
    fetchData(`/league/${leagueId}/users`, 300),
    fetchData(`/state/nfl`, 300),
    fetchData(`/players/nfl`, 86400),
    optional(`/players/nfl/trending/add?lookback_hours=24&limit=100`, 300, "trending"),
  ]);

  if (username && !user?.user_id) throw new Error(`Sleeper user ${username} was not found.`);
  if (!league?.league_id) throw new Error(`Sleeper league ${leagueId} was not found.`);
  if (!Array.isArray(rosters) || !Array.isArray(users) || !players || Array.isArray(players) || !state?.season) throw new Error("Invalid core Sleeper data");
  if (String(league.league_id) !== String(leagueId)) throw new Error("Sleeper league mismatch");
  if (season != null && Number(league.season) !== Number(season)) throw new Error("League belongs to another season; discover a league for the selected season");
  if (league.sport && league.sport !== "nfl") throw new Error("Only NFL leagues are supported");

  const currentWeek = Math.max(1, Number(state.leg || state.week || 1));
  const sameSeason = String(league.season) === String(state.season);
  if (!sameSeason) warnings.push({ code: "SEASON_MISMATCH", resource: "league", message: "This league is not in the current NFL season; current-week transactions and matchups are unavailable." });
  const rounds = sameSeason ? [...new Set([Math.max(1, currentWeek - 1), currentWeek])] : [];
  const transactionLists = await Promise.all(
    rounds.map((round) => optional(`/league/${leagueId}/transactions/${round}`, 30, `transactions/week/${round}`))
  );
  const matchups = sameSeason ? await optional(`/league/${leagueId}/matchups/${currentWeek}`, 30, "matchups") : [];

  const rosterViews = buildRosterViews({
    rosters,
    users,
    players,
    userId: user?.user_id ?? null,
    rosterPositions: league.roster_positions || [],
  });
  const freeAgents = buildFreeAgents({ players, rosters, trending, rosterPositions: league.roster_positions });
  const transactions = summarizeTransactions({
    transactions: transactionLists.flat(),
    players,
    rosterViews,
  });
  if (rosterId != null) {
    if (!rosterViews.some(r => r.roster_id === rosterId)) throw new Error("Selected roster does not exist in this league");
    for (const roster of rosterViews) roster.is_user = roster.roster_id === rosterId;
  }
  const myRoster = rosterViews.find((r) => r.is_user) || null;
  const availableById = new Map(Object.values(freeAgents).flat().map(player => [player.player_id, player]));
  const trendingAvailable = trending.flatMap(item => {
    const player = availableById.get(String(item.player_id));
    return player ? [{ ...player, count: item.count }] : [];
  });
  const matchupIds = [...new Set(matchups.flatMap(m => [...(m.players || []), ...(m.starters || []), ...Object.keys(m.players_points || {})]).filter(id => id != null && String(id) !== "0").map(String))];
  const missing = [...new Set([...rosterViews.flatMap(r => r.all_players.map(p => p.player_id)), ...matchupIds,
    ...transactions.flatMap(tx => [...tx.adds, ...tx.drops].map(item => item.player.player_id))])].filter(id => !players[id]);
  if (missing.length) warnings.push({ code: "MISSING_PLAYER_METADATA", resource: "players", player_ids: missing, message: "Some player identities could not be resolved; IDs are preserved." });
  const count = (total, limit) => ({ total, returned: Math.min(total, limit), omitted: Math.max(0, total - limit), limit });

  return {
    schema_version: "0.2",
    view: "full",
    generated_at: new Date().toISOString(),
    source: "Sleeper",
    identity: { provider: "sleeper", provider_user_id: user?.user_id ?? null, selected_roster_id: myRoster?.roster_id ?? null, mode: rosterId != null ? "selected_roster" : myRoster ? "account" : "spectator" },
    league: {
      league_id: league.league_id,
      name: league.name,
      season: league.season,
      status: league.status,
      sport: league.sport,
      season_type: league.season_type,
      total_rosters: league.total_rosters,
      roster_positions: league.roster_positions,
      scoring_settings: league.scoring_settings,
      settings: league.settings,
    },
    nfl_state: {
      season: state.season,
      season_type: state.season_type,
      week: state.week,
      leg: state.leg,
      display_week: state.display_week,
    },
    my_roster: myRoster,
    rosters: rosterViews,
    standings: buildStandings(rosterViews),
    free_agents: trimFreeAgents(freeAgents, freeAgentLimit),
    trending_available: trendingAvailable.slice(0, 25),
    recent_transactions: transactions.slice(0, 40),
    matchup_week: sameSeason ? currentWeek : null,
    matchup_players: matchupIds.map(id => normalizePlayer(id, players)),
    current_matchups: matchups,
    coverage: { transaction_weeks: rounds, transaction_statuses: ["complete", "pending"], trending_upstream_limit: 100, player_cache_seconds: 86400, waiver_policy: "current-nfl-assets-v1" },
    truncation: {
      free_agents: Object.fromEntries(Object.entries(freeAgents).map(([position, group]) => [position, count(group.length, freeAgentLimit)])),
      recent_transactions: count(transactions.length, 40),
      trending_available: count(trendingAvailable.length, 25),
    },
    partial: warnings.length > 0,
    warnings: warnings.sort((a, b) => a.resource.localeCompare(b.resource)),
  };
}
