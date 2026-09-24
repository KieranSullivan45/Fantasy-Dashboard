import test from "node:test";
import assert from "node:assert/strict";
import { readFootballPlays, aggregatePlays } from "../lib/sources/plays/precompute.js";
import { playerHighValue } from "../lib/sources/plays/aggregates.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";
test("precompute reads chunked quoted CSV, discards non-allowlisted fields and retains reproducible play counts", async () => {
  const csv = 'season,season_type,week,game_id,play_id,posteam,yardline_100,rush_attempt,pass_attempt,rusher_player_id,receiver_player_id,description,odds\n2027,REG,1,g,1,BUF,5,1,0,p,,"line\nwith quote ""yes""",999\n2027,REG,1,g,2,BUF,8,0,1,,p,target,888\n2027,REG,3,future,3,BUF,2,1,0,p,,future,777\n';
  async function* stream() { for (let i = 0; i < csv.length; i += 7) yield csv.slice(i, i + 7); }
  const parsed = await readFootballPlays(stream()); assert.equal(parsed.records[0].odds, undefined);
  const a = aggregatePlays(parsed, { season: 2027, beforeWeek: 2, provenance: { source: "test" } });
  assert.equal(a.records.length, 1); assert.equal(a.records[0].inside_10_targets, 1); assert.equal(a.records[0].inside_5_carries, 1);
  assert.equal(a.records[0].high_value_opportunity_share, 1); assert.equal(a.data_through_week, 1);
  assert.equal(a.records[0].end_zone_targets, null);
});
test("zeros require covered games, and new PBP evidence cannot silently change calibrated models", async () => {
  const c = { analytics: { history: [{ game_id: "covered", week: 1, team: "BUF" }, { game_id: "missing", week: 2, team: "BUF" }] } };
  const high = playerHighValue(c, { games: [{ game_id: "covered", week: 1 }], records: [], data_through_week: 1 }, "p", 2);
  assert.equal(high.history.length, 1); assert.equal(high.history[0].high_value_opportunities, 0);
  const options = decisionFixtureOptions(), before = await buildDecisionContext("A", options);
  const after = await buildDecisionContext("A", { ...options, highValueSource: async () => ({ status: "available", warnings: [], data: { records: [{ player_id: "g65", game_id: "game2", week: 2, team: "BUF", high_value_opportunities: 99 }], games: [{ game_id: "game2", week: 2 }], data_through_week: 2, provenance: { source: "fixture" } } }) });
  assert.deepEqual(before.player_context["65"].model, after.player_context["65"].model);
  assert.equal(after.player_context["65"].high_value.history[0].high_value_opportunities, 99);
});
