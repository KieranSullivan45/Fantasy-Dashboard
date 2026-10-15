// EDGE-01 point-forecast candidate family and walk-forward driver (research only; writes no calibration).
import { numeric, mean } from "../../decision/features.js";
import { sustained } from "./features.js";
import { ridge, predictLinear } from "./fit.js";

export const POSITIONS = ["QB", "RB", "WR", "TE"];
export const PRIMARY_FOLDS = [2022, 2023, 2024, 2025];
export const DEVELOPMENT_FOLDS = [2019, 2020, 2021];
export const FIRST_TRAINING_SEASON = 2016;

const m = (c, metric, w) => c.inputs.opp?.metrics?.[metric]?.[w] ?? null;
const vip2 = c => m(c, "vip", "last2"), vipS = c => m(c, "vip", "season"), snap2 = c => m(c, "snap_share", "last2");
const has = (...xs) => xs.every(numeric);
export const sustainedRoleChange = c => !!c.inputs.opp && (sustained(c.inputs.opp.metrics.vip, 3) !== 0 || sustained(c.inputs.opp.metrics.snap_share, 0.10) !== 0);

/** Controls: fixed formulas, no selection. `prod` contains betting-derived xFP where the season has it (≥ 2021). */
export const CONTROLS = {
  prod: { betting_derived: true, predict: c => c.inputs.prod },
  noX: { betting_derived: false, predict: c => c.inputs.noX },
  Q: { betting_derived: false, predict: c => c.inputs.Q },
  S: { betting_derived: false, predict: c => c.inputs.S },
  EW3: { betting_derived: false, predict: c => c.inputs.EW3 },
  EW5: { betting_derived: false, predict: c => c.inputs.EW5 },
  R3: { betting_derived: false, predict: c => c.inputs.R3 },
  last1: { betting_derived: false, predict: c => c.inputs.last1 },
};

const RIDGE_FEATURES = c => [c.inputs.Q, c.inputs.R3, c.inputs.S, c.inputs.ewall[16], vip2(c), vipS(c), snap2(c)];
const RIDGE_X_FEATURES = c => [...RIDGE_FEATURES(c), c.inputs.X, c.inputs.X_season];

/** Candidate families from the analysis plan. predict(c, param, model) returns null when an input is missing (→ noX fallback). */
export const FAMILIES = {
  A1_qr: { family: "recency", betting_derived: false, grid: [0.6, 0.7, 0.8, 0.9, 1.0],
    predict: (c, w) => has(c.inputs.Q, c.inputs.R3) ? w * c.inputs.Q + (1 - w) * c.inputs.R3 : null },
  A2_qrv: { family: "role level (VIP)", betting_derived: false, grid: [0.05, 0.1, 0.15, 0.2, 0.3],
    predict: (c, w) => has(c.inputs.Q, c.inputs.R3, vip2(c)) ? (0.8 - w) * c.inputs.Q + 0.2 * c.inputs.R3 + w * vip2(c) : null },
  A3_qrx: { family: "xFP refit", betting_derived: true, minTest: 2023, grid: [0, 0.1, 0.15, 0.2, 0.25, 0.3],
    predict: (c, w) => has(c.inputs.Q, c.inputs.R3, c.inputs.X) ? (0.8 - w) * c.inputs.Q + 0.2 * c.inputs.R3 + w * c.inputs.X : null },
  B1_h9_noX: { family: "EW prior (ADR 0009 ew2_h16)", betting_derived: false, grid: [null],
    predict: c => has(c.inputs.h9q, c.inputs.R3) ? 0.8 * c.inputs.h9q + 0.2 * c.inputs.R3 : null },
  B1_h9_prod: { family: "EW prior (ADR 0009 ew2_h16), production frame", betting_derived: true, grid: [null],
    // Same as production with Q replaced by H9 Q; a missing X still falls back to (H9) Q, as production does.
    predict: c => has(c.inputs.h9q, c.inputs.R3) ? 0.6 * c.inputs.h9q + 0.2 * c.inputs.R3 + 0.2 * (numeric(c.inputs.X) ? c.inputs.X : c.inputs.h9q) : null },
  B2_ewall: { family: "EW all games", betting_derived: false, grid: [8, 12, 16, 24],
    predict: (c, h) => has(c.inputs.ewall[h], c.inputs.R3) ? 0.8 * c.inputs.ewall[h] + 0.2 * c.inputs.R3 : null },
  C1_role_always: { family: "role change (ungated)", betting_derived: false, grid: [0.1, 0.2, 0.3, 0.5],
    predict: (c, b) => has(c.inputs.noX, vip2(c), vipS(c)) ? c.inputs.noX + b * (vip2(c) - vipS(c)) : null },
  C2_role_gated: { family: "role change (sustained-gated)", betting_derived: false, grid: [0.1, 0.2, 0.3, 0.5],
    predict: (c, b) => !numeric(c.inputs.noX) ? null : sustainedRoleChange(c) && has(vip2(c), vipS(c)) ? c.inputs.noX + b * (vip2(c) - vipS(c)) : c.inputs.noX },
  D1_ridge: { family: "ridge (7 features)", betting_derived: false, grid: [1, 10, 100, 1000], features: RIDGE_FEATURES,
    fit: (rows, lambda, y) => ridge(rows.map(c => ({ x: RIDGE_FEATURES(c), y: y(c) })), lambda),
    predict: (c, lambda, model) => predictLinear(model, RIDGE_FEATURES(c)) },
  D2_ridge_x: { family: "ridge + xFP (9 features)", betting_derived: true, minTest: 2023, minTrain: 2021, grid: [1, 10, 100, 1000], features: RIDGE_X_FEATURES,
    fit: (rows, lambda, y) => ridge(rows.map(c => ({ x: RIDGE_X_FEATURES(c), y: y(c) })), lambda),
    predict: (c, lambda, model) => predictLinear(model, RIDGE_X_FEATURES(c)) },
  // ---- Post-hoc (class X): added after the pre-registered families were scored, to locate the A2 grid edge, test H9 + VIP
  // together, and measure what xFP adds once VIP is present. Labelled post_hoc everywhere; never promotion evidence alone.
  X1_qrv_wide: { family: "role level (VIP), extended grid", post_hoc: true, betting_derived: false, grid: [0.3, 0.4, 0.5, 0.6],
    predict: (c, w) => has(c.inputs.Q, c.inputs.R3, vip2(c)) ? (0.8 - w) * c.inputs.Q + 0.2 * c.inputs.R3 + w * vip2(c) : null },
  X2_h9_qrv: { family: "H9 prior + role level (VIP)", post_hoc: true, betting_derived: false, grid: [0.05, 0.1, 0.15, 0.2, 0.3, 0.4],
    predict: (c, w) => has(c.inputs.h9q, c.inputs.R3, vip2(c)) ? (0.8 - w) * c.inputs.h9q + 0.2 * c.inputs.R3 + w * vip2(c) : null },
  X3_prod_plus_vip: { family: "production + VIP (xFP incremental check)", post_hoc: true, betting_derived: true, grid: [0.05, 0.1, 0.15, 0.2, 0.3],
    predict: (c, w) => has(c.inputs.Q, c.inputs.R3, vip2(c)) ? (0.6 - w) * c.inputs.Q + 0.2 * c.inputs.R3 + 0.2 * (numeric(c.inputs.X) ? c.inputs.X : c.inputs.Q) + w * vip2(c) : null },
  // Spread controls (class X): shrink a forecast toward its own as-of week × position mean (inputs only, no outcome). They test
  // whether a candidate's MAE gain is information or merely a smaller forecast spread (calibration slope < 1 in production).
  X4_prod_shrunk: { family: "production shrunk toward week×position mean", post_hoc: true, betting_derived: true, grid: [0, 0.05, 0.1, 0.15, 0.2, 0.3],
    predict: (c, l) => has(c.inputs.prod, c.inputs.prod_wp_mean) ? (1 - l) * c.inputs.prod + l * c.inputs.prod_wp_mean : null },
  X5_noX_shrunk: { family: "noX shrunk toward week×position mean", post_hoc: true, betting_derived: false, grid: [0, 0.05, 0.1, 0.15, 0.2, 0.3],
    predict: (c, l) => has(c.inputs.noX, c.inputs.noX_wp_mean) ? (1 - l) * c.inputs.noX + l * c.inputs.noX_wp_mean : null },
};

