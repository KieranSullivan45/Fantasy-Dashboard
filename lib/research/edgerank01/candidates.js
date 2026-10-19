// EDGE-RANK-01 ranking-oriented candidates and walk-forward runner (research only, class X; writes no calibration).
// Reuses the EDGE-01 case table. No candidate here reads xFP or any other betting-derived input.
import { numeric, mean } from "../../decision/features.js";
import { ridge, predictLinear } from "../edge01/fit.js";
import { pointMetrics } from "../edge01/metrics.js";

export const POSITIONS = ["QB", "RB", "WR", "TE"];
export const FIRST_TRAINING_SEASON = 2016;

const m = (c, metric, w) => c.inputs.opp?.metrics?.[metric]?.[w] ?? null;
export const F = {
  Q: c => c.inputs.Q, S: c => c.inputs.S, R3: c => c.inputs.R3, EW16: c => c.inputs.ewall[16],
  vip2: c => m(c, "vip", "last2"), vipS: c => m(c, "vip", "season"), snap2: c => m(c, "snap_share", "last2"), snapS: c => m(c, "snap_share", "season"),
  prod: c => c.inputs.prod, noX: c => c.inputs.noX,
};
const has = (...xs) => xs.every(numeric);
export const vipA2 = (c, w = 0.3) => has(F.Q(c), F.R3(c), F.vip2(c)) ? (0.8 - w) * F.Q(c) + 0.2 * F.R3(c) + w * F.vip2(c) : null;

const RIDGE7 = ["Q", "R3", "S", "EW16", "vip2", "vipS", "snap2"];
const linear = (features, grid, extra = {}) => ({ kind: "linear", features, grid, betting_derived: false, ...extra });
const formula = (predict, grid = [null], extra = {}) => ({ kind: "formula", predict, grid, betting_derived: false, ...extra });

/** Baselines: fixed formulas (prod is the control and contains betting-derived xFP from 2021). */
export const BASELINES = {
  prod: formula(c => c.inputs.prod, [null], { betting_derived: true, cls: "control" }),
  noX: formula(c => c.inputs.noX, [null], { cls: "baseline" }),
  Q: formula(F.Q, [null], { cls: "baseline" }), S: formula(F.S, [null], { cls: "baseline" }), R3: formula(F.R3, [null], { cls: "baseline" }),
  VIP_A2: formula(c => vipA2(c), [null], { cls: "baseline", note: "EDGE-01 fixed w=0.3" }),
  D1_ridge: linear(RIDGE7, [1, 10, 100, 1000], { cls: "baseline", note: "EDGE-01 D1 replica (lambda by Y-1 MAE)" }),
};

/** Candidate classes A/B/C and spread/level controls (complete search space; see docs/research/edge-rank-01-analysis-plan.md). */
export const CANDIDATES = {
  A1_q_vip: linear(["Q", "vip2"], [0], { cls: "A" }),
  A2_q_vip_snap: linear(["Q", "vip2", "snap2"], [0], { cls: "A" }),
  A3_q_r3_vip_snap: linear(["Q", "R3", "vip2", "snap2"], [0], { cls: "A" }),
  A4_vipA2_recal: linear([c => vipA2(c)], [0], { cls: "A" }),
  B1_ridge7_l100: linear(RIDGE7, [100], { cls: "B" }),
  B2_noVIP: linear(["Q", "R3", "S", "EW16", "snap2"], [100], { cls: "B" }),
  B3_noRecency: linear(["Q", "S", "EW16", "vipS", "snapS"], [100], { cls: "B" }),
  B4_noSnap: linear(["Q", "R3", "S", "EW16", "vip2", "vipS"], [100], { cls: "B" }),
  B5_dedupLevel: linear(["Q", "R3", "vip2", "vipS", "snap2"], [100], { cls: "B" }),
  // B6: shrink B1 toward Q, built after the walk-forward (fixed a, no selection).
  C_ridge7: linear(RIDGE7, [1, 10, 100, 1000, 10000], { cls: "C", objectiveSelected: true }),
  C_vipBlend: formula((c, w) => vipA2(c, w), [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], { cls: "C", objectiveSelected: true }),
  // Post-hoc (added after the first full run showed snap_last2 carries most of the ridge lineup gain; disclosed as such).
  P1_q_snap: linear(["Q", "snap2"], [0], { cls: "P", post_hoc: true }),
  P2_q_r3_snap: linear(["Q", "R3", "snap2"], [0], { cls: "P", post_hoc: true }),
  P3_q_snapSeason: linear(["Q", "snapS"], [0], { cls: "P", post_hoc: true }),
  // Post-hoc round 2 (added after the standardized-coefficient table showed EW16 and snap_last2 carry the ridge; disclosed).
  P4_ew_snap: linear(["EW16", "snap2"], [0], { cls: "P", post_hoc: true }),
  P5_ew_r3_snap: linear(["EW16", "R3", "snap2"], [0], { cls: "P", post_hoc: true }),
  P6_ew_s_r3_snap: linear(["EW16", "S", "R3", "snap2"], [0], { cls: "P", post_hoc: true }),
  R_prod_recal: linear(["prod"], [0], { cls: "control", betting_derived: true }),
  R_Q_recal: linear(["Q"], [0], { cls: "control" }),
  R_noX_recal: linear(["noX"], [0], { cls: "control" }),
};
export const SHRINK = [0.25, 0.5, 0.75];

