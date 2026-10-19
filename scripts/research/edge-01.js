// EDGE-01 end-to-end research run (class R/X; offline; seasons ≤ 2025 only).
// Usage: node scripts/research/edge-01.js [dataDir=.data/edge01] [--permutations=20] [--out=artifacts/research/edge-01-results.json]
// Inputs must already be downloaded (see docs/research/edge-01.md). Writes no calibration and changes no production file.
import { mkdir, writeFile } from "node:fs/promises";
import { numeric, mean } from "../../lib/decision/features.js";
import { MODEL_VERSION, FEATURE_VERSION } from "../../lib/decision/model-config.js";
import { loadSeasons, RESEARCH_FORMATS, SEALED_SEASON, XFP_FLOOR } from "../../lib/research/edge01/data.js";
import { buildCaseTable, fitVipModel, withFormat, EW_ALL_HALF_LIVES } from "../../lib/research/edge01/cases.js";
import { inventory } from "../../lib/research/edge01/features.js";
import { CONTROLS, FAMILIES, POSITIONS, PRIMARY_FOLDS, DEVELOPMENT_FOLDS, runFold, foldsFor, sustainedRoleChange, attachWeekPositionMeans } from "../../lib/research/edge01/experiments.js";
import { sliced, pointMetrics, pairedDelta, rng } from "../../lib/research/edge01/metrics.js";
import { simulate, summarize, SLOTS, ROSTER, TEAMS, LEAGUES_PER_WEEK } from "../../lib/research/edge01/lineup.js";
import { breakoutRows, evaluateSignals, leadTimes, weeklyReplacement, TIER, GAIN, ROLE_METRIC, DECISION_WEEKS } from "../../lib/research/edge01/breakout.js";

const args = process.argv.slice(2), opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const dataDir = args.find(a => !a.startsWith("--")) || ".data/edge01";
const PERMUTATIONS = Number(opt("permutations", 20)), OUT = opt("out", "artifacts/research/edge-01-results.json");
const FIRST_SEASON = 2014, LAST_SEASON = 2025, CASE_SEASONS = []; for (let s = 2016; s <= LAST_SEASON; s++) CASE_SEASONS.push(s);
const ALL_FOLDS = [...DEVELOPMENT_FOLDS, ...PRIMARY_FOLDS];
const round = v => typeof v === "number" ? (Number.isFinite(v) ? +v.toFixed(4) : null) : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;
const log = (...xs) => console.log(new Date().toISOString().slice(11, 19), ...xs);

log("loading", dataDir);
const data = await loadSeasons(dataDir, FIRST_SEASON, LAST_SEASON);
const y = c => c.outcome.actual;

// ---------- case tables per format ----------
const tables = {}, vip = {}, audit = {};
for (const format of Object.keys(RESEARCH_FORMATS)) {
  const gb = Object.fromEntries(Object.entries(data.games).map(([s, g]) => [s, withFormat(g, format)]));
  vip[format] = fitVipModel([2014, 2015, 2016, 2017].flatMap(s => gb[s]));
  tables[format] = { games: gb, cases: {} }; audit[format] = {};
  for (const s of CASE_SEASONS) {
    const t = buildCaseTable(gb, s, { vipModel: vip[format], draft: data.draft });
    tables[format].cases[s] = t.cases;
    audit[format][s] = { cases: t.cases.length, cases_without_outcome: t.cases_without_outcome, participation_rate: 1 - t.cases_without_outcome / t.cases.length,
      xfp_present: t.cases.filter(c => numeric(c.inputs.X)).length, vip_last2_present: t.cases.filter(c => numeric(c.inputs.opp?.metrics.vip.last2)).length,
      snap_last2_present: t.cases.filter(c => numeric(c.inputs.opp?.metrics.snap_share.last2)).length, h9_prior_present: t.cases.filter(c => numeric(c.inputs.P_ew16)).length };
  }
  log("cases built", format);
}
const ppr = tables.ppr.cases;

