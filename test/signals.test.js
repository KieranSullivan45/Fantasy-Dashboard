import test from "node:test";
import assert from "node:assert/strict";
import { playerSignals } from "../lib/signals/engine.js";
import { sleeperAttention, importMarketAggregates } from "../lib/market/observations.js";
const scope = { leagueId: "L", season: 2027, week: 4, throughWeek: 3, generatedAt: "2027-09-23", modelVersion: "decision-0.3.2" };
const context = (snap = [0.45, 0.61, 0.79], target = [0.12, 0.18, 0.25]) => ({ player: { player_id: "p", team: "BUF", fantasy_positions: ["WR"] }, model: { player_value: 15, features: { prior: null } },
  analytics: { source_ids: ["nflverse"], history: snap.map((share, i) => ({ season: 2027, game_id: `g${i}`, week: i + 1, team: "BUF", snap_share: share, target_share: target[i], xfp: 5 + i * 4 })) } });
test("role expansion, noise rejection, decline and two-game confidence", () => {
  assert.ok(playerSignals(context(), scope).some(s => s.type === "ROLE_EXPANSION" && s.confidence === "moderate"));
  assert.equal(playerSignals(context([0.61, 0.63], [0.17, 0.18]), { ...scope, week: 3, throughWeek: 2 }).length, 0);
  assert.ok(playerSignals(context([0.82, 0.6, 0.39]), scope).some(s => s.type === "ROLE_DECLINE"));
  assert.ok(playerSignals(context([0.1, 0.35], [0.05, 0.2]), { ...scope, week: 3, throughWeek: 2 }).some(s => s.type === "ROLE_EXPANSION" && s.confidence === "low"));
});
test("attention confirms or contradicts evidence without changing FootballValue; censored data cannot be quiet", () => {
  const c = context(), before = JSON.stringify(c.model); c.market_attention = { raw_count: 200, attention_percentile: 20 };
  assert.ok(playerSignals(c, scope).some(s => s.type === "QUIET_BREAKOUT"));
  c.market_attention = { raw_count: 200, change: 150, relative_change: 3, attention_percentile: 95 };
  assert.ok(playerSignals(c, scope).some(s => s.type === "BUZZ_AND_DATA_CONFIRMATION"));
  assert.equal(JSON.stringify(c.model), before);
  const weak = context([0.2, 0.22, 0.23], [0.1, 0.1, 0.1]); weak.analytics.history.forEach(g => g.xfp = 4); weak.market_attention = c.market_attention;
  assert.ok(playerSignals(weak, scope).some(s => s.type === "HYPE_RISK"));
  c.market_attention = { raw_count: null, attention_percentile: null }; assert.ok(!playerSignals(c, scope).some(s => s.type === "QUIET_BREAKOUT"));
});
test("signals cannot see later weeks, stale samples or old-team roles", () => {
  const c = context(), before = playerSignals(c, scope);
  c.analytics.history.push({ ...c.analytics.history[0], game_id: "future", week: 5, snap_share: 0 });
  assert.deepEqual(playerSignals(c, scope), before);
  c.player.team = "NE"; assert.equal(playerSignals(c, scope).length, 0);
  assert.equal(playerSignals(context(), { ...scope, week: 7, throughWeek: 6 }).length, 0);
});
test("market change needs comparable past windows; imports discard social identifiers and text", () => {
  const c = context(); c.interest = { sleeper_adds_24h: 100, available_percentile: 90 };
  const opts = { season: 2027, week: 4, generatedAt: "2027-09-23" };
  assert.equal(sleeperAttention(c, opts).change, null);
  const previous = [{ source: "sleeper", player_id: "p", season: 2027, window_hours: 24, raw_count: 20, timestamp: "2027-09-22" }];
  assert.equal(sleeperAttention(c, { ...opts, previous }).change, 80);
  assert.equal(sleeperAttention(c, { ...opts, previous: [{ ...previous[0], timestamp: "2027-09-24" }] }).change, null);
  const rows = importMarketAggregates([{ source: "reddit", player_id: "p", timestamp: "2027-09-22", mention_count: 3, window_hours: 24, username: "never-store", text: "discard", provenance: { permission_reference: "approved-use" } }], { now: Date.parse("2027-09-23"), approvedSources: ["reddit"] });
  assert.equal(rows.length, 1); assert.equal(rows[0].username, undefined); assert.equal(rows[0].text, undefined);
});
