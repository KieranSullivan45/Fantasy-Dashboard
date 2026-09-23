import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { handleDecisionRequest } from "../lib/decision-api.js";
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
  assert.equal(data.waivers.recommendations[0].player_id, "65");
  assert.equal(data.player_context["65"].production.ppg, 64);
  assert.equal(data.player_context["65"].ownership.percent, null);
  assert.equal(data.player_context["65"].projection, null);
  assert.equal(data.player_context["65"].rankings.average_rank, null);
  assert.equal(data.basis, decisionBasis(snapshot));
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
