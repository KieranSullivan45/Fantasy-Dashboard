import test from "node:test";
import assert from "node:assert/strict";
import { importRankings, consensusRank } from "../lib/sources/rankings/index.js";
import { importOwnership, ownershipContext } from "../lib/sources/ownership/index.js";
import { weeklyMatchup } from "../lib/decision/weekly-matchup.js";

test("imports reject incompatible/stale observations; consensus deduplicates source families", () => {
  const scope = { season: 2026, week: 3, scoring_profile: "PPR", now: Date.parse("2026-09-22") };
  const row = { player_id: "1", position: "WR", season: 2026, week: 3, scoring_profile: "PPR", published_at: "2026-09-21", source_id: "a", source_family: "a", value: 4 };
  const imported = importRankings([row, { ...row, source_id: "mirror" }, { ...row, source_family: "b", value: 8 }, { ...row, week: 2 }, { ...row, value: null }, { ...row, published_at: "2026-08-01" }], scope);
  assert.equal(imported.rejected.length, 3);
  assert.equal(consensusRank(imported.accepted, "1", "WR").average_rank, 6);
  assert.equal(consensusRank([], "1", "WR").average_rank, null);
  assert.equal(importOwnership([{ ...row, value: 101 }], scope).accepted.length, 0);
  assert.equal(ownershipContext().change_percentage_points, null);
});

test("weekly matchup preserves actual zeroes, overrides, weekly order and empty slots", () => {
  const snapshot = { my_roster: { roster_id: 1 }, matchup_week: 3, league: { roster_positions: ["QB", "FLEX", "BN"] }, rosters: [], current_matchups: [
    { roster_id: 1, matchup_id: 4, points: 12, custom_points: 0, starters: ["2", "0"], starters_points: [0, 0] },
    { roster_id: 2, matchup_id: 4, points: 15, starters: ["3"], players_points: { "3": 15 } },
  ] };
  const matchup = weeklyMatchup(snapshot);
  assert.equal(matchup.teams[0].actual_points, 0);
  assert.equal(matchup.teams[0].starters[0].player_id, "2");
  assert.equal(matchup.teams[0].starters[0].actual_points, 0);
  assert.equal(matchup.teams[0].starters[1].player_id, null);
  assert.equal(matchup.teams[1].starters[0].actual_points, 15);
  assert.equal(matchup.teams[0].projected_points, null);
  assert.equal(weeklyMatchup({ ...snapshot, current_matchups: [] }).status, "unavailable");
  assert.equal(weeklyMatchup({ ...snapshot, current_matchups: snapshot.current_matchups.slice(0, 1) }).status, "unavailable");
});
