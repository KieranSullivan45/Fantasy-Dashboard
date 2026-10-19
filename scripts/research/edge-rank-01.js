// EDGE-RANK-01 ranking / lineup-edge research run (class X; offline; seasons ≤ 2025 only; PPR).
// Usage: node scripts/research/edge-rank-01.js [dataDir=.data/edge01] [--out=artifacts/research/edge-rank-01-results.json] [--seeds=3]
// Reuses the EDGE-01 data layer and case table unchanged. Writes no calibration and changes no production file.
import { mkdir, writeFile } from "node:fs/promises";
import { numeric, mean, quantile } from "../../lib/decision/features.js";
import { spearman } from "../../lib/backtest/evaluate.js";
import { MODEL_VERSION, FEATURE_VERSION } from "../../lib/decision/model-config.js";
import { loadSeasons, SEALED_SEASON } from "../../lib/research/edge01/data.js";
import { buildCaseTable, fitVipModel, withFormat } from "../../lib/research/edge01/cases.js";
import { sliced, pointMetrics, pairedDelta, rng } from "../../lib/research/edge01/metrics.js";
import { summarize } from "../../lib/research/edge01/lineup.js";
import { BASELINES, CANDIDATES, SHRINK, POSITIONS, gridFold, selectParams } from "../../lib/research/edgerank01/candidates.js";
import { STRUCTURES, simulate } from "../../lib/research/edgerank01/lineup.js";

const args = process.argv.slice(2), opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const dataDir = args.find(a => !a.startsWith("--")) || ".data/edge01";
const OUT = opt("out", "artifacts/research/edge-rank-01-results.json"), SEEDS = [...Array(Number(opt("seeds", 3))).keys()];
const PRIMARY = [2022, 2023, 2024, 2025], DEV = [2019, 2020, 2021], FOLDS = [...DEV, ...PRIMARY];
const round = v => typeof v === "number" ? (Number.isFinite(v) ? +v.toFixed(4) : null) : Array.isArray(v) ? v.map(round) : v instanceof Map ? undefined : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
const log = (...xs) => console.log(new Date().toISOString().slice(11, 19), ...xs);
const y = c => c.outcome.actual;
const groupBy = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)).push(x); } return m; };

// ---------- data and case table (EDGE-01, PPR) ----------
log("loading", dataDir);
const data = await loadSeasons(dataDir, 2014, 2025);
const games = Object.fromEntries(Object.entries(data.games).map(([s, g]) => [s, withFormat(g, "ppr")]));
const vipModel = fitVipModel([2014, 2015, 2016, 2017].flatMap(s => games[s]));
const cases = {}; for (let s = 2016; s <= 2025; s++) cases[s] = buildCaseTable(games, s, { vipModel, draft: data.draft }).cases;
if (Math.max(...Object.keys(data.games).map(Number)) >= SEALED_SEASON) throw new Error("sealed season loaded");
// Truncation canary on the inputs this run reads (same check as EDGE-01).
let compared = 0, mismatches = 0;
for (const [s, w] of [[2019, 6], [2022, 3], [2024, 11], [2025, 16]]) {
  const t = {}; for (const [season, g] of Object.entries(games)) if (Number(season) < s) t[season] = g; else if (Number(season) === s) t[season] = g.filter(r => r.week < w);
  const rebuilt = new Map(buildCaseTable(t, s, { vipModel, draft: data.draft }).cases.filter(c => c.week === w).map(c => [c.player_id, c]));
  for (const c of cases[s].filter(c => c.week === w)) { const r = rebuilt.get(c.player_id); compared++; if (!r || JSON.stringify(r.inputs) !== JSON.stringify(c.inputs) || r.rosterable !== c.rosterable) mismatches++; }
}
if (mismatches) throw new Error("truncation canary failed");
log("cases built; canary", compared, "compared, 0 mismatches");
const common = s => cases[s].filter(c => numeric(y(c)) && numeric(c.inputs.prod));

// ---------- lineup helpers ----------
const seasonWeeks = seasons => { const m = new Map(); for (const s of seasons) for (const c of common(s)) { const k = `${s}:${c.week}`; (m.get(k) ?? m.set(k, []).get(k)).push(c); } return m; };
const SW = Object.fromEntries([2018, ...FOLDS].map(s => [s, seasonWeeks([s])]));
const lineupScore = sel => { const rows = simulate(SW[[...sel.keys()][0].season], { cand: c => sel.get(c) ?? c.inputs.noX }, STRUCTURES.standard_1qb, 0); return -mean(rows.map(r => r.cand).filter(numeric)); };

