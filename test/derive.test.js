import test from "node:test";
import assert from "node:assert/strict";
import { buildFreeAgents, buildRosterViews, buildStandings } from "../lib/derive.js";

const players = {
  "1": { player_id: "1", first_name: "Alpha", last_name: "RB", position: "RB", fantasy_positions: ["RB"], team: "BUF", active: true, search_rank: 10 },
  "2": { player_id: "2", first_name: "Beta", last_name: "WR", position: "WR", fantasy_positions: ["WR"], team: "BUF", active: true, search_rank: 20 },
  "3": { player_id: "3", first_name: "Gamma", last_name: "RB", position: "RB", fantasy_positions: ["RB"], team: "BUF", active: true, search_rank: 30 },
};

test("free agents exclude rostered players", () => {
  const groups = buildFreeAgents({ players, rosters: [{ players: ["1"] }], trending: [{ player_id: "3", count: 4 }] });
  assert.equal(groups.RB.some((p) => p.player_id === "1"), false);
  assert.equal(groups.RB.some((p) => p.player_id === "3"), true);
});

test("roster views identify the user's roster", () => {
  const views = buildRosterViews({
    rosters: [{ roster_id: 1, owner_id: "u1", players: ["1", "2"], starters: ["1"], settings: { wins: 2, losses: 0, fpts: 200 } }],
    users: [{ user_id: "u1", display_name: "Me" }],
    players,
    userId: "u1",
  });
  assert.equal(views[0].is_user, true);
  assert.equal(views[0].starters[0].name, "Alpha RB");
  assert.equal(views[0].bench[0].name, "Beta WR");
});

test("standings sort by wins then points", () => {
  const standings = buildStandings([
    { roster_id: 1, team_name: "A", is_user: false, record: { wins: 1, losses: 1, ties: 0, points_for: 150, points_against: 140 } },
    { roster_id: 2, team_name: "B", is_user: true, record: { wins: 2, losses: 0, ties: 0, points_for: 120, points_against: 90 } },
  ]);
  assert.equal(standings[0].team_name, "B");
});
