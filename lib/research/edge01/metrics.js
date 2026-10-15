// EDGE-01 evaluation metrics. Pure functions over [{ c, pred, y }] rows; rows with a missing prediction or outcome are dropped
// by the caller's frame builder, never scored as zero.
import { mean, numeric, quantile } from "../../decision/features.js";
import { spearman } from "../../backtest/evaluate.js";

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const groupBy = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)).push(r); } return m; };

function pairAccuracy(groups, { minGap = 0 } = {}) {
  let n = 0, correct = 0;
  for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const a = g[i], b = g[j]; if (a.y === b.y) continue;
    const d = a.pred - b.pred; if (Math.abs(d) < minGap) continue;
    n++; correct += d === 0 ? 0.5 : Math.sign(d) === Math.sign(a.y - b.y) ? 1 : 0;
  }
  return n ? correct / n : null;
}

export function pointMetrics(rows, { pairs = true } = {}) {
  if (!rows.length) return { n: 0 };
  const err = rows.map(r => r.pred - r.y), abs = err.map(Math.abs);
  const mp = mean(rows.map(r => r.pred)), my = mean(rows.map(r => r.y));
  const sxy = rows.reduce((s, r) => s + (r.pred - mp) * (r.y - my), 0), sxx = rows.reduce((s, r) => s + (r.pred - mp) ** 2, 0);
  const groups = [...groupBy(rows, r => `${r.c.season}:${r.c.week}:${r.c.position}`).values()];
  const rost = groups.map(g => g.filter(r => r.c.rosterable)).filter(g => g.length >= 3);
  const sp = gs => mean(gs.map(g => g.length >= 3 ? spearman(g.map(r => r.pred), g.map(r => r.y)) : null));
  return {
    n: rows.length, players: new Set(rows.map(r => r.c.player_id)).size,
    mae: mean(abs), rmse: Math.sqrt(mean(err.map(e => e * e))), median_ae: quantile(abs, 0.5), bias: mean(err),
    calibration_slope: sxx ? sxy / sxx : null,
    spearman_all: sp(groups), spearman_rosterable: sp(rost),
    ...(pairs ? { pair_accuracy_all: pairAccuracy(groups), pair_accuracy_rosterable: pairAccuracy(rost), pair_accuracy_rosterable_gap2: pairAccuracy(rost, { minGap: 2 }) } : {}),
  };
}

export const STRATA = { weeks_3_5: c => c.week <= 5, weeks_6_9: c => c.week >= 6 && c.week <= 9, weeks_10_17: c => c.week >= 10 };
export function sliced(rows, opts) {
  const out = { all: pointMetrics(rows, opts), position: {}, stratum: {} };
  for (const p of ["QB", "RB", "WR", "TE"]) out.position[p] = pointMetrics(rows.filter(r => r.c.position === p), opts);
  for (const [k, f] of Object.entries(STRATA)) out.stratum[k] = pointMetrics(rows.filter(r => f(r.c)), { pairs: false });
  return out;
}

/** Paired cluster bootstrap of Δ MAE (a − b); clusters by player and by season-week; the wider 95% interval is reported. */
export function pairedDelta(rowsA, rowsB, { draws = 1000, seed = 1 } = {}) {
  const key = r => `${r.c.season}:${r.c.week}:${r.c.player_id}`, bMap = new Map(rowsB.map(r => [key(r), r]));
  const pairs = rowsA.filter(r => bMap.has(key(r))).map(r => ({ c: r.c, d: Math.abs(r.pred - r.y) - Math.abs(bMap.get(key(r)).pred - r.y) }));
  if (!pairs.length) return null;
  const est = mean(pairs.map(p => p.d));
  const ci = clusterOf => {
    const clusters = [...groupBy(pairs, clusterOf).values()].map(g => [g.reduce((s, p) => s + p.d, 0), g.length]);
    const rand = rng(seed), stats = [];
    for (let b = 0; b < draws; b++) { let s = 0, m = 0; for (let i = 0; i < clusters.length; i++) { const [cs, cn] = clusters[Math.floor(rand() * clusters.length)]; s += cs; m += cn; } stats.push(s / m); }
    return [quantile(stats, 0.025), quantile(stats, 0.975)];
  };
  const byPlayer = ci(p => p.c.player_id), byWeek = ci(p => `${p.c.season}:${p.c.week}`);
  const wider = byPlayer[1] - byPlayer[0] >= byWeek[1] - byWeek[0] ? byPlayer : byWeek;
  return { n: pairs.length, delta_mae: est, ci95: wider, ci_by_player: byPlayer, ci_by_season_week: byWeek,
    clusters: { players: new Set(pairs.map(p => p.c.player_id)).size, season_weeks: new Set(pairs.map(p => `${p.c.season}:${p.c.week}`)).size } };
}

/** Binary-flag metrics against a binary outcome. */
export function flagMetrics(rows) {
  // rows: [{ flag: bool, event: bool, value: number (window mean points) }]
  const n = rows.length, events = rows.filter(r => r.event).length, flagged = rows.filter(r => r.flag), tp = flagged.filter(r => r.event).length;
  const base = n ? events / n : null, precision = flagged.length ? tp / flagged.length : null;
  const fp = flagged.filter(r => !r.event);
  return { n, events, base_rate: base, flagged: flagged.length, true_positives: tp, precision, lift: precision != null && base ? precision / base : null,
    recall: events ? tp / events : null, false_positive_rate: n - events ? fp.length / (n - events) : null,
    false_positive_window_points_vs_pool: fp.length ? mean(fp.map(r => r.value)) - mean(rows.map(r => r.value)) : null };
}

/** Average precision (PR-AUC) for a score; ties broken by a stable key. */
export function averagePrecision(rows) {
  // Missing scores rank last (never dropped), so coverage gaps cannot inflate precision.
  const sc = r => numeric(r.score) ? r.score : -Infinity;
  const s = [...rows].sort((a, b) => sc(b) - sc(a) || a.key.localeCompare(b.key));
  const P = s.filter(r => r.event).length; if (!P) return null;
  let tp = 0, ap = 0; s.forEach((r, i) => { if (r.event) { tp++; ap += tp / (i + 1); } });
  return ap / P;
}