// ---------- leakage canaries ----------
function truncationCanary(format, pairs) {
  const gb = tables[format].games; let compared = 0, mismatches = 0, missing = 0;
  for (const [s, w] of pairs) {
    const truncated = {}; for (const [season, games] of Object.entries(gb)) if (Number(season) < s) truncated[season] = games; else if (Number(season) === s) truncated[season] = games.filter(g => g.week < w);
    const rebuilt = new Map(buildCaseTable(truncated, s, { vipModel: vip[format], draft: data.draft }).cases.filter(c => c.week === w).map(c => [c.player_id, c]));
    for (const c of tables[format].cases[s].filter(c => c.week === w)) {
      const r = rebuilt.get(c.player_id); if (!r) { missing++; continue; }
      compared++; if (JSON.stringify(r.inputs) !== JSON.stringify(c.inputs) || r.rosterable !== c.rosterable) mismatches++;
    }
  }
  return { compared, mismatches, missing_after_truncation: missing, season_weeks: pairs };
}
const leakage = { truncation_invariance_ppr: truncationCanary("ppr", [[2017, 5], [2020, 9], [2022, 3], [2023, 12], [2024, 7], [2025, 16]]),
  sealed_season: SEALED_SEASON, max_season_loaded: Math.max(...Object.keys(data.games).map(Number)), xfp_floor: XFP_FLOOR,
  xfp_rows_before_floor: Object.entries(data.games).filter(([s]) => Number(s) < XFP_FLOOR).reduce((n, [, g]) => n + g.filter(r => numeric(r.xfp)).length, 0),
  vip_training_seasons: [2014, 2015, 2016, 2017], notes: ["Rosterable flag uses as-of Q only", "Outcomes are read only from case.outcome", "No 2026 file exists in the data directory or provenance"] };
log("leakage canary", JSON.stringify(leakage.truncation_invariance_ppr));
if (leakage.truncation_invariance_ppr.mismatches) throw new Error("Truncation-invariance canary failed");
// Spread-control inputs (after the canary, which covers every other input): as-of week × position forecast means.
for (const format of Object.keys(RESEARCH_FORMATS)) for (const s of CASE_SEASONS) attachWeekPositionMeans(tables[format].cases[s]);

// ---------- point forecasts: controls ----------
const frame = (cases, pred) => cases.map(c => ({ c, pred: pred(c), y: y(c) })).filter(r => numeric(r.pred) && numeric(r.y));
const frameMap = (cases, preds) => cases.map(c => ({ c, pred: preds.get(c), y: y(c) })).filter(r => numeric(r.pred) && numeric(r.y));
// Common evaluation frame: played cases with a production forecast (every candidate has a noX fallback, so frames match).
const common = s => ppr[s].filter(c => numeric(y(c)) && numeric(c.inputs.prod));
const controls = {};
for (const [name, ctl] of Object.entries(CONTROLS)) {
  controls[name] = { betting_derived: ctl.betting_derived, folds: {} };
  for (const s of ALL_FOLDS) controls[name].folds[s] = sliced(frame(common(s), ctl.predict));
  controls[name].pooled_primary = pointMetrics(PRIMARY_FOLDS.flatMap(s => frame(common(s), ctl.predict)));
}
const simple = ["S", "EW3", "EW5", "Q"].map(k => [k, controls[k].pooled_primary.mae]).sort((a, b) => a[1] - b[1]);
log("strongest simple baseline", simple[0]);

