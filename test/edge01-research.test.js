// EDGE-01 research harness tests: leakage, missingness, identity, determinism and production isolation (synthetic data only).
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { assertNotSealed, teamTotals, draftRounds, buildSeasonGames } from "../lib/research/edge01/data.js";
import { opportunityFeatures, sustained, spikeOnly, ewTwoSeasonPrior, ewAllGames, vipOf } from "../lib/research/edge01/features.js";
import { buildCaseTable } from "../lib/research/edge01/cases.js";
import { ridge, predictLinear } from "../lib/research/edge01/fit.js";
import { pointMetrics, pairedDelta, flagMetrics, averagePrecision } from "../lib/research/edge01/metrics.js";
import { runFold, FAMILIES } from "../lib/research/edge01/experiments.js";
import { outcomes, signals, weeklyReplacement } from "../lib/research/edge01/breakout.js";
import { draftLeagues, simulate } from "../lib/research/edge01/lineup.js";
import { CALIBRATION } from "../lib/decision/calibration/weights.js";
import { MODEL_VERSION, FEATURE_VERSION, POLICY } from "../lib/decision/model-config.js";
import { SIGNAL_POLICY } from "../lib/signals/engine.js";

const game = (o = {}) => ({ player_id: "p1", position: "WR", season: 2024, week: 1, game_id: `g${o.week ?? 1}`, team: "BUF", points: 10, snap_share: 0.5, targets: 5, target_share: 0.15,
  carries: 0, carry_share: 0, air_yards: 50, air_yard_share: 0.2, wopr: 0.3, passing_attempts: 0, xfp: null, team_targets: 35, team_carries: 25, team_pass_attempts: 35, team_plays: 65, ...o });
const VIP = { WR: { coef: [0, 1.5, 0.01, 0.8] }, RB: { coef: [0, 0.6, 1.4] }, TE: { coef: [0, 1.5, 0.03] }, QB: { coef: [0, 0.4, 0.9] } };

test("sealed 2026 season is refused by every research loader entry point", () => {
  assert.throws(() => assertNotSealed(2026)); assert.throws(() => assertNotSealed(2027)); assert.doesNotThrow(() => assertNotSealed(2025));
  assert.throws(() => buildSeasonGames({ stats: [], snaps: [], opportunity: [], ids: [] }, 2026));
  assert.throws(() => buildCaseTable({}, 2026));
});

test("opportunity features never read rows at or after the evaluated week (truncation invariance)", () => {
  const rows = [1, 2, 3, 4, 5, 6].map(w => game({ week: w, snap_share: 0.3 + w * 0.05, targets: w }));
  const future = [7, 8, 9].map(w => game({ week: w, snap_share: 1, targets: 30, points: 99 }));
  const a = opportunityFeatures([...rows, ...future], { season: 2024, week: 7, vipModel: VIP });
  const b = opportunityFeatures(rows, { season: 2024, week: 7, vipModel: VIP });
  assert.deepEqual(a, b); assert.equal(a.data_through_week, 6);
  // A later season never enters either.
  assert.deepEqual(opportunityFeatures([...rows, game({ season: 2025, week: 1, points: 50 })], { season: 2024, week: 7, vipModel: VIP }), b);
});

test("missing values stay missing: a window with a missing value is null, never zero-filled or partially averaged", () => {
  const rows = [1, 2, 3, 4].map(w => game({ week: w, snap_share: w === 4 ? null : 0.5 }));
  const f = opportunityFeatures(rows, { season: 2024, week: 5, vipModel: VIP });
  assert.equal(f.metrics.snap_share.last1, null); assert.equal(f.metrics.snap_share.last2, null); assert.equal(f.metrics.snap_share.d_2v2, null);
  assert.equal(f.metrics.snap_share.prev2, 0.5); assert.equal(f.coverage.snap_share, 0.75);
  assert.equal(sustained(f.metrics.snap_share, 0.1), 0);
  assert.equal(vipOf(game({ targets: null }), VIP), null);
  // Team share needs an observed positive team total.
  const g = opportunityFeatures([game({ week: 1, team_targets: null }), game({ week: 2, team_targets: 0 })], { season: 2024, week: 3, vipModel: VIP });
  assert.equal(g.metrics.team_target_share.last2, null);
});

