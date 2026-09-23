import test from "node:test";
import assert from "node:assert/strict";
import { weeklyFeatures, forecast } from "../lib/decision/features.js";
import { optimizeLineup } from "../lib/decision/optimizer.js";
import { assignHistoricalLineup } from "../lib/decision/team-strength.js";
import { buildCases, evaluate, spearman } from "../lib/backtest/evaluate.js";
import { replacementLevels } from "../lib/decision/replacement.js";
import { transactionEvaluator } from "../lib/decision/add-drop.js";
import { immediateUpgrade } from "../lib/decision/calibrated-waivers.js";
import { adjustedMatchups } from "../lib/decision/adjusted-matchups.js";
const player = (id, position = "WR", extra = {}) => ({ player_id: id, position, fantasy_positions: [position], team: "BUF", ...extra });
const history = (n = 5) => Array.from({ length: n }, (_, i) => ({ player_id: "a", season: 2023, week: i + 1, position: "WR", team: "BUF", points: 10 + i, snap_share: 0.8, targets: 7, carries: 0, target_share: 0.25, xfp: 12, snap_count: 40 }));
test("features exclude current/future weeks, wrong seasons, and distant priors", () => {
  const rows = history(), opts = { season: 2023, week: 4, currentTeam: "BUF" };
  const a = weeklyFeatures(rows, [], "WR", opts);
  const b = weeklyFeatures([...rows, { ...rows[0], week: 8, points: 999 }, { ...rows[0], season: 2024, points: 999 }], [{ ...rows[0], season: 2020, points: 999 }], "WR", opts);
  assert.deepEqual(a, b); assert.equal(a.current_games, 3); assert.equal(a.data_through_week, 3);
});
test("role expansion is provisional at two games, declines reduce opportunity, missing shares cannot create a trend", () => {
  const rows = history(2).map((g, i) => ({ ...g, snap_share: [0.1, 0.35][i], carry_share: [0.05, 0.4][i] }));
  const options = { season: 2023, week: 3, currentTeam: "BUF" };
  const f = weeklyFeatures(rows, [], "RB", options);
  assert.equal(f.provisional_role_expansion, true); assert.equal(f.small_sample, true);
  assert.equal(weeklyFeatures(rows.map((g, i) => ({ ...g, snap_share: i ? 0.8 : null, carry_share: null })), [], "RB", options).provisional_role_expansion, false);
  const strong = weeklyFeatures(history(4), [], "WR", { ...options, week: 5 });
  const falling = weeklyFeatures(history(4).map((g, i) => i < 2 ? g : { ...g, snap_share: 0.1, targets: 1, target_share: 0.02, xfp: 2 }), [], "WR", { ...options, week: 5 });
  assert.ok(falling.opportunity.score < strong.opportunity.score);
});
test("priors shrink by sample, are discounted on team change, and denominators remain explicit", () => {
  const prior = history(5).map(g => ({ ...g, season: 2022, points: 20 }));
  const opts = { season: 2023, week: 3, currentTeam: "BUF" };
  const f = weeklyFeatures(history(2), prior, "WR", opts);
  assert.equal(f.prior.contribution, 4 / 6);
  const moved = weeklyFeatures(history(2).map(g => ({ ...g, team: "NE" })), prior, "WR", { ...opts, currentTeam: "NE" });
  assert.equal(moved.prior.effective_games, 1);
  assert.equal(f.denominators.active_games, null); assert.equal(f.denominators.offensive_snaps.games, 2);
  assert.equal(f.uncertainty.floor_like, null);
});
test("optimizer matches exhaustive DP, preserves dual eligibility, negative scorers, and never doubles players", () => {
  const players = [player("q", "QB"), player("dual", "WR", { fantasy_positions: ["WR", "DB"] }), player("w"), player("r", "RB"), player("t", "TE")];
  const slots = ["QB", "WR", "FLEX", "SUPER_FLEX", "DB"], values = { q: 20, dual: 15, w: 12, r: -2, t: 9 };
  for (let seed = 0; seed < 20; seed++) {
    const v = Object.fromEntries(Object.entries(values).map(([id, value], i) => [id, value + (seed * (i + 3) % 11)]));
    const actual = optimizeLineup(players, slots, v), reference = assignHistoricalLineup(players, slots, Object.fromEntries(Object.entries(v).map(([id, ppg]) => [id, { ppg }])));
    assert.equal(actual.reduce((s, p) => s + (p.value || 0), 0), reference.reduce((s, p) => s + (p.ppg || 0), 0));
    assert.equal(new Set(actual.map(p => p.player_id).filter(Boolean)).size, actual.filter(p => p.player_id).length);
  }
  assert.equal(optimizeLineup([player("r", "RB")], ["RB"], { r: -5 })[0].value, -5);
});
test("replacement reflects real pool, shallow/deep demand and Superflex QB scarcity", () => {
  const all = Array.from({ length: 200 }, (_, i) => player(String(i), i < 100 ? "RB" : "QB")), values = Object.fromEntries(all.map((p, i) => [p.player_id, 60 - i % 100 * 0.5]));
  const free = all.filter((_, i) => i % 100 > 30), options = { slots: ["QB", "RB", "RB", "FLEX"], benchSlots: 6 };
  const eight = replacementLevels(all, free, values, { ...options, teams: 8 }), twelve = replacementLevels(all, free, values, { ...options, teams: 12 });
  assert.ok(eight.RB.replacement_value > twelve.RB.replacement_value + 1);
  const sf = replacementLevels(all, free, values, { ...options, teams: 10, slots: [...options.slots, "SUPER_FLEX"] });
  assert.ok(sf.QB.demand_rank > eight.QB.demand_rank);
  assert.ok(sf.QB.replacement_value < eight.QB.replacement_value);
});
function contexts(players, values) { return Object.fromEntries(players.map(p => [p.player_id, { player: p, schedule: { status: "scheduled" }, model: { player_value: values[p.player_id], start_value: { central: values[p.player_id] }, features: { feature_inputs: {} } } }])); }
test("full rosters require a drop and preserve its opportunity cost; reserve/taxi do not free capacity", () => {
  const a = player("a"), b = player("b"), c = player("c"), elite = player("elite"), players = [a, b, c, elite], values = { a: 10, b: 8, c: 11, elite: 40 }, ctx = contexts(players, values);
  const levels = { WR: { replacement_value: 5 } };
  const result = transactionEvaluator({ all_players: [a, b] }, ["WR", "BN"], ctx, levels)(c);
  assert.equal(result.best.drop_player_id, "b"); assert.equal(result.best.dropped_player_value, 8);
  assert.equal(result.starter_gain, 1); assert.equal(result.depth_gain, 2);
  const free = transactionEvaluator({ all_players: [a] }, ["WR", "BN"], ctx, levels)(c);
  assert.equal(free.best.drop_player_id, null); assert.ok(free.net_roster_improvement > result.net_roster_improvement);
  const protectedResult = transactionEvaluator({ all_players: [{ ...a, injury_status: "IR" }, { ...b, injury_status: "PUP" }, { ...elite, reserve: true }] }, ["WR", "BN"], ctx, levels)(c);
  assert.equal(protectedResult.best, null);
});
test("immediate label requires meaningful gain, role, evidence, freshness and availability", () => {
  const c = { decision_week: 6, model: { start_value: { available_this_week: true }, features: { current_games: 5, data_through_week: 5, opportunity: { score: 70 } } } };
  const item = { coverage_percent: 90, roster_value: { starter_gain: 1.5, net_roster_improvement: 2 } };
  assert.equal(immediateUpgrade(item, c), false);
  item.roster_value.starter_gain = 6.5; assert.equal(immediateUpgrade(item, c), true);
  c.model.start_value.available_this_week = false; assert.equal(immediateUpgrade(item, c), false);
});
test("two-game assets without prior baselines cannot be sold cheaply as automatic drops", () => {
  const rookie = player("rookie"), candidate = player("candidate"), elite = player("elite");
  const c = contexts([rookie, candidate, elite], { rookie: 3, candidate: 15, elite: 40 });
  c.rookie.model.features = { current_games: 2, prior: { ppg: null }, feature_inputs: {} };
  const result = transactionEvaluator({ all_players: [rookie] }, ["WR"], c, { WR: { replacement_value: 5 } })(candidate);
  assert.equal(result.best, null);
  assert.ok(result.protected_players[0].reasons.some(r => r.startsWith("Unestablished asset")));
});
test("backtest membership and features cannot see future output, metric math handles ties", () => {
  const rows = history(8), before = buildCases(rows, 2023).cases.find(c => c.week === 4);
  const after = buildCases(rows.map(r => r.week >= 4 ? { ...r, points: 999, xfp: 999 } : r), 2023).cases.find(c => c.week === 4);
  assert.deepEqual(before.features, after.features); assert.notEqual(before.actual, after.actual);
  assert.equal(spearman([1, 2, 2, 4], [1, 2, 2, 4]), 1);
  assert.equal(evaluate([before], c => c.actual).mae, 0);
  const missing = forecast({ ...before.features, recent_xfp: null }, [0.6, 0.2, 0.2, 0]);
  assert.equal(missing.coverage, 0.8); assert.ok(missing.fallback);
});
test("adjusted matchups use opponent baseline, exclude future games and temper small samples", () => {
  const games = [{ player_id: "a", game_id: "g1", week: 1, position: "RB", opponent: "NE", points: 20 }, { player_id: "a", game_id: "g2", week: 2, position: "RB", opponent: "NYJ", points: 30 }, { player_id: "a", game_id: "future", week: 3, position: "RB", opponent: "NYJ", points: 999 }];
  const raw = { RB: { NE: { team: "NE", games: 1, points_per_game: 20, total_points: 20, through_week: 1, game_values: [{ game_id: "g1", week: 1, points: 20 }] } } };
  const result = adjustedMatchups(games, raw, 3, "ppr").RB.NE;
  assert.equal(result.residual_per_game, -10); assert.equal(result.shrinkage_weight, 1 / 7); assert.equal(result.small_sample, true);
  assert.deepEqual(result, adjustedMatchups(games.slice(0, 2), raw, 3, "ppr").RB.NE);
});