// ---------- walk-forward ----------
const OBJECTIVE_NAMES = ["mae", "spearman_all", "pair_rosterable", "pair_rosterable_gap2", "lineup"];
const specs = { ...BASELINES, ...CANDIDATES };
const preds = {}, info = {};
const frameOf = sel => [...sel].map(([c, pred]) => ({ c, pred, y: y(c) })).filter(r => numeric(r.pred) && numeric(r.y));
for (const [id, spec] of Object.entries(specs)) {
  const objectives = spec.objectiveSelected ? OBJECTIVE_NAMES : ["mae"];
  const grids = Object.fromEntries(FOLDS.map(Y => [Y, gridFold(spec, cases, Y, y)]));
  for (const objective of objectives) {
    const name = spec.objectiveSelected ? `${id}@${objective}` : id, p = new Map(), folds = {};
    for (const Y of FOLDS) {
      const choice = selectParams(grids[Y], objective === "lineup" ? { jointScore: lineupScore } : { objective, frameOf });
      folds[Y] = Object.fromEntries(POSITIONS.map(pos => { const ch = choice[pos]; if (!ch) return [pos, null]; for (const [c, v] of ch.test) p.set(c, v);
        return [pos, { param: ch.param, selection_score: ch.selection_score, coef: ch.model?.coef, std_coef: ch.model?.std_coef, training_rows: ch.model?.n, fallback_rate: ch.fallback_rate }]; }));
    }
    preds[name] = p; info[name] = { id, cls: spec.cls, post_hoc: !!spec.post_hoc, betting_derived: spec.betting_derived, objective, grid: spec.grid, features: spec.features?.map(f => typeof f === "string" ? f : "VIP_A2"), note: spec.note, folds };
  }
  log("walk-forward", id);
}
for (const a of SHRINK) {
  const name = `B6_shrinkQ_${a}`, b = preds.B1_ridge7_l100;
  preds[name] = new Map([...b].map(([c, v]) => [c, numeric(c.inputs.Q) ? (1 - a) * v + a * c.inputs.Q : v]));
  info[name] = { id: "B6_shrinkQ", cls: "B", betting_derived: false, shrink_toward_Q: a, note: "(1-a)*B1 + a*Q, fixed a" };
}
const NAMES = Object.keys(preds);

// ---------- point and ranking metrics ----------
const frameFor = (name, seasons, filter = () => true) => seasons.flatMap(s => common(s)).filter(filter).map(c => ({ c, pred: preds[name].get(c), y: y(c) })).filter(r => numeric(r.pred) && numeric(r.y));
const ranksOf = (rowsA, rowsB, { rosterable = true, draws = 1000, seed = 3 } = {}) => {
  // Paired Δ macro Spearman (A − B) over season-week-position groups; cluster bootstrap by season-week.
  const key = r => `${r.c.season}:${r.c.week}:${r.c.player_id}`, bMap = new Map(rowsB.map(r => [key(r), r]));
  const groups = groupBy(rowsA.filter(r => bMap.has(key(r)) && (!rosterable || r.c.rosterable)), r => `${r.c.season}:${r.c.week}:${r.c.position}`);
  const d = []; for (const [k, g] of groups) if (g.length >= 3) { const a = spearman(g.map(r => r.pred), g.map(r => r.y)), b = spearman(g.map(r => bMap.get(key(r)).pred), g.map(r => r.y)); if (numeric(a) && numeric(b)) d.push({ sw: k.split(":").slice(0, 2).join(":"), d: a - b }); }
  if (!d.length) return null;
  const cl = [...groupBy(d, x => x.sw).values()].map(g => [g.reduce((s, x) => s + x.d, 0), g.length]), rand = rng(seed), st = [];
  for (let b = 0; b < draws; b++) { let s = 0, n = 0; for (let i = 0; i < cl.length; i++) { const [cs, cn] = cl[Math.floor(rand() * cl.length)]; s += cs; n += cn; } st.push(s / n); }
  return { groups: d.length, delta: mean(d.map(x => x.d)), ci95: [quantile(st, 0.025), quantile(st, 0.975)] };
};
// Fixed decision-relevant pair set: rosterable, same season-week-position, |actual difference| ≥ 2 (identical for every model).
const fixedPairs = rows => { let n = 0, ok = 0; for (const g of groupBy(rows.filter(r => r.c.rosterable), r => `${r.c.season}:${r.c.week}:${r.c.position}`).values())
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) { const dy = g[i].y - g[j].y; if (Math.abs(dy) < 2) continue; n++; const dp = g[i].pred - g[j].pred; ok += dp === 0 ? 0.5 : Math.sign(dp) === Math.sign(dy) ? 1 : 0; }
  return n ? ok / n : null; };
