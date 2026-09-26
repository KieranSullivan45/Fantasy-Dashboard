// V04-04: POST /api/trade route tests over the SYNTHETIC trade league (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { handleTradeRequest, tradeInputsFromState, PROTECTION_PRODUCER } from "../lib/trade-api.js";
import { buildDecisionState, buildDecisionContext } from "../lib/decision/build-context.js";
import { dropProtections } from "../lib/decision/add-drop.js";
import { decisionBasis } from "../lib/decision/basis.js";
import { createDecisionService } from "../lib/decision-service.js";
import { validateTradeEvaluation, FORBIDDEN_EVALUATION_KEYS, PROTECTION_POPULATION } from "../lib/trade/contracts.js";
import { createTradeLoader, tradeRequestBody } from "../lib/trade-loader.js";
import { formatSigned, formatValue, tradeAssetSupport } from "../lib/trade-display.js";
import { ProviderError } from "../lib/providers/contracts.js";
import { TRADE_LEAGUE, ME, proposal, tradeFixtureBuild, tradeFixtureOptions, tradeRequest } from "./trade-api-fixtures.js";

const leagueIds = [TRADE_LEAGUE];
const counted = (build = tradeFixtureBuild()) => { const calls = []; return { calls, build: async (league, options) => { calls.push({ league, options }); return build(league, options); } }; };
const call = async (body, { build = tradeFixtureBuild(), headers } = {}) => {
  const response = await handleTradeRequest(tradeRequest(body, headers), { leagueIds, build });
  return { status: response.status, headers: response.headers, json: await response.json() };
};
const post = (sendsA, sendsB, extra = {}) => ({ league: TRADE_LEAGUE, user: ME, proposal: proposal(sendsA, sendsB), ...extra });
const side = (evaluation, id) => evaluation.sides.find(s => s.roster_id === String(id));
/** A build whose state is transformed after the real pipeline (inputs stay server-authoritative). */
const transformed = transform => async (league, options) => { const state = await tradeFixtureBuild()(league, options); transform(state); return state; };

test("valid 1-for-1 evaluates both rosters with server-authoritative inputs", async () => {
  const { status, headers, json } = await call(post(["12"], ["23"]));
  assert.equal(status, 200);
  assert.match(headers.get("cache-control"), /no-store/);
  assert.equal(json.schema_version, "trade-1");
  assert.equal(json.status, "evaluated");
  assert.deepEqual(validateTradeEvaluation(json), { ok: true, violations: [] });
  assert.equal(json.horizon.id, "next_game");
  assert.equal(json.legality, "conditional_known_rules");
  assert.equal(json.market_value, null);
  assert.deepEqual(json.sides.map(s => [s.roster_id, s.sends, s.receives]), [["1", ["12"], ["23"]], ["2", ["23"], ["12"]]]);
  assert.equal(side(json, 1).starter_change, 11);
  assert.equal(side(json, 2).starter_change, -3);
  // The K slot counts for legality with an unavailable (null) value, never zero, and the engine discloses it.
  const k = side(json, 2).before.lineup.find(s => s.slot === "K");
  assert.deepEqual(k, { slot: "K", player_id: "66", value: null, valued: false });
  assert.ok(side(json, 2).unknowns.some(u => u.field === "unvalued_starter_slots"));
  // Reserve/taxi eligibility has no verified production source: placement stays active with the limitation exposed.
  assert.deepEqual(side(json, 1).reserve_placement[0].limitations, ["reserve eligibility unverified", "taxi eligibility unverified"]);
  const options = (await tradeFixtureOptions().loadLeague(TRADE_LEAGUE, { userId: ME }));
  assert.equal(json.basis, decisionBasis(options));
});

