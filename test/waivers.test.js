import test from "node:test";
import assert from "node:assert/strict";
import { buildFreeAgents, isCurrentFantasyPlayer } from "../lib/derive.js";

test("current injured assets survive while stale and retired records do not", () => {
  const base = { position: "RB", team: "BUF", active: true };
  for (const injury_status of ["IR", "Out", "PUP", "Questionable", "Doubtful"]) {
    assert.equal(isCurrentFantasyPlayer({ ...base, active: false, status: "Inactive", injury_status }), true);
  }
  assert.equal(isCurrentFantasyPlayer({ ...base, active: false, status: "Injured Reserve" }), true);
  assert.equal(isCurrentFantasyPlayer({ ...base, status: "Retired", injury_status: "IR" }), false);
  assert.equal(isCurrentFantasyPlayer({ ...base, active: false, status: "Inactive" }), false);
  assert.equal(isCurrentFantasyPlayer({ ...base, team: null }), false);
  assert.equal(isCurrentFantasyPlayer({ ...base, team: null }, 12), true);
  assert.equal(isCurrentFantasyPlayer({ ...base, team: null, active: false }, 12), false);
  assert.equal(isCurrentFantasyPlayer({ ...base, position: "OL" }), false);
  assert.equal(isCurrentFantasyPlayer({ position: "DEF", team: "BUF", active: false }), true);
  assert.equal(isCurrentFantasyPlayer({ position: "DEF", team: "OAK" }), false);
});

test("all roster compartments and numeric IDs exclude holdings from waivers", () => {
  const players = Object.fromEntries([1, 2, 3, 4, 5].map(id => [id, { position: "RB", team: "BUF", active: true }]));
  const free = buildFreeAgents({ players, rosters: [{ players: [1], starters: [2, "0"], reserve: [3], taxi: [4] }] });
  assert.deepEqual(free.RB.map(p => p.player_id), ["5"]);
});