// ---------- candidate families ----------
const familyResults = {}, familyPreds = {};
for (const id of Object.keys(FAMILIES)) {
  const fam = FAMILIES[id], folds = foldsFor(id), res = { family: fam.family, betting_derived: fam.betting_derived, post_hoc: !!fam.post_hoc, evidence_class: fam.post_hoc ? "X (post-hoc)" : "R", grid: fam.grid, folds: {} };
  const allPreds = new Map();
  for (const Y of folds) {
    const { choices, preds } = runFold(id, ppr, Y);
    for (const [c, p] of preds) allPreds.set(c, p);
    const rows = frameMap(common(Y), preds), prodRows = frame(common(Y), CONTROLS.prod.predict), qRows = frame(common(Y), CONTROLS.Q.predict), noXRows = frame(common(Y), CONTROLS.noX.predict);
    res.folds[Y] = { choices, metrics: sliced(rows), vs_prod: pairedDelta(rows, prodRows, { seed: Y }), vs_Q: pairedDelta(rows, qRows, { seed: Y + 1 }), vs_noX: pairedDelta(rows, noXRows, { seed: Y + 2 }),
      position_delta_vs_prod: Object.fromEntries(POSITIONS.map(p => [p, pointMetrics(rows.filter(r => r.c.position === p), { pairs: false }).mae - pointMetrics(prodRows.filter(r => r.c.position === p), { pairs: false }).mae])) };
  }
  const pooled = (fs, ctl) => { const a = fs.flatMap(Y => frameMap(common(Y), allPreds)), b = fs.flatMap(Y => frame(common(Y), CONTROLS[ctl].predict)); return pairedDelta(a, b, { seed: 99 }); };
  const prim = PRIMARY_FOLDS.filter(Y => folds.includes(Y)), dev = DEVELOPMENT_FOLDS.filter(Y => folds.includes(Y));
  res.pooled_primary = { folds: prim, metrics: sliced(prim.flatMap(Y => frameMap(common(Y), allPreds))), vs_prod: pooled(prim, "prod"), vs_Q: pooled(prim, "Q"), vs_noX: pooled(prim, "noX") };
  res.pooled_development = dev.length ? { folds: dev, vs_prod: pooled(dev, "prod"), vs_Q: pooled(dev, "Q") } : null;
  res.primary_folds_better_than_prod = prim.filter(Y => res.folds[Y].vs_prod.delta_mae < 0).length;
  res.primary_folds_better_than_Q = prim.filter(Y => res.folds[Y].vs_Q.delta_mae < 0).length;
  familyResults[id] = res; familyPreds[id] = allPreds;
  log("family", id, "Δ vs prod", res.pooled_primary.vs_prod?.delta_mae?.toFixed(4), "Δ vs Q", res.pooled_primary.vs_Q?.delta_mae?.toFixed(4), `better than prod ${res.primary_folds_better_than_prod}/${prim.length}`);
}
// Position-level pooled deltas vs prod (guardrail: no position worse by > 0.10).
const prodPos = Object.fromEntries(POSITIONS.map(p => [p, pointMetrics(PRIMARY_FOLDS.flatMap(Y => frame(common(Y), CONTROLS.prod.predict)).filter(r => r.c.position === p), { pairs: false }).mae]));
for (const [id, res] of Object.entries(familyResults)) {
  res.position_delta_vs_prod_pooled = Object.fromEntries(POSITIONS.map(p => [p, res.pooled_primary.metrics.position[p].mae - (res.pooled_primary.folds.length === 4 ? prodPos[p] : pointMetrics(res.pooled_primary.folds.flatMap(Y => frame(common(Y), CONTROLS.prod.predict)).filter(r => r.c.position === p), { pairs: false }).mae)]));
  res.worst_position_delta_vs_prod_pooled = Math.max(...Object.values(res.position_delta_vs_prod_pooled));
  res.position_delta_vs_Q_pooled = Object.fromEntries(POSITIONS.map(p => [p, pairedDelta(res.pooled_primary.folds.flatMap(Y => frameMap(common(Y), familyPreds[id])).filter(r => r.c.position === p), res.pooled_primary.folds.flatMap(Y => frame(common(Y), CONTROLS.Q.predict)).filter(r => r.c.position === p), { seed: 5, draws: 500 })]));
}

// Information vs spread: every family against the selected production-shrinkage control on the same primary folds.
for (const [id, res] of Object.entries(familyResults)) {
  const fs = res.pooled_primary.folds;
  res.pooled_primary.vs_prod_shrunk = pairedDelta(fs.flatMap(Y => frameMap(common(Y), familyPreds[id])), fs.flatMap(Y => frameMap(common(Y), familyPreds.X4_prod_shrunk)), { seed: 11 });
}

