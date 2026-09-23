import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, usageSignals, usageTrend } from "../lib/decision/analytics.js";
import { interestContext } from "../lib/decision/interest.js";
import { scoreOpportunity } from "../lib/normalize/opportunity.js";
import { loadSnaps } from "../lib/sources/usage/nflverse.js";

const history = [0.48, 0.61, 0.74, 0.83].map((share, i) => ({ week: i + 1, team: "BUF", snap_share: share, target_share: [0.12, 0.17, 0.24, 0.26][i], carry_share: [0.1, 0.15, 0.4, 0.5][i], fantasy_points: 10, wopr: 0.7, racr: 1, air_yards: 40 }));
test("usage flags require four fresh same-team games and expose exact evidence", () => {
  assert.deepEqual(usageSignals(history.slice(0, 2), 2), []);
  const signals = usageSignals(history, 4);
  assert.ok(signals.some(s => s.label === "Role expanding" && s.evidence.delta > 0.2));
  assert.ok(signals.some(s => s.label === "Target share rising"));
  assert.ok(signals.some(s => s.label === "Backfield takeover watch"));
  assert.ok(signals.some(s => s.label === "Production lagging opportunity"));
  assert.deepEqual(usageSignals(history, 5), []);
  assert.deepEqual(usageSignals(history.map((h, i) => ({ ...h, team: i < 2 ? "NE" : "BUF" })), 4), []);
  assert.equal(usageTrend(history.map((h, i) => ({ ...h, snap_share: i === 1 ? null : h.snap_share })), "snap_share", 4).delta, null);
  assert.ok(usageSignals(history.map(h => ({ ...h, snap_share: 1 - h.snap_share })), 4).some(s => s.label === "Role contracting"));
});
test("analytics joins snaps by PFR ID, preserves zeroes, derives team shares without generic scoring", () => {
  const rows = [{ player_id: "g", game_id: "a", season: 2026, season_type: "REG", week: 1, team: "BUF", position: "RB", targets: 4, carries: 10, target_share: 0.2, receiving_air_yards: 20, air_yards_share: 0.1, wopr: 0.37, racr: 1.1 }, { player_id: "other", game_id: "a", season: 2026, season_type: "REG", week: 1, team: "BUF", carries: 10 }];
  const snaps = [{ pfr_player_id: "p", game_id: "a", season: 2026, game_type: "REG", week: 1, team: "BUF", offense_snaps: 0, offense_pct: 0 }];
  const result = buildAnalytics(rows, snaps, [{ gsis_id: "g", pfr_id: "p", sleeper_id: "s" }], { season: 2026, week: 2, production: { games: [] } });
  const latest = result.players.s.latest;
  assert.equal(latest.snap_share, 0); assert.equal(latest.snap_count, 0);
  assert.equal(latest.carry_share, 0.5); assert.equal(latest.opportunities, 14);
  assert.equal(latest.fantasy_points, null); assert.equal(latest.wopr, 0.37);
  assert.equal(result.players.s.through_week, 1);
  assert.equal(result.environment.BUF[0].epa_per_recorded_play, null);
});
test("interest percentiles use unique available players and all platform positions; unlisted is unknown", () => {
  const players = [{ player_id: "a", fantasy_positions: ["WR", "DB"], trending_adds_24h: 100 }, { player_id: "b", fantasy_positions: ["WR"], trending_adds_24h: 50 }, { player_id: "c", fantasy_positions: ["DB"], trending_adds_24h: 0 }];
  const result = interestContext([...players, players[0]]);
  assert.equal(result.a.available_rank, 1); assert.equal(result.a.pool_size, 3);
  assert.equal(result.a.positional_percentiles.DB, 50);
  assert.equal(result.c.sleeper_adds_24h, null); assert.equal(result.c.available_percentile, null);
  assert.equal(interestContext(players, true).a.available_percentile, null);
});
test("xFP re-scores expected events and matches actual rules including TE premium", () => {
  const row = { receptions: 5, receptions_exp: 6, rec_yards_gained: 50, rec_yards_gained_exp: 60, total_fantasy_points_exp: 999 };
  const base = scoreOpportunity(row, { rec: 1, rec_yd: 0.1 }, "TE");
  const premium = scoreOpportunity(row, { rec: 1, rec_yd: 0.1, bonus_rec_te: 0.5, st_ff: 1 }, "TE");
  assert.equal(base.expected_points, 12); assert.equal(premium.expected_points, 15);
  assert.equal(premium.points_over_expected, -2.5); assert.equal(premium.status, "partial");
  assert.deepEqual(premium.excluded_rules, ["st_ff"]);
  assert.equal(scoreOpportunity({}, { rec: 1 }, "WR").expected_points, null);
  assert.equal(scoreOpportunity(row, { rec: 1 }, "DB"), null);
});
test("snap adapter reports missing/changed sources instead of manufacturing usage", async () => {
  const result = await loadSnaps(2026, { fetcher: async () => new Response("bad,data\n1,2", { status: 200 }) });
  assert.equal(result.status, "unavailable");
});