/** As-of week × position means of forecasts, over every case of that week (inputs only; outcomes never read). */
export function attachWeekPositionMeans(cases) {
  const groups = new Map(); for (const c of cases) { const k = `${c.season}:${c.week}:${c.position}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(c); }
  for (const g of groups.values()) { const p = mean(g.map(c => c.inputs.prod)), n = mean(g.map(c => c.inputs.noX)); for (const c of g) { c.inputs.prod_wp_mean = p; c.inputs.noX_wp_mean = n; } }
}

const maeOf = (cases, pred, y) => mean(cases.map(c => { const p = pred(c), t = y(c); return numeric(p) && numeric(t) ? Math.abs(p - t) : null; }));
const withFallback = (p, c) => numeric(p) ? p : c.inputs.noX;

/**
 * Walk-forward fold for one family. Per position: fit on training seasons [FIRST_TRAINING_SEASON…Y−2] (fitted families),
 * pick the grid value with the lowest Y−1 MAE, score once on Y. Returns predictions for the test cases plus the choices.
 */
export function runFold(familyId, casesBySeason, Y, y = c => c.outcome.actual, { gridByPosition } = {}) {
  const fam = FAMILIES[familyId], choices = {}, preds = new Map();
  const trainSeasons = []; for (let s = Math.max(FIRST_TRAINING_SEASON, fam.minTrain ?? 0); s <= Y - 2; s++) trainSeasons.push(s);
  for (const pos of POSITIONS) {
    const train = trainSeasons.flatMap(s => (casesBySeason[s] || []).filter(c => c.position === pos));
    const select = (casesBySeason[Y - 1] || []).filter(c => c.position === pos), test = (casesBySeason[Y] || []).filter(c => c.position === pos);
    let best = null;
    for (const param of gridByPosition?.[pos] ?? fam.grid) {
      const model = fam.fit ? fam.fit(train, param, y) : null;
      if (fam.fit && !model) continue;
      const score = maeOf(select, c => withFallback(fam.predict(c, param, model), c), y);
      if (score !== null && (!best || score < best.score - 1e-12)) best = { param, model, score };
    }
    if (!best) continue;
    choices[pos] = { param: best.param, selection_mae: best.score, selection_season: Y - 1, training_seasons: fam.fit ? trainSeasons : [],
      coefficients: best.model ? best.model.coef : undefined, training_rows: best.model?.n };
    let fallbacks = 0;
    for (const c of test) { const p = fam.predict(c, best.param, best.model); if (!numeric(p)) fallbacks++; preds.set(c, withFallback(p, c)); }
    choices[pos].fallback_rate = test.length ? fallbacks / test.length : null;
  }
  return { choices, preds };
}

export const foldsFor = familyId => [...DEVELOPMENT_FOLDS, ...PRIMARY_FOLDS].filter(Y => Y >= (FAMILIES[familyId].minTest ?? 0));