test("absent games are not padded: windows count recorded appearances, and role windows use only the current team", () => {
  const rows = [game({ week: 1, team: "MIA", snap_share: 0.9 }), game({ week: 2, team: "MIA", snap_share: 0.9 }), game({ week: 5, snap_share: 0.2 }), game({ week: 9, snap_share: 0.4 })];
  const f = opportunityFeatures(rows, { season: 2024, week: 10, vipModel: VIP });
  assert.equal(f.team, "BUF"); assert.equal(f.current_team_games, 2); assert.ok(Math.abs(f.metrics.snap_share.last2 - 0.3) < 1e-12);
  assert.equal(f.metrics.points.games, 4); assert.equal(f.calendar_gap, 1);
});

test("sustained change needs both latest games beyond the previous-two baseline; a one-week spike does not qualify", () => {
  const w = vals => opportunityFeatures(vals.map((v, i) => game({ week: i + 1, snap_share: v })), { season: 2024, week: vals.length + 1, vipModel: VIP }).metrics.snap_share;
  assert.equal(sustained(w([0.4, 0.4, 0.6, 0.6]), 0.1), 1); assert.equal(sustained(w([0.4, 0.4, 0.4, 0.9]), 0.1), 0);
  assert.equal(sustained(w([0.6, 0.6, 0.4, 0.4]), 0.1), -1);
  assert.equal(spikeOnly([0.4, 0.4, 0.4, 0.4, 0.8], 0.15), true); assert.equal(spikeOnly([0.4, 0.4, 0.4, 0.8, 0.8], 0.15), false);
});

test("H9 ew2_h16 prior needs a Y−1 game (no Y−2-only fallback) and EW-all ignores current-season rows at or after the week", () => {
  assert.equal(ewTwoSeasonPrior([game({ season: 2022, points: 10 })], 2024), null);
  const p = ewTwoSeasonPrior([game({ season: 2022, week: 1, points: 0 }), game({ season: 2023, week: 1, points: 16 })], 2024, 16);
  assert.ok(Math.abs(p - 16 / (1 + 0.5 ** (1 / 16))) < 1e-9);
  const rows = [game({ season: 2023, week: 1, points: 10 }), game({ season: 2024, week: 1, points: 20 }), game({ season: 2024, week: 3, points: 500 })];
  assert.equal(ewAllGames(rows, 2024, 3, 8), ewAllGames(rows.slice(0, 2), 2024, 3, 8));
});

test("team totals sum observed rows only and the plays proxy is the max offensive snap count", () => {
  const t = teamTotals([{ season_type: "REG", team: "BUF", game_id: "g", targets: "5", carries: "", attempts: "30", receiving_air_yards: "40" }, { season_type: "POST", team: "BUF", game_id: "g", targets: "9" }],
    [{ game_type: "REG", team: "BUF", game_id: "g", offense_snaps: "61" }, { game_type: "REG", team: "BUF", game_id: "g", offense_snaps: "64" }]);
  assert.deepEqual(t.get("BUF:g"), { targets: 5, carries: 0, pass_attempts: 30, air_yards: 40, plays: 64 });
});

test("identity: draft rounds join on exact gsis_id only and duplicated ids stay unknown", () => {
  const d = draftRounds([{ gsis_id: "00-1", draft_round: "2" }, { gsis_id: "00-2", draft_round: "1" }, { gsis_id: "00-2", draft_round: "3" }, { gsis_id: "NA", draft_round: "1" }, { gsis_id: "00-3", draft_round: "NA" }]);
  assert.equal(d.get("00-1"), 2); assert.equal(d.get("00-2"), null); assert.equal(d.get("00-3"), null); assert.equal(d.has("NA"), false);
});

