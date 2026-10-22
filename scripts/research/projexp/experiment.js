// Projection experiment: weekly + rest-of-season (ROS) projections with walk-forward intervals, scored against production,
// simple baselines and the FantasyPros consensus (benchmark only). Research only; changes no production file.
// Usage: node scripts/research/projexp/experiment.js --phase=dev|final [--rows=.data/projexp/rows.json] [--out=...]
//   dev   : folds 2017–2021 fitted, 2019–2021 scored (design choices were made here)
//   final : frozen design, folds 2017–2025 fitted, consumed seasons 2022–2025 scored once
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { numeric, mean } from "../../../lib/decision/features.js";
import { ridge, predictLinear } from "../../../lib/research/edge01/fit.js";
import { WEEKLY_FEATURES, BETTING_FEATURES, ROS_FEATURES, POSITIONS, residualQuantiles, intervalFor, intervalMetrics } from "../../../lib/research/projexp/models.js";
import { foldPredictions, frame, pointMetrics, pairedDelta, lineup, rankCompare, rowKey } from "../../../lib/research/projexp/run.js";

const args = process.argv.slice(2), opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const PHASE = opt("phase", "dev");
if (!["dev", "final"].includes(PHASE)) throw new Error("--phase must be dev or final");
const SCORE = PHASE === "dev" ? [2019, 2020, 2021] : [2022, 2023, 2024, 2025];
const FOLDS = PHASE === "dev" ? [2017, 2018, 2019, 2020, 2021] : [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const LAST = Math.max(...FOLDS);
const OUT = opt("out", PHASE === "dev" ? ".data/projexp/dev-results.json" : "artifacts/research/projection-experiment-results.json");
const t0 = Date.now(), log = (...x) => console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", ...x);
const r4 = v => typeof v === "number" ? (Number.isFinite(v) ? +v.toFixed(4) : null) : Array.isArray(v) ? v.map(r4) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r4(x)])) : v;

const data = JSON.parse(await readFile(opt("rows", ".data/projexp/rows.json"), "utf8"));
const weekly = data.weekly.filter(r => r.season <= LAST), rosRows = data.ros.filter(r => r.season <= LAST);
if (PHASE === "dev" && (weekly.some(r => r.season > 2021) || rosRows.some(r => r.season > 2021))) throw new Error("dev phase must not read consumed seasons");

// ---------------- frozen design (chosen on development folds 2019–2021; see docs/research/projection-experiment-plan.md) ----------------
const GBM = { trees: 200, depth: 5, lr: 0.05, minLeaf: 200 };
const y = r => r.y, fbNoX = r => r.base.noX;
const WEEKLY_SPECS = {
  prod: { kind: "fixed", predict: r => r.base.prod, betting_derived: true, note: "production Start Value (contains ffopportunity xFP from 2021)" },
  noX: { kind: "fixed", predict: r => r.base.noX }, Q: { kind: "fixed", predict: r => r.base.Q },
  vipA2: { kind: "fixed", predict: r => r.base.vipA2, fallback: fbNoX, note: "EDGE-01 A2 (fixed w=0.3)" },
  P5: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2"], fallback: fbNoX, note: "EDGE-RANK-01 P5 (refit per fold)" },
  P5ctx: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2", "opp_factor", "home"], fallback: fbNoX },
  GBM: { kind: "gbm", target: y, features: WEEKLY_FEATURES, params: GBM },
  P5bet: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2", "implied_total"], fallback: fbNoX, betting_derived: true },
  GBMbet: { kind: "gbm", target: y, features: [...WEEKLY_FEATURES, ...BETTING_FEATURES], params: GBM, betting_derived: true },
};
const BLENDS = { PX: ["P5ctx", "GBM"], PXbet: ["P5bet", "GBMbet"] }; // equal-weight averages
const ROS_PPG = r => r.ros.ppg, ROS_AVAIL = r => r.ros.played_rate;
const ROS_SPECS = {
  R_GBM: { kind: "gbm", target: ROS_PPG, features: ROS_FEATURES, params: GBM },
  R_LIN: { kind: "linear", target: ROS_PPG, features: ["ew16", "S", "P_ew16", "snap_season", "R3"], fallback: r => r.f.S },
  A_GBM: { kind: "gbm", target: ROS_AVAIL, features: ROS_FEATURES, params: GBM },
};
const TOP = { QB: 32, RB: 60, WR: 72, TE: 32 }; // consensus comparisons: players inside the consensus top-N at their position

