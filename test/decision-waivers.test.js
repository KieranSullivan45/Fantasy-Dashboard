import test from "node:test";
import assert from "node:assert/strict";
import { assignHistoricalLineup, teamStrength } from "../lib/decision/team-strength.js";
import { waiverRecommendations } from "../lib/decision/waiver-score.js";

test("team strength assigns each player once across FLEX/SUPER_FLEX and excludes IR/taxi", () => {
  const players = [{ player_id: "q", position: "QB", fantasy_positions: ["QB"] }, { player_id: "r", position: "RB", fantasy_positions: ["RB"] }, { player_id: "x", position: "RB", fantasy_positions: ["RB"], taxi: true }];
  const production = { q: { ppg: 20 }, r: { ppg: 15 }, x: { ppg: 99 } };
  const lineup = assignHistoricalLineup(players.slice(0, 2), ["QB", "SUPER_FLEX", "FLEX"], production);
  assert.equal(new Set(lineup.map(p => p.player_id).filter(Boolean)).size, 2);
  assert.equal(lineup.filter(p => p.player_id).length, 2);
  assert.equal(teamStrength({ roster_id: 1, all_players: players }, ["RB"], production, []).historical_lineup[0].player_id, "r");
});

test("waivers score the full pool before truncation without using search rank or interest as usage", () => {
  const players = Array.from({ length: 100 }, (_, i) => ({ player_id: String(i), position: "RB", fantasy_positions: ["RB"], search_rank: i, trending_adds_24h: 999 }));
  const contexts = Object.fromEntries(players.map((p, i) => [p.player_id, { production: { ppg: i, recent_average: i, recorded_games: 2, usage_trend: null, scoring_status: "complete" }, schedule: { status: "scheduled" }, matchup: { rank_most: 1, defenses_measured: 32, points_per_game: 20 } }]));
  const strengths = [{ roster_id: 1, historical_lineup: [{ slot: "RB", ppg: 10 }] }];
  const result = waiverRecommendations(players, contexts, strengths, 1, players, 5);
  assert.equal(result.evaluated_count, 100);
  assert.equal(result.recommendations[0].player_id, "99");
  assert.equal(result.recommendations.length, 5);
  assert.equal(result.recommendations[0].components.usage_trend.score, null);
  assert.equal(result.recommendations[0].coverage_percent, 90);
  assert.equal(result.recommendations[0].components.external_quality.score, null);
  assert.ok(result.recommendations.every(p => p.score >= 0 && p.score <= 100));
  contexts["99"].schedule.status = "no_scheduled_game";
  const second = waiverRecommendations(players, contexts, strengths, 1, players, 5);
  assert.notEqual(second.recommendations[0].player_id, "99");
  assert.equal(second.limited_candidates[0].status, "stash_or_bye");
  assert.equal(waiverRecommendations(players, {}, [], null, players).scored_count, 0);
});
