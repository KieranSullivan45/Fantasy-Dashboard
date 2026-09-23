import test from "node:test";
import assert from "node:assert/strict";
import { kickoffUtc, normalizeSchedule, upcomingGame } from "../lib/decision/schedule.js";
import { buildMatchupDifficulty } from "../lib/decision/matchup-difficulty.js";

test("schedule uses Eastern DST, identifies opponents, and never invents live game status", () => {
  assert.equal(kickoffUtc("2026-09-27", "13:00"), "2026-09-27T17:00:00.000Z");
  assert.equal(kickoffUtc("2026-01-04", "13:00"), "2026-01-04T18:00:00.000Z");
  const schedule = normalizeSchedule([{ season: "2026", week: "3", game_type: "REG", game_id: "g", home_team: "LA", away_team: "SEA", gameday: "2026-09-27", gametime: "13:00", home_score: "", away_score: "" }], 2026);
  assert.equal(upcomingGame("LAR", schedule, 3, Date.parse("2026-09-23")).opponent, "SEA");
  assert.equal(upcomingGame("SEA", schedule, 3, Date.parse("2026-09-28")).status, "kickoff_passed");
  assert.equal(upcomingGame("SEA", schedule, 3).live_status, null);
  assert.equal(upcomingGame("BUF", schedule, 3).status, "no_scheduled_game");
});

test("points allowed ranks most-first, includes real positional zeros, excludes missing games, and preserves raw totals", () => {
  const schedule = [
    { game_id: "a", week: 1, home_team: "BUF", away_team: "NE", home_score: 20, away_score: 10 },
    { game_id: "b", week: 2, home_team: "BUF", away_team: "NE", home_score: 20, away_score: 10 },
    { game_id: "missing", week: 2, home_team: "SEA", away_team: "LAR", home_score: 20, away_score: 10 },
  ];
  const base = { position: "WR", scoring: { status: "complete" }, raw_stats: { receptions: "2", season: "2026" } };
  const result = buildMatchupDifficulty([{ ...base, game_id: "a", opponent: "BUF", points: 20 }, { ...base, game_id: "a", opponent: "NE", points: 10 }, { ...base, position: "QB", game_id: "b", opponent: "NE", points: 1 }], schedule, 3);
  assert.equal(result.WR.BUF.points_per_game, 10);
  assert.equal(result.WR.BUF.games, 2);
  assert.equal(result.WR.BUF.rank_most, 1);
  assert.equal(result.WR.NE.rank_most, 2);
  assert.match(result.WR.BUF.label, /1st-most WR/);
  assert.equal(result.WR.SEA.points_per_game, null);
  assert.equal(result.WR.SEA.expected_games, 1);
  assert.equal(result.WR.BUF.game_values.find(g => g.game_id === "a").raw_totals.receptions, 2);
});