// ---------------- weekly walk-forward ----------------
const wPred = {}; for (const n of [...Object.keys(WEEKLY_SPECS), ...Object.keys(BLENDS)]) wPred[n] = new Map();
for (const Y of FOLDS) {
  for (const [n, s] of Object.entries(WEEKLY_SPECS)) for (const [k, v] of foldPredictions(weekly, Y, s).preds) wPred[n].set(k, v);
  for (const [n, [a, b]] of Object.entries(BLENDS)) for (const r of weekly.filter(r => r.season === Y)) {
    const k = rowKey(r), va = wPred[a].get(k), vb = wPred[b].get(k); wPred[n].set(k, numeric(va) && numeric(vb) ? (va + vb) / 2 : null);
  }
  log("weekly fold", Y);
}
const scored = weekly.filter(r => SCORE.includes(r.season));
const W_NAMES = Object.keys(wPred);
const weeklyOut = { per_fold: {}, pooled: {}, by_position: {}, deltas: {}, lineup: {}, intervals: {}, consensus: {} };
for (const n of W_NAMES) {
  weeklyOut.pooled[n] = pointMetrics(frame(scored, wPred[n]));
  weeklyOut.by_position[n] = Object.fromEntries(POSITIONS.map(p => [p, pointMetrics(frame(scored.filter(r => r.position === p), wPred[n]), { pairs: false })]));
  weeklyOut.per_fold[n] = Object.fromEntries(SCORE.map(Y => [Y, pointMetrics(frame(scored.filter(r => r.season === Y), wPred[n]), { pairs: false }).mae]));
  if (n !== "prod") weeklyOut.deltas[n] = { vs_prod: pairedDelta(frame(scored, wPred[n]), frame(scored, wPred.prod)), vs_P5: n === "P5" ? null : pairedDelta(frame(scored, wPred[n]), frame(scored, wPred.P5)),
    per_fold_vs_prod: Object.fromEntries(SCORE.map(Y => [Y, pairedDelta(frame(scored.filter(r => r.season === Y), wPred[n]), frame(scored.filter(r => r.season === Y), wPred.prod), { draws: 200 })?.delta_mae])),
    per_position_vs_prod: Object.fromEntries(POSITIONS.map(p => [p, pairedDelta(frame(scored.filter(r => r.position === p), wPred[n]), frame(scored.filter(r => r.position === p), wPred.prod), { draws: 200 })?.delta_mae])) };
}
weeklyOut.lineup.pooled_vs_prod = lineup(scored, wPred, "prod");
weeklyOut.lineup.per_fold_vs_prod = Object.fromEntries(SCORE.map(Y => [Y, Object.fromEntries(Object.entries(lineup(scored.filter(r => r.season === Y), wPred, "prod")).map(([n, s]) => [n, s?.delta_vs_control]))]));
weeklyOut.lineup.weeks_3_9_vs_prod = lineup(scored.filter(r => r.week <= 9), { prod: wPred.prod, PX: wPred.PX, P5: wPred.P5, PXbet: wPred.PXbet }, "prod");
weeklyOut.lineup.weeks_10_17_vs_prod = lineup(scored.filter(r => r.week >= 10), { prod: wPred.prod, PX: wPred.PX, P5: wPred.P5, PXbet: wPred.PXbet }, "prod");
log("weekly scored");

// Walk-forward conformal intervals (residual quantiles of the two previous seasons' out-of-sample predictions).
const oosOf = (rows, preds, target) => { const o = {}; for (const r of rows) { const p = preds.get(rowKey(r)), t = target(r); if (numeric(p) && numeric(t)) (o[r.season] ??= []).push({ position: r.position, pred: p, y: t }); } return o; };
for (const n of ["PX", "PXbet", "prod", "P5"]) {
  const oos = oosOf(weekly, wPred[n], y), all = [], flat = [];
  for (const Y of SCORE) {
    const prior = [Y - 2, Y - 1].flatMap(s => oos[s] || []), rq = residualQuantiles(prior), rq1 = residualQuantiles(prior, { bins: 1 });
    for (const r of scored.filter(r => r.season === Y && numeric(r.y) && numeric(wPred[n].get(rowKey(r))))) {
      const p = wPred[n].get(rowKey(r));
      all.push({ c: r, y: r.y, q: intervalFor(rq, r.position, p) }); flat.push({ c: r, y: r.y, q: intervalFor(rq1, r.position, p) });
    }
  }
  weeklyOut.intervals[n] = { binned: intervalMetrics(all), unbinned: intervalMetrics(flat),
    by_position: Object.fromEntries(POSITIONS.map(p => [p, intervalMetrics(all.filter(x => x.c.position === p))])),
    rosterable: intervalMetrics(all.filter(x => x.c.rosterable)) };
}