const featureFns = spec => spec.features.map(f => typeof f === "function" ? f : F[f]);
const xOf = (spec, c) => featureFns(spec).map(f => f(c));

/** Fit a linear spec on training cases; also returns standardized coefficients (beta × training SD) for stability tables. */
export function fitLinear(spec, train, lambda, y) {
  const rows = train.map(c => ({ x: xOf(spec, c), y: y(c) })).filter(r => numeric(r.y) && r.x.every(numeric));
  const model = ridge(rows, lambda);
  if (!model) return null;
  const sds = model.coef.slice(1).map((_, j) => { const v = rows.map(r => r.x[j]), mu = mean(v); return Math.sqrt(mean(v.map(x => (x - mu) ** 2))); });
  return { ...model, std_coef: model.coef.slice(1).map((b, j) => b * sds[j]) };
}
export const predictWith = (spec, c, param, model) => spec.kind === "formula" ? spec.predict(c, param) : predictLinear(model, xOf(spec, c));
export const withFallback = (p, c) => numeric(p) ? p : c.inputs.noX;

/** Ranking/point objectives for selection (all pre-existing EDGE-01 metrics; lower is better after sign). */
export const OBJECTIVES = {
  mae: rows => pointMetrics(rows, { pairs: false }).mae,
  spearman_all: rows => -pointMetrics(rows, { pairs: false }).spearman_all,
  pair_rosterable: rows => -pointMetrics(rows).pair_accuracy_rosterable,
  pair_rosterable_gap2: rows => -pointMetrics(rows).pair_accuracy_rosterable_gap2,
};

/**
 * Walk-forward predictions for every grid value: fit on FIRST_TRAINING_SEASON..Y−2, predict Y−1 (selection) and Y (test).
 * Returns per position per param { model, select: Map, test: Map }. Selection happens in selectParams.
 */
export function gridFold(spec, casesBySeason, Y, y) {
  const trainSeasons = []; for (let s = FIRST_TRAINING_SEASON; s <= Y - 2; s++) trainSeasons.push(s);
  const out = {};
  for (const pos of POSITIONS) {
    const train = trainSeasons.flatMap(s => (casesBySeason[s] || []).filter(c => c.position === pos));
    const select = (casesBySeason[Y - 1] || []).filter(c => c.position === pos), test = (casesBySeason[Y] || []).filter(c => c.position === pos);
    out[pos] = spec.grid.map(param => {
      const model = spec.kind === "linear" ? fitLinear(spec, train, param, y) : null;
      if (spec.kind === "linear" && !model) return null;
      const pred = c => withFallback(predictWith(spec, c, param, model), c);
      let fallbacks = 0; const testMap = new Map(test.map(c => { const raw = predictWith(spec, c, param, model); if (!numeric(raw)) fallbacks++; return [c, withFallback(raw, c)]; }));
      return { param, model, select: new Map(select.map(c => [c, pred(c)])), test: testMap, fallback_rate: test.length ? fallbacks / test.length : null, training_seasons: trainSeasons };
    }).filter(Boolean);
  }
  return out;
}

/** Per-position selection on Y−1 by a row objective, or a shared (global) param chosen by a joint scorer (lineup). */
export function selectParams(grid, { objective, frameOf, jointScore }) {
  const choice = {};
  if (jointScore) {
    const params = grid.QB.map(g => g.param);
    let best = null;
    for (const param of params) {
      const sel = new Map(); for (const pos of POSITIONS) for (const [c, p] of grid[pos].find(g => g.param === param)?.select ?? []) sel.set(c, p);
      const score = jointScore(sel);
      if (numeric(score) && (!best || score < best.score - 1e-12)) best = { param, score };
    }
    for (const pos of POSITIONS) choice[pos] = { ...grid[pos].find(g => g.param === best.param), selection_score: best.score };
    return choice;
  }
  for (const pos of POSITIONS) {
    let best = null;
    for (const g of grid[pos]) {
      const score = OBJECTIVES[objective](frameOf(g.select));
      if (numeric(score) && (!best || score < best.selection_score - 1e-12)) best = { ...g, selection_score: score };
    }
    choice[pos] = best;
  }
  return choice;
}