const spread = rows => { const sds = [...groupBy(rows.filter(r => r.c.rosterable), r => `${r.c.season}:${r.c.week}:${r.c.position}`).values()].filter(g => g.length >= 3).map(g => { const mu = mean(g.map(r => r.pred)); return Math.sqrt(mean(g.map(r => (r.pred - mu) ** 2))); }); return mean(sds); };
const topQuintileBias = rows => mean([...groupBy(rows, r => `${r.c.season}:${r.c.week}:${r.c.position}`).values()].flatMap(g => { const s = [...g].sort((a, b) => b.pred - a.pred); return s.slice(0, Math.max(1, Math.floor(s.length / 5))).map(r => r.pred - r.y); }));
const STRATA_N = { early_n_le_4: c => c.inputs.n <= 4, established_n_ge_5: c => c.inputs.n >= 5 };

const metrics = {};
for (const name of NAMES) {
  const primary = frameFor(name, PRIMARY), prodP = frameFor("prod", PRIMARY), dev = frameFor(name, DEV), prodD = frameFor("prod", DEV);
  const mk = (rows, ref, seed) => ({ ...sliced(rows), fixed_pair_accuracy_rosterable_gap2: fixedPairs(rows), spread_rosterable_sd: spread(rows), top_quintile_bias: topQuintileBias(rows),
    position_detail: Object.fromEntries(POSITIONS.map(p => { const r = rows.filter(x => x.c.position === p); return [p, { bias: pointMetrics(r, { pairs: false }).bias, median_residual: quantile(r.map(x => x.pred - x.y), 0.5), spread_rosterable_sd: spread(r), top_quintile_bias: topQuintileBias(r), fixed_pair_accuracy_rosterable_gap2: fixedPairs(r) }]; })),
    n_strata: Object.fromEntries(Object.entries(STRATA_N).map(([k, f]) => [k, pointMetrics(rows.filter(r => f(r.c)), { pairs: false })])),
    vs_prod_mae: name === "prod" ? null : pairedDelta(rows, ref, { seed }),
    vs_prod_spearman_rosterable: name === "prod" ? null : ranksOf(rows, ref, { seed }),
    vs_prod_spearman_all: name === "prod" ? null : ranksOf(rows, ref, { rosterable: false, seed: seed + 1 }),
    vs_prod_position_mae: Object.fromEntries(POSITIONS.map(p => [p, mean(rows.filter(r => r.c.position === p).map(r => Math.abs(r.pred - r.y))) - mean(ref.filter(r => r.c.position === p).map(r => Math.abs(r.pred - r.y)))])) });
  metrics[name] = { primary: mk(primary, prodP, 11), development: mk(dev, prodD, 21),
    folds: Object.fromEntries(FOLDS.map(Y => { const r = frameFor(name, [Y]), ref = frameFor("prod", [Y]); return [Y, { ...pointMetrics(r), fixed_pair_accuracy_rosterable_gap2: fixedPairs(r), spread_rosterable_sd: spread(r), delta_mae_vs_prod: pointMetrics(r, { pairs: false }).mae - pointMetrics(ref, { pairs: false }).mae }]; })),
    primary_no_rb: name === "prod" ? null : { mae: pairedDelta(primary.filter(r => r.c.position !== "RB"), prodP.filter(r => r.c.position !== "RB"), { seed: 5, draws: 500 }), spearman_rosterable: ranksOf(primary.filter(r => r.c.position !== "RB"), prodP.filter(r => r.c.position !== "RB"), { seed: 6, draws: 500 }) },
    leave_one_fold_out: name === "prod" ? null : Object.fromEntries(PRIMARY.map(Y => { const fs = PRIMARY.filter(s => s !== Y), a = frameFor(name, fs), b = frameFor("prod", fs);
      return [Y, { delta_mae: pointMetrics(a, { pairs: false }).mae - pointMetrics(b, { pairs: false }).mae, delta_spearman_rosterable: pointMetrics(a, { pairs: false }).spearman_rosterable - pointMetrics(b, { pairs: false }).spearman_rosterable }]; })) };
}
log("point/ranking metrics done");