test("ridge recovers a known linear map and skips incomplete rows instead of zero-filling", () => {
  const rows = []; for (let i = 0; i < 50; i++) rows.push({ x: [i, (i * 7) % 11], y: 2 + 3 * i - 0.5 * ((i * 7) % 11) });
  rows.push({ x: [null, 1], y: 1000 });
  const m = ridge(rows, 0); assert.equal(m.n, 50);
  assert.ok(Math.abs(m.coef[0] - 2) < 1e-6 && Math.abs(m.coef[1] - 3) < 1e-6 && Math.abs(m.coef[2] + 0.5) < 1e-6);
  assert.equal(predictLinear(m, [1, null]), null);
});

test("metrics and the paired bootstrap are deterministic and correct on a toy frame", () => {
  const c = (id, w) => ({ player_id: id, season: 2024, week: w, position: "WR", rosterable: true });
  const rows = [{ c: c("a", 3), pred: 10, y: 12 }, { c: c("b", 3), pred: 8, y: 6 }, { c: c("c", 3), pred: 5, y: 4 }, { c: c("a", 4), pred: 9, y: 9 }];
  const m = pointMetrics(rows); assert.equal(m.mae, 1.25); assert.equal(m.bias, 0.25); assert.equal(m.pair_accuracy_all, 1);
  const worse = rows.map(r => ({ ...r, pred: r.pred + 1 }));
  assert.deepEqual(pairedDelta(rows, worse, { seed: 3, draws: 200 }), pairedDelta(rows, worse, { seed: 3, draws: 200 }));
  assert.ok(pairedDelta(rows, worse).delta_mae < 0.75);
  const f = flagMetrics([{ flag: true, event: true, value: 10 }, { flag: true, event: false, value: 2 }, { flag: false, event: true, value: 9 }, { flag: false, event: false, value: 3 }]);
  assert.equal(f.precision, 0.5); assert.equal(f.recall, 0.5); assert.equal(f.lift, 1); assert.equal(f.false_positive_rate, 0.5);
  // Missing scores rank last instead of being dropped.
  assert.equal(averagePrecision([{ score: null, event: true, key: "a" }, { score: 1, event: false, key: "b" }]), 0.5);
});

test("walk-forward selection never reads the test season's outcomes", () => {
  const mk = (season, i, actual) => ({ season, week: 3, player_id: `p${i}`, position: "WR", rosterable: true, outcome: { actual, future: [] },
    inputs: { Q: 10, R3: 10 + (i % 2 ? 4 : -4), noX: 10, opp: null, ewall: {} } });
  const cases = {}; for (let s = 2016; s <= 2025; s++) cases[s] = Array.from({ length: 10 }, (_, i) => mk(s, i, 10 + (i % 2 ? 4 : -4)));
  const a = runFold("A1_qr", cases, 2025);
  const poisoned = { ...cases, 2025: cases[2025].map(c => ({ ...c, outcome: { actual: 10 - (c.inputs.R3 - 10), future: [] } })) };
  const b = runFold("A1_qr", poisoned, 2025);
  assert.equal(a.choices.WR.param, 0.6); assert.equal(b.choices.WR.param, a.choices.WR.param);
  assert.equal(a.choices.WR.selection_season, 2024);
  // xFP-dependent fitted families never train on seasons before the xFP floor.
  assert.equal(FAMILIES.D2_ridge_x.minTrain, 2021); assert.equal(FAMILIES.D2_ridge_x.betting_derived, true);
});

