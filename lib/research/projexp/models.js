// Projection experiment model specs and walk-forward fitting (research only, class X; writes no calibration).
// Weekly target: next-game PPR points (played only). ROS targets: points per played game over weeks w..17 and the share of
// scheduled games with a stat row. Betting-derived models are labelled and always reported beside their non-betting twin.
import { numeric, mean, quantile } from "../../decision/features.js";
import { ridge, predictLinear } from "../edge01/fit.js";
import { fitGbm, predictGbm } from "./gbm.js";
import { BETTING_DERIVED_FEATURES } from "./context.js";

export const POSITIONS = ["QB", "RB", "WR", "TE"];

export const WEEKLY_FEATURES = ["Q", "S", "P", "P_ew16", "h9q", "R3", "EW3", "EW5", "last1", "ew8", "ew16", "ew24", "n", "k", "changed_team", "calendar_gap",
  "snap_last1", "snap_last2", "snap_last3", "snap_season", "tgtsh_last3", "tgtsh_season", "carsh_last3", "carsh_season", "targets_last3", "carries_last3",
  "air_last3", "airsh_season", "wopr_last3", "vip_last2", "vip_last3", "vip_season", "team_pass_att_season", "team_plays_season", "pts_vol4", "played_rate",
  "opp_factor", "home", "rest", "opp_rest", "dome", "week"];
export const BETTING_FEATURES = ["implied_total", "spread_for", "game_total"];
export const ROS_FEATURES = [...WEEKLY_FEATURES.filter(f => !["home", "rest", "opp_rest", "dome", "opp_factor"].includes(f)), "ros_games", "ros_opp_factor"];

export const isBettingDerived = features => features.some(f => BETTING_DERIVED_FEATURES.has(f));
const vec = (row, features) => features.map(k => (numeric(row.f[k]) ? row.f[k] : NaN));

/** Per-position GBM fitted on training rows with a numeric target. */
export function fitGbmByPosition(train, target, features, params) {
  const models = {};
  for (const p of POSITIONS) {
    const rows = train.filter(r => r.position === p && numeric(target(r)));
    models[p] = fitGbm(rows.map(r => vec(r, features)), rows.map(target), params);
  }
  return { kind: "gbm", features, models, predict: r => predictGbm(models[r.position], vec(r, features)) };
}

/** Per-position OLS/ridge (complete-case fit); predictions null when an input is missing (caller decides the fallback). */
export function fitLinearByPosition(train, target, features, lambda = 0) {
  const models = {};
  for (const p of POSITIONS) models[p] = ridge(train.filter(r => r.position === p).map(r => ({ x: features.map(k => r.f[k]), y: target(r) })), lambda);
  return { kind: "linear", features, models, predict: r => predictLinear(models[r.position], features.map(k => r.f[k])) };
}

/**
 * Walk-forward conformal intervals: residual quantiles of out-of-sample predictions from earlier folds, binned by position
 * and prediction quintile (bin edges from those same earlier predictions). Nothing from the scored season is used.
 */
export const QUANTILES = [0.1, 0.25, 0.5, 0.75, 0.9];
export function residualQuantiles(oos, { bins = 5 } = {}) {
  const out = {};
  for (const p of POSITIONS) {
    const rows = oos.filter(r => r.position === p && numeric(r.pred) && numeric(r.y));
    if (rows.length < 50) continue;
    const preds = rows.map(r => r.pred), edges = Array.from({ length: bins - 1 }, (_, i) => quantile(preds, (i + 1) / bins));
    const groups = Array.from({ length: bins }, () => []);
    for (const r of rows) groups[binIndex(edges, r.pred)].push(r.y - r.pred);
    out[p] = { edges, q: groups.map(g => QUANTILES.map(q => quantile(g, q))), n: groups.map(g => g.length) };
  }
  return out;
}
const binIndex = (edges, x) => { let i = 0; while (i < edges.length && x > edges[i]) i++; return i; };
export function intervalFor(rq, position, pred) {
  const m = rq[position]; if (!m || !numeric(pred)) return null;
  return m.q[binIndex(m.edges, pred)].map(r => pred + r);
}

/** Interval/quantile scoring: coverage, width and mean pinball loss over QUANTILES. */
export function intervalMetrics(rows) {
  const ok = rows.filter(r => r.q && numeric(r.y));
  if (!ok.length) return { n: 0 };
  const pin = (y, q, tau) => (y >= q ? tau * (y - q) : (1 - tau) * (q - y));
  return { n: ok.length,
    coverage80: mean(ok.map(r => +(r.y >= r.q[0] && r.y <= r.q[4]))), coverage50: mean(ok.map(r => +(r.y >= r.q[1] && r.y <= r.q[3]))),
    width80: mean(ok.map(r => r.q[4] - r.q[0])), below_p10: mean(ok.map(r => +(r.y < r.q[0]))), above_p90: mean(ok.map(r => +(r.y > r.q[4]))),
    pinball: mean(ok.map(r => mean(QUANTILES.map((t, i) => pin(r.y, r.q[i], t))))), median_mae: mean(ok.map(r => Math.abs(r.y - r.q[2]))) };
}
