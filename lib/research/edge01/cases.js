// EDGE-01 case table. Membership, production features and the production forecast come from repo code read-only
// (lib/backtest/evaluate.js buildCases -> lib/decision/features.js weeklyFeatures/forecast). Outcomes are kept apart
// from inputs under `outcome` so leakage tests can prove inputs never change when future rows are removed.
import { buildCases } from "../../backtest/evaluate.js";
import { forecast, mean, numeric } from "../../decision/features.js";
import { CALIBRATION } from "../../decision/calibration/weights.js";
import { assertNotSealed } from "./data.js";
import { opportunityFeatures, ewTwoSeasonPrior, ewAllGames, VIP_INPUTS } from "./features.js";
import { ridge } from "./fit.js";

export const WEEKS = [3, 17];
export const ROSTERABLE = { QB: 24, RB: 48, WR: 60, TE: 24 };
export const EW_ALL_HALF_LIVES = [8, 12, 16, 24];

/** Points for one research format, keeping every other field. */
export const withFormat = (games, format) => games.map(g => ({ ...g,
  points: g.points_by_format ? g.points_by_format[format] ?? null : format === "ppr" ? g.points : null,
  xfp: g.xfp_by_format ? g.xfp_by_format[format] ?? null : format === "ppr" ? g.xfp : null,
  fpoe: g.fpoe_by_format ? g.fpoe_by_format[format] ?? null : format === "ppr" ? g.fpoe : null }));

/** VIP map fitted on the given (training-only) game rows, per position, OLS with intercept. */
export function fitVipModel(games) {
  const model = {};
  for (const [position, inputs] of Object.entries(VIP_INPUTS)) {
    const fit = ridge(games.filter(g => g.position === position).map(g => ({ x: inputs.map(k => g[k]), y: g.points })), 0);
    if (fit) model[position] = { coef: fit.coef, inputs, n: fit.n };
  }
  return model;
}

const ew = (pts, h) => { if (!pts.length) return null; let s = 0, w = 0; pts.forEach((p, i) => { const wt = 0.5 ** ((pts.length - 1 - i) / h); s += wt * p; w += wt; }); return s / w; };

/**
 * Cases for one season/format. `gamesBySeason` holds per-season game rows (already in the requested format);
 * Y, Y−1 and Y−2 are used, nothing later than Y and nothing at or after the case week inside Y.
 */
export function buildCaseTable(gamesBySeason, season, { vipModel, draft = new Map() } = {}) {
  assertNotSealed(season);
  const current = gamesBySeason[season] || [], prior1 = gamesBySeason[season - 1] || [], prior2 = gamesBySeason[season - 2] || [];
  const { cases, missing_weekly_outcomes } = buildCases([...prior1, ...current], season);
  const byPlayer = new Map();
  for (const g of [...prior2, ...prior1, ...current]) (byPlayer.get(g.player_id) ?? byPlayer.set(g.player_id, []).get(g.player_id)).push(g);
  const out = [];
  for (const c of cases) {
    if (c.week < WEEKS[0] || c.week > WEEKS[1] || !CALIBRATION[c.position]) continue;
    const rows = byPlayer.get(c.player_id) || [];
    const ft = c.features, w = CALIBRATION[c.position].start.weights;
    const hist = rows.filter(r => r.season === season && r.week < c.week).sort((a, b) => a.week - b.week);
    const pts = hist.map(r => r.points).filter(numeric);
    const pEw = ewTwoSeasonPrior(rows, season, 16), k = ft.prior.effective_games, n = ft.current_games, S = ft.season_ppg;
    // H9 ew2_h16 Q with production's numeric k (ADR 0009/0011): only P is replaced, k is never recomputed.
    const h9q = pEw === null ? ft.quality_points : S === null ? pEw : (S * n + pEw * k) / (n + k);
    const future = rows.filter(r => r.season === season && r.week >= c.week && r.week <= c.week + 3).sort((a, b) => a.week - b.week)
      .map(r => ({ week: r.week, points: r.points, snap_share: r.snap_share, target_share: r.target_share, carry_share: r.carry_share }));
    out.push({
      season, week: c.week, player_id: c.player_id, position: c.position, team: hist.at(-1)?.team ?? null,
      draft_round: draft.get(c.player_id) ?? null,
      inputs: {
        n, k, S, Q: ft.quality_points, P: ft.prior.ppg, R3: ft.recent_ppg, X: ft.recent_xfp, X_season: ft.xfp_per_game,
        changed_team: ft.changed_team, role_change: ft.role_change,
        prod: forecast(ft, w).central, noX: forecast(ft, [0.8, 0.2, 0, 0]).central,
        EW3: ew(pts, 3), EW5: ew(pts, 5), last1: pts.at(-1) ?? null, P_ew16: pEw, h9q,
        ewall: Object.fromEntries(EW_ALL_HALF_LIVES.map(h => [h, ewAllGames(rows, season, c.week, h)])),
        opp: opportunityFeatures(rows, { season, week: c.week, vipModel }),
      },
      // Outcomes: realised next-game points (played only; null = no stat row, never zero) and the w..w+3 window.
      outcome: { actual: c.actual, future },
      production_features: ft,
    });
  }
  // As-of rosterable flag: top-N by as-of Q within season × week × position (no end-of-season information).
  const groups = new Map();
  for (const c of out) { const key = `${c.week}:${c.position}`; (groups.get(key) ?? groups.set(key, []).get(key)).push(c); }
  for (const g of groups.values()) {
    [...g].sort((a, b) => (b.inputs.Q ?? -Infinity) - (a.inputs.Q ?? -Infinity) || a.player_id.localeCompare(b.player_id))
      .forEach((c, i) => { c.rosterable = i < ROSTERABLE[c.position]; });
  }
  return { cases: out, missing_weekly_outcomes, cases_without_outcome: out.filter(c => !numeric(c.outcome.actual)).length };
}

export const meanOf = mean;
