import { fitsSlot, unavailableThisWeek } from "./team-strength.js";
const clamp = value => Math.min(100, Math.max(0, value));
const percentile = (value, values) => value == null || !values.length ? null : 100 * values.filter(v => v < value).length / values.length;

export function waiverRecommendations(candidates, contexts, strengths, myRosterId, allPlayers, limit = 20) {
  const strength = strengths.find(s => s.roster_id === myRosterId);
  const distributions = {};
  for (const player of allPlayers) {
    const record = contexts[player.player_id]?.production;
    if (!record) continue;
    if (!distributions[player.position]) distributions[player.position] = { ppg: [], recent: [] };
    if (record.ppg != null) distributions[player.position].ppg.push(record.ppg);
    if (record.recent_average != null) distributions[player.position].recent.push(record.recent_average);
  }
  const scored = candidates.map(player => {
    const context = contexts[player.player_id], production = context?.production;
    const distribution = distributions[player.position] || { ppg: [], recent: [] };
    const difficulty = context?.matchup;
    const compatible = strength?.historical_lineup?.filter(entry => fitsSlot(player, entry.slot)) || [];
    const known = compatible.filter(entry => entry.ppg !== null);
    // Unknown occupied capacity is not assumed to be a weak starter.
    const baseline = compatible.length && known.length === compatible.length ? Math.min(...known.map(entry => entry.ppg)) : null;
    const component = (score, weight, raw_value, explanation) => ({ score, weight, contribution: score === null ? null : score * weight / 100, raw_value, explanation });
    const components = {
      season_production: component(percentile(production?.ppg, distribution.ppg), 35, production?.ppg ?? null, "Positional percentile of league-scored recorded-game PPG"),
      recent_production: component(percentile(production?.recent_average, distribution.recent), 25, production?.recent_average ?? null, "Positional percentile over up to three recent recorded games"),
      usage_trend: component(production?.usage_trend == null ? null : clamp(50 + production.usage_trend * 5), 10, production?.usage_trend ?? null, "Change in targets + carries per game; requires prior games"),
      matchup: component(difficulty?.rank_most == null ? null : difficulty.defenses_measured === 1 ? 50 : 100 * (difficulty.defenses_measured - difficulty.rank_most) / (difficulty.defenses_measured - 1), 15, difficulty?.points_per_game ?? null, "More points allowed to this position means an easier historical matchup"),
      roster_need: component(baseline === null || production?.ppg == null ? null : clamp(50 + (production.ppg - baseline) * 5), 15, baseline, "PPG comparison with weakest compatible slot in your historical lineup; not a projection"),
      external_quality: component(null, 0, null, "External rankings are not configured"),
      upside: component(null, 0, null, "Standalone/contingent upside needs role evidence; no probability inferred"),
    };
    const coverage = Object.values(components).filter(c => c.score !== null).reduce((sum, c) => sum + c.weight, 0);
    const subtotal = Object.values(components).reduce((sum, c) => sum + (c.contribution || 0), 0);
    const weeklyEligible = !unavailableThisWeek(player) && context?.schedule?.status !== "no_scheduled_game";
    const sufficient = production?.ppg != null && production?.recent_average != null && coverage >= 75;
    return { player_id: player.player_id, position: player.position, score: sufficient && weeklyEligible ? Math.round(subtotal * 10) / 10 : null,
      supported_component_points: subtotal, coverage_percent: coverage, comparable_group: Object.entries(components).filter(([, c]) => c.weight > 0 && c.score !== null).map(([key]) => key).join("+"),
      status: !weeklyEligible ? "stash_or_bye" : sufficient ? "scored" : "insufficient_data", components,
      interest_adds_24h: player.trending_adds_24h || 0, scoring_status: production?.scoring_status || "unavailable",
      small_sample: (production?.recorded_games || 0) < 4 };
  });
  const ranked = scored.filter(p => p.score !== null).sort((a, b) => b.coverage_percent - a.coverage_percent || a.comparable_group.localeCompare(b.comparable_group) || b.score - a.score || a.player_id.localeCompare(b.player_id));
  const limited = scored.filter(p => p.score === null);
  return { model_version: "production-v1", basis: "Historical heuristic, not predicted points. Compare scores only within the same component group. Missing weights are not redistributed.",
    evaluated_count: scored.length, scored_count: ranked.length, limited_count: limited.length,
    recommendations: ranked.slice(0, limit), limited_candidates: limited.slice(0, limit),
    truncation: { limit, ranked_omitted: Math.max(0, ranked.length - limit), limited_omitted: Math.max(0, limited.length - limit) } };
}