// ---------- lineups ----------
const HYBRID_BASE = NAMES.filter(n => !["prod", "R_prod_recal"].includes(n) && !info[n].betting_derived);
const predictorsAll = Object.fromEntries(NAMES.map(n => [n, c => preds[n].get(c)]));
for (const n of HYBRID_BASE) predictorsAll[`${n}~prodRB`] = c => c.position === "RB" ? c.inputs.prod : preds[n].get(c);
const lineups = {}, perRosterStd = [];
const swAll = seasonWeeks(FOLDS);
for (const [sname, structure] of Object.entries(STRUCTURES)) {
  const rows = [];
  const usePreds = sname === "standard_1qb" || sname === "no_flex" ? predictorsAll : Object.fromEntries(NAMES.map(n => [n, predictorsAll[n]]));
  for (const seed of SEEDS) { const r = simulate(swAll, usePreds, structure, seed); r.forEach(x => { x.seed = seed; }); rows.push(...r); }
  if (sname === "standard_1qb") perRosterStd.push(...rows);
  const pr = rows.filter(r => PRIMARY.includes(r.season)), dv = rows.filter(r => DEV.includes(r.season));
  const out = { slots: structure.slots, roster: structure.roster, teams: structure.teams, seeds: SEEDS, roster_weeks_primary: pr.length, roster_weeks_development: dv.length, results: {} };
  for (const name of Object.keys(usePreds)) {
    const res = { primary: summarize(pr, name, "prod"), development: summarize(dv, name, "prod", { draws: 500 }),
      by_seed_primary: Object.fromEntries(SEEDS.map(s => [s, summarize(pr.filter(r => r.seed === s), name, "prod", { draws: 300 })?.delta_vs_control])) };
    if (sname === "standard_1qb" && !name.includes("~")) {
      res.by_fold = Object.fromEntries(FOLDS.map(Y => [Y, summarize(rows.filter(r => r.season === Y), name, "prod", { draws: 300 })]));
      res.by_week = { weeks_3_5: summarize(pr.filter(r => r.week <= 5), name, "prod", { draws: 300 }), weeks_6_9: summarize(pr.filter(r => r.week >= 6 && r.week <= 9), name, "prod", { draws: 300 }), weeks_10_17: summarize(pr.filter(r => r.week >= 10), name, "prod", { draws: 300 }) };
      res.leave_one_fold_out = Object.fromEntries(PRIMARY.map(Y => [Y, summarize(pr.filter(r => r.season !== Y), name, "prod", { draws: 300 })]));
      res.vs_noX = summarize(pr, name, "noX", { draws: 500 });
    }
    if (sname === "no_flex" && !name.includes("~")) {
      // Additive per-position decomposition (exact: every slot is single-position).
      res.by_position_primary = Object.fromEntries(POSITIONS.map(p => { const d = pr.filter(r => r.by[name] && r.by.prod).map(r => (r.by[name][p] ?? 0) - (r.by.prod[p] ?? 0)); return [p, mean(d)]; }));
    }
    out.results[name] = res;
  }
  lineups[sname] = out;
  log("lineups", sname, rows.length);
}

// ---------- selection optimism: walk-forward meta-selection over the candidate set ----------
const POOL = NAMES.filter(n => !["prod", "R_prod_recal", "noX", "Q", "S", "R3"].includes(n));
const swDelta = (name, season) => { const r = perRosterStd.filter(x => x.season === season && numeric(x[name]) && numeric(x.prod)); return mean(r.map(x => x[name] - x.prod)); };
const meta = { pool_size: POOL.length, pool: POOL, folds: {} };
for (const Y of PRIMARY) {
  const ranked = POOL.map(n => [n, swDelta(n, Y - 1)]).sort((a, b) => b[1] - a[1]);
  meta.folds[Y] = { chosen_on: Y - 1, chosen: ranked[0][0], in_sample_delta: ranked[0][1], out_of_sample_delta: swDelta(ranked[0][0], Y), best_on_Y: POOL.map(n => [n, swDelta(n, Y)]).sort((a, b) => b[1] - a[1])[0] };
}
meta.mean_in_sample = mean(Object.values(meta.folds).map(f => f.in_sample_delta)); meta.mean_out_of_sample = mean(Object.values(meta.folds).map(f => f.out_of_sample_delta));
// Best-of-pool optimism on the pooled primary folds: max candidate delta vs the distribution of candidate deltas.
meta.pooled_primary_ranking = POOL.map(n => [n, lineups.standard_1qb.results[n].primary.delta_vs_control]).sort((a, b) => b[1] - a[1]);