// ---------- selection optimism (protocol §8.4) ----------
log("permutations", PERMUTATIONS);
const permutation = Object.fromEntries(Object.keys(FAMILIES).map(id => [id, []])), permutationProd = Object.fromEntries(Object.keys(FAMILIES).map(id => [id, []]));
for (let p = 0; p < PERMUTATIONS; p++) {
  const rand = rng(1000 + p), permY = new Map();
  for (const s of CASE_SEASONS) {
    const groups = new Map(); for (const c of ppr[s]) if (numeric(y(c))) { const k = `${c.week}:${c.position}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(c); }
    for (const g of groups.values()) { const ys = g.map(y); for (let i = ys.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ys[i], ys[j]] = [ys[j], ys[i]]; } g.forEach((c, i) => permY.set(c, ys[i])); }
  }
  const yp = c => permY.get(c) ?? null;
  for (const id of Object.keys(FAMILIES)) {
    const prim = PRIMARY_FOLDS.filter(Y => foldsFor(id).includes(Y)), d = [], dp = [];
    for (const Y of prim) { const { preds } = runFold(id, ppr, Y, yp); for (const c of common(Y)) { const t = yp(c), a = preds.get(c); if (numeric(t) && numeric(a) && numeric(c.inputs.Q)) { d.push(Math.abs(a - t) - Math.abs(c.inputs.Q - t)); dp.push(Math.abs(a - t) - Math.abs(c.inputs.prod - t)); } } }
    permutation[id].push(mean(d)); permutationProd[id].push(mean(dp));
  }
}
for (const [id, ds] of Object.entries(permutation)) {
  const sorted = [...ds].sort((a, b) => a - b), real = familyResults[id].pooled_primary.vs_Q?.delta_mae;
  familyResults[id].selection_optimism = { permutations: ds.length, permuted_delta_vs_Q_mean: mean(ds), permuted_delta_vs_Q_min: sorted[0] ?? null,
    real_delta_vs_Q: real, passes: ds.length ? real < sorted[0] : null,
    supplementary_vs_prod: (() => { const p = [...permutationProd[id]].sort((a, b) => a - b), rp = familyResults[id].pooled_primary.vs_prod?.delta_mae;
      return { permuted_delta_vs_prod_mean: mean(p), permuted_delta_vs_prod_min: p[0] ?? null, real_delta_vs_prod: rp, real_below_every_permutation: p.length ? rp < p[0] : null,
        note: "Supplementary (not pre-registered): same permutation runs, compared with production, whose forecast spread is similar to the blend candidates" }; })(), note: "Passes when the real pooled Δ vs Q is below (better than) every permuted-outcome Δ. Structurally biased against shrinkage candidates (ADR 0009)." };
}

// ---------- other formats (parameters chosen on PPR) ----------
const formats = {};
for (const format of Object.keys(RESEARCH_FORMATS).filter(f => f !== "ppr")) {
  const cs = tables[format].cases, com = s => cs[s].filter(c => numeric(y(c)) && numeric(c.inputs.prod)), out = { controls: {}, families: {} };
  for (const name of ["prod", "noX", "Q"]) out.controls[name] = Object.fromEntries(PRIMARY_FOLDS.map(Y => [Y, pointMetrics(frame(com(Y), CONTROLS[name].predict), { pairs: false })]));
  for (const id of Object.keys(FAMILIES)) {
    const prim = PRIMARY_FOLDS.filter(Y => foldsFor(id).includes(Y)), a = [], b = [], q = [];
    for (const Y of prim) {
      const grid = Object.fromEntries(Object.entries(familyResults[id].folds[Y].choices).map(([p, ch]) => [p, [ch.param]]));
      const { preds } = runFold(id, cs, Y, y, { gridByPosition: grid });
      a.push(...frameMap(com(Y), preds)); b.push(...frame(com(Y), CONTROLS.prod.predict)); q.push(...frame(com(Y), CONTROLS.Q.predict));
    }
    out.families[id] = { folds: prim, vs_prod: pairedDelta(a, b, { seed: 3, draws: 500 }), vs_Q: pairedDelta(a, q, { seed: 4, draws: 500 }) };
  }
  formats[format] = out; log("format", format);
}

// ---------- lineup simulation (class X) ----------
const bySeasonWeek = new Map(); for (const s of PRIMARY_FOLDS) for (const c of common(s)) { const k = `${s}:${c.week}`; (bySeasonWeek.get(k) ?? bySeasonWeek.set(k, []).get(k)).push(c); }
const predictors = { prod: c => c.inputs.prod, noX: c => c.inputs.noX, Q: c => c.inputs.Q, S: c => c.inputs.S, ...Object.fromEntries(Object.keys(FAMILIES).map(id => [id, c => familyPreds[id].get(c)])) };
const perRoster = simulate(bySeasonWeek, predictors);
const lineup = { class: "X (simulated rosters; no historical roster state exists in the sources)", slots: SLOTS, roster: ROSTER, teams: TEAMS, leagues_per_week: LEAGUES_PER_WEEK,
  pool: "played cases only (participation-conditional)", seasons: PRIMARY_FOLDS, results: {} };
for (const name of Object.keys(predictors)) lineup.results[name] = { vs_prod: summarize(perRoster, name, "prod"), by_season: Object.fromEntries(PRIMARY_FOLDS.map(s => [s, summarize(perRoster.filter(r => r.season === s), name, "prod", { draws: 300 })])) };
log("lineup sim", perRoster.length, "roster-weeks");

// ---------- breakout / opportunity signals (class X) ----------
const replacement = weeklyReplacement(Object.values(tables.ppr.games).flat());
const bRows = {}; for (const s of CASE_SEASONS) bRows[s] = breakoutRows(ppr[s], tables.ppr.games[s], replacement);
const pools = { waiver_relevant: r => r.outside_tier && r.c.position !== "QB", all_rb_wr_te: r => r.c.position !== "QB", qb_reported_only: r => r.c.position === "QB" };
const breakout = { class: "X", decision_weeks: DECISION_WEEKS, tiers: TIER, gain_G: GAIN, role_metric: ROLE_METRIC, definitions: ["rank", "gain", "persistence"], results: {} };
const eras = { development_2016_2021: CASE_SEASONS.filter(s => s <= 2021), consumed_2022_2025: PRIMARY_FOLDS, all_2016_2025: CASE_SEASONS };
for (const [pool, f] of Object.entries(pools)) {
  breakout.results[pool] = {};
  for (const def of breakout.definitions) {
    if (pool === "qb_reported_only" && def === "persistence") continue;
    const r = { eras: {}, seasons: {}, positions: {} };
    for (const [era, ss] of Object.entries(eras)) r.eras[era] = evaluateSignals(ss.flatMap(s => bRows[s]).filter(f), def);
    for (const s of CASE_SEASONS) r.seasons[s] = evaluateSignals(bRows[s].filter(f), def);
    if (pool !== "qb_reported_only") for (const p of ["RB", "WR", "TE"]) r.positions[p] = evaluateSignals(CASE_SEASONS.flatMap(s => bRows[s]).filter(f).filter(x => x.c.position === p), def);
    breakout.results[pool][def] = r;
  }
}
const allWaiver = CASE_SEASONS.flatMap(s => bRows[s]).filter(pools.waiver_relevant);
breakout.lead_times = Object.fromEntries(Object.keys(allWaiver[0].flags).map(fl => [fl, leadTimes(allWaiver, fl)]));
breakout.role_change_gate_rate = mean(PRIMARY_FOLDS.flatMap(s => ppr[s].map(c => sustainedRoleChange(c) ? 1 : 0)));
log("breakout done");

const report = {
  task: "EDGE-01", schema: "edge-01-results-1", generated_at: new Date().toISOString(),
  evidence_class: { point_forecast: "R (V0 corrected public data; walk-forward; consumed seasons 2022-2025; development folds 2019-2021)", lineup_simulation: "X", breakout_signals: "X" },
  control_model: { model_version: MODEL_VERSION, feature_version: FEATURE_VERSION, note: "Production Start Value is the control; unchanged. It contains ffopportunity xFP (betting-derived) for seasons >= 2021 and equals noX before." },
  protocol: { sealed_season: SEALED_SEASON, seasons_loaded: [FIRST_SEASON, LAST_SEASON], case_seasons: CASE_SEASONS, primary_folds: PRIMARY_FOLDS, development_folds: DEVELOPMENT_FOLDS,
    walk_forward: "train 2016..Y-2, select on Y-1 per position (PPR MAE), score once on Y", weeks: [3, 17], outcome: "next-game PPR points, played only; missing stays missing", screens: { mae: 0.05, lineup_points_per_roster_week: 0.1 },
    analysis_plan: "docs/research/edge-01-analysis-plan.md (committed before outcomes)", permutations: PERMUTATIONS },
  provenance: { data_dir: dataDir, files: data.provenance, betting_derived_inputs: ["ffopportunity v1.0.0-data xFP (X, X_season, xfp metrics)"] },
  inventory: inventory(data.games), case_audit: audit, leakage, vip_models: vip,
  strongest_simple_baseline: { ranking: simple, identity: simple[0][0] },
  controls, families: familyResults, other_formats: formats, lineup, breakout,
  candidate_definitions: Object.fromEntries(Object.entries(FAMILIES).map(([id, f]) => [id, { family: f.family, betting_derived: f.betting_derived, post_hoc: !!f.post_hoc, grid: f.grid, min_test_season: f.minTest ?? null, ew_half_lives: id === "B2_ewall" ? EW_ALL_HALF_LIVES : undefined }])),
};
await mkdir(OUT.split("/").slice(0, -1).join("/"), { recursive: true });
await writeFile(OUT, JSON.stringify(round(report), null, 1) + "\n");
log("wrote", OUT);