test("valid uneven packages: 2-for-1 selects a forced drop, 1-for-2 needs none", async () => {
  const twoForOne = (await call(post(["11", "12"], ["23"]))).json;
  assert.equal(twoForOne.status, "evaluated");
  const receiver = side(twoForOne, 2);
  assert.equal(receiver.forced_drops.status, "selected");
  assert.equal(receiver.forced_drops.required, 1);
  assert.deepEqual(receiver.forced_drops.dropped, ["11"]);
  // The kicker is never a drop candidate: protected by the existing add/drop rule, excluded with its reason.
  assert.ok(receiver.forced_drops.excluded.some(e => e.player_id === "66" && e.reasons.includes("K/DST/IDP advanced value unsupported")));
  const oneForTwo = (await call(post(["12"], ["22", "23"], { user: "spectator" }))).json;
  assert.equal(oneForTwo.status, "evaluated");
  assert.deepEqual(oneForTwo.sides.map(s => s.forced_drops.status), ["none", "none"]);
  assert.deepEqual(side(oneForTwo, 1).receives, ["22", "23"]);
});

test("invalid proposals are rejected before any league data loads", async () => {
  const cases = [
    [{ ...post(["12"], ["23"]), proposal: { horizon: "next_game", sides: [{ roster_id: 1, sends: [{ type: "player", id: "12" }] }, { roster_id: 1, sends: [{ type: "player", id: "11" }] }] } }, "invalid", "SAME_ROSTER"],
    [{ ...post(["12"], ["23"]), proposal: proposal(["12"], ["23"], { horizon: "rest_of_season" }) }, "unsupported", "UNSUPPORTED_HORIZON"],
    [{ ...post(["12"], ["23"]), proposal: { horizon: "next_game", sides: [{ roster_id: 1, sends: [{ type: "draft_pick", id: "2027-1" }] }, { roster_id: 2, sends: [{ type: "player", id: "23" }] }] } }, "unsupported", "UNSUPPORTED_ASSET"],
    [{ ...post(["12"], ["23"]), proposal: { horizon: "next_game", sides: [{ roster_id: 1, sends: [{ type: "faab", id: "15" }] }, { roster_id: 2, sends: [{ type: "player", id: "23" }] }] } }, "unsupported", "UNSUPPORTED_ASSET"],
    [post(["10", "11", "12"], ["23"]), "unsupported", "PACKAGE_TOO_LARGE"],
    [post([], ["23"]), "unsupported", "EMPTY_SIDE"],
    [post(["12", "12"], ["23"]), "invalid", "DUPLICATE_ASSET"],
  ];
  for (const [body, status, code] of cases) {
    const { calls, build } = counted();
    const result = await call(body, { build });
    assert.equal(result.status, 422, code);
    assert.equal(result.json.status, status, code);
    assert.ok(result.json.errors.some(e => e.code === code), code);
    assert.deepEqual(result.json.sides, [], code);
    assert.equal(calls.length, 0, `${code} must not load league data`);
  }
});

test("ownership is checked against the server's current basis", async () => {
  const notOwned = await call(post(["23"], ["12"]));
  assert.equal(notOwned.status, 422);
  assert.equal(notOwned.json.status, "invalid");
  assert.deepEqual(notOwned.json.errors.map(e => [e.code, e.roster_id, e.asset_id]), [["ASSET_NOT_OWNED", "1", "23"], ["ASSET_NOT_OWNED", "2", "12"]]);
  const unknownRoster = await call({ ...post(["12"], ["23"]), proposal: { horizon: "next_game", sides: [{ roster_id: 1, sends: [{ type: "player", id: "12" }] }, { roster_id: 9, sends: [{ type: "player", id: "23" }] }] } });
  assert.ok(unknownRoster.json.errors.some(e => e.code === "UNKNOWN_ROSTER"));
});

test("unsupported K asset returns the engine's UNSUPPORTED_ASSET without valuation", async () => {
  const { status, json } = await call(post(["12"], ["66"]));
  assert.equal(status, 422);
  assert.equal(json.status, "unsupported");
  assert.deepEqual(json.errors.map(e => [e.code, e.asset_id]), [["UNSUPPORTED_ASSET", "66"]]);
  assert.deepEqual(json.sides, []);
});