// ---------------- consensus benchmark (weekly) ----------------
// Consensus rank -> points per position: y ~ a + b·ln(rank), fitted on earlier seasons only (from 2020, the first archived year).
const ecrRows = weekly.filter(r => numeric(r.bench?.ecr_rank) && r.bench.ecr_rank <= TOP[r.position]);
const lnRank = r => Math.log(r.bench.ecr_rank);
const consensus = { per_fold: {}, coefficients: {} };
const ecrPts = new Map(), ecrBlend = new Map();
for (const Y of SCORE.filter(Y => Y >= 2021)) {
  const prior = ecrRows.filter(r => r.season >= 2020 && r.season < Y && numeric(r.y));
  const maps = {}, blends = {};
  for (const p of POSITIONS) {
    const pr = prior.filter(r => r.position === p);
    maps[p] = ridge(pr.map(r => ({ x: [lnRank(r)], y: r.y })), 0);
    blends[p] = ridge(pr.map(r => ({ x: [predictLinear(maps[p], [lnRank(r)]), wPred.PX.get(rowKey(r))], y: r.y })), 0);
  }
  consensus.coefficients[Y] = Object.fromEntries(POSITIONS.map(p => [p, { rank_map: maps[p]?.coef, blend_consensus_PX: blends[p]?.coef, n: blends[p]?.n }]));
  for (const r of ecrRows.filter(r => r.season === Y)) {
    const e = predictLinear(maps[r.position], [lnRank(r)]), px = wPred.PX.get(rowKey(r));
    ecrPts.set(rowKey(r), e); ecrBlend.set(rowKey(r), numeric(px) ? predictLinear(blends[r.position], [e, px]) : null);
  }
}
const ecrScored = ecrRows.filter(r => SCORE.includes(r.season) && r.season >= 2021 && numeric(r.y) && numeric(ecrPts.get(rowKey(r))) && numeric(wPred.PX.get(rowKey(r))));
if (ecrScored.length) {
  const cp = { consensus: ecrPts, PX: wPred.PX, blend: ecrBlend, PXbet: wPred.PXbet, prod: wPred.prod, P5: wPred.P5 };
  consensus.rows = ecrScored.length;
  consensus.point = Object.fromEntries(Object.entries(cp).map(([n, m]) => [n, pointMetrics(frame(ecrScored, m), { pairs: false })]));
  consensus.delta_vs_consensus = Object.fromEntries(Object.entries(cp).filter(([n]) => n !== "consensus").map(([n, m]) => [n, pairedDelta(frame(ecrScored, m), frame(ecrScored, ecrPts))]));
  const gk = r => `${r.season}:${r.week}:${r.position}`, get = m => r => m.get(rowKey(r));
  consensus.ranking = Object.fromEntries(["PX", "PXbet", "prod", "blend", "P5"].map(n => [n, rankCompare(ecrScored, get(cp[n]), get(ecrPts), y, gk)]));
  consensus.ranking_by_position = Object.fromEntries(POSITIONS.map(p => [p, rankCompare(ecrScored.filter(r => r.position === p), get(wPred.PX), get(ecrPts), y, gk, { draws: 300 })]));
  consensus.ranking_per_fold = Object.fromEntries(SCORE.filter(Y => Y >= 2021).map(Y => [Y, rankCompare(ecrScored.filter(r => r.season === Y), get(wPred.PX), get(ecrPts), y, gk, { draws: 300 })]));
  consensus.lineup_vs_consensus = lineup(ecrScored, cp, "consensus");
  consensus.lineup_per_fold_vs_consensus = Object.fromEntries(SCORE.filter(Y => Y >= 2021).map(Y => [Y, Object.fromEntries(Object.entries(lineup(ecrScored.filter(r => r.season === Y), cp, "consensus")).map(([n, s]) => [n, s?.delta_vs_control]))]));
}
weeklyOut.consensus = consensus;
log("consensus scored");

