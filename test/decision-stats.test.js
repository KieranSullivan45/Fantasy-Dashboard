import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../lib/sources/csv.js";
import { loadCsvSource } from "../lib/sources/http.js";
import { playerIdMap } from "../lib/normalize/player-ids.js";
import { scoreStats } from "../lib/normalize/scoring.js";
import { buildProduction } from "../lib/decision/production.js";

test("CSV parsing preserves quoted fields, null-like text, and validates source columns", async () => {
  assert.deepEqual(parseCsv('id,name\r\n1,"A, B"\r\n2,"C ""D"""\r\n').rows, [{ id: "1", name: "A, B" }, { id: "2", name: 'C "D"' }]);
  assert.throws(() => parseCsv('a,b\n1'), /width/);
  const result = await loadCsvSource("test", "http://test", { required: ["missing"], fetcher: async () => new Response("id,name\n1,Test") });
  assert.equal(result.status, "unavailable");
  assert.match(result.warnings[0], /columns/);
});

test("league scoring handles TE premium, interceptions, negative/zero points and unsupported rules", () => {
  const raw = { position: "TE", receptions: "4", receiving_yards: "50", passing_interceptions: "1", fumbles_lost_total: "1" };
  assert.equal(scoreStats(raw, { rec: 1, bonus_rec_te: 0.5, rec_yd: 0.1, pass_int: -2, fum_lost: -2 }).points, 7);
  assert.equal(scoreStats({ ...raw, position: "WR" }, { rec: 1, bonus_rec_te: 0.5 }).points, 4);
  assert.equal(scoreStats(raw, { pass_int: -1 }).points, -1);
  assert.equal(scoreStats(raw, { fum: 0 }).points, 0);
  const partial = scoreStats(raw, { rec: 1, st_ff: 1, st_fum_rec: 1 });
  assert.equal(partial.status, "partial"); assert.deepEqual(partial.unsupported_rules, ["st_ff", "st_fum_rec"]);
  assert.equal(scoreStats({}, { rec: 1 }, "WR").points, null);
  assert.equal(scoreStats({}, {}, "DEF").status, "unsupported");
  assert.equal(scoreStats({ fg_made_60_: "1", pat_missed: "1" }, { fgm_60p: 6, xpmiss: -1 }, "K").points, 5);
});

test("production excludes current/future weeks, deduplicates games and does not manufacture DNP zeroes", () => {
  const ids = playerIdMap([{ gsis_id: "g", sleeper_id: "1" }, { gsis_id: "bad", sleeper_id: "2" }, { gsis_id: "bad", sleeper_id: "3" }]);
  assert.deepEqual(ids.ambiguous, ["bad"]);
  const base = { player_id: "g", position: "WR", season: "2026", season_type: "REG", team: "LA", opponent_team: "SEA", receptions: "0", targets: "1", carries: "0" };
  const first = { ...base, game_id: "one", week: "1" };
  const result = buildProduction([first, first, { ...base, game_id: "two", week: "2", receptions: "4" }, { ...base, game_id: "three", week: "3", receptions: "99" }], ids.map, { season: 2026, week: 3, settings: { rec: 1 } });
  assert.equal(result.players["1"].ppg, 2);
  assert.equal(result.players["1"].recorded_games, 2);
  assert.equal(result.players["1"].recent_games[0].week, 2);
  assert.equal(result.players["1"].usage_trend, null);
  assert.equal(result.games[0].team, "LAR");
});