test("context and basis failures are reported, never evaluated", async () => {
  const stale = await call(post(["12"], ["23"], { basis: "an older basis" }));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.status, "invalid");
  assert.deepEqual(stale.json.errors.map(e => e.code), ["STALE_BASIS"]);
  assert.deepEqual(stale.json.sides, []);
  const current = await call(post(["12"], ["23"], { basis: (await call(post(["12"], ["23"]))).json.basis }));
  assert.equal(current.status, 200);
  // A decision result whose metadata disagrees with the snapshot is CONTEXT_MISMATCH (trade-local validation).
  const mismatch = await call(post(["12"], ["23"]), { build: transformed(state => { state.decision.league.week = 4; }) });
  assert.equal(mismatch.status, 422);
  assert.ok(mismatch.json.errors.some(e => e.code === "CONTEXT_MISMATCH" && e.field === "week"));
  // No current week (e.g. preseason) cannot supply the next_game horizon.
  const noWeek = await call(post(["12"], ["23"]), { build: transformed(state => { state.snapshot.matchup_week = null; state.decision.league.week = null; }) });
  assert.equal(noWeek.json.status, "invalid");
  assert.deepEqual(noWeek.json.sides, []);
  // Incomplete internal state (a provider that cannot supply contexts) is a clear limitation.
  const incomplete = await call(post(["12"], ["23"]), { build: async () => ({ decision: {} }) });
  assert.equal(incomplete.status, 422);
  assert.match(incomplete.json.error, /complete internal decision context/);
  const failing = await call(post(["12"], ["23"]), { build: async () => { throw new Error("upstream down: secret-token-123"); } });
  assert.equal(failing.status, 502);
  assert.doesNotMatch(JSON.stringify(failing.json), /secret-token/);
  const provider = await call(post(["12"], ["23"]), { build: async () => { throw new ProviderError("UNSUPPORTED_FEATURE", "sleeper", "Unsupported lineup slots prevent legal decision evaluation."); } });
  assert.equal(provider.status, 422);
  assert.equal(provider.json.code, "UNSUPPORTED_FEATURE");
  const espn = await call(post(["12"], ["23"], { provider: "espn" }));
  assert.equal(espn.status, 422);
  assert.equal(espn.json.code, "UNSUPPORTED_FEATURE");
});

test("engine blocked and withheld results pass through unchanged", async () => {
  // Every receiving-side player unestablished ⇒ protected by the existing add/drop rule ⇒ the required drop is blocked.
  const unestablish = state => { for (const id of ["6", "20", "21", "22", "23", "11", "12"]) Object.assign(state.contexts[id].model.features, { current_games: 1, prior: { ppg: null } }); };
  const blocked = await call(post(["11", "12"], ["23"]), { build: transformed(unestablish) });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.json.status, "blocked");
  const rival = side(blocked.json, 2);
  assert.equal(rival.forced_drops.status, "blocked");
  assert.equal(rival.after, null);
  assert.equal(rival.starter_change, null);
  assert.ok(rival.forced_drops.diagnostics.some(d => d.reason === "not_enough_droppable_players"));
  assert.ok(blocked.json.errors.some(e => e.code === "FORCED_DROP_BLOCKED" && e.roster_id === "2"));
  assert.deepEqual(validateTradeEvaluation(blocked.json), { ok: true, violations: [] });
  // Unknown next-game values for competing droppable players ⇒ no drop set ranks first ⇒ withheld.
  const unknownValues = state => { for (const id of ["6", "11", "12", "21", "22", "23"]) state.contexts[id].model.start_value.central = null; };
  const withheld = await call(post(["11", "12"], ["23"]), { build: transformed(unknownValues) });
  assert.equal(withheld.status, 200);
  assert.equal(withheld.json.status, "withheld");
  assert.equal(side(withheld.json, 2).forced_drops.status, "undetermined");
  assert.equal(side(withheld.json, 2).before.lineup, null);
  assert.equal(side(withheld.json, 2).before.starter_total, null);
  assert.deepEqual(validateTradeEvaluation(withheld.json), { ok: true, violations: [] });
});

