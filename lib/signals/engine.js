import { digest, evidenceOnly } from "../history/contracts.js";
import { mean, numeric } from "../decision/features.js";
export const SIGNAL_VERSION = "signals-1";
export const SIGNAL_POLICY = { snapDelta: 0.18, targetDelta: 0.06, carryDelta: 0.15, xfpDelta: 3, marketRelative: 0.5, marketAbsolute: 100, maxPerPlayer: 5 };
export function playerSignals(context, { leagueId, season, week, throughWeek, generatedAt, modelVersion }) {
  const currentTeam = context.player.team, seen = new Set();
  const history = (context.analytics?.history || []).filter(g => {
    if ((g.season != null && Number(g.season) !== Number(season)) || g.week > throughWeek || g.week >= week || g.team !== currentTeam || seen.has(g.game_id)) return false;
    seen.add(g.game_id); return true;
  }).sort((a, b) => a.week - b.week).slice(-4);
  const signals = [], fresh = history.length >= 2 && history.at(-1).week === throughWeek && throughWeek === week - 1 && history.at(-1).week - history[0].week <= history.length;
  const samples = history.length, confidence = samples < 3 ? "low" : "moderate";
  const warnings = [samples < 4 ? "Small sample; provisional evidence, not an established role" : null,
    context.model?.features.changed_team ? "Changed team; previous role may not transfer" : null,
    context.player.injury_status ? `Current injury/status: ${context.player.injury_status}; historical role is not availability` : null].filter(Boolean);
  const emit = (type, direction, severity, evidence, explanation, count = samples) => {
    const record = { schema_version: SIGNAL_VERSION, player_id: context.player.player_id, league_id: leagueId, season, week, type, direction, severity,
      confidence: count < 3 ? "low" : confidence, evidence, sample_size: count, generated_at: generatedAt, data_through_week: throughWeek,
      model_version: modelVersion, provenance: [...new Set([...(context.analytics?.source_ids || []),
        ...(/XFP|OPPORTUNITY_OVER|PRODUCTION_OVER|HYPE/.test(type) ? ["ffopportunity"] : []),
        ...(/HIGH_VALUE/.test(type) ? ["nflverse_pbp"] : []), ...(/SCHEDULE/.test(type) ? ["nflverse_schedule"] : []),
        ...(/MARKET|BUZZ|HYPE|QUIET/.test(type) ? ["sleeper_trending", "prospective_market_archive"] : [])])],
      warnings, explanation, alert_candidate: true, predictive: false };
    signals.push({ signal_id: digest(evidenceOnly(record)), ...record });
  };
  const values = key => history.map(g => key === "xfp" ? g.opportunity_model?.expected_points ?? g.xfp ?? null : key === "fpoe" ? g.opportunity_model?.points_over_expected ?? g.fpoe ?? null : g[key] ?? null);
  const change = key => { const xs = values(key); if (xs.length < 2 || xs.some(v => !numeric(v))) return null;
    return xs.length === 4 ? mean(xs.slice(-2)) - mean(xs.slice(0, 2)) : xs.at(-1) - xs[0]; };
  const snap = change("snap_share"), target = change("target_share"), carry = change("carry_share");
  const rising = fresh && (snap >= 0.18 && snap != null) && ((target >= 0.06 && target != null) || (carry >= 0.15 && carry != null));
  const declining = fresh && snap != null && snap <= -0.18;
  if (fresh) {
    const roleEvidence = { weeks: history.map(g => g.week), snap_share: values("snap_share"), target_share: values("target_share"), carry_share: values("carry_share"), xfp: values("xfp"), prior: context.model?.features.prior ?? null };
    if (rising) emit("ROLE_EXPANSION", "up", "notable", roleEvidence, "Snap participation and opportunity share both increased materially.");
    if (declining) emit("ROLE_DECLINE", "down", "notable", roleEvidence, "Snap participation fell materially, irrespective of past fantasy points.");
    for (const [key, delta, threshold, type, minimum] of [["snap_share", snap, 0.25, "SNAP_SHARE_SPIKE", 0.5], ["target_share", target, 0.08, "TARGET_SHARE_SPIKE", 0.18], ["carry_share", carry, 0.2, "CARRY_SHARE_SPIKE", 0.3]]) {
      if (delta != null && delta >= threshold && values(key).at(-1) >= minimum) emit(type, "up", "notable", { weekly: values(key), delta, threshold, minimum }, "Large participation change with a meaningful current share.");
    }
    if (context.player.fantasy_positions?.includes("RB") && carry != null && Math.abs(carry) >= 0.2 && values("carry_share").some(v => v >= 0.3)) emit("BACKFIELD_SHIFT", carry > 0 ? "up" : "down", "notable", { weekly: values("carry_share"), delta: carry }, "Observed backfield share shifted; succession or an injury cause is not assumed.");
    const xfp = change("xfp"), recentX = mean(values("xfp").slice(-2)), fpoe = mean(values("fpoe").slice(-2));
    if (xfp != null && xfp >= 3 && recentX >= 10) emit("XFP_BREAKOUT", "up", "notable", { weekly: values("xfp"), delta: xfp, recent_average: recentX }, "Covered-rule expected opportunity increased; not a breakout probability.");
    if (recentX >= 10 && fpoe != null && fpoe <= -4) emit("OPPORTUNITY_OVER_RESULTS", "neutral", "context", { recent_xfp: recentX, recent_fpoe: fpoe }, "Results lag matched-rule opportunity; improvement is not guaranteed.");
    if (recentX >= 5 && fpoe != null && fpoe >= 5) emit("PRODUCTION_OVER_OPPORTUNITY", "neutral", "context", { recent_xfp: recentX, recent_fpoe: fpoe }, "Recent efficiency exceeds opportunity; no automatic regression prediction.");
    if (samples >= 4 && snap != null && Math.max(...values("snap_share")) - Math.min(...values("snap_share")) <= 0.08 && mean(values("snap_share")) >= 0.7) emit("ROLE_STABILITY", "steady", "context", { weekly: values("snap_share") }, "Four recorded games show stable, substantial participation.");
    const high = (context.high_value?.history || []).filter(g => g.week <= throughWeek && g.week < week && g.team === currentTeam).slice(-4);
    if (high.length >= 2 && high.at(-1).week === throughWeek) {
      const delta = high.at(-1).high_value_opportunities - high[0].high_value_opportunities;
      if (Math.abs(delta) >= 3 && Math.max(high.at(-1).high_value_opportunities, high[0].high_value_opportunities) >= 4) emit("HIGH_VALUE_OPPORTUNITY_CHANGE", delta > 0 ? "up" : "down", "notable", { weekly: high.map(g => ({ week: g.week, opportunities: g.high_value_opportunities })), delta, source: context.high_value.provenance }, "Material change in documented red-zone touches/targets.", high.length);
    }
  }
  const market = context.market_attention;
  const currentMatch = context.adjusted_matchup, next = (context.schedule_outlook || []).filter(g => g.matchup?.games >= 4 && g.matchup.adjusted_points_per_game != null);
  if (currentMatch?.games >= 4 && currentMatch.adjusted_points_per_game != null && next.length >= 2) {
    const delta = mean(next.map(g => g.matchup.adjusted_points_per_game)) - currentMatch.adjusted_points_per_game;
    if (Math.abs(delta) >= 3) emit(delta > 0 ? "SCHEDULE_IMPROVEMENT" : "SCHEDULE_DECLINE", delta > 0 ? "up" : "down", "context", { current_adjusted: currentMatch.adjusted_points_per_game, next: next.map(g => ({ week: g.week, opponent: g.opponent, adjusted: g.matchup.adjusted_points_per_game, games: g.matchup.games })), delta }, "Next three scheduled weeks differ materially in positional schedule-adjusted context; not a player projection.");
  }
  const attentionRising = market?.change >= SIGNAL_POLICY.marketAbsolute && market.relative_change >= SIGNAL_POLICY.marketRelative;
  const attentionFalling = market?.change <= -SIGNAL_POLICY.marketAbsolute && market.relative_change <= -SIGNAL_POLICY.marketRelative;
  if (attentionRising || attentionFalling) emit(attentionRising ? "MARKET_INTEREST_RISING" : "MARKET_INTEREST_FALLING", attentionRising ? "up" : "down", "context", market, "Comparable archived 24-hour add-interest windows changed materially; not football value.", 2);
  if (attentionRising && rising) emit("BUZZ_AND_DATA_CONFIRMATION", "up", "notable", { market, snap_delta: snap, target_delta: target, carry_delta: carry }, "Growing attention coincides with observed role expansion; no score boost.");
  if (attentionRising && fresh && snap != null && Math.abs(snap) < 0.08 && mean(values("snap_share")) < 0.5 && mean(values("xfp")) != null && mean(values("xfp")) < 8) emit("HYPE_RISK", "neutral", "notable", { market, snap_share: values("snap_share"), xfp: values("xfp") }, "Attention rose without supporting participation or opportunity; not a prediction of failure.");
  if (rising && market?.raw_count != null && market.attention_percentile != null && market.attention_percentile <= 30) emit("QUIET_BREAKOUT", "up", "notable", { market, snap_delta: snap, target_delta: target, carry_delta: carry }, "Role growth with low observed attention in this comparison pool. Censored missing attention never qualifies.");
  return signals.sort((a, b) => Number(b.type.startsWith("BUZZ") || b.type === "QUIET_BREAKOUT" || b.type === "HYPE_RISK") - Number(a.type.startsWith("BUZZ") || a.type === "QUIET_BREAKOUT" || a.type === "HYPE_RISK") || Number(b.severity === "notable") - Number(a.severity === "notable")).slice(0, SIGNAL_POLICY.maxPerPlayer);
}
export function buildSignals(contexts, scope, limit = 100) {
  const all = Object.values(contexts).flatMap(c => playerSignals(c, scope)).sort((a, b) => Number(b.severity === "notable") - Number(a.severity === "notable") || a.player_id.localeCompare(b.player_id));
  return { schema_version: SIGNAL_VERSION, records: all.slice(0, limit), total: all.length, omitted: Math.max(0, all.length - limit), limit,
    unsupported_types: ["ROUTE_RECEIVING_ROLE_CHANGE", "INJURY_OPPORTUNITY", "BUZZ_RISING"],
    basis: "Evidence flags, not predictions. Feed capped; no automatic football-score changes." };
}
