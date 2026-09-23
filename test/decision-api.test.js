import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { handleDecisionRequest, decisionResponse } from "../lib/decision-api.js";
import { gunzipSync } from "node:zlib";
import { createDecisionLoader } from "../lib/decision-loader.js";
import { decisionBasis } from "../lib/decision/basis.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";

test("decision endpoint scores the entire eligible pool and leaves v0.2 snapshot untouched", async () => {
  const options = decisionFixtureOptions();
  const snapshot = await options.loadLeague("A");
  const before = JSON.stringify(snapshot);
  const data = await buildDecisionContext("A", { ...options, loadLeague: async () => snapshot });
  assert.equal(JSON.stringify(snapshot), before);
  assert.equal(snapshot.schema_version, "0.2");
  assert.equal(data.schema_version, "0.3");
  assert.equal(data.waivers.evaluated_count, 60);
  assert.ok(data.waivers.recommendations.some(p => p.player_id === "65"));
  assert.equal(data.player_context["65"].production.ppg, 64);
  assert.equal(data.player_context["65"].ownership.percent, null);
  assert.equal(data.player_context["65"].projection, null);
  assert.equal(data.player_context["65"].rankings.average_rank, null);
  assert.equal(data.basis, decisionBasis(snapshot));
  assert.equal(data.waivers.model_version, "roster-value-v2");
  assert.ok(data.waivers.categories.immediate_upgrades.players.length);
  for (const group of Object.values(data.waivers.categories)) for (const player of group.players) {
    assert.ok(data.waivers.candidate_details[player.player_id]);
    assert.ok(data.player_context[player.player_id]);
  }
});

test("usage source outages do not remove actual matchups or historical production", async () => {
  const data = await buildDecisionContext("A", { ...decisionFixtureOptions(), snapSource: async () => { throw new Error("snap outage"); }, opportunitySource: async () => { throw new Error("xFP outage"); } });
  assert.ok(data.player_context["65"].production.ppg > 0);
  assert.equal(data.player_context["65"].analytics.latest.snap_share, null);
  assert.equal(data.player_context["65"].analytics.xfp, null);
  assert.ok(data.warnings.some(w => w.includes("snap outage")));
});

test("large histories use negotiated gzip without changing JSON or ignoring gzip rejection", async () => {
  const data = { history: Array.from({ length: 18000 }, (_, week) => ({ week, snap_share: 0.65, target_share: 0.2, carries: 15 })) };
  const compressed = decisionResponse(data, new Request("http://localhost", { headers: { "Accept-Encoding": "gzip, deflate, br" } }));
  assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
  const bytes = Buffer.from(await compressed.arrayBuffer());
  assert.ok(bytes.length < 4500000);
  assert.deepEqual(JSON.parse(gunzipSync(bytes).toString()), data);
  const identity = decisionResponse(data, new Request("http://localhost", { headers: { "Accept-Encoding": "gzip;q=0, *;q=1" } }));
  assert.equal(identity.headers.get("Content-Encoding"), null);
  assert.deepEqual(await identity.json(), data);
});

test("decision analytics preserve expected-event inputs and ignore future model rows", async () => {
  const options = decisionFixtureOptions();
  options.opportunitySource = async () => ({ source_id: "ffopportunity", status: "available", warnings: [], data: [1, 2, 3].map(week => ({ player_id: "g65", season: 2026, week, game_id: `game${week}`, receptions: 2, receptions_exp: week === 3 ? 999 : 4, pass_touchdown: 0, pass_touchdown_exp: 0 })) });
  const data = await buildDecisionContext("A", options);
  const analytics = data.player_context["65"].analytics;
  assert.equal(analytics.xfp.average, 4);
  assert.equal(analytics.xfp.games, 2);
  assert.equal(analytics.xfp.through_week, 2);
  assert.equal(analytics.fantasy_points_over_expected.average, -2);
  assert.deepEqual(analytics.history[0].opportunity_model.components.rec, [2, 4, 2, 4, 1]);
});

test("a team change disables old-team role signals while retaining weekly history", async () => {
  const options = decisionFixtureOptions(), snapshot = await options.loadLeague("A");
  snapshot.matchup_week = 5;
  options.loadLeague = async () => snapshot;
  options.statsSource = async () => ({ source_id: "nflverse_stats", status: "available", warnings: [], data: [1, 2, 3, 4].map(week => ({ player_id: "g65", position: "RB", season: 2026, season_type: "REG", week, game_id: `game${week}`, team: "BUF", opponent_team: "NE", receptions: 5, targets: 10, carries: 10, target_share: week < 3 ? 0.1 : 0.3, passing_tds: 0 })) });
  const original = await buildDecisionContext("A", options);
  assert.ok(original.player_context["65"].analytics.signals.some(s => s.label === "Target share rising"));
  snapshot.free_agents.RB.find(p => p.player_id === "65").team = "NE";
  const moved = await buildDecisionContext("A", options);
  assert.equal(moved.player_context["65"].analytics.history.length, 4);
  assert.equal(moved.player_context["65"].analytics.current_team_matches, false);
  assert.deepEqual(moved.player_context["65"].analytics.signals, []);
  assert.equal(moved.player_context["65"].analytics.trends.target_share.delta, null);
});

test("external source failures retain matchup and clearly mark missing metrics", async () => {
  const options = decisionFixtureOptions();
  const data = await buildDecisionContext("A", { ...options, statsSource: async () => { throw new Error("outage"); } });
  assert.equal(data.partial, true);
  assert.equal(data.player_context["1"].production, null);
  assert.equal(data.waivers.scored_count, 0);
  assert.ok(data.sources.some(s => s.source_id === "nflverse_stats" && s.status === "unavailable"));
});

test("API validates league/week/season and separates optional outages from core errors", async () => {
  const options = { leagueIds: ["A"], build: id => buildDecisionContext(id, decisionFixtureOptions()) };
  const request = query => new Request(`http://localhost/api/decision-support?${query}`);
  assert.equal((await handleDecisionRequest(request("league=A"), options)).status, 200);
  for (const query of ["league=B", "week=banana", "week=19", "season=9999"]) assert.equal((await handleDecisionRequest(request(query), options)).status, 400);
  assert.equal((await handleDecisionRequest(request("week=2"), options)).status, 409);
  assert.equal((await handleDecisionRequest(request("league=A"), { ...options, build: async () => { throw new Error("core outage"); } })).status, 502);
});

test("decision loader ignores superseded completions and mismatched roster state", async () => {
  const a = await decisionFixtureOptions().loadLeague("A"), b = await decisionFixtureOptions().loadLeague("B");
  const pending = [], states = [];
  const loader = createDecisionLoader(state => states.push(state), () => new Promise(resolve => pending.push(resolve)));
  const first = loader.load(a), second = loader.load(b);
  pending[1]({ ok: true, json: async () => ({ basis: decisionBasis(b) }) }); await second;
  pending[0]({ ok: true, json: async () => ({ basis: decisionBasis(a) }) }); await first;
  assert.equal(states.at(-1).basis, decisionBasis(b));
  const third = loader.load(a);
  pending[2]({ ok: true, json: async () => ({ basis: "wrong" }) }); await third;
  assert.match(states.at(-1).error, /state changed/);
  const fourth = loader.load(a); loader.cancel(); const count = states.length;
  pending[3]({ ok: true, json: async () => ({ basis: decisionBasis(a) }) }); await fourth;
  assert.equal(states.length, count);
});
