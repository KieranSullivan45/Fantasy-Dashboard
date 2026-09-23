import { loadSleeperContext } from "../sources/sleeper/index.js";
import { loadStats } from "../sources/stats/nflverse.js";
import { loadSchedules } from "../sources/schedules/nflverse.js";
import { loadPlayerIds, playerIdMap } from "../normalize/player-ids.js";
import { scoringProfile } from "../normalize/scoring.js";
import { unavailableSource } from "../sources/contracts.js";
import { buildProduction } from "./production.js";
import { normalizeSchedule, upcomingGame } from "./schedule.js";
import { buildMatchupDifficulty } from "./matchup-difficulty.js";
import { weeklyMatchup } from "./weekly-matchup.js";
import { teamStrength, playerValue } from "./team-strength.js";
import { waiverRecommendations } from "./waiver-score.js";
import { decisionBasis } from "./basis.js";

export async function buildDecisionContext(leagueId, {
  loadLeague = loadSleeperContext, statsSource = loadStats, scheduleSource = loadSchedules,
  idsSource = loadPlayerIds, now = Date.now(), limit = 20,
} = {}) {
  const snapshot = await loadLeague(leagueId);
  const season = Number(snapshot.league.season), week = snapshot.matchup_week;
  const currentRegular = week !== null && snapshot.nfl_state.season_type === "regular";
  const optional = async (name, task) => { try { return await task(); } catch (error) { return unavailableSource(name, error.message); } };
  const [stats, schedules, ids] = await Promise.all([
    currentRegular ? optional("nflverse_stats", () => statsSource(season)) : unavailableSource("nflverse_stats", "Historical metrics require a current regular-season league.", "unsupported"),
    optional("nflverse_schedule", scheduleSource), optional("ffverse_ids", idsSource),
  ]);
  const schedule = normalizeSchedule(schedules.data, season);
  const idMap = playerIdMap(ids.data);
  const production = buildProduction(stats.data, idMap.map, { season, week: currentRegular ? week : 0, settings: snapshot.league.scoring_settings });
  const difficulty = buildMatchupDifficulty(production.games, schedule, currentRegular ? week : 0);
  const freeAgents = Object.values(snapshot.free_agents).flat();
  const players = new Map([...freeAgents, ...snapshot.rosters.flatMap(r => r.all_players), ...snapshot.matchup_players].map(p => [p.player_id, p]));
  const contexts = Object.fromEntries([...players.values()].map(player => {
    const upcoming = currentRegular ? upcomingGame(player.team, schedule, week, now) : { status: "unavailable", opponent: null, kickoff: null };
    const match = difficulty[player.position]?.[upcoming.opponent];
    return [player.player_id, { player: { player_id: player.player_id, name: player.name, position: player.position, team: player.team, injury_status: player.injury_status, status: player.status },
      production: production.players[player.player_id] || null, schedule: upcoming,
      matchup: match ? Object.fromEntries(Object.entries(match).filter(([key]) => key !== "game_values")) : null,
      rankings: { average_rank: null, source_count: 0, sources: [] }, projection: null,
      ownership: { percent: null, platform: null, change_percentage_points: null },
      interest: { sleeper_adds_24h: player.trending_adds_24h || 0, meaning: "Adds across Sleeper; not ownership percentage or usage growth" },
      value_profile: playerValue(player, production.players[player.player_id]) }];
  }));
  const slots = snapshot.league.roster_positions.filter(p => !["BN", "IR", "TAXI"].includes(p));
  const strengths = snapshot.rosters.map(roster => teamStrength(roster, slots, production.players, freeAgents));
  const waivers = waiverRecommendations(freeAgents, contexts, strengths, snapshot.my_roster?.roster_id, [...players.values()], limit);
  const matchup = weeklyMatchup(snapshot);
  for (const team of matchup.teams) {
    const starterContexts = team.starters.filter(s => s.player_id).map(s => contexts[s.player_id]?.schedule);
    team.scheduled_later = schedules.status === "available" && starterContexts.every(Boolean) ? starterContexts.filter(s => s.status === "scheduled").length : null;
    team.schedule_note = "Scheduled later counts use kickoff times, not live game status. Remaining players is unavailable.";
  }
  const selected = new Set([...snapshot.rosters.flatMap(r => r.all_players.map(p => p.player_id)), ...snapshot.matchup_players.map(p => p.player_id),
    ...Object.values(snapshot.free_agents).flatMap(group => group.slice(0, 20).map(p => p.player_id)),
    ...waivers.recommendations.map(p => p.player_id), ...waivers.limited_candidates.map(p => p.player_id)]);
  const warnings = snapshot.warnings.map(w => w.message);
  const unsupported = [...new Set(production.games.flatMap(g => g.scoring.unsupported_rules))];
  if (unsupported.length) warnings.push(`Historical points use supported rules only. Unsupported: ${unsupported.join(", ")}.`);
  if (production.unmatched_ids.length) warnings.push(`${production.unmatched_ids.length} statistical player IDs could not be mapped; no name guesses were made.`);
  if (idMap.ambiguous.length) warnings.push(`${idMap.ambiguous.length} ambiguous ID mappings were excluded.`);
  const throughWeek = Math.max(0, ...production.games.map(g => g.week));
  if (currentRegular && week > 1 && throughWeek < week - 1) warnings.push(`Statistics are available through week ${throughWeek}; expected prior week ${week - 1}.`);
  const sources = [stats, schedules, ids].map(({ data, ...source }) => ({ ...source, records: data.length }));
  sources.push(...["rankings", "projections", "ownership"].map(id => {
    const { data, ...status } = unavailableSource(id, "No permitted provider configured; values remain null.", "unsupported");
    return { ...status, records: 0 };
  }));
  for (const source of sources.filter(s => s.status === "unavailable")) warnings.push(`${source.source_id}: ${source.warnings.join(" ")}`);
  return { schema_version: "0.3", generated_at: new Date(now).toISOString(),
    league: { league_id: snapshot.league.league_id, name: snapshot.league.name, season, week,
      roster_positions: snapshot.league.roster_positions, scoring_settings: snapshot.league.scoring_settings, settings: snapshot.league.settings },
    basis: decisionBasis(snapshot), my_roster_id: snapshot.my_roster?.roster_id ?? null,
    scoring: { profile: scoringProfile(snapshot.league.scoring_settings), unsupported_rules: unsupported,
      unsupported_positions: ["DEF", "IDP"], historical_scope: "Prior regular-season weeks only; PPG uses recorded statistical appearances, not assumed participation.", through_week: throughWeek },
    matchup, player_context: Object.fromEntries([...selected].filter(id => contexts[id]).map(id => [id, contexts[id]])),
    matchup_difficulty: difficulty, team_strength: strengths, waivers, sources, partial: warnings.length > 0, warnings,
    coverage: { eligible_pool: freeAgents.length, context_players: selected.size, context_omitted: Math.max(0, players.size - selected.size),
      statistics_through_week: throughWeek, unmatched_statistical_ids: production.unmatched_ids.length, ownership_history: "deferred" } };
}
