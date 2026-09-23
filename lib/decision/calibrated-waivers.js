import { waiverRecommendations as baseline } from "./waiver-score-v031.js";
import { transactionEvaluator } from "./add-drop.js";
import { MODEL_VERSION, POLICY } from "./model-config.js";
import { clamp } from "./features.js";
import { fantasyPositions } from "../normalize/positions.js";
const component = (score, weight, raw, explanation) => ({ score, weight, raw_value: raw, contribution: score == null ? null : score * weight / 100, explanation });
export function immediateUpgrade(item, context) {
  const policy = POLICY.immediate, f = context?.model?.features;
  return context?.model?.start_value.available_this_week === true && item.roster_value.starter_gain >= policy.minimumStarterGain &&
    item.roster_value.net_roster_improvement >= policy.minimumNetGain && f?.current_games >= policy.minimumGames &&
    f?.opportunity.score >= policy.minimumRoleScore && item.coverage_percent >= policy.minimumCoverage &&
    f.data_through_week >= context.decision_week - 1;
}
export function calibratedWaivers(candidates, contexts, strengths, myRosterId, allPlayers, limit, snapshot, levels) {
  const old = baseline(candidates, contexts, strengths, myRosterId, allPlayers, limit);
  const evaluator = transactionEvaluator(snapshot.rosters.find(r => r.roster_id === myRosterId), snapshot.league.roster_positions, contexts, levels);
  const players = new Map(candidates.map(p => [p.player_id, p]));
  const percentile = player => {
    const value = contexts[player.player_id]?.model?.pickup_value.central;
    const pool = allPlayers.filter(p => fantasyPositions(p).some(pos => fantasyPositions(player).includes(pos))).map(p => contexts[p.player_id]?.model?.pickup_value.central).filter(v => v != null);
    return value == null || !pool.length ? null : 100 * pool.filter(v => v < value).length / pool.length;
  };
  const scored = old.all_evaluations.map(item => {
    const player = players.get(item.player_id), c = contexts[item.player_id], model = c?.model, f = model?.features;
    const tx = evaluator(player), supported = model?.supported;
    const components = {
      football_acquisition: component(supported ? percentile(player) : null, 40, model?.pickup_value, "Out-of-sample evaluated football acquisition blend; not market value"),
      role_opportunity: component(supported ? f.opportunity.score : null, 15, f?.opportunity, "Position-specific recent opportunity; no efficiency weight or missing-weight redistribution"),
      roster_improvement: component(supported && tx.net_roster_improvement != null ? clamp(tx.net_roster_improvement * 10) : null, 35, tx.best && { starter: tx.starter_gain, depth: tx.depth_gain, net: tx.net_roster_improvement }, "Best conservative legal add/drop net, retaining dropped asset cost"),
      upside: component(supported && f?.role_games >= 2 && f.feature_inputs.snap_share != null ? f.role_change ? 75 : f.provisional_role_expansion ? 60 : 40 : null, 5, { role_change: f?.role_change, provisional: f?.provisional_role_expansion }, "Conservative role evidence, not breakout probability"),
      market_interest: component(supported ? c.interest?.available_percentile ?? null : null, 5, c.interest, "Sleeper add interest only; not ownership or trade market value"),
      matchup: component(null, 0, c.adjusted_matchup, "Informational until incremental forecast benefit is validated"),
    };
    const coverage = Object.entries(components).filter(([, x]) => x.score != null).reduce((s, [key, x]) => s + x.weight * (key === "role_opportunity" ? f.opportunity.coverage / 100 : key === "football_acquisition" ? model.pickup_value.coverage : 1), 0);
    const subtotal = Object.values(components).reduce((s, x) => s + (x.contribution ?? 0), 0);
    const rated = supported && model.pickup_value.central != null && coverage >= 55;
    const types = item.recommendation_types.filter(t => !["immediate_upgrades", "best_overall", "matchup_plays"].includes(t));
    const result = { ...item, components, roster_value: tx, pickup_rating: rated ? Math.round(subtotal * 10) / 10 : null,
      score: rated && tx.best?.recommended ? Math.round(subtotal * 10) / 10 : null, supported_component_points: subtotal, coverage_percent: coverage,
      comparable_group: Object.entries(components).filter(([, c]) => c.score != null && c.weight).map(([key]) => key).join("+") + `+role_coverage_${f?.opportunity.coverage ?? 0}+forecast_coverage_${model?.pickup_value.coverage ?? 0}`,
      status: !supported ? "advanced_model_unsupported" : !tx.best?.recommended ? "no_supported_positive_transaction" : rated ? "scored" : "insufficient_data",
      recommendation_types: types, model_version: MODEL_VERSION, feature_version: model?.feature_version, data_through_week: f?.data_through_week,
      generated_at: model?.generated_at, immediate_upgrade_policy: POLICY.immediate,
      explanations: ["Pickup Rating is a partially observed acquisition heuristic, not a projection or probability.",
        tx.best ? `ADD ${player.name || player.player_id}; ${tx.best.drop_player_id ? `DROP ${contexts[tx.best.drop_player_id]?.player.name || tx.best.drop_player_id}` : "use vacant active slot"}.` : "No supported legal add/drop pair.",
        tx.reason || "Injured assets, meaningful backfield roles, structural Superflex QBs and unknown-value assets are protected from automatic drops."] };
    if (immediateUpgrade(result, c)) types.push("immediate_upgrades");
    if (rated && tx.best?.recommended) types.push("best_overall");
    if (f?.provisional_role_expansion && !types.includes("upside_stashes")) types.push("upside_stashes");
    return result;
  });
  const compare = (a, b) => b.coverage_percent - a.coverage_percent || a.comparable_group.localeCompare(b.comparable_group) || (b.pickup_rating ?? -1) - (a.pickup_rating ?? -1);
  const ranked = scored.filter(p => p.score != null).sort(compare), limited = scored.filter(p => p.score == null).sort(compare);
  const categories = Object.fromEntries(Object.entries(old.categories).map(([key, group]) => { const pool = scored.filter(p => p.recommendation_types.includes(key)).sort(compare); return [key, { label: group.label, total: pool.length, omitted: Math.max(0, pool.length - limit), players: pool.slice(0, limit) }]; }));
  return { ...old, model_version: MODEL_VERSION, categories, all_evaluations: scored, recommendations: ranked.slice(0, limit), limited_candidates: limited.slice(0, limit),
    scored_count: ranked.length, limited_count: limited.length, replacement_levels: levels,
    basis: "Legal add/drop Pickup Rating. Missing weights are not redistributed; compare identical evidence groups. Thresholds and roster weights are conservative policy, not backtest-calibrated probabilities.",
    truncation: { limit, ranked_omitted: Math.max(0, ranked.length - limit), limited_omitted: Math.max(0, limited.length - limit) } };
}
