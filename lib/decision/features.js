import { POLICY, POSITION_MODELS, FEATURE_VERSION } from "./model-config.js";
export const numeric = v => typeof v === "number" && Number.isFinite(v);
export const mean = values => { const xs = values.filter(numeric); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
export function quantile(values, q) {
  const xs = values.filter(numeric).sort((a, b) => a - b); if (!xs.length) return null;
  const i = (xs.length - 1) * q, lower = Math.floor(i); return xs[lower] + (xs[Math.ceil(i)] - xs[lower]) * (i - lower);
}
export function canonicalGame(g) {
  const model = g.opportunity_model;
  return { ...g, points: numeric(g.points) ? g.points : g.fantasy_points ?? null,
    xfp: g.xfp ?? model?.expected_points ?? null, fpoe: g.fpoe ?? model?.points_over_expected ?? null,
    model_actual: g.model_actual ?? model?.actual_matching_rules ?? null,
    // Exact dropbacks only when the play-by-play adapter supplies them.
    dropbacks: g.dropbacks ?? (numeric(g.passing_attempts) && numeric(g.sacks) ? g.passing_attempts + g.sacks : null),
    dropback_basis: g.dropbacks != null ? "pbp including scrambles" : "attempts+sacks; scrambles excluded",
  };
}

/** Pure event-time builder shared by production and backtests. Future rows never enter features. */
export function weeklyFeatures(history, priorHistory, position, { season, week, currentTeam } = {}) {
  const rows = history.filter(g => (g.season == null || Number(g.season) === Number(season)) && Number(g.week) < week).map(canonicalGame).sort((a, b) => a.week - b.week);
  const prior = priorHistory.filter(g => Number(g.season) === Number(season) - 1).map(canonicalGame).sort((a, b) => a.week - b.week).slice(-8);
  const sameTeam = !!currentTeam && rows.at(-1)?.team === currentTeam;
  const current = rows.filter(g => !currentTeam || g.team === currentTeam);
  const recent = current.slice(-2), previous = current.slice(-4, -2);
  const snapRecent = mean(recent.map(g => g.snap_share)), snapPrevious = mean(previous.map(g => g.snap_share));
  const carryRecent = mean(recent.map(g => g.carry_share)), carryPrevious = mean(previous.map(g => g.carry_share));
  const expanding = recent.length === 2 && previous.length === 2 && ((snapRecent != null && snapPrevious != null && snapRecent - snapPrevious >= 0.2) || (carryRecent != null && carryPrevious != null && carryRecent - carryPrevious >= 0.2));
  const early = current.length >= 2 && current.length < 4 && current.at(-1).week - current.at(-2).week <= 2 && ["snap_share", "carry_share"].some(key => numeric(current.at(-1)[key]) && numeric(current.at(-2)[key]) && current.at(-1)[key] - current.at(-2)[key] >= 0.2);
  const priorMean = mean(prior.map(g => g.points)), seasonMean = mean(rows.map(g => g.points));
  const changedTeam = !!prior.length && prior.at(-1).team !== currentTeam;
  const priorN = priorMean == null ? 0 : changedTeam || expanding ? POLICY.changedRolePriorGames : POLICY.priorGames;
  const n = rows.filter(g => numeric(g.points)).length;
  const priorContribution = priorN / Math.max(1, n + priorN);
  const blended = seasonMean == null ? priorMean : priorMean == null ? seasonMean : (seasonMean * n + priorMean * priorN) / (n + priorN);
  const inputs = {};
  for (const key of Object.keys(POSITION_MODELS[position] || {})) inputs[key] = mean(recent.map(g => g[key]));
  const roleComponents = Object.fromEntries(Object.entries(POSITION_MODELS[position] || {}).map(([key, [weight, scale]]) => [key, {
    value: inputs[key], score: inputs[key] == null ? null : clamp(inputs[key] / scale * 100), weight, scale,
    games: recent.filter(g => numeric(g[key])).length,
  }]));
  const roleCoverage = Object.values(roleComponents).filter(c => c.score != null).reduce((s, c) => s + c.weight, 0);
  const roleScore = roleCoverage ? Object.values(roleComponents).reduce((s, c) => s + (c.score ?? 0) * c.weight / 100, 0) : null;
  const ppgValues = rows.map(g => g.points).filter(numeric), variance = ppgValues.length >= 4 ? mean(ppgValues.map(p => (p - mean(ppgValues)) ** 2)) : null;
  const xfpRows = rows.filter(g => numeric(g.xfp)), fpoeRows = rows.filter(g => numeric(g.fpoe));
  const uncertainty = { floor_like: ppgValues.length >= 4 ? quantile(ppgValues, 0.2) : null,
    central_observed: ppgValues.length >= 4 ? quantile(ppgValues, 0.5) : null, ceiling_like: ppgValues.length >= 4 ? quantile(ppgValues, 0.8) : null,
    standard_deviation: variance == null ? null : Math.sqrt(variance), sample_games: ppgValues.length,
    risk: ppgValues.length < 4 ? "insufficient_sample" : Math.sqrt(variance) > Math.max(5, mean(ppgValues) * 0.6) ? "high_variability" : "moderate_variability",
    basis: "Observed current-season 20th/50th/80th percentiles, not forecast intervals or probabilities" };
  return { feature_version: FEATURE_VERSION, position, data_through_week: rows.at(-1)?.week ?? 0,
    current_games: n, role_games: recent.length, same_team: sameTeam, changed_team: changedTeam, role_change: expanding,
    provisional_role_expansion: early, small_sample: n < 4, confidence: n >= 8 && roleCoverage >= 80 ? "moderate" : "low",
    legacy_opportunity: mean(recent.map(g => numeric(g.targets) && numeric(g.carries) ? g.targets + g.carries : null)), season_ppg: seasonMean, recent_ppg: mean(rows.slice(-3).map(g => g.points)), quality_points: blended,
    prior: { games: prior.length, ppg: priorMean, effective_games: priorN, contribution: priorContribution, reason: priorMean == null ? "No prior; rookie/unknown remains uncertain" : changedTeam ? "New team: discounted prior" : expanding ? "Changed role: discounted prior" : "Prior-season shrinkage" },
    opportunity: { score: roleScore, coverage: roleCoverage, components: roleComponents, window: "Latest two recorded games on current team; no redistribution of missing weights" },
    xfp_per_game: mean(xfpRows.map(g => g.xfp)), recent_xfp: mean(recent.map(g => g.xfp)), xfp_cumulative: xfpRows.length ? xfpRows.reduce((s, g) => s + g.xfp, 0) : null,
    actual_matching_rules_per_game: mean(xfpRows.map(g => g.model_actual)), fpoe_per_game: mean(fpoeRows.map(g => g.fpoe)), fpoe_cumulative: fpoeRows.length ? fpoeRows.reduce((s, g) => s + g.fpoe, 0) : null,
    xfp_games: xfpRows.length, recent_xfp_delta: recent.length === 2 && previous.length === 2 && recent.every(g => numeric(g.xfp)) && previous.every(g => numeric(g.xfp)) ? mean(recent.map(g => g.xfp)) - mean(previous.map(g => g.xfp)) : null,
    feature_inputs: { ...inputs, fpoe: mean(recent.map(g => g.fpoe)), racr: mean(recent.map(g => g.racr)), passing_epa_per_dropback: mean(recent.map(g => g.passing_epa_per_attempt_or_sack)) },
    uncertainty,
    denominators: { statistical_appearances: { points: ppgValues.reduce((a, b) => a + b, 0), games: ppgValues.length, ppg: mean(ppgValues) },
      offensive_snaps: participation(rows, g => g.snap_count > 0), meaningful_participation: participation(rows, g => g.snap_count >= 10),
      observed_zero_offensive_snap_games: rows.filter(g => g.snap_count === 0).length, active_games: null, true_dnps: null,
      explanation: "Snap participation is observable; active/DNP status cannot be inferred from absent stat rows. Bye weeks are schedule context, never zero-point appearances." },
  };
}
function participation(rows, predicate) {
  const games = rows.filter(predicate), known = games.filter(g => numeric(g.points));
  return { games: games.length, scored_games: known.length, missing_scoring_games: games.length - known.length,
    points: known.reduce((s, g) => s + g.points, 0), ppg: known.length === games.length ? mean(known.map(g => g.points)) : null };
}

export function forecast(features, weights) {
  const inputs = [features.quality_points, features.recent_ppg, features.recent_xfp,
    features.opportunity.coverage >= 65 && features.opportunity.score != null ? features.opportunity.score / 100 * (features.position === "QB" ? 25 : 20) : null];
  const used = inputs.map((v, i) => numeric(v) && weights[i] > 0 ? weights[i] : 0), coverage = used.reduce((a, b) => a + b, 0);
  // A missing predictor is an explicit fallback to historical quality, not weight renormalization.
  const fallback = features.quality_points;
  if (!numeric(fallback)) return { central: null, coverage, inputs, fallback: "No quality baseline" };
  return { central: inputs.reduce((sum, v, i) => sum + (numeric(v) ? v : fallback) * weights[i], 0), coverage,
    inputs, weights, fallback: coverage < 0.999 ? "Missing predictors use the disclosed historical quality prior" : null };
}