// ---------- RB failure analysis ----------
const rb = {};
for (const name of ["prod", "Q", "noX", "VIP_A2", "D1_ridge", "B1_ridge7_l100", "B2_noVIP", "A2_q_vip_snap", "A3_q_r3_vip_snap", "A4_vipA2_recal", "P1_q_snap", "P2_q_r3_snap", "P4_ew_snap", "P5_ew_r3_snap", "P6_ew_s_r3_snap", "R_Q_recal"]) {
  const r = frameFor(name, PRIMARY, c => c.position === "RB"), res = r.map(x => x.pred - x.y);
  const bins = [...Array(5).keys()].map(q => { const s = [...r].sort((a, b) => a.pred - b.pred), lo = Math.floor(q * s.length / 5), hi = Math.floor((q + 1) * s.length / 5), b = s.slice(lo, hi);
    return { quintile: q + 1, mean_pred: mean(b.map(x => x.pred)), mean_actual: mean(b.map(x => x.y)), median_actual: quantile(b.map(x => x.y), 0.5), mae: mean(b.map(x => Math.abs(x.pred - x.y))) }; });
  const snapBins = [[0, 0.4], [0.4, 0.6], [0.6, 1.01]].map(([lo, hi]) => { const b = r.filter(x => { const s = x.c.inputs.opp?.metrics?.snap_share?.last2; return numeric(s) && s >= lo && s < hi; }); return { snap_last2: [lo, hi], n: b.length, bias: mean(b.map(x => x.pred - x.y)), mae: mean(b.map(x => Math.abs(x.pred - x.y))) }; });
  // Median-offset diagnostic: subtract each fold's training-free offset is not available here, so use the previous fold's RB median residual (as-of).
  const byFold = Object.fromEntries(PRIMARY.map(Y => { const prev = frameFor(name, [Y - 1], c => c.position === "RB"), off = quantile(prev.map(x => x.pred - x.y), 0.5), cur = frameFor(name, [Y], c => c.position === "RB");
    return [Y, { prev_fold_median_residual: off, mae: mean(cur.map(x => Math.abs(x.pred - x.y))), mae_median_shifted: mean(cur.map(x => Math.abs(x.pred - off - x.y))) }]; }));
  rb[name] = { n: r.length, mae: mean(res.map(Math.abs)), bias: mean(res), median_residual: quantile(res, 0.5), actual_mean: mean(r.map(x => x.y)), actual_median: quantile(r.map(x => x.y), 0.5),
    calibration_slope: pointMetrics(r, { pairs: false }).calibration_slope, pred_quintiles: bins, snap_bins: snapBins, median_shift_by_fold: byFold,
    mae_median_shifted_pooled: mean(Object.values(byFold).map(f => f.mae_median_shifted)) };
}

const report = {
  task: "EDGE-RANK-01", schema: "edge-rank-01-results-1", generated_at: new Date().toISOString(), evidence_class: "X (exploratory; post-hoc relative to EDGE-01; consumed seasons)",
  control_model: { model_version: MODEL_VERSION, feature_version: FEATURE_VERSION, note: "Production Start Value is the control (contains betting-derived xFP from 2021); unchanged." },
  protocol: { sealed_season: SEALED_SEASON, seasons_loaded: [2014, 2025], primary_folds_consumed: PRIMARY, development_folds: DEV, format: "ppr", weeks: [3, 17],
    walk_forward: "fit 2016..Y-2, select on Y-1, score on Y", outcome: "next-game points, played only; missing stays missing", plan: "docs/research/edge-rank-01-analysis-plan.md",
    screens: { mae: 0.05, lineup_points_per_roster_week: 0.1 }, canary: { compared, mismatches } },
  provenance: data.provenance, candidates: info, metrics, lineups, selection_optimism: meta, rb_analysis: rb,
};
await mkdir(OUT.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(OUT, JSON.stringify(round(report), null, 1) + "\n");
log("wrote", OUT);