// ---------------- ROS walk-forward ----------------
const rPred = { R_GBM: new Map(), R_LIN: new Map(), A_GBM: new Map() };
for (const Y of FOLDS) { for (const [n, s] of Object.entries(ROS_SPECS)) for (const [k, v] of foldPredictions(rosRows, Y, s).preds) rPred[n].set(k, v); log("ros fold", Y); }
const clamp01 = v => Math.max(0, Math.min(1, v));
const ppgPred = { S: r => r.f.S, Q: r => r.base.Q, prod_flat: r => r.base.prod, PX_flat: r => wPred.PX.get(rowKey(r)),
  R_GBM: r => rPred.R_GBM.get(rowKey(r)), R_LIN: r => rPred.R_LIN.get(rowKey(r)),
  R_BLEND: r => { const a = rPred.R_GBM.get(rowKey(r)), b = rPred.R_LIN.get(rowKey(r)); return numeric(a) && numeric(b) ? (a + b) / 2 : null; } };
const availPred = { asof_rate: r => r.f.played_rate, A_GBM: r => { const v = rPred.A_GBM.get(rowKey(r)); return numeric(v) ? clamp01(v) : null; }, none: () => 1 };
const totals = {
  prod_flat: r => numeric(r.base.prod) ? r.base.prod * r.f.ros_games : null,           // what a flat weekly value implies, no availability
  S_asof: r => numeric(r.f.S) && numeric(r.f.played_rate) ? r.f.S * r.f.ros_games * r.f.played_rate : null,
  PX_flat_asof: r => numeric(ppgPred.PX_flat(r)) && numeric(r.f.played_rate) ? ppgPred.PX_flat(r) * r.f.ros_games * r.f.played_rate : null,
  ROS: r => numeric(ppgPred.R_BLEND(r)) && numeric(availPred.A_GBM(r)) ? ppgPred.R_BLEND(r) * r.f.ros_games * availPred.A_GBM(r) : null,
  ROS_noavail: r => numeric(ppgPred.R_BLEND(r)) ? ppgPred.R_BLEND(r) * r.f.ros_games : null,
};
const rosScored = rosRows.filter(r => SCORE.includes(r.season));
const toMap = (rows, f) => new Map(rows.map(r => [rowKey(r), f(r)]));
const rosOut = { ppg: {}, ppg_deltas: {}, avail: {}, total: {}, total_deltas: {}, total_ranking: {}, intervals: {}, consensus: {} };
const ppgMaps = Object.fromEntries(Object.entries(ppgPred).map(([n, f]) => [n, toMap(rosScored, f)]));
for (const [n, m] of Object.entries(ppgMaps)) {
  rosOut.ppg[n] = pointMetrics(frame(rosScored, m, ROS_PPG), { pairs: false });
  if (n !== "prod_flat") rosOut.ppg_deltas[n] = pairedDelta(frame(rosScored, m, ROS_PPG), frame(rosScored, ppgMaps.prod_flat, ROS_PPG));
}
for (const [n, f] of Object.entries(availPred)) { const fr = rosScored.filter(r => numeric(f(r)) && numeric(r.ros.played_rate)); rosOut.avail[n] = { n: fr.length, mae: mean(fr.map(r => Math.abs(f(r) - r.ros.played_rate))), bias: mean(fr.map(r => f(r) - r.ros.played_rate)) }; }
const TOTAL = r => r.ros.scheduled > 0 ? r.ros.total : null;
const totMaps = Object.fromEntries(Object.entries(totals).map(([n, f]) => [n, toMap(rosScored, f)]));
const gk = r => `${r.season}:${r.week}:${r.position}`;
for (const [n, m] of Object.entries(totMaps)) {
  rosOut.total[n] = pointMetrics(frame(rosScored, m, TOTAL), { pairs: false });
  if (n !== "prod_flat") {
    rosOut.total_deltas[n] = { vs_prod_flat: pairedDelta(frame(rosScored, m, TOTAL), frame(rosScored, totMaps.prod_flat, TOTAL)),
      per_fold: Object.fromEntries(SCORE.map(Y => [Y, pairedDelta(frame(rosScored.filter(r => r.season === Y), m, TOTAL), frame(rosScored.filter(r => r.season === Y), totMaps.prod_flat, TOTAL), { draws: 200 })?.delta_mae])) };
    rosOut.total_ranking[n] = rankCompare(rosScored.filter(r => r.rosterable), r => m.get(rowKey(r)), r => totMaps.prod_flat.get(rowKey(r)), TOTAL, gk);
  }
}
// ROS total intervals (walk-forward conformal on the two previous seasons' OOS totals).
{
  const allTot = toMap(rosRows, totals.ROS), oos = oosOf(rosRows, allTot, TOTAL), list = [];
  for (const Y of SCORE) { const rq = residualQuantiles([Y - 2, Y - 1].flatMap(s => oos[s] || [])); for (const r of rosScored.filter(r => r.season === Y && numeric(TOTAL(r)) && numeric(allTot.get(rowKey(r))))) list.push({ c: r, y: TOTAL(r), q: intervalFor(rq, r.position, allTot.get(rowKey(r))) }); }
  rosOut.intervals.ROS_total = { all: intervalMetrics(list), rosterable: intervalMetrics(list.filter(x => x.c.rosterable)), by_position: Object.fromEntries(POSITIONS.map(p => [p, intervalMetrics(list.filter(x => x.c.position === p))])) };
}
// ROS consensus benchmark: rank-only comparison on players inside the consensus ROS top-N.
const rosEcr = rosScored.filter(r => r.season >= 2021 && numeric(r.bench?.ros_rank) && r.bench.ros_rank <= TOP[r.position] && numeric(TOTAL(r)) && numeric(totMaps.ROS.get(rowKey(r))));
if (rosEcr.length) {
  const neg = r => -r.bench.ros_rank;
  rosOut.consensus = { rows: rosEcr.length,
    ROS_vs_consensus: rankCompare(rosEcr, r => totMaps.ROS.get(rowKey(r)), neg, TOTAL, gk),
    prod_flat_vs_consensus: rankCompare(rosEcr, r => totMaps.prod_flat.get(rowKey(r)), neg, TOTAL, gk),
    ROS_ppg_vs_consensus_on_ppg: rankCompare(rosEcr, r => ppgMaps.R_BLEND.get(rowKey(r)), neg, ROS_PPG, gk),
    by_position: Object.fromEntries(POSITIONS.map(p => [p, rankCompare(rosEcr.filter(r => r.position === p), r => totMaps.ROS.get(rowKey(r)), neg, TOTAL, gk, { draws: 300 })])),
    per_fold: Object.fromEntries(SCORE.filter(Y => Y >= 2021).map(Y => [Y, rankCompare(rosEcr.filter(r => r.season === Y), r => totMaps.ROS.get(rowKey(r)), neg, TOTAL, gk, { draws: 300 })])) };
}
log("ros scored");

