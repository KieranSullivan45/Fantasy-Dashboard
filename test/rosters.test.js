import test from "node:test";
import assert from "node:assert/strict";
import { buildRosterViews } from "../lib/derive.js";

test("starter order, empty slots, co-ownership, IR/taxi and unknown assets survive", () => {
  const [roster] = buildRosterViews({ rosters: [{ roster_id: 1, co_owners: ["me"], players: [1, 2, 3], starters: [2, "0", 1], reserve: [4], taxi: [5] }], userId: "me", rosterPositions: ["RB", "WR", "FLEX", "BN"] });
  assert.equal(roster.is_user, true);
  assert.deepEqual(roster.starters.map(p => p.player_id), ["2", "1"]);
  assert.deepEqual(roster.starter_slots, [{ slot: "RB", player_id: "2" }, { slot: "WR", player_id: null }, { slot: "FLEX", player_id: "1" }]);
  assert.deepEqual(roster.bench.map(p => p.player_id), ["3"]);
  assert.deepEqual(roster.reserve.map(p => p.player_id), ["4"]);
  assert.deepEqual(roster.taxi.map(p => p.player_id), ["5"]);
  assert.equal(roster.taxi[0].name, "5");
  assert.equal(roster.all_players.length, 5);
  assert.equal(roster.waiver_budget_used, null);
});