test("breakout outcomes are censored, not zero, when fewer than three window games exist", () => {
  const base = { season: 2024, week: 6, position: "WR", inputs: { S: 8, opp: null }, outcome: { future: [{ week: 6, points: 20 }, { week: 8, points: 20 }] } };
  assert.equal(outcomes(base, new Map()), null);
  const rep = new Map([6, 7, 8].map(w => [`2024:${w}:WR`, 10]));
  const o = outcomes({ ...base, outcome: { future: [6, 7, 8].map(w => ({ week: w, points: 15 })) } }, rep);
  assert.equal(o.gain, true); assert.equal(o.window_games, 3);
  assert.equal(weeklyReplacement([{ season: 2024, week: 1, position: "TE", points: 5 }]).get("2024:1:TE"), null);
});

test("breakout signals use as-of inputs only (changing the outcome window changes no signal)", () => {
  const rows = [1, 2, 3, 4].map(w => game({ week: w, snap_share: w > 2 ? 0.8 : 0.4, targets: w > 2 ? 9 : 3, target_share: w > 2 ? 0.3 : 0.1, points: 8 }));
  const opp = opportunityFeatures(rows, { season: 2024, week: 5, vipModel: VIP });
  const c = { season: 2024, week: 5, position: "WR", player_id: "p1", draft_round: null, inputs: { S: 8, opp }, outcome: { future: [] } };
  const s1 = signals(c, []), s2 = signals({ ...c, outcome: { future: [5, 6, 7].map(w => ({ week: w, points: 40 })) } }, []);
  assert.deepEqual(s1, s2); assert.equal(s1.flags.N1_sustained_snap, true); assert.equal(s1.flags.N2_sustained_target_share, true); assert.equal(s1.flags.N4_multi_dimension, true);
});

test("lineup simulation drafts deterministically from played cases and fills a legal lineup", () => {
  const cases = []; let i = 0;
  for (const [pos, n] of Object.entries({ QB: 30, RB: 70, WR: 70, TE: 30 })) for (let k = 0; k < n; k++) cases.push({ player_id: `x${i++}`, position: pos, season: 2024, week: 5, inputs: { Q: 20 - k * 0.1 }, outcome: { actual: k % 7 } });
  cases.push({ player_id: "dnp", position: "RB", season: 2024, week: 5, inputs: { Q: 99 }, outcome: { actual: null } });
  const a = draftLeagues(cases, 1), b = draftLeagues(cases, 1);
  assert.deepEqual(a.map(r => r.map(c => c.player_id)), b.map(r => r.map(c => c.player_id)));
  assert.ok(a.every(r => r.length === 14)); assert.ok(a.flat().every(c => c.player_id !== "dnp"));
  const sim = simulate(new Map([["2024:5", cases]]), { q: c => c.inputs.Q });
  assert.ok(sim.every(r => r.q <= r.optimal + 1e-9));
});

test("production isolation: no production path imports research code and protected model constants are unchanged", async () => {
  const files = [];
  const walk = async dir => { for (const e of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}${e.name}`; if (e.isDirectory()) { if (!["research", "node_modules"].includes(e.name)) await walk(`${p}/`); } else if (/\.(js|jsx|mjs)$/.test(e.name)) files.push(p);
  } };
  await walk("../lib/"); await walk("../app/");
  for (const f of files) assert.doesNotMatch(await readFile(new URL(f, import.meta.url), "utf8"), /research\/edge01|lib\/research/, f);
  assert.equal(MODEL_VERSION, "decision-0.3.2"); assert.equal(FEATURE_VERSION, "weekly-features-2");
  for (const pos of ["QB", "RB", "WR", "TE"]) assert.deepEqual(CALIBRATION[pos].start.weights, [0.6, 0.2, 0.2, 0]);
  assert.deepEqual(CALIBRATION.TE.pickup.weights, [0.3, 0.1, 0.4, 0.2]);
  assert.equal(POLICY.priorGames, 4); assert.equal(POLICY.changedRolePriorGames, 1);
  assert.deepEqual(SIGNAL_POLICY, { snapDelta: 0.18, targetDelta: 0.06, carryDelta: 0.15, xfpDelta: 3, marketRelative: 0.5, marketAbsolute: 100, maxPerPlayer: 5 });
});
