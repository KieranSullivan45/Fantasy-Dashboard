import test from "node:test";
import assert from "node:assert/strict";
import { highValueOpportunities } from "../lib/sources/plays/nflverse.js";
import { robustConsensus } from "../lib/sources/rankings/index.js";
import { recommendationObservations, saveObservations } from "../lib/decision/observations.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";
import { teamStrengthV2 } from "../lib/decision/team-strength-v2.js";
test("red-zone import derives reproducible counts and excludes invalid/non-football opportunities", () => {
  const row = { game_id: "g", play_id: 1, season: 2025, season_type: "REG", week: 1, posteam: "BUF", rush_attempt: 1, rusher_player_id: "a", yardline_100: 5 };
  const result = highValueOpportunities([row, row, { ...row, play_id: 2, rusher_player_id: "b", yardline_100: 3 }, { ...row, play_id: 3, rush_attempt: 0, pass_attempt: 1, receiver_player_id: "a", yardline_100: 15 }, ...["no_play", "qb_kneel", "two_point_attempt"].map((key, i) => ({ ...row, play_id: i + 4, [key]: 1 })), { ...row, play_id: 9, week: 3 }], { season: 2025, beforeWeek: 3 });
  const a = result.find(p => p.player_id === "a");
  assert.equal(a.red_zone_carries, 1); assert.equal(a.inside_10_carries, 1); assert.equal(a.inside_5_carries, 1);
  assert.equal(a.red_zone_targets, 1); assert.equal(a.goal_line_carry_share, 0.5); assert.equal(a.end_zone_targets, null);
  assert.deepEqual(a.evidence.map(e => e.play_id), ["1", "3"]);
});
test("robust consensus separates horizon/scoring, deduplicates families and ignores missing ranks", () => {
  const row = { player_id: "a", position: "WR", horizon: "weekly", season: 2026, week: 3, scoring_profile: "PPR", source_family: "a", value: 5, published_at: "2026-09-22", redistribution_permitted: true };
  const scope = { season: 2026, week: 3, scoring_profile: "PPR", now: Date.parse("2026-09-23") };
  const r = robustConsensus([row, row, { ...row, source_family: "b", value: 6 }, { ...row, source_family: "c", value: 100 }, { ...row, source_family: "d", value: null }, { ...row, source_family: "e", value: 1, horizon: "ros" }], "a", "WR", scope);
  assert.equal(r.robust_rank, 6); assert.equal(r.source_count, 3); assert.equal(r.public_redistribution_allowed, true);
  assert.equal(robustConsensus([], "a", "WR", scope).robust_rank, null);
});
test("versioned recommendation observations support append-only idempotence without a database", async () => {
  const d = await buildDecisionContext("A", decisionFixtureOptions()), rows = recommendationObservations(d), memory = new Map();
  const store = { appendIfAbsent: async (id, r) => { if (!memory.has(id)) memory.set(id, r); } };
  await saveObservations(store, rows); await saveObservations(store, rows);
  assert.equal(memory.size, rows.length); assert.ok(rows.length);
  assert.equal(rows[0].model_version, "decision-0.3.2");
  const changed = recommendationObservations({ ...d, model_version: "future" });
  assert.notEqual(changed[0].observation_id, rows[0].observation_id);
});
test("team v2 accounts for dual assets once across assigned starters and bench", () => {
  const players = [{ player_id: "dual", fantasy_positions: ["WR", "TE"] }, { player_id: "w", fantasy_positions: ["WR"] }, { player_id: "t", fantasy_positions: ["TE"] }];
  const ctx = Object.fromEntries(players.map((p, i) => [p.player_id, { schedule: { status: "scheduled" }, model: { supported: true, player_value: 20 - i, start_value: { central: 20 - i }, replacement: { position: "TE" } } }]));
  const levels = Object.fromEntries(["QB", "RB", "WR", "TE"].map(p => [p, { replacement_value: 5, eligible_starter_demand: p === "WR" ? 1 : 0 }]));
  const r = teamStrengthV2({ roster_id: 1, all_players: players }, ["WR", "FLEX"], ctx, levels, { bonus_rec_te: 0.5 });
  assert.equal(Object.values(r.positions).reduce((s, p) => s + p.starter_ids.length, 0), 2);
  assert.equal(r.bench.length, 1); assert.equal(r.te_reception_premium, 0.5); assert.equal(r.market_value, null);
});