test("client-supplied valuation, protection, ownership and capability fields are rejected", async () => {
  for (const key of ["values", "protection", "contexts", "capabilities", "vor", "player_context", "lineup", "owner", "market_value"]) {
    const { calls, build } = counted();
    const result = await call({ ...post(["12"], ["23"]), [key]: {} }, { build });
    assert.equal(result.status, 400, key);
    assert.match(result.json.error, /Unknown trade request field/);
    assert.equal(calls.length, 0);
  }
  const nested = [
    body => { body.proposal.values = { 12: 99 }; },
    body => { body.proposal.sides[0].protection = []; },
    body => { body.proposal.sides[0].sends[0].value = 99; },
    body => { body.proposal.sides[0].sends[0].vor = 5; },
    body => { body.proposal.sides[1].owner_id = "x"; },
  ];
  for (const edit of nested) {
    const body = post(["12"], ["23"]); edit(body);
    const { calls, build } = counted();
    const result = await call(body, { build });
    assert.equal(result.status, 422);
    assert.equal(result.json.status, "invalid");
    assert.ok(result.json.errors.every(e => e.code === "MALFORMED_PROPOSAL"));
    assert.equal(calls.length, 0);
  }
  for (const [body, headers, status] of [["not json", undefined, 400], [JSON.stringify(post(["12"], ["23"])), { "content-type": "text/plain" }, 415],
    [JSON.stringify({ ...post(["12"], ["23"]), padding: "x".repeat(20000) }), undefined, 413], [JSON.stringify([]), undefined, 400],
    [JSON.stringify({ league: TRADE_LEAGUE }), undefined, 400], [JSON.stringify({ ...post(["12"], ["23"]), league: "../etc" }), undefined, 400],
    [JSON.stringify({ ...post(["12"], ["23"]), user: "not a user" }), undefined, 400], [JSON.stringify({ ...post(["12"], ["23"]), league: 5 }), undefined, 400]]) {
    const result = await call(body, { headers });
    assert.equal(result.status, status, String(body).slice(0, 40));
  }
});

test("protection evidence is dropProtections on the full internal contexts, never the public subset", async () => {
  const state = await buildDecisionState(TRADE_LEAGUE, { ...tradeFixtureOptions(), identity: { userId: ME } });
  const inputs = tradeInputsFromState(state);
  const rostered = state.snapshot.rosters.flatMap(r => r.all_players);
  assert.deepEqual(inputs.protectionEvidence.players, dropProtections(rostered, state.decision.league.roster_positions, state.contexts));
  assert.equal(inputs.protectionEvidence.population, PROTECTION_POPULATION);
  assert.equal(inputs.protectionEvidence.producer, PROTECTION_PRODUCER);
  assert.equal(inputs.valueSource.contexts, state.contexts);
  assert.ok(Object.keys(state.contexts).length > Object.keys(state.decision.player_context).length, "fixture must distinguish full contexts from the public subset");
  assert.equal(inputs.placement, undefined, "no verified placement-eligibility source exists");
  assert.equal(inputs.capabilities.IR.status, "available");
  // Public decision output is unchanged by the state split.
  assert.deepEqual(JSON.parse(JSON.stringify(state.decision)), JSON.parse(JSON.stringify(await buildDecisionContext(TRADE_LEAGUE, { ...tradeFixtureOptions(), identity: { userId: ME }, now: tradeFixtureOptions().now }))));
});

