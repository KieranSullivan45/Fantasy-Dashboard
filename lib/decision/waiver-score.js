import { fitsSlot, unavailableThisWeek, lineupEvaluator } from "./team-strength.js";
import { fantasyPositions, uniquePlayers } from "../normalize/positions.js";
const clamp = value => Math.min(100, Math.max(0, value));
const percentile = (value, values) => value == null || !values.length ? null : 100 * values.filter(v => v < value).length / values.length;
const total = lineup => lineup?.reduce((sum, p) => sum + (p.ppg ?? 0), 0) ?? null;
const component = (score, weight, raw_value, explanation) => ({ score, weight, contribution: score === null ? null : score * weight / 100, raw_value, explanation });
const compare = (a, b) => b.coverage_percent - a.coverage_percent || a.comparable_group.localeCompare(b.comparable_group) || (b.pickup_rating ?? -1) - (a.pickup_rating ?? -1) || a.player_id.localeCompare(b.player_id);

export function waiverRecommendations(candidates, contexts, strengths, myRosterId, allPlayers, limit = 20) {
  candidates = uniquePlayers(candidates); allPlayers = uniquePlayers(allPlayers);
  const strength = strengths.find(s => s.roster_id === myRosterId);
  const production = Object.fromEntries(Object.entries(contexts).map(([id, c]) => [id, c.production]));
  const slots = strength?.starter_slots || strength?.historical_lineup?.map(s => s.slot) || [];
  const evaluator = strength?.usable_players ? lineupEvaluator(strength.usable_players, slots, production) : null;
  const before = evaluator?.before;
  const distributions = {};
  for (const player of allPlayers) for (const pos of fantasyPositions(player)) {
    const record = contexts[player.player_id]?.production;
    if (!distributions[pos]) distributions[pos] = { ppg: [], recent: [], opportunity: [] };
    if (record?.ppg != null) distributions[pos].ppg.push(record.ppg);
    if (record?.recent_average != null) distributions[pos].recent.push(record.recent_average);
    const opportunity = contexts[player.player_id]?.analytics?.trends?.opportunities?.recent_average;
    if (opportunity != null) distributions[pos].opportunity.push(opportunity);
  }
  const scored = candidates.map(player => {
    const context = contexts[player.player_id], history = context?.production, analytics = context?.analytics;
    const positions = fantasyPositions(player);
    const percentiles = metric => positions.map(pos => percentile(metric === "opportunity" ? analytics?.trends?.opportunities?.recent_average : metric === "ppg" ? history?.ppg : history?.recent_average, distributions[pos]?.[metric] || [])).filter(v => v !== null);
    const best = metric => { const values = percentiles(metric); return values.length ? Math.max(...values) : null; };
    const healthy = !unavailableThisWeek(player);
    const weeklyEligible = healthy && context?.schedule?.status === "scheduled";
    const compatible = slots.filter(slot => fitsSlot(player, slot));
    const unknown = (strength?.usable_players || []).some(p => production[p.player_id]?.ppg == null && compatible.some(slot => fitsSlot(p, slot)));
    const after = evaluator?.after(player);
    const known = history?.ppg != null && evaluator && compatible.length > 0 && !unknown;
    const gain = known && healthy ? Math.max(0, total(after) - total(before)) : null;
    const backupValues = (strength?.bench_depth || []).filter(p => compatible.some(slot => fitsSlot(p, slot))).map(p => p.ppg);
    const cutoffs = positions.map(pos => strength?.positions?.[pos]?.replacement_ppg).filter(v => v != null);
    const cutoff = cutoffs.length ? Math.min(...cutoffs) : null;
    const depthBaseline = cutoff !== null && backupValues.every(v => v != null) ? Math.max(cutoff, ...backupValues) : null;
    const depthGain = known && healthy && depthBaseline !== null ? Math.max(0, history.ppg - depthBaseline) : null;
    const rosterValue = { lineup_before: before || null, lineup_after: after || null, starter_gain: gain, depth_gain: depthGain, replacement_ppg: cutoff,
      depth_baseline_ppg: depthBaseline, league_size: strength?.league_size ?? null, unknown_compatible_players: unknown,
      basis: "Optimal legal historical-PPG lineup before/after addition; depth above best compatible backup or league-depth cutoff. No drop assumed; injured candidates have no current lineup gain." };
    const opportunity = analytics?.trends?.opportunities?.recent_average ?? null;
    const expanding = analytics?.signals?.filter(s => ["Role expanding", "Target share rising", "Backfield takeover watch"].includes(s.label)) || [];
    const upside = analytics?.trends?.snap_share?.delta != null ? clamp(50 + analytics.trends.snap_share.delta * 150) : null;
    const difficulty = context?.matchup;
    const matchupScore = difficulty?.rank_most == null ? null : difficulty.defenses_measured === 1 ? 50 : 100 * (difficulty.defenses_measured - difficulty.rank_most) / (difficulty.defenses_measured - 1);
    const components = {
      season_production: component(best("ppg"), 20, history?.ppg ?? null, "Player quality proxy: best eligible positional percentile of league-scored PPG; ROS rank unavailable"),
      role_opportunity: component(best("opportunity"), 20, opportunity, "Recent targets + carries per recorded game, compared within platform eligibility; usage before efficiency"),
      roster_improvement: component(gain === null ? null : clamp(gain * 10 + (depthGain ?? 0) * 3), 30, { starter_gain: gain, depth_gain: depthGain, replacement_ppg: cutoff }, "Legal-lineup marginal gain plus depth insurance; historical points, not a forecast"),
      upside: component(upside, 10, analytics?.trends?.snap_share ?? null, "Role-expansion proxy: snap-share change, minimum four games. No breakout probability or ROS projection"),
      recent_production: component(best("recent"), 10, history?.recent_average ?? null, "Recent recorded-game PPG positional percentile"),
      matchup: component(matchupScore === null ? null : 50 + (matchupScore - 50) * Math.min(1, (difficulty.games || 0) / 6), 5, { points_per_game: difficulty?.points_per_game ?? null, games: difficulty?.games ?? null }, "Upcoming positional matchup; shrunk toward neutral through six games, only 5% weight"),
      market_interest: component(context?.interest?.available_percentile ?? null, 5, context?.interest ?? null, "Sleeper add-interest percentile among available players; top-100 censored feed, not ownership or usage"),
      external_quality: component(null, 0, null, "External ROS rankings are not configured"),
      usage_trend: component(history?.usage_trend == null ? null : clamp(50 + history.usage_trend * 5), 0, history?.usage_trend ?? null, "Legacy usage diagnostic retained; role/opportunity now carries the weight"),
    };
    const coverage = Object.values(components).filter(c => c.score !== null).reduce((sum, c) => sum + c.weight, 0);
    const subtotal = Object.values(components).reduce((sum, c) => sum + (c.contribution || 0), 0);
    const sufficient = history?.ppg != null && history?.recent_average != null && coverage >= 45;
    const rating = sufficient ? Math.round(subtotal * 10) / 10 : null;
    const types = [];
    if (weeklyEligible && gain > 0) types.push("immediate_upgrades");
    if (healthy && sufficient) types.push("best_overall");
    if (!healthy) types.push("injury_stashes");
    if (expanding.length) types.push("upside_stashes");
    // Observe a secondary backfield role; never claim the depth-chart successor is known.
    const teammates = allPlayers.filter(p => p.player_id !== player.player_id && p.team === player.team && fantasyPositions(p).includes("RB"));
    const lead = teammates.find(p => contexts[p.player_id]?.analytics?.trends?.carry_share?.recent_average >= 0.5);
    const carryShare = analytics?.trends?.carry_share?.recent_average;
    const contingent = positions.includes("RB") && lead && analytics?.recorded_games >= 4 && carryShare >= 0.1 && carryShare < 0.5 && analytics.trends.carry_share.delta != null;
    if (contingent) types.push("contingent_rbs");
    if (weeklyEligible && gain > 0 && difficulty?.games >= 4 && matchupScore >= 75) types.push("matchup_plays");
    const explanations = [gain === null ? "Lineup gain unavailable (injury, eligibility, or incomplete roster evidence)." : `Historical starter gain: ${gain.toFixed(1)} points; depth gain: ${depthGain === null ? "unknown" : depthGain.toFixed(1)}.`,
      !healthy ? "Injury/reserve stash: no claim of availability this week." : "Historical acquisition heuristic; not a projection or probability.",
      ...(contingent ? [`Secondary observed carry share behind ${lead.name || lead.player_id}; successor status is unverified.`] : []), ...expanding.map(s => s.label)];
    return { player_id: player.player_id, position: player.position, fantasy_positions: positions, score: sufficient && weeklyEligible ? rating : null, pickup_rating: rating,
      supported_component_points: subtotal, coverage_percent: coverage, comparable_group: Object.entries(components).filter(([, c]) => c.weight > 0 && c.score !== null).map(([key]) => key).join("+"),
      status: !weeklyEligible ? "stash_bye_or_kickoff_passed" : sufficient ? "scored" : "insufficient_data", components, roster_value: rosterValue,
      recommendation_types: types, explanations, contingent_evidence: contingent ? { lead_player_id: lead.player_id, recent_carry_share: carryShare, recorded_games: analytics.recorded_games, through_week: analytics.through_week } : null,
      interest_adds_24h: context?.interest?.sleeper_adds_24h ?? null, scoring_status: history?.scoring_status || "unavailable", small_sample: (history?.recorded_games || 0) < 4 };
  });
  const ranked = scored.filter(p => p.score !== null).sort(compare);
  const limited = scored.filter(p => p.score === null).sort(compare);
  const labels = { immediate_upgrades: "Immediate lineup upgrades", best_overall: "Best overall adds", upside_stashes: "Upside stashes", injury_stashes: "Injury / PUP / IR stashes", contingent_rbs: "Contingent-value RB watch", matchup_plays: "Short-term matchup plays" };
  const categories = Object.fromEntries(Object.entries(labels).map(([key, label]) => {
    const pool = scored.filter(p => p.recommendation_types.includes(key)).sort(compare);
    return [key, { label, total: pool.length, omitted: Math.max(0, pool.length - limit), players: pool.slice(0, limit) }];
  }));
  return { model_version: "roster-value-v2", basis: "Pickup Rating is a historical heuristic, not projected points or probability. Compare only within identical evidence groups. Missing weights are not redistributed.",
    evaluated_count: scored.length, scored_count: ranked.length, limited_count: limited.length, categories, all_evaluations: scored,
    recommendations: ranked.slice(0, limit), limited_candidates: limited.slice(0, limit),
    truncation: { limit, ranked_omitted: Math.max(0, ranked.length - limit), limited_omitted: Math.max(0, limited.length - limit) } };
}
