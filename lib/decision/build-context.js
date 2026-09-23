import { loadSleeperContext } from "../sources/sleeper/index.js";
import { loadStats } from "../sources/stats/nflverse.js";
import { loadSchedules } from "../sources/schedules/nflverse.js";
import { loadPlayerIds, playerIdMap } from "../normalize/player-ids.js";
import { scoringProfile } from "../normalize/scoring.js";
import { unavailableSource, normalizeTeam } from "../sources/contracts.js";
import { buildProduction } from "./production.js";
import { normalizeSchedule, upcomingGame } from "./schedule.js";
import { buildMatchupDifficulty } from "./matchup-difficulty.js";
import { weeklyMatchup } from "./weekly-matchup.js";
import { teamStrength, playerValue } from "./team-strength.js";
import { calibratedWaivers } from "./calibrated-waivers.js";
import { playerModels } from "./value-models.js";
import { replacementLevels, valueOverReplacement } from "./replacement.js";
import { adjustedMatchups } from "./adjusted-matchups.js";
import { teamStrengthV2 } from "./team-strength-v2.js";
import { MODEL_VERSION, FEATURE_VERSION } from "./model-config.js";
import { decisionBasis } from "./basis.js";
import { uniquePlayers, fantasyPositions } from "../normalize/positions.js";
import { loadSnaps } from "../sources/usage/nflverse.js";
import { buildAnalytics } from "./analytics.js";
import { interestContext } from "./interest.js";
import { loadOpportunity } from "../sources/usage/opportunity.js";
import { scoreOpportunity } from "../normalize/opportunity.js";