test("responses never leak internal contexts, snapshots or protection evidence", async () => {
  const { json } = await call(post(["11", "12"], ["23"]));
  const text = JSON.stringify(json);
  for (const leaked of ["player_context", "contexts", "features", "production", "analytics", "pickup_value", "provenance", "free_agents", "scoring_settings", "owner_id", "protection"])
    assert.ok(!text.includes(`"${leaked}"`), `response leaks ${leaked}`);
  assert.deepEqual(Object.keys(json).sort(), ["basis", "errors", "feature_version", "horizon", "legality", "legality_limitations", "market_value", "model_version", "schema_version", "sides", "status"]);
  for (const key of FORBIDDEN_EVALUATION_KEYS) assert.ok(!text.includes(`"${key}"`), key);
});

test("the trade route and decision-support share one cached state build per identity", async () => {
  let builds = 0;
  const service = createDecisionService(async (league, options) => { builds++; return tradeFixtureBuild()(league, options); });
  const first = await handleTradeRequest(tradeRequest(post(["12"], ["23"])), { leagueIds, build: service });
  const second = await handleTradeRequest(tradeRequest(post(["11"], ["22"])), { leagueIds, build: service });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(builds, 1);
  await handleTradeRequest(tradeRequest(post(["12"], ["23"], { user: "spectator" })), { leagueIds, build: service });
  assert.equal(builds, 2, "a different identity never reuses another identity's state");
});

test("trade loader sends ids only, guards stale responses and reports route errors", async () => {
  const snapshot = await tradeFixtureOptions().loadLeague(TRADE_LEAGUE, { userId: ME });
  const body = tradeRequestBody(snapshot, [{ rosterId: 1, playerIds: ["12"] }, { rosterId: 2, playerIds: ["23"] }]);
  assert.deepEqual(Object.keys(body).sort(), ["basis", "league", "proposal", "user"]);
  assert.deepEqual(body.proposal, proposal(["12"], ["23"]));
  const published = [], pending = [];
  const loader = createTradeLoader(state => published.push(state), (url, init) => new Promise(resolve => pending.push({ url, init, resolve })));
  loader.load(snapshot, [{ rosterId: 1, playerIds: ["12"] }, { rosterId: 2, playerIds: ["23"] }], "first");
  loader.load(snapshot, [{ rosterId: 1, playerIds: ["11"] }, { rosterId: 2, playerIds: ["23"] }], "second");
  assert.equal(pending[0].init.method, "POST");
  assert.equal(pending[0].init.signal.aborted, true);
  pending[1].resolve({ json: async () => ({ schema_version: "trade-1", basis: decisionBasis(snapshot), status: "evaluated", errors: [], sides: [] }) });
  pending[0].resolve({ json: async () => ({ schema_version: "trade-1", basis: decisionBasis(snapshot), status: "invalid", errors: [], sides: [] }) });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(published.filter(s => !s.loading).map(s => [s.key, s.data?.status]), [["second", "evaluated"]]);
  loader.load(snapshot, [], "third");
  pending[2].resolve({ json: async () => ({ error: "Trade evaluation could not load league data." }) });
  await new Promise(r => setTimeout(r, 0));
  assert.equal(published.at(-1).error, "Trade evaluation could not load league data.");
  loader.load(snapshot, [], "fourth");
  pending[3].resolve({ json: async () => ({ schema_version: "trade-1", basis: "other", status: "evaluated", errors: [], sides: [] }) });
  await new Promise(r => setTimeout(r, 0));
  assert.match(published.at(-1).error, /League state changed/);
});

test("display helpers never render unknown values as zero", () => {
  assert.equal(formatSigned(null), "Unknown");
  assert.equal(formatSigned(3.14), "+3.1");
  assert.equal(formatSigned(-2), "−2.0");
  assert.equal(formatSigned(0), "0.0");
  assert.equal(formatValue(null), "Unavailable");
  assert.equal(formatValue(0), "0.0");
  assert.deepEqual(tradeAssetSupport({ fantasy_positions: ["K"] }), { supported: false, reason: "No modeled football value (K/DEF/IDP)" });
  assert.equal(tradeAssetSupport({ fantasy_positions: ["RB"] }, { model: { supported: false } }).supported, false);
  assert.equal(tradeAssetSupport({ fantasy_positions: ["RB"] }).supported, true);
});