const result = r4({ task: "PROJECTION-EXPERIMENT-01", schema: "projection-experiment-results-1", phase: PHASE, generated_at: new Date().toISOString(),
  evidence_class: "X (research; walk-forward on public data; consumed seasons are reported, never held out)", scored_seasons: SCORE, fitted_folds: FOLDS,
  sealed_season: 2026, max_season_read: LAST, provenance: data.provenance,
  betting_derived: { prod: "ffopportunity xFP from 2021", P5bet: "closing implied team total", GBMbet: "closing spread/total/implied total", PXbet: "blend of the two" },
  benchmark_only: "FantasyPros ECR archive (DynastyProcess db_fpecr), consensus rank, never a model input",
  design: { gbm: GBM, weekly: Object.fromEntries(Object.entries(WEEKLY_SPECS).map(([n, s]) => [n, { kind: s.kind, features: s.features, betting_derived: !!s.betting_derived, note: s.note }])), blends: BLENDS,
    ros: Object.fromEntries(Object.entries(ROS_SPECS).map(([n, s]) => [n, { kind: s.kind, features: s.features }])), consensus_top_n: TOP },
  case_counts: { weekly_rows: scored.length, weekly_played: scored.filter(r => numeric(r.y)).length, ros_rows: rosScored.length, ros_with_ppg: rosScored.filter(r => numeric(r.ros.ppg)).length },
  weekly: weeklyOut, ros: rosOut });
await mkdir(OUT.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(OUT, JSON.stringify(result, null, 1));
log("wrote", OUT);
