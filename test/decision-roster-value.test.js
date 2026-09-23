import test from "node:test";
import assert from "node:assert/strict";
import { teamStrength, lineupEvaluator } from "../lib/decision/team-strength.js";
import { waiverRecommendations } from "../lib/decision/waiver-score.js";
const player = (id, positions, ppg, extras = {}) => ({ player_id: id, position: positions[0], fantasy_positions: positions, ppg, ...extras });
const contexts = players => Object.fromEntries(players.map(p => [p.player_id, { production: { ppg: p.ppg, recent_average: p.ppg, recorded_games: 4 }, analytics: { trends: { opportunities: { recent_average: p.ppg } } }, schedule: { status: "scheduled" } }]));
const run = (roster, candidate, slots, population = [...roster, candidate], leagueSize = 12) => {
  const ctx = contexts(population), production = Object.fromEntries(population.map(p => [p.player_id, ctx[p.player_id].production]));
  const strength = teamStrength({ roster_id: 1, all_players: roster }, slots, production, [candidate], { leagueSize, benchSlots: 0, allPlayers: population });
  return waiverRecommendations([candidate], ctx, [strength], 1, population).all_evaluations[0];
};
test("candidate gain uses full legal reassignment across overlapping slots", () => {
  const roster = [player("dual", ["RB", "WR"], 20), player("wr", ["WR"], 10)];
  const candidate = player("rb", ["RB"], 15);
  const result = run(roster, candidate, ["RB", "WR"]);
  assert.equal(result.roster_value.starter_gain, 5);
  assert.equal(new Set(result.roster_value.lineup_after.map(p => p.player_id)).size, 2);
  assert.ok(result.recommendation_types.includes("immediate_upgrades"));
});
test("same player has different marginal value on strong vs weak rosters", () => {
  const candidate = player("add", ["RB"], 15);
  assert.equal(run([player("weak", ["RB"], 5)], candidate, ["RB"]).roster_value.starter_gain, 10);
  assert.equal(run([player("strong", ["RB"], 20)], candidate, ["RB"]).roster_value.starter_gain, 0);
});
test("Superflex respects QB eligibility and TE premium flows through scored values", () => {
  const players = [player("qb", ["QB"], 25), player("te", ["TE"], 22), player("wr", ["WR"], 18)];
  const production = Object.fromEntries(players.map(p => [p.player_id, { ppg: p.ppg }]));
  const evaluator = lineupEvaluator(players, ["QB", "SUPER_FLEX", "TE"], production);
  assert.equal(evaluator.before.reduce((sum, p) => sum + p.ppg, 0), 65);
  assert.equal(evaluator.before.find(p => p.slot === "TE").player_id, "te");
});
test("league-depth replacement cutoffs make depth value different in 8 vs 12 team leagues", () => {
  const population = Array.from({ length: 30 }, (_, i) => player(`r${i}`, ["RB"], 30 - i));
  const shallow = run([population[0]], population[9], ["RB"], population, 8);
  const deep = run([population[0]], population[9], ["RB"], population, 12);
  assert.equal(shallow.roster_value.starter_gain, 0);
  assert.equal(shallow.roster_value.depth_gain, 0);
  assert.equal(deep.roster_value.depth_gain, 2);
  assert.ok(deep.components.roster_improvement.score > shallow.components.roster_improvement.score);
});
test("injured candidates remain stashes, missing roster data does not become a weak starter", () => {
  const stash = run([player("r", ["RB"], 5)], player("ir", ["RB"], 25, { injury_status: "IR" }), ["RB"]);
  assert.equal(stash.roster_value.starter_gain, null); assert.equal(stash.score, null);
  assert.ok(stash.pickup_rating !== null); assert.ok(stash.recommendation_types.includes("injury_stashes"));
  assert.ok(!stash.recommendation_types.includes("immediate_upgrades"));
  const unknown = run([player("unknown", ["RB"], null)], player("add", ["RB"], 10), ["RB"]);
  assert.equal(unknown.roster_value.starter_gain, null);
  assert.equal(unknown.components.roster_improvement.score, null);
});
test("missing weights stay missing and one-week matchup cannot dominate pickup rating", () => {
  const result = run([player("r", ["RB"], 5)], player("add", ["RB"], 10), ["RB"]);
  assert.equal(result.components.matchup.weight, 5);
  assert.equal(result.components.upside.score, null);
  assert.equal(Object.values(result.components).reduce((sum, c) => sum + c.weight, 0), 100);
  assert.equal(result.pickup_rating, Math.round(result.supported_component_points * 10) / 10);
  assert.ok(result.coverage_percent < 100);
});

test("contingent RB watch needs four fresh games and an observed same-team lead", () => {
  const rb = player("back", ["RB"], 10, { team: "BUF" }), lead = player("lead", ["RB"], 20, { team: "BUF" });
  const ctx = contexts([rb, lead]);
  ctx.back.analytics = { recorded_games: 4, through_week: 4, trends: { carry_share: { delta: 0.1, recent_average: 0.3 } } };
  ctx.lead.analytics = { trends: { carry_share: { recent_average: 0.6 } } };
  const run = () => waiverRecommendations([rb], ctx, [], null, [rb, lead]).all_evaluations[0];
  assert.ok(run().recommendation_types.includes("contingent_rbs"));
  assert.equal(run().contingent_evidence.lead_player_id, "lead");
  ctx.back.analytics.recorded_games = 2;
  assert.ok(!run().recommendation_types.includes("contingent_rbs"));
  ctx.back.analytics.recorded_games = 4; ctx.back.analytics.trends.carry_share.delta = null;
  assert.ok(!run().recommendation_types.includes("contingent_rbs"));
});
