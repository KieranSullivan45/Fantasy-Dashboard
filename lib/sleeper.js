import { getConfiguredUsername } from "./config.js";
import {
  buildFreeAgents,
  buildRosterViews,
  buildStandings,
  summarizeTransactions,
  trimFreeAgents,
} from "./derive.js";

const API = "https://api.sleeper.app/v1";

async function sleeperFetch(path, revalidate = 60) {
  const response = await fetch(`${API}${path}`, {
    next: { revalidate },
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Sleeper request failed (${response.status}) for ${path}`);
  }
  return response.json();
}

export async function buildLeagueSnapshot(leagueId, { freeAgentLimit = 50 } = {}) {
  const username = getConfiguredUsername();

  const [user, league, rosters, users, state, players, trending] = await Promise.all([
    sleeperFetch(`/user/${encodeURIComponent(username)}`, 3600),
    sleeperFetch(`/league/${leagueId}`, 60),
    sleeperFetch(`/league/${leagueId}/rosters`, 30),
    sleeperFetch(`/league/${leagueId}/users`, 300),
    sleeperFetch(`/state/nfl`, 300),
    sleeperFetch(`/players/nfl`, 86400),
    sleeperFetch(`/players/nfl/trending/add?lookback_hours=24&limit=100`, 300),
  ]);

  if (!user?.user_id) throw new Error(`Sleeper user @${username} was not found.`);
  if (!league?.league_id) throw new Error(`Sleeper league ${leagueId} was not found.`);

  const currentWeek = Number(state.leg || state.week || 1);
  const rounds = [...new Set([Math.max(1, currentWeek - 1), currentWeek])];
  const transactionLists = await Promise.all(
    rounds.map((round) => sleeperFetch(`/league/${leagueId}/transactions/${round}`, 30).catch(() => []))
  );
  const matchups = await sleeperFetch(`/league/${leagueId}/matchups/${currentWeek}`, 30).catch(() => []);

  const rosterViews = buildRosterViews({
    rosters,
    users,
    players,
    userId: user.user_id,
  });
  const myRoster = rosterViews.find((r) => r.is_user) || null;
  const freeAgents = buildFreeAgents({ players, rosters, trending });
  const transactions = summarizeTransactions({
    transactions: transactionLists.flat(),
    players,
    rosterViews,
  }).slice(0, 40);

  return {
    generated_at: new Date().toISOString(),
    source: "Sleeper",
    league: {
      league_id: league.league_id,
      name: league.name,
      season: league.season,
      status: league.status,
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
    trending_available: trending
      .map((item) => {
        const player = freeAgents.QB.concat(freeAgents.RB, freeAgents.WR, freeAgents.TE, freeAgents.K, freeAgents.DEF)
          .find((p) => p.player_id === String(item.player_id));
        return player ? { ...player, count: item.count } : null;
      })
      .filter(Boolean)
      .slice(0, 25),
    recent_transactions: transactions,
    current_matchups: matchups,
  };
}
