import test from "node:test";
import assert from "node:assert/strict";
import { buildFreeAgents } from "../lib/derive.js";
import { fitsSlot, uniquePlayers } from "../lib/normalize/positions.js";
import { buildProduction } from "../lib/decision/production.js";

test("Sleeper dual WR/DB eligibility survives provider conflicts and appears in every legal tab", () => {
  const hunter = { position: "DB", fantasy_positions: ["WR", "DB"], active: true, team: "JAX" };
  const pools = buildFreeAgents({ players: { h: hunter }, rosterPositions: ["WR", "DB", "FLEX"] });
  assert.equal(pools.WR[0].position, "DB");
  assert.equal(pools.DB[0].player_id, "h");
  assert.equal(uniquePlayers(Object.values(pools).flat()).length, 1);
  assert.equal(fitsSlot(hunter, "DB"), true);
  assert.equal(fitsSlot(hunter, "FLEX"), true);
  assert.equal(fitsSlot(hunter, "RB"), false);
  const production = buildProduction([{ player_id: "g", position: "DB", season: 2026, season_type: "REG", week: 1, game_id: "g1", receptions: 5 }], new Map([["g", "h"]]), { season: 2026, week: 2, settings: { rec: 1 }, platformPlayers: new Map([["h", hunter]]) });
  assert.equal(production.players.h.ppg, 5);
  assert.deepEqual(production.players.h.provider_positions, ["DB"]);
});

test("provider primary position never grants eligibility absent from platform positions", () => {
  const pool = buildFreeAgents({ players: { p: { position: "RB", fantasy_positions: ["TE"], team: "BUF", active: true } } });
  assert.equal(pool.RB.length, 0);
  assert.equal(pool.TE.length, 1);
});