export async function buildDecisionContext(leagueId, {
  loadLeague = loadSleeperContext, statsSource = loadStats, scheduleSource = loadSchedules,
  idsSource = loadPlayerIds, snapSource = loadSnaps, opportunitySource = loadOpportunity, now = Date.now(), limit = 20,
} = {}) {
  const snapshot = await loadLeague(leagueId);
  const season = Number(snapshot.league.season), week = snapshot.matchup_week;
  const currentRegular = week !== null && snapshot.nfl_state.season_type === "regular";
  const optional = async (name, task) => { try { return await task(); } catch (error) { return unavailableSource(name, error.message); } };
  const [stats, schedules, ids, snaps, opportunity, priorStats] = await Promise.all([
    currentRegular ? optional("nflverse_stats", () => statsSource(season)) : unavailableSource("nflverse_stats", "Historical metrics require a current regular-season league.", "unsupported"),
    optional("nflverse_schedule", scheduleSource), optional("ffverse_ids", idsSource),
    currentRegular ? optional("nflverse_snaps", () => snapSource(season)) : unavailableSource("nflverse_snaps", "Current regular season required", "unsupported"),
    currentRegular ? optional("ffopportunity", () => opportunitySource(season)) : unavailableSource("ffopportunity", "Current regular season required", "unsupported"),
    currentRegular ? optional("nflverse_prior_stats", () => statsSource(season - 1)) : unavailableSource("nflverse_prior_stats", "Current regular season required", "unsupported"),
  ]);
  const schedule = normalizeSchedule(schedules.data, season);
  const idMap = playerIdMap(ids.data);
  const freeAgents = uniquePlayers(Object.values(snapshot.free_agents).flat());
  const players = new Map([...freeAgents, ...snapshot.rosters.flatMap(r => r.all_players), ...snapshot.matchup_players].map(p => [p.player_id, p]));
  const production = buildProduction(stats.data, idMap.map, { season, week: currentRegular ? week : 0, settings: snapshot.league.scoring_settings, platformPlayers: players });
  const difficulty = buildMatchupDifficulty(production.games, schedule, currentRegular ? week : 0);
  const adjusted = adjustedMatchups(production.games, difficulty, currentRegular ? week : 0, scoringProfile(snapshot.league.scoring_settings));
  const priorProduction = buildProduction(priorStats.data, idMap.map, { season: season - 1, week: 19, settings: snapshot.league.scoring_settings, platformPlayers: players });
  const analytics = buildAnalytics(stats.data, snaps.data, ids.data, { season, week: currentRegular ? week : 0, production });
  for (const raw of opportunity.data) {
    if (Number(raw.season) !== season || Number(raw.week) >= week || !currentRegular) continue;
    const id = idMap.map.get(raw.player_id), record = analytics.players[id];
    const game = record?.history.find(g => g.game_id === raw.game_id);
    if (!game) continue;
    const position = production.players[id]?.scoring_positions?.[0];
    if (production.players[id]?.missing_stats.includes("ambiguous platform position for reception premium")) continue;
    game.opportunity_model = scoreOpportunity(raw, snapshot.league.scoring_settings, position);
  }
  for (const record of Object.values(analytics.players)) {
    const modeled = record.history.filter(h => h.opportunity_model?.expected_points != null);
    record.xfp = modeled.length ? { average: modeled.reduce((sum, g) => sum + g.opportunity_model.expected_points, 0) / modeled.length, games: modeled.length, through_week: modeled.at(-1).week, status: modeled.some(g => g.opportunity_model.status === "partial") ? "partial" : "complete" } : null;
    record.fantasy_points_over_expected = modeled.length ? { average: modeled.reduce((sum, g) => sum + g.opportunity_model.points_over_expected, 0) / modeled.length, games: modeled.length, through_week: modeled.at(-1).week, basis: "Matching covered rules only" } : null;
    if (modeled.length) record.missing_metrics = ["red_zone_opportunities"];
    if (modeled.length >= 4 && modeled.at(-1).week === week - 1 && modeled.slice(-4).every(g => g.team === modeled.at(-1).team) && modeled.at(-1).week - modeled.at(-4).week <= 4) {
      const latest = modeled.slice(-2), xfp = latest.reduce((s, g) => s + g.opportunity_model.expected_points, 0) / 2, fpoe = latest.reduce((s, g) => s + g.opportunity_model.points_over_expected, 0) / 2;
      if (xfp >= 10 && fpoe <= -4) record.signals.push({ label: "Production below opportunity", metric: "covered_rule_xfp", sample_games: 4, predictive: false, evidence: { recent_games: 2, through_week: modeled.at(-1).week, expected_points: xfp, points_over_expected: fpoe, thresholds: { xfp: 10, fpoe: -4 } } });
    }
    // Keep all weekly raw evidence, but put repeated scoring definitions on the player once.
    if (modeled.length) record.opportunity_contract = { source_id: "ffopportunity", basis: modeled[0].opportunity_model.basis,
      component_columns: ["actual_points", "expected_points", "raw_actual", "raw_expected", "coefficient"] };
    for (const game of modeled) {
      const model = game.opportunity_model;
      game.opportunity_model = { expected_points: model.expected_points, actual_matching_rules: model.actual_matching_rules,
        points_over_expected: model.points_over_expected, status: model.status, excluded_rules: model.excluded_rules,
        components: Object.fromEntries(Object.entries(model.components).map(([key, c]) => [key, [c.actual, c.expected, c.raw_actual, c.raw_expected, c.coefficient]])) };
    }
    const { opportunity_model, ...latest } = record.latest;
    record.latest = latest;
    record.trend_basis = record.trends.snap_share.basis;
    for (const trend of Object.values(record.trends)) delete trend.basis;
  }
  for (const [id, record] of Object.entries(analytics.players)) {
    const player = players.get(id);
    if (!fantasyPositions(player || {}).includes("RB")) record.signals = record.signals.filter(s => s.label !== "Backfield takeover watch");
    record.current_team_matches = !!player?.team && normalizeTeam(player.team) === record.latest.team;
    if (!record.current_team_matches) {
      record.signals = [];
      for (const trend of Object.values(record.trends)) trend.delta = null;
      record.role_warning = "Current team differs from latest usage or is unknown; history retained, role-change claims disabled.";
    }
  }
  const interest = interestContext(freeAgents, snapshot.warnings.some(w => w.resource === "trending"));
  const contexts = Object.fromEntries([...players.values()].map(player => {
    const upcoming = currentRegular ? upcomingGame(player.team, schedule, week, now) : { status: "unavailable", opponent: null, kickoff: null };
    const matches = Object.fromEntries(fantasyPositions(player).filter(pos => difficulty[pos]?.[upcoming.opponent]).map(pos => [pos, Object.fromEntries(Object.entries(difficulty[pos][upcoming.opponent]).filter(([key]) => key !== "game_values"))]));
    const match = matches[player.position] || Object.values(matches)[0];
    return [player.player_id, { player: { player_id: player.player_id, name: player.name, position: player.position, fantasy_positions: fantasyPositions(player), provider_positions: production.players[player.player_id]?.provider_positions || [], team: player.team, injury_status: player.injury_status, status: player.status },
      production: production.players[player.player_id] || null, schedule: upcoming,
      analytics: analytics.players[player.player_id] || null, matchups_by_position: matches,
      matchup: match ? Object.fromEntries(Object.entries(match).filter(([key]) => key !== "game_values")) : null,
      rankings: { average_rank: null, source_count: 0, sources: [] }, projection: null,
      ownership: { percent: null, platform: null, change_percentage_points: null },
      interest: interest[player.player_id] || { sleeper_adds_24h: null, meaning: "Available-player Sleeper add interest unavailable for rostered players" },
      value_profile: playerValue(player, production.players[player.player_id]) }];
  }));
  for (const [id, context] of Object.entries(contexts)) {
    context.decision_week = week;
    context.adjusted_matchups_by_position = Object.fromEntries(fantasyPositions(context.player).filter(p => adjusted[p]?.[context.schedule.opponent]).map(p => { const a = adjusted[p][context.schedule.opponent]; return [p, { team: a.team, position: p, label: a.label, adjusted_points_per_game: a.adjusted_points_per_game, rank_most_favorable: a.rank_most_favorable, games: a.games, through_week: a.through_week, small_sample: a.small_sample, evidence_path: `adjusted_matchup_difficulty.${p}.${a.team}` }]; }));
    context.adjusted_matchup = context.adjusted_matchups_by_position[context.player.position] || Object.values(context.adjusted_matchups_by_position)[0] || null;
    context.model = playerModels(context, priorProduction.games.filter(g => g.player_id === id).map(g => ({ ...g, season: season - 1 })), { season, week: currentRegular ? week : 0, generatedAt: new Date(now).toISOString() });
  }
  const slots = snapshot.league.roster_positions.filter(p => !["BN", "IR", "TAXI"].includes(p));
  const strengths = snapshot.rosters.map(roster => teamStrength(roster, slots, production.players, freeAgents, { leagueSize: snapshot.league.total_rosters || snapshot.rosters.length, benchSlots: snapshot.league.roster_positions.filter(p => p === "BN").length, allPlayers: [...players.values()] }));
  const levels = replacementLevels([...players.values()], freeAgents, Object.fromEntries(Object.entries(contexts).map(([id, c]) => [id, c.model.supported ? c.model.player_value : null])), { teams: snapshot.league.total_rosters || snapshot.rosters.length, slots, benchSlots: snapshot.league.roster_positions.filter(p => p === "BN").length });
  for (const context of Object.values(contexts)) context.model.replacement = valueOverReplacement(context.player, context.model.player_value, levels);
  const strengthV2 = snapshot.rosters.map(r => teamStrengthV2(r, slots, contexts, levels, snapshot.league.scoring_settings));
  const waivers = calibratedWaivers(freeAgents, contexts, strengths, snapshot.my_roster?.roster_id, [...players.values()], limit, snapshot, levels);
  for (const item of waivers.all_evaluations) if (contexts[item.player_id]) {
    contexts[item.player_id].pickup = { rating: item.pickup_rating, coverage_percent: item.coverage_percent, types: item.recommendation_types, comparable_group: item.comparable_group };
    const { lineup_before, lineup_after, pairs, protected_players, best, ...value } = item.roster_value;
    value.best_transaction = best ? { add_player_id: best.add_player_id, drop_player_id: best.drop_player_id, net_roster_improvement: best.net_roster_improvement, recommended: best.recommended } : null;
    contexts[item.player_id].value_profile.roster_value = { ...value, lineup_evidence: "waivers.candidate_details / team_strength" };
  }
  delete waivers.all_evaluations;
  // Category membership is references, not repeated full scoring/lineup documents.
  waivers.candidate_details = Object.fromEntries(Object.values(waivers.categories).flatMap(c => c.players.map(p => [p.player_id, p])));
  for (const category of Object.values(waivers.categories)) category.players = category.players.map(p => ({ player_id: p.player_id }));
  const matchup = weeklyMatchup(snapshot);
  for (const team of matchup.teams) {
    const starterContexts = team.starters.filter(s => s.player_id).map(s => contexts[s.player_id]?.schedule);
    team.scheduled_later = schedules.status === "available" && starterContexts.every(Boolean) ? starterContexts.filter(s => s.status === "scheduled").length : null;
    team.schedule_note = "Scheduled later counts use kickoff times, not live game status. Remaining players is unavailable.";
  }
  const selected = new Set([...snapshot.rosters.flatMap(r => r.all_players.map(p => p.player_id)), ...snapshot.matchup_players.map(p => p.player_id),
    ...Object.values(snapshot.free_agents).flatMap(group => group.slice(0, 20).map(p => p.player_id)),
    ...waivers.recommendations.map(p => p.player_id), ...waivers.limited_candidates.map(p => p.player_id), ...Object.values(waivers.categories).flatMap(c => c.players.map(p => p.player_id))]);
  const warnings = snapshot.warnings.map(w => w.message);
  const unsupported = [...new Set(production.games.flatMap(g => g.scoring.unsupported_rules))];
  if (unsupported.length) warnings.push(`Historical points use supported rules only. Unsupported: ${unsupported.join(", ")}.`);
  if (production.unmatched_ids.length) warnings.push(`${production.unmatched_ids.length} statistical player IDs could not be mapped; no name guesses were made.`);
  if (idMap.ambiguous.length) warnings.push(`${idMap.ambiguous.length} ambiguous ID mappings were excluded.`);
  const throughWeek = Math.max(0, ...production.games.map(g => g.week));
  if (currentRegular && week > 1 && throughWeek < week - 1) warnings.push(`Statistics are available through week ${throughWeek}; expected prior week ${week - 1}.`);
  const sources = [stats, schedules, ids, snaps, opportunity, { ...priorStats, source_id: "nflverse_prior_stats" }].map(({ data, ...source }) => {
    const weekly = ["nflverse_stats", "nflverse_snaps", "ffopportunity"].includes(source.source_id);
    const through = weekly ? Math.max(0, ...data.filter(r => Number(r.season) === season && Number(r.week) < week).map(r => Number(r.week))) : null;
    if (weekly && source.status === "available" && currentRegular && through < week - 1) warnings.push(`${source.source_id} is available only through week ${through}; expected week ${week - 1}.`);
    return { ...source, records: data.length, ...(weekly ? { through_week: through, expected_through_week: week - 1 } : {}) };
  });
  sources.push(...["rankings", "projections", "ownership"].map(id => {
    const { data, ...status } = unavailableSource(id, "No permitted provider configured; values remain null.", "unsupported");
    return { ...status, records: 0 };
  }));
  for (const source of sources.filter(s => s.status === "unavailable")) warnings.push(`${source.source_id}: ${source.warnings.join(" ")}`);
  return { schema_version: "0.3", model_version: MODEL_VERSION, feature_version: FEATURE_VERSION, data_through_week: throughWeek, generated_at: new Date(now).toISOString(),
    league: { league_id: snapshot.league.league_id, name: snapshot.league.name, season, week,
      roster_positions: snapshot.league.roster_positions, scoring_settings: snapshot.league.scoring_settings, settings: snapshot.league.settings },
    basis: decisionBasis(snapshot), my_roster_id: snapshot.my_roster?.roster_id ?? null,
    scoring: { profile: scoringProfile(snapshot.league.scoring_settings), unsupported_rules: unsupported,
      unsupported_positions: ["DEF", "IDP"], historical_scope: "Prior regular-season weeks only; PPG uses recorded statistical appearances, not assumed participation.", through_week: throughWeek },
    matchup, player_context: Object.fromEntries([...selected].filter(id => contexts[id]).map(id => [id, contexts[id]])),
    matchup_difficulty: difficulty, adjusted_matchup_difficulty: adjusted, team_environment: analytics.environment, team_strength: strengths, team_strength_v2: strengthV2, waivers, sources, partial: warnings.length > 0, warnings,
    analytics_coverage: { unmapped_snap_rows: analytics.unmapped_snap_rows, unavailable_metrics: ["red_zone_opportunities", "success_rate"], signal_minimum_games: 4, opportunity_source: opportunity.status },
    coverage: { eligible_pool: freeAgents.length, context_players: selected.size, context_omitted: Math.max(0, players.size - selected.size),
      statistics_through_week: throughWeek, unmatched_statistical_ids: production.unmatched_ids.length, ownership_history: "deferred" } };
}
