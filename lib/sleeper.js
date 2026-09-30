import { getConfiguredLeagueIds, getConfiguredUsername } from "./config.js";
import { createSleeperInputs } from "./sources/sleeper/inputs.js";
import {
  buildFreeAgents,
  buildRosterViews,
  buildStandings,
  summarizeTransactions,
  trimFreeAgents,
  normalizePlayer,
} from "./derive.js";

const API = "https://api.sleeper.app/v1";

// Username -> stable user id is identity resolution, not league evidence; it keeps Next's fetch revalidation.
async function sleeperUserFetch(path, revalidate = 3600) {
  const response = await fetch(`${API}${path}`, { next: { revalidate }, signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Sleeper user lookup failed (${response.status})`);
  return response.json();
}

/** Process-local coordinator for public Sleeper league inputs (ADR 0008). Installation leagues are never evicted. */
export const sleeperInputs = createSleeperInputs({ isPinned: id => getConfiguredLeagueIds().includes(id) });

/**
 * Snapshot 0.2 for one league. League evidence comes from the committed Sleeper bundle: `inputs` (a pinned bundle from
 * `sleeperInputs.ensure`), a one-shot coordinator over an injected `fetchData` (tests/scripts; no shared state and no
 * freshness claim), or the process coordinator.
 */
export async function buildLeagueSnapshot(leagueId, { freeAgentLimit = 50, fetchData = null, inputs = null, coordinator = sleeperInputs, userId = getConfiguredUsername() || null, rosterId = null, season = null } = {}) {
  const username = userId;
  const direct = !inputs && !!fetchData;
  const [user, committed] = await Promise.all([
    username ? (fetchData ?? sleeperUserFetch)(`/user/${encodeURIComponent(username)}`, 3600) : Promise.resolve(null),
    inputs ?? (direct ? createSleeperInputs({ fetchData: path => fetchData(path) }).ensure(leagueId) : coordinator.ensure(leagueId)),
  ]);
  if (username && !user?.user_id) throw new Error(`Sleeper user ${username} was not found.`);
  if (String(committed.league_id) !== String(leagueId)) throw new Error("Sleeper league mismatch");
  return snapshotFromInputs(committed, { freeAgentLimit, user, rosterId, season, freshness: direct ? null : committed.freshness });
}

function snapshotFromInputs(committed, { freeAgentLimit, user, rosterId, season, freshness }) {
  const warnings = [];
  const unavailable = resource => warnings.push({ code: "UPSTREAM_UNAVAILABLE", resource, message: `${resource} could not be loaded; empty results do not mean no activity.` });
  // Committed values are shared and immutable; derivation works on copies (the large catalog is read-only, as before).
  const bundle = committed.bundle, players = bundle.players;
  const { league, rosters, users, state, trending: rawTrending, transactions: rawTransactions, matchups: rawMatchups } = structuredClone({
    league: bundle.league, rosters: bundle.rosters, users: bundle.users, state: bundle.state, trending: bundle.trending, transactions: bundle.transactions, matchups: bundle.matchups });
  const trending = rawTrending ?? (unavailable("trending"), []);
  if (season != null && Number(league.season) !== Number(season)) throw new Error("League belongs to another season; discover a league for the selected season");

  const sameSeason = String(league.season) === String(state.season);
  if (!sameSeason) warnings.push({ code: "SEASON_MISMATCH", resource: "league", message: "This league is not in the current NFL season; current-week transactions and matchups are unavailable." });
  const rounds = rawTransactions.map(item => item.round);
  const transactionLists = rawTransactions.map(item => item.value ?? (unavailable(`transactions/week/${item.round}`), []));
  const matchups = bundle.matchup_week == null ? [] : rawMatchups ?? (unavailable("matchups"), []);

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
    matchup_week: bundle.matchup_week,
    matchup_players: matchupIds.map(id => normalizePlayer(id, players)),
    current_matchups: matchups,
    coverage: { transaction_weeks: rounds, transaction_statuses: ["complete", "pending"], trending_upstream_limit: 100, player_cache_seconds: 86400, waiver_policy: "current-nfl-assets-v1",
      // Additive (SLEEPER-REFRESH-01): the committed input bundle this snapshot was derived from, and per-resource sync state.
      input_revision: committed.revision, ...(freshness ? { freshness } : {}) },
    truncation: {
      free_agents: Object.fromEntries(Object.entries(freeAgents).map(([position, group]) => [position, count(group.length, freeAgentLimit)])),
      recent_transactions: count(transactions.length, 40),
      trending_available: count(trendingAvailable.length, 25),
    },
    partial: warnings.length > 0,
    warnings: warnings.sort((a, b) => a.resource.localeCompare(b.resource)),
  };
}
