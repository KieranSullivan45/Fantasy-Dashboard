// SLEEPER-REFRESH-01: process-local Sleeper refresh coordinator, revision, POST /api/refresh and consistency guards.
// SYNTHETIC fixture transport only (no network). Letters in test names map to the contract's acceptance matrix.
import test from "node:test";
import assert from "node:assert/strict";
import { createSleeperInputs, createSleeperTransport, SleeperResourceError, REFRESH_POLICY, contentDigest } from "../lib/sources/sleeper/inputs.js";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { SleeperProvider } from "../lib/providers/sleeper.js";
import { createDecisionService } from "../lib/decision-service.js";
import { buildDecisionState } from "../lib/decision/build-context.js";
import { decisionBasis, basisRevision } from "../lib/decision/basis.js";
import { compactSnapshot } from "../lib/compact.js";
import { handleRefreshRequest } from "../lib/refresh-api.js";
import { handleSnapshotRequest } from "../lib/snapshot-api.js";
import { handleDecisionRequest } from "../lib/decision-api.js";
import { handleChatRequest } from "../lib/chat-api.js";
import { handleTradeRequest } from "../lib/trade-api.js";
import { createSnapshotLoader } from "../lib/snapshot-loader.js";
import { createDecisionLoader } from "../lib/decision-loader.js";
import { createTradeLoader } from "../lib/trade-loader.js";
import { createAutoRefresh, AUTO_REFRESH_MS } from "../lib/auto-refresh.js";
import { setPrivateEspnProviderFactory } from "../lib/providers/index.js";
import { TOKEN_ENV, LOOPBACK_HEADER } from "../lib/private/loopback.js";
import { fixtureFetch } from "./fixtures.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";
import { TRADE_LEAGUE, TRADE_ROSTERS, ME, proposal, tradeFixtureFetch, tradeFixtureOptions, tradeRequest } from "./trade-api-fixtures.js";

const LEAGUE = "123456789", OTHER = "987654321", T0 = Date.parse("2026-09-30T12:00:00Z");
const ROSTERS = [
  { roster_id: 1, owner_id: "me", players: ["1", "2", "3", "4"], starters: ["2", "0"], reserve: ["3"], taxi: ["4"], settings: { wins: 2, waiver_position: 0, waiver_budget_used: 0, fpts: 100, fpts_decimal: 25 } },
  { roster_id: 2, owner_id: "other", players: ["6"], starters: ["6"], settings: { wins: 1 } },
];
const moved = () => { const r = structuredClone(ROSTERS); r[1].players.push("10"); return r; };

function clock(start = T0) { let t = start; const now = () => t; now.advance = seconds => { t += seconds * 1000; }; return now; }
/** Mutable SYNTHETIC Sleeper upstream: `rosters` override, `fail` map (path fragment -> Error or value), optional gates. */
function upstream(base = fixtureFetch()) {
  const u = { calls: [], fail: new Map(), rosters: null, gates: new Map(), exact: new Map() };
  u.fetchData = async path => {
    u.calls.push(path);
    for (const [part, gate] of u.gates) if (path.includes(part)) await gate;
    if (u.exact.has(path)) { const outcome = u.exact.get(path); if (outcome instanceof Error) throw outcome; return structuredClone(outcome); }
    for (const [part, outcome] of u.fail) if (path.includes(part)) { if (outcome instanceof Error) throw outcome; return structuredClone(outcome); }
    if (path.endsWith("/rosters") && u.rosters) return structuredClone(u.rosters);
    return structuredClone(await base(path));
  };
  u.count = part => u.calls.filter(p => p === part || (part.startsWith("/") ? p.endsWith(part) : p.includes(part))).length;
  return u;
}
const gate = () => { let open; const promise = new Promise(resolve => { open = resolve; }); return { promise, open }; };
const coordinator = (u, now = clock(), extra = {}) => createSleeperInputs({ fetchData: u.fetchData, now, ...extra });
const resource = (result, name) => result.freshness.resources[name];

// ---------------------------------------------------------------- coordinator

test("A: overlapping identical refreshes coalesce to one upstream call per resource and one revision", async () => {
  const u = upstream(), inputs = coordinator(u);
  const [a, b] = await Promise.all([inputs.ensure(LEAGUE, { force: true }), inputs.ensure(LEAGUE, { force: true })]);
  assert.equal(a.revision, b.revision);
  for (const path of [`/league/${LEAGUE}`, "/rosters", "/users", "/state/nfl", "/matchups/3", "/transactions/2", "/transactions/3"]) assert.equal(u.count(path), 1, path);
  assert.equal(u.calls.filter(p => p === "/players/nfl").length, 1);
  // A second league shares the process-wide catalog, state and trending (their own single flight).
  const before = u.calls.length; await inputs.ensure(OTHER);
  assert.deepEqual(u.calls.slice(before).filter(p => !p.includes(OTHER)), []);
});

test("A/16: manual refresh is bounded by a cooldown and memory holds a bounded, pinned set of leagues", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now, { policy: { ...REFRESH_POLICY, max_leagues: 3 }, isPinned: id => id === "100000001" });
  await inputs.ensure(LEAGUE);
  await inputs.ensure(LEAGUE, { force: true });
  assert.equal(u.count("/rosters"), 1, "forced refresh within the cooldown does not re-fetch");
  now.advance(REFRESH_POLICY.min_force_interval_seconds);
  await inputs.ensure(LEAGUE, { force: true });
  assert.equal(u.count("/rosters"), 2);
  assert.equal(u.calls.filter(p => p === "/players/nfl").length, 1, "manual refresh does not re-download the catalog");
  for (const id of ["100000001", "100000002", "100000003", "100000004", "100000005"]) await inputs.ensure(id);
  const { unpinned, league_ids } = inputs.stats();
  assert.ok(unpinned <= 3, "arbitrary (unpinned) leagues stay bounded"); assert.ok(league_ids.includes("100000001"), "installation (pinned) league is not evicted");
});

test("B: a failed refresh releases the in-flight slot and a later retry succeeds", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now);
  u.fail.set("/rosters", new Error("outage"));
  await assert.rejects(inputs.ensure(LEAGUE), SleeperResourceError);
  assert.equal(inputs.stats().leagues, 0, "nothing is retained for a league that never loaded");
  u.fail.clear();
  const ok = await inputs.ensure(LEAGUE);
  assert.match(ok.revision, /^sleeper:[0-9a-f]{64}$/);
  // Committed league: a forced failure, then a forced retry after the cooldown promotes new data.
  u.fail.set("/rosters", new Error("outage")); now.advance(10);
  const failed = await inputs.ensure(LEAGUE, { force: true });
  assert.equal(failed.revision, ok.revision);
  u.fail.clear(); u.rosters = moved(); now.advance(10);
  const retried = await inputs.ensure(LEAGUE, { force: true });
  assert.notEqual(retried.revision, ok.revision);
  assert.equal(resource(retried, "rosters").last_attempt_status, "success");
});

function transportUpstream() {
  const base = fixtureFetch(), state = { mode: null, calls: [] };
  const fetcher = async (url, options) => {
    const path = url.replace("https://api.sleeper.app/v1", ""); state.calls.push({ path, options });
    if (state.mode && path.endsWith("/rosters")) {
      if (state.mode === "http") return new Response('{"error":"secret-token-abc internal detail"}', { status: 503 });
      if (state.mode === "rate") return new Response("slow down secret-token-abc", { status: 429, headers: { "retry-after": "120" } });
      if (state.mode === "timeout") throw Object.assign(new Error("The operation timed out secret-token-abc"), { name: "TimeoutError" });
      if (state.mode === "malformed") return new Response("{ not json secret-token-abc", { status: 200 });
      if (state.mode === "invalid") return Response.json([{ roster_id: 1, players: ["1"] }, { roster_id: 1, players: ["2"] }]);
    }
    return Response.json(await base(path));
  };
  return { state, fetchData: createSleeperTransport(fetcher) };
}

test("C/S: last-known-good survives HTTP, rate-limit, timeout, malformed and invalid refreshes; errors are sanitized", async () => {
  for (const [mode, code] of [["http", "HTTP_ERROR"], ["rate", "RATE_LIMITED"], ["timeout", "TIMEOUT"], ["malformed", "MALFORMED_RESPONSE"], ["invalid", "INVALID_DATA"]]) {
    const t = transportUpstream(), now = clock(), inputs = createSleeperInputs({ fetchData: t.fetchData, now });
    const r1 = await inputs.ensure(LEAGUE);
    const success = resource(r1, "rosters").last_success_at;
    now.advance(60); t.state.mode = mode;
    const after = await inputs.ensure(LEAGUE, { force: true });
    assert.equal(after.revision, r1.revision, mode);
    assert.equal(after.bundle, r1.bundle, `${mode}: committed bundle object is retained`);
    const rosters = resource(after, "rosters");
    assert.equal(rosters.last_success_at, success, `${mode}: failure does not advance last success`);
    assert.equal(rosters.last_attempt_at, new Date(T0 + 60000).toISOString());
    assert.equal(rosters.last_attempt_status, "failed"); assert.equal(rosters.error.code, code);
    assert.doesNotMatch(JSON.stringify(after.freshness), /secret-token|internal detail/, `${mode}: no upstream payload leaks`);
    if (mode === "http") assert.equal(rosters.error.http_status, 503);
    if (mode === "rate") {
      assert.equal(rosters.error.retry_after_seconds, 120);
      now.advance(60); t.state.mode = null; const calls = t.state.calls.length;
      await inputs.ensure(LEAGUE, { force: true });
      assert.equal(t.state.calls.slice(calls).filter(c => c.path.endsWith("/rosters")).length, 0, "Retry-After is honored");
    }
    // Transport never uses Next's fetch cache: the coordinator is the only cache.
    assert.ok(t.state.calls.every(c => c.options.cache === "no-store"));
  }
});

test("C: optional activity keeps its own previous valid value; missing on first load stays missing", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now);
  const r1 = await inputs.ensure(LEAGUE);
  u.fail.set("/matchups/", new Error("outage")); u.fail.set("/transactions/", new Error("outage")); now.advance(60);
  const kept = await inputs.ensure(LEAGUE, { force: true });
  assert.equal(kept.revision, r1.revision);
  const snapshot = await buildLeagueSnapshot(LEAGUE, { inputs: kept, userId: null });
  assert.equal(snapshot.current_matchups.length, 1); assert.equal(snapshot.recent_transactions.length, 1);
  assert.ok(!snapshot.warnings.some(w => w.code === "UPSTREAM_UNAVAILABLE"), "retained evidence is not reported missing");
  assert.equal(snapshot.coverage.freshness.resources["matchups/week/3"].last_attempt_status, "failed");
  const u2 = upstream(); u2.fail.set("/matchups/", new Error("outage"));
  const first = await coordinator(u2).ensure(LEAGUE);
  const s2 = await buildLeagueSnapshot(LEAGUE, { inputs: first, userId: null });
  assert.deepEqual(s2.current_matchups, []); assert.ok(s2.warnings.some(w => w.resource === "matchups" && w.code === "UPSTREAM_UNAVAILABLE"));
  assert.equal(resource(first, "matchups/week/3").status, "missing");
});

test("D: first-load core failure is unavailable, never an empty league, and is not retained", async () => {
  for (const part of ["/rosters", "/users", "/state/nfl", "/players/nfl"]) {
    const u = upstream(); u.fail.set(part, new Error("outage"));
    const inputs = coordinator(u);
    await assert.rejects(inputs.ensure(LEAGUE), error => error instanceof SleeperResourceError && error.code === "UPSTREAM_UNAVAILABLE" && !/outage/.test(error.message), part);
    assert.equal(inputs.stats().leagues, 0);
  }
  const u = upstream(); u.fail.set(`/league/${LEAGUE}`, null);
  await assert.rejects(coordinator(u).ensure(LEAGUE), error => error.code === "NOT_FOUND");
});

test("E: validate before promote rejects wrong league/season, malformed core, duplicate or inconsistent rosters", async () => {
  const cases = [
    ["wrong league id", u => u.fail.set(`/league/${LEAGUE}`, { league_id: OTHER, season: "2026", sport: "nfl", roster_positions: [] })],
    ["not NFL", u => u.fail.set(`/league/${LEAGUE}`, { league_id: LEAGUE, season: "2026", sport: "nba", roster_positions: [] })],
    ["malformed users", u => u.fail.set("/users", { user_id: "me" })],
    ["duplicate members", u => u.fail.set("/users", [{ user_id: "me" }, { user_id: "me" }])],
    ["rosters not a list", u => u.fail.set("/rosters", { roster_id: 1 })],
    ["duplicate roster id", u => { u.rosters = [ROSTERS[0], { ...ROSTERS[1], roster_id: 1 }]; }],
    ["player on two rosters", u => { u.rosters = [ROSTERS[0], { ...ROSTERS[1], players: ["6", "1"] }]; }],
    ["roster of another league", u => { u.rosters = [{ ...ROSTERS[0], league_id: OTHER }, ROSTERS[1]]; }],
    ["malformed player list", u => { u.rosters = [{ ...ROSTERS[0], players: "1,2" }, ROSTERS[1]]; }],
  ];
  for (const [label, corrupt] of cases) {
    const first = upstream(); corrupt(first);
    await assert.rejects(coordinator(first).ensure(LEAGUE), SleeperResourceError, `first load: ${label}`);
    const u = upstream(), now = clock(), inputs = coordinator(u, now), r1 = await inputs.ensure(LEAGUE);
    corrupt(u); now.advance(REFRESH_POLICY.stale_after_seconds.slow);
    const after = await inputs.ensure(LEAGUE, { force: true });
    assert.equal(after.revision, r1.revision, `after R1: ${label}`);
    assert.ok(Object.values(after.freshness.resources).some(r => r.last_attempt_status === "failed"), label);
  }
  // A league whose season changes under the same id is not promoted.
  const u = upstream(), now = clock(), inputs = coordinator(u, now), r1 = await inputs.ensure(LEAGUE);
  u.fail.set(`/league/${LEAGUE}`, { league_id: LEAGUE, season: "2027", sport: "nfl", roster_positions: ["RB"] }); now.advance(REFRESH_POLICY.stale_after_seconds.slow);
  assert.equal((await inputs.ensure(LEAGUE)).revision, r1.revision);
  // Matchups that reference an unknown roster are rejected on their own; valid empty activity is valid.
  const v = upstream(); v.fail.set("/matchups/", [{ roster_id: 99 }]); v.fail.set("/transactions/", []);
  const committed = await coordinator(v).ensure(LEAGUE);
  const snapshot = await buildLeagueSnapshot(LEAGUE, { inputs: committed, userId: null });
  assert.equal(resource(committed, "matchups/week/3").error.code, "INVALID_DATA");
  assert.deepEqual(snapshot.recent_transactions, []);
  assert.ok(!snapshot.warnings.some(w => w.resource.startsWith("transactions")), "empty activity is not an outage");
});

test("F: revision tracks committed evidence only", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now);
  const r1 = await inputs.ensure(LEAGUE);
  now.advance(20);
  const same = await inputs.ensure(LEAGUE, { force: true });
  assert.equal(same.revision, r1.revision, "identical successful input keeps the revision");
  assert.notEqual(resource(same, "rosters").last_success_at, resource(r1, "rosters").last_success_at, "timestamps moved");
  u.fail.set("/rosters", new Error("outage")); now.advance(20);
  assert.equal((await inputs.ensure(LEAGUE, { force: true })).revision, r1.revision, "errors alone keep the revision");
  u.fail.clear(); u.rosters = moved(); now.advance(20);
  const r2 = await inputs.ensure(LEAGUE, { force: true });
  assert.notEqual(r2.revision, r1.revision, "a roster change is a new revision");
  // Canonical: key order does not matter; revisions of two separate processes agree on identical evidence.
  assert.equal(contentDigest({ a: 1, b: [1, { c: 2, d: 3 }] }), contentDigest({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.equal((await coordinator(upstream()).ensure(LEAGUE)).revision, r1.revision);
  assert.doesNotMatch(JSON.stringify(r2.bundle.rosters), /token|cookie|espn_s2|SWID/i);
});

test("Q: freshness crosses 5 min / 15 min / 24 h thresholds under controlled time; failures never advance success", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now);
  await inputs.ensure(LEAGUE);
  const view = async seconds => { now.advance(seconds); return (await inputs.ensure(LEAGUE, { force: false })).freshness.resources; };
  u.fail.set("/", new Error("outage")); // every refresh from here on fails
  let r = await view(299);
  assert.equal(r.rosters.status, "fresh"); assert.equal(r.rosters.stale_after_seconds, 300);
  r = await view(1);
  assert.equal(r.rosters.status, "stale"); assert.equal(r.league.status, "fresh"); assert.equal(r.players.status, "fresh");
  assert.equal(r.rosters.last_success_at, new Date(T0).toISOString()); assert.equal(r.rosters.last_attempt_status, "failed");
  r = await view(600);
  assert.equal(r.league.status, "stale"); assert.equal(r.users.status, "stale"); assert.equal(r.trending.status, "stale"); assert.equal(r.players.status, "fresh");
  r = await view(86400);
  assert.equal(r.players.status, "stale"); assert.equal(r.players.age_seconds, 87300);
  assert.equal(r.players.last_success_at, new Date(T0).toISOString());
});

// ---------------------------------------------------------------- decision / chat / trade consistency

function pinnedService(inputs, { now = clock(), gates = [], snapshot } = {}) {
  const provider = new SleeperProvider({ inputs, ...(snapshot ? { snapshot } : {}) });
  const { loadLeague, ...fixture } = decisionFixtureOptions();
  const builds = [];
  const build = async (league, options) => {
    builds.push(options.revision);
    const wait = gates.shift(); if (wait) await wait;
    return buildDecisionState(league, { ...fixture, ...options });
  };
  return { builds, provider, service: createDecisionService(build, now, (league, o) => (o.provider || "sleeper") === "sleeper" ? provider.pinInputs(league) : null) };
}
const spectator = { userId: null, rosterId: null, season: null };

test("G: promoting R2 inside the 30 s decision TTL rebuilds decision state on R2 immediately", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now), { service, builds } = pinnedService(inputs, { now });
  const first = await service(LEAGUE, { identity: spectator, provider: "sleeper" });
  assert.equal(builds.length, 1);
  assert.equal((await service(LEAGUE, { identity: spectator, provider: "sleeper" })), first, "same revision within TTL is a cache hit");
  u.rosters = moved(); now.advance(10);
  const r2 = await inputs.ensure(LEAGUE, { force: true });
  const second = await service(LEAGUE, { identity: spectator, provider: "sleeper" });
  assert.equal(builds.length, 2); assert.deepEqual(builds, [first.snapshot.coverage.input_revision, r2.revision]);
  assert.equal(basisRevision(second.decision.basis), r2.revision);
  assert.ok(second.snapshot.rosters.find(r => r.roster_id === 2).all_players.some(p => p.player_id === "10"));
});

test("H: a slow R1 build cannot satisfy or publish as R2, and never mixes revisions", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now), slow = gate();
  const { service, builds } = pinnedService(inputs, { now, gates: [slow.promise] });
  const r1 = (await inputs.ensure(LEAGUE)).revision;
  const pendingR1 = service(LEAGUE, { identity: spectator, provider: "sleeper" });
  await new Promise(resolve => setImmediate(resolve));
  u.rosters = moved(); now.advance(10);
  const r2 = (await inputs.ensure(LEAGUE, { force: true })).revision;
  const stateR2 = await service(LEAGUE, { identity: spectator, provider: "sleeper" });
  slow.open();
  const stateR1 = await pendingR1;
  assert.deepEqual(builds, [r1, r2]);
  assert.equal(basisRevision(stateR1.decision.basis), r1); assert.equal(stateR1.snapshot.coverage.input_revision, r1);
  assert.ok(!stateR1.snapshot.rosters.find(r => r.roster_id === 2).all_players.some(p => p.player_id === "10"), "R1 state holds only R1 rosters");
  assert.equal(basisRevision(stateR2.decision.basis), r2);
  assert.equal(await service(LEAGUE, { identity: spectator, provider: "sleeper" }), stateR2, "later requests resolve to R2");
  assert.equal(builds.length, 2);
});

test("I: decision-backed chat consumes R2 after promotion", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now), { service } = pinnedService(inputs, { now });
  const chat = () => handleChatRequest(new Request(`http://localhost/api/chat/league-summary?league=${LEAGUE}&user=spectator`), "league-summary",
    { build: (league, options) => service(league, options).then(state => state.decision), configured: [] }).then(r => r.json());
  const before = await chat();
  u.rosters = moved(); now.advance(10); await inputs.ensure(LEAGUE, { force: true });
  const after = await chat();
  assert.equal(after.eligible_pool, before.eligible_pool - 1, "player 10 left the available pool in R2");
});

test("J: trade basis carries the revision; obsolete ownership is refused; refresh never runs a trade", async () => {
  const u = upstream(tradeFixtureFetch()), now = clock(), inputs = coordinator(u, now);
  const users = async path => ({ user_id: ME, path });
  const provider = new SleeperProvider({ inputs, snapshot: (id, o) => buildLeagueSnapshot(id, { ...o, fetchData: users }) });
  const { loadLeague, ...fixture } = tradeFixtureOptions();
  let builds = 0;
  const service = createDecisionService(async (league, o) => { builds++; return buildDecisionState(league, { ...fixture, ...o }); }, now, league => provider.pinInputs(league));
  const trade = body => handleTradeRequest(tradeRequest({ league: TRADE_LEAGUE, user: ME, ...body }), { leagueIds: [], build: service }).then(async r => ({ status: r.status, json: await r.json() }));
  const r1 = await inputs.ensure(TRADE_LEAGUE);
  const basis1 = decisionBasis(await buildLeagueSnapshot(TRADE_LEAGUE, { inputs: r1, userId: ME, fetchData: users, freeAgentLimit: 100 }));
  assert.equal((await trade({ basis: basis1, proposal: proposal(["12"], ["23"]) })).status, 200);
  // Refresh promotes R2 (player 23 moved to roster 1). Refresh itself builds no decision and evaluates no trade.
  const rosters = structuredClone(TRADE_ROSTERS); rosters[1].players = rosters[1].players.filter(p => p !== "23"); rosters[1].starters = rosters[1].starters.map(p => p === "23" ? "0" : p); rosters[0].players.push("23");
  u.rosters = rosters; now.advance(10);
  const buildsBefore = builds;
  const refreshed = await handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: TRADE_LEAGUE, user: ME }) }),
    { leagueIds: [], resolveProvider: () => provider });
  const report = await refreshed.json();
  assert.equal(refreshed.status, 200); assert.equal(report.revision_changed, true); assert.equal(builds, buildsBefore);
  const stale = await trade({ basis: basis1, proposal: proposal(["12"], ["23"]) });
  assert.equal(stale.status, 409); assert.equal(stale.json.errors[0].code, "STALE_BASIS");
  const basis2 = decisionBasis(report.snapshot);
  assert.equal(basisRevision(basis2), report.input_revision);
  const obsolete = await trade({ basis: basis2, proposal: proposal(["12"], ["23"]) });
  assert.equal(obsolete.status, 422); assert.equal(obsolete.json.status, "invalid");
});

test("J/O: late trade responses after a basis change are dropped by the loader", async () => {
  const pending = [], states = [];
  const loader = createTradeLoader(state => states.push(state), () => new Promise(resolve => pending.push(resolve)));
  const snapshot = await buildLeagueSnapshot(LEAGUE, { fetchData: fixtureFetch(), userId: null });
  const request = loader.load(snapshot, [{ rosterId: 1, playerIds: ["1"] }, { rosterId: 2, playerIds: ["6"] }], "k");
  loader.cancel(); // what the trade view does when the snapshot basis (revision) changes
  const count = states.length;
  pending[0]({ json: async () => ({ schema_version: "trade-1", basis: decisionBasis(snapshot) }) }); await request;
  assert.equal(states.length, count);
});

test("K: leagues, users, explicit rosters, spectators and seasons stay isolated", async () => {
  const u = upstream(), now = clock(), inputs = coordinator(u, now);
  const users = async path => ({ user_id: path.split("/").at(-1) === "alice" ? "me" : "other" });
  const provider = new SleeperProvider({ inputs, snapshot: (id, o) => buildLeagueSnapshot(id, { ...o, fetchData: users }) });
  const refresh = body => handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { leagueIds: [], resolveProvider: () => provider }).then(async r => ({ status: r.status, json: await r.json() }));
  const a = await refresh({ league: LEAGUE, user: "spectator" }), b = await refresh({ league: OTHER, user: "spectator" });
  assert.notEqual(a.json.input_revision, b.json.input_revision);
  assert.equal(a.json.snapshot.identity.mode, "spectator"); assert.equal(a.json.snapshot.my_roster, null);
  const selected = await refresh({ league: LEAGUE, user: "spectator", roster: 2 });
  assert.equal(selected.json.snapshot.identity.mode, "selected_roster"); assert.equal(selected.json.snapshot.my_roster.roster_id, 2);
  assert.equal((await refresh({ league: LEAGUE, user: "spectator", roster: 9 })).status, 422);
  assert.equal((await refresh({ league: LEAGUE, user: "spectator", season: 2025 })).status, 422);
  // Refreshing one league does not touch another's committed revision.
  u.rosters = moved(); now.advance(10);
  await refresh({ league: LEAGUE, user: "spectator" });
  assert.equal((await inputs.ensure(OTHER)).revision, b.json.input_revision);
  // Personalized decision state keys on identity as well as revision.
  const { service, builds } = pinnedService(inputs, { now });
  await service(LEAGUE, { identity: spectator, provider: "sleeper" });
  await service(LEAGUE, { identity: { ...spectator, rosterId: 2 }, provider: "sleeper" });
  await service(LEAGUE, { identity: { ...spectator, season: 2026 }, provider: "sleeper" });
  assert.equal(builds.length, 3);
});

test("L: private mode keeps its own revision path; public refresh never reaches private ESPN", async () => {
  const saved = { mode: process.env.FANTASY_PRIVATE_MODE, config: process.env.ESPN_PRIVATE_CONFIG, vercel: process.env.VERCEL, token: process.env[TOKEN_ENV] };
  const TOKEN = "cd".repeat(32);
  let privateTouched = 0;
  Object.assign(process.env, { FANTASY_PRIVATE_MODE: "local", ESPN_PRIVATE_CONFIG: "/nonexistent/espn-private.json", [TOKEN_ENV]: TOKEN }); delete process.env.VERCEL;
  setPrivateEspnProviderFactory(() => { privateTouched++; throw new Error("private provider must not be built"); });
  try {
    const response = await handleRefreshRequest(new Request("http://127.0.0.1:3000/api/refresh", { method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json", [LOOPBACK_HEADER]: TOKEN }, body: JSON.stringify({ provider: "espn", league: "424242" }) }));
    assert.equal(response.status, 422); assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal((await response.json()).code, "UNSUPPORTED_FEATURE"); assert.equal(privateTouched, 0);
  } finally {
    for (const [key, value] of [["FANTASY_PRIVATE_MODE", saved.mode], ["ESPN_PRIVATE_CONFIG", saved.config], ["VERCEL", saved.vercel], [TOKEN_ENV, saved.token]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    setPrivateEspnProviderFactory();
  }
  // Private (and any explicitly revisioned or adapter-backed) builds are never re-pinned to Sleeper inputs.
  let pins = 0, seen;
  const service = createDecisionService(async (league, o) => { seen = o; return {}; }, Date.now, () => { pins++; return null; });
  const adapter = {};
  await service("424242", { provider: "espn", providerAdapter: adapter, revision: "config:x;bundle:y", identity: { principal: "local-owner" } });
  assert.equal(pins, 0); assert.equal(seen.providerAdapter, adapter); assert.equal(seen.revision, "config:x;bundle:y");
  // Snapshots without a Sleeper revision (ESPN, private) keep the original basis string exactly.
  const snapshot = await buildLeagueSnapshot(LEAGUE, { fetchData: fixtureFetch(), userId: null });
  const { input_revision, ...coverage } = snapshot.coverage;
  const legacy = decisionBasis({ ...snapshot, coverage });
  assert.equal(JSON.parse(legacy).length, 7);
  assert.equal(decisionBasis(snapshot), JSON.stringify([...JSON.parse(legacy), ["input_revision", input_revision]]));
});

test("M: GET paths only read committed inputs (never forced) and the refresh route has no GET", async () => {
  const calls = [];
  const spy = { ensure: async (id, options = {}) => { calls.push(options.force ?? false); return coordinator(upstream()).ensure(id); } };
  const provider = new SleeperProvider({ inputs: spy });
  await provider.getSnapshot(LEAGUE, { userId: null });
  await provider.getDecisionContext(LEAGUE, { userId: null });
  await provider.pinInputs(LEAGUE);
  assert.deepEqual(calls, [false, false, false]);
  const route = await import("../app/api/refresh/route.js");
  assert.equal(typeof route.POST, "function"); assert.equal(route.GET, undefined);
  for (const path of ["../app/api/snapshot/route.js", "../app/api/decision-support/route.js"]) assert.equal((await import(path)).POST, undefined);
  // The refresh module writes nothing: no archive/history imports.
  const { readFileSync } = await import("node:fs");
  for (const file of ["lib/refresh-api.js", "lib/sources/sleeper/inputs.js"]) assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), /from "[^"]*(history|git-store|node:fs)|appendCapture|writeFile/);
});

test("N: forced refresh reaches Sleeper despite earlier transport entries; revision-qualified reads stay consistent", async () => {
  const t = transportUpstream(), now = clock(), inputs = createSleeperInputs({ fetchData: t.fetchData, now });
  const r1 = await inputs.ensure(LEAGUE);
  const rosterCalls = () => t.state.calls.filter(c => c.path.endsWith("/rosters")).length;
  now.advance(10); await inputs.ensure(LEAGUE, { force: true });
  assert.equal(rosterCalls(), 2);
  // Snapshot GET: a matching `rev` is cacheable; another revision is served no-store (never cached under the wrong URL).
  const options = { leagueIds: [], buildSnapshot: (id, o) => buildLeagueSnapshot(id, { ...o, inputs: r1 }) };
  const get = query => handleSnapshotRequest(new Request(`http://localhost/api/snapshot?league=${LEAGUE}&user=spectator&compact=0${query}`), options);
  assert.match((await get(`&rev=${r1.revision}`)).headers.get("cache-control"), /public, s-maxage=30/);
  assert.equal((await get(`&rev=sleeper:${"0".repeat(64)}`)).headers.get("cache-control"), "no-store");
  assert.equal((await get("&rev=nope")).status, 400);
  // Decision GET: a revision this process does not hold is 409 no-store, never a cached stale answer.
  const { service } = pinnedService(inputs, { now });
  const decision = query => handleDecisionRequest(new Request(`http://localhost/api/decision-support?league=${LEAGUE}&user=spectator${query}`), { leagueIds: [], build: (l, o) => service(l, o).then(s => s.decision) });
  const current = (await inputs.ensure(LEAGUE)).revision;
  const ok = await decision(`&rev=${current}`);
  assert.equal(ok.status, 200); assert.match(ok.headers.get("cache-control"), /public, s-maxage=60/);
  const stale = await decision(`&rev=sleeper:${"1".repeat(64)}`);
  assert.equal(stale.status, 409); assert.equal(stale.headers.get("cache-control"), "no-store");
  // Loaders name the revision they hold.
  const urls = [];
  const loader = createSnapshotLoader(() => {}, async url => { urls.push(url); return { ok: true, json: async () => (url.startsWith("/api/refresh") ? { schema_version: "refresh-1", status: "ok", snapshot: await buildLeagueSnapshot(LEAGUE, { inputs: r1, userId: null }) } : await buildLeagueSnapshot(LEAGUE, { inputs: r1, userId: null })) }; });
  await loader.refresh(LEAGUE, { userId: null }); await loader.load(LEAGUE, { userId: null });
  assert.match(urls.at(-1), new RegExp(`rev=${encodeURIComponent(r1.revision)}`));
  const decisionUrls = [];
  const snapshot = await buildLeagueSnapshot(LEAGUE, { inputs: r1, userId: null });
  await createDecisionLoader(() => {}, async url => { decisionUrls.push(url); return { ok: true, json: async () => ({ basis: decisionBasis(snapshot) }) }; }).load(snapshot);
  assert.match(decisionUrls[0], new RegExp(`rev=${encodeURIComponent(r1.revision)}`));
});

test("O: refresh keeps same-selection data, and late refresh/load results cannot overwrite a newer selection", async () => {
  const pending = [], states = [];
  const loader = createSnapshotLoader(s => states.push(s), (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })));
  const snap = league => ({ league: { league_id: league }, coverage: { input_revision: `sleeper:${"a".repeat(64)}` } });
  const ok = (i, body) => pending[i].resolve({ ok: true, json: async () => body });
  const first = loader.load("A", { userId: null }); ok(0, snap("A")); await first;
  const refresh = loader.refresh("A", { userId: null });
  assert.equal(states.at(-1).refreshing, true); assert.equal(states.at(-1).data.league.league_id, "A", "data stays visible while refreshing");
  assert.equal(pending[1].options.method, "POST");
  await loader.refresh("A", { userId: null }); assert.equal(pending.length, 2, "duplicate refresh of the same selection is ignored");
  const switched = loader.load("B", { userId: null });
  assert.equal(pending[1].options.signal.aborted, true);
  ok(2, snap("B")); await switched;
  const count = states.length;
  ok(1, { schema_version: "refresh-1", status: "ok", snapshot: snap("A") }); await refresh;
  assert.equal(states.length, count); assert.equal(states.at(-1).data.league.league_id, "B");
  // Failure keeps last-known-good with a retryable error; a success after it clears the error.
  const failing = loader.refresh("B", { userId: null });
  pending[3].resolve({ ok: false, json: async () => ({ error: "Sleeper league data is unavailable." }) }); await failing;
  assert.equal(states.at(-1).data.league.league_id, "B"); assert.match(states.at(-1).refreshError, /unavailable/); assert.equal(states.at(-1).error, "");
  const retry = loader.refresh("B", { userId: null }); ok(4, { schema_version: "refresh-1", status: "failed", snapshot: snap("B") }); await retry;
  assert.match(states.at(-1).refreshError, /could not be refreshed/);
  const later = loader.refresh("B", { userId: null }); ok(5, { schema_version: "refresh-1", status: "ok", snapshot: snap("B") }); await later;
  assert.equal(states.at(-1).refreshError, ""); assert.ok(states.at(-1).receivedAt);
  // A refresh with nothing retained behaves like a first load: errors are shown as errors.
  const cold = createSnapshotLoader(s => states.push(s), async () => ({ ok: false, json: async () => ({ error: "unavailable" }) }));
  await cold.refresh("C", { userId: null }); assert.equal(states.at(-1).error, "unavailable"); assert.equal(states.at(-1).data, null);
});

test("R: automatic refresh runs only while visible, once on return when due, with no polling loop or leaks", () => {
  let t = 0, visible = true, listener = null;
  const timers = new Map(); let nextId = 0;
  const setTimer = (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: t + ms, ms }); return id; };
  const clearTimer = id => timers.delete(id);
  const runDue = () => { for (const [id, timer] of [...timers]) if (timer.at <= t) { timers.delete(id); timer.fn(); } };
  let refreshes = 0;
  const auto = createAutoRefresh({ now: () => t, isVisible: () => visible, onDue: () => { refreshes++; }, setTimer, clearTimer,
    subscribe: fn => { listener = fn; return () => { listener = null; }; } });
  auto.synced(0);
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].ms, AUTO_REFRESH_MS, "one timer at the due time, not a poll");
  t = AUTO_REFRESH_MS; runDue(); assert.equal(refreshes, 1); assert.equal(timers.size, 1);
  visible = false; listener(); assert.equal(timers.size, 0, "hidden pauses the timer");
  t += AUTO_REFRESH_MS * 3; runDue(); assert.equal(refreshes, 1, "nothing runs while hidden");
  visible = true; listener(); assert.equal(refreshes, 2, "returning to a visible view refreshes once when due"); assert.equal(timers.size, 1);
  visible = false; listener(); visible = true; listener(); assert.equal(refreshes, 2, "not due again yet");
  auto.synced(t); assert.ok([...timers.values()].every(timer => timer.ms >= 60000), "no sub-minute timers");
  auto.stop(); assert.equal(timers.size, 0); assert.equal(listener, null);
});

test("T/U: decisions value the full available pool; display limits and compact views do not; contracts stay additive", async () => {
  const base = fixtureFetch();
  const many = async path => path === "/players/nfl" ? Object.fromEntries(Array.from({ length: 150 }, (_, i) => [String(i + 1), { full_name: `Player ${i + 1}`, position: "RB", fantasy_positions: ["RB"], team: "BUF", active: true, search_rank: i }])) : base(path);
  const inputs = createSleeperInputs({ fetchData: many, now: clock() }), provider = new SleeperProvider({ inputs });
  const refresh = await handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator", mode: "due" }) }), { leagueIds: [], resolveProvider: () => provider });
  const body = await refresh.json();
  assert.equal(body.schema_version, "refresh-1"); assert.equal(body.mode, "due"); assert.equal(refresh.headers.get("cache-control"), "no-store");
  assert.ok(body.snapshot.truncation.free_agents.RB.omitted > 0, "refresh returns the dashboard's display-limited snapshot");
  const { adapter } = await provider.pinInputs(LEAGUE);
  const full = await adapter.getDecisionContext(LEAGUE, { userId: null });
  assert.equal(full.free_agents.RB.length, 150 - 5); assert.equal(full.truncation.free_agents.RB.omitted, 0);
  // Snapshot 0.2: freshness/revision are additive under coverage and identical in compact and full views.
  const snapshot = body.snapshot, compact = compactSnapshot(snapshot);
  assert.equal(snapshot.schema_version, "0.2"); assert.equal(compact.schema_version, "0.2");
  assert.deepEqual(compact.coverage, snapshot.coverage);
  assert.equal(snapshot.coverage.input_revision, body.input_revision); assert.equal(snapshot.coverage.freshness.guarantee, "process-local");
  for (const key of ["transaction_weeks", "transaction_statuses", "trending_upstream_limit", "player_cache_seconds", "waiver_policy"]) assert.ok(key in snapshot.coverage, key);
  assert.notEqual(snapshot.generated_at, undefined);
  // Historical season: no current-week activity resources, the season warning, and a revision all the same.
  const old = await createSleeperInputs({ fetchData: fixtureFetch({ season: "2025" }) }).ensure(LEAGUE);
  assert.deepEqual(old.bundle.resources.filter(r => /matchups|transactions/.test(r)), []);
  const oldSnapshot = await buildLeagueSnapshot(LEAGUE, { inputs: old, userId: null });
  assert.equal(oldSnapshot.matchup_week, null); assert.ok(oldSnapshot.warnings.some(w => w.code === "SEASON_MISMATCH"));
});

test("refresh request envelope is strict, bounded and sanitized", async () => {
  const provider = new SleeperProvider({ inputs: coordinator(upstream()) });
  const post = (body, headers = { "content-type": "application/json" }) => handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), { leagueIds: [], resolveProvider: () => provider });
  assert.equal((await post({ league: LEAGUE }, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post("{")).status, 400);
  assert.equal((await post({ league: LEAGUE, resources: ["players"] })).status, 400);
  assert.equal((await post({ league: LEAGUE, mode: "everything" })).status, 400);
  assert.equal((await post({ league: "../etc" })).status, 400);
  assert.equal((await post({ league: LEAGUE, user: "not a user" })).status, 400);
  assert.equal((await post({ league: LEAGUE, pad: "x".repeat(4000) })).status, 413);
  const u = upstream(); u.fail.set("/rosters", new Error("secret-token-xyz"));
  const failed = await handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator" }) }), { leagueIds: [], resolveProvider: () => new SleeperProvider({ inputs: coordinator(u) }) });
  const text = await failed.text();
  assert.equal(failed.status, 502); assert.equal(failed.headers.get("cache-control"), "no-store"); assert.doesNotMatch(text, /secret-token/);
  assert.equal(JSON.parse(text).snapshot, undefined, "no fabricated empty league");
  // A later failure with a committed bundle serves last-known-good and says so.
  const v = upstream(), now = clock(), lkg = new SleeperProvider({ inputs: coordinator(v, now) });
  const call = () => handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator" }) }), { leagueIds: [], resolveProvider: () => lkg }).then(r => r.json());
  const good = await call(); v.fail.set("/rosters", new Error("outage")); now.advance(10);
  const kept = await call();
  assert.equal(kept.status, "failed"); assert.equal(kept.served, "last_known_good"); assert.equal(kept.input_revision, good.input_revision);
  assert.deepEqual(kept.snapshot.rosters, good.snapshot.rosters);
});

// ---------------------------------------------------------------- Codex first-pass regressions

const DAY = 24 * 60 * 60, BACKOFF = REFRESH_POLICY.failure_backoff_seconds;
const newCatalog = async () => { const players = structuredClone(await fixtureFetch()("/players/nfl")); players["1"] = { ...players["1"], team: "KC" }; return players; };
const newState = async () => ({ ...(await fixtureFetch()("/state/nfl")), week: 4, leg: 4 });
/** One core-atomicity scenario: after R1, `change` stages new candidates, then `recover` lets the failing one succeed. */
async function coreScenario({ advance, change, recover, failing }) {
  const u = upstream(), now = clock(), inputs = coordinator(u, now, { isPinned: () => true });
  const r1 = await inputs.ensure(LEAGUE);
  now.advance(advance); await change(u);
  const before = u.calls.length;
  const held = await inputs.ensure(LEAGUE, { force: true });
  assert.equal(held.revision, r1.revision, "a failed core candidate keeps revision R1");
  assert.equal(held.bundle, r1.bundle, "the committed core is exactly R1 (same immutable bundle)");
  assert.deepEqual(u.calls.slice(before).filter(p => /matchups\/4|transactions\/4/.test(p)), [], "activity paths are not switched to an uncommitted week");
  assert.equal(held.bundle.matchup_week, 3);
  assert.ok(held.report.unresolved.includes(failing), `${failing} is reported unresolved`);
  // Another league sharing the same process-wide candidates does not change the first league's committed core either.
  await inputs.ensure(OTHER).catch(() => {});
  assert.equal((await inputs.ensure(LEAGUE)).bundle, r1.bundle);
  recover(u); now.advance(BACKOFF);
  const r2 = await inputs.ensure(LEAGUE, { force: true });
  assert.notEqual(r2.revision, r1.revision, "once every core candidate succeeds one coherent R2 promotes");
  assert.deepEqual(r2.report.unresolved, []);
  return { r1, r2, held, u };
}

test("Codex 1a: new NFL state + failed rosters keeps R1 core and activity week, then promotes R2 coherently", async () => {
  const { r2, held, u } = await coreScenario({ advance: 10, failing: "rosters",
    change: async u => { u.exact.set("/state/nfl", await newState()); u.fail.set("/rosters", new Error("outage")); u.rosters = moved(); },
    recover: u => u.fail.delete("/rosters") });
  assert.equal(resource(held, "state").last_attempt_status, "not_promoted");
  assert.equal(resource(held, "state").error.code, "NOT_PROMOTED");
  assert.equal(resource(held, "rosters").last_attempt_status, "failed");
  assert.equal(r2.bundle.state.week, 4); assert.equal(r2.bundle.matchup_week, 4); assert.deepEqual(r2.bundle.rosters, moved());
  assert.ok(u.count("/matchups/4") >= 1, "the new week is used only after the new state is committed");
});

test("Codex 1b: new catalog + failed rosters keeps R1, then promotes R2 with both", async () => {
  const { r1, r2, held } = await coreScenario({ advance: DAY, failing: "rosters",
    change: async u => { u.exact.set("/players/nfl", await newCatalog()); u.fail.set("/rosters", new Error("outage")); u.rosters = moved(); },
    recover: u => u.fail.delete("/rosters") });
  assert.equal(held.bundle.players, r1.bundle.players);
  assert.equal(resource(held, "players").last_attempt_status, "not_promoted");
  assert.equal(r2.bundle.players["1"].team, "KC"); assert.deepEqual(r2.bundle.rosters, moved());
});

test("Codex 1c: new rosters + failed NFL state keeps R1 rosters, then promotes R2", async () => {
  const { r2, held } = await coreScenario({ advance: 10, failing: "state",
    change: async u => { u.rosters = moved(); u.exact.set("/state/nfl", new Error("outage")); },
    recover: u => u.exact.delete("/state/nfl") });
  assert.equal(resource(held, "rosters").last_attempt_status, "not_promoted");
  assert.deepEqual(r2.bundle.rosters, moved());
});

test("Codex 1d: new rosters + failed catalog keeps R1 rosters, then promotes R2", async () => {
  const { r2, held } = await coreScenario({ advance: DAY, failing: "players",
    change: async u => { u.rosters = moved(); u.exact.set("/players/nfl", new Error("outage")); },
    recover: u => u.exact.delete("/players/nfl") });
  assert.equal(resource(held, "rosters").last_attempt_status, "not_promoted");
  assert.equal(resource(held, "players").last_attempt_status, "failed");
  assert.deepEqual(r2.bundle.rosters, moved());
});

test("Codex 2: an R2 client never accepts an R1 answer from another instance, and a sync resolves it", async () => {
  const r1 = await buildLeagueSnapshot(LEAGUE, { inputs: await coordinator(upstream()).ensure(LEAGUE), userId: null });
  const u2 = upstream(); u2.rosters = moved();
  const r2 = await buildLeagueSnapshot(LEAGUE, { inputs: await coordinator(u2).ensure(LEAGUE), userId: null });
  assert.notEqual(r1.coverage.input_revision, r2.coverage.input_revision);
  const states = [], requests = [];
  let answer = null;
  const loader = createSnapshotLoader(s => states.push(s), async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => answer }; });
  answer = { schema_version: "refresh-1", status: "ok", snapshot: r2 };
  await loader.refresh(LEAGUE, { userId: null });
  assert.equal(states.at(-1).data.coverage.input_revision, r2.coverage.input_revision);
  // The next read names R2 and lands on an instance that still holds R1 (older or newer is irrelevant: no ordering).
  answer = r1;
  await loader.load(LEAGUE, { userId: null });
  assert.equal(new URL(requests.at(-1).url, "http://x").searchParams.get("rev"), r2.coverage.input_revision);
  const shown = states.at(-1);
  assert.equal(shown.data.coverage.input_revision, r2.coverage.input_revision, "R1 is not published; same-selection R2 data is retained");
  assert.equal(shown.mismatch, true); assert.match(shown.refreshError, /different sync/); assert.equal(shown.error, "");
  assert.ok(!states.some(s => s.data?.coverage?.input_revision === r1.coverage.input_revision), "R1 was never published");
  await loader.load(LEAGUE, { userId: null });
  assert.equal(new URL(requests.at(-1).url, "http://x").searchParams.get("rev"), r2.coverage.input_revision, "the remembered revision is not overwritten");
  // Manual/automatic sync (POST) is the explicit resolution: its committed result is accepted and remembered.
  answer = { schema_version: "refresh-1", status: "ok", snapshot: r1 };
  await loader.refresh(LEAGUE, { userId: null });
  assert.equal(states.at(-1).data.coverage.input_revision, r1.coverage.input_revision); assert.equal(states.at(-1).refreshError, ""); assert.ok(!states.at(-1).mismatch);
  answer = r1; await loader.load(LEAGUE, { userId: null });
  assert.equal(states.at(-1).data.coverage.input_revision, r1.coverage.input_revision);
  // Different selection with a remembered revision and no retained data: an error, never the mismatched data.
  const cold = [], coldLoader = createSnapshotLoader(s => cold.push(s), async () => ({ ok: true, json: async () => (cold.length > 2 ? r1 : { schema_version: "refresh-1", status: "ok", snapshot: r2 }) }));
  await coldLoader.refresh(LEAGUE, { userId: null }); await coldLoader.load(OTHER, { userId: null }).catch(() => {});
  await coldLoader.load(LEAGUE, { userId: null });
  assert.equal(cold.at(-1).data, null); assert.match(cold.at(-1).error, /different sync/);
});

test("Codex 3: sixteen busy leagues refuse a seventeenth before any upstream work; idle ones make room single-flight", async () => {
  const u = upstream(), g = gate(), inputs = coordinator(u, clock());
  const ids = Array.from({ length: 16 }, (_, i) => String(200000000 + i)), NEW = "299999999";
  u.gates.set("/rosters", g.promise);
  const held = ids.map(id => inputs.ensure(id));
  const refused = await Promise.allSettled(Array.from({ length: 10 }, () => inputs.ensure(NEW)));
  assert.ok(refused.every(r => r.status === "rejected" && r.reason.code === "CAPACITY"), "no active entry is evicted or untracked");
  assert.equal(u.calls.filter(p => p.includes(NEW)).length, 0, "admission happens before upstream work");
  assert.deepEqual(inputs.stats().league_ids, ids);
  g.open(); await Promise.all(held);
  const before = u.calls.length;
  const admitted = await Promise.all(Array.from({ length: 10 }, () => inputs.ensure(NEW)));
  assert.equal(new Set(admitted.map(a => a.revision)).size, 1);
  assert.equal(u.calls.slice(before).filter(p => p === `/league/${NEW}/rosters`).length, 1, "concurrent requests for an admitted league are single-flight");
  assert.equal(inputs.stats().leagues, 16); assert.ok(inputs.stats().league_ids.includes(NEW)); assert.ok(!inputs.stats().league_ids.includes(ids[0]), "the least recently used idle league was evicted");
  // The capacity refusal reaches the refresh route as a retryable 503, no-store.
  const hold = gate(), busyUp = upstream(); busyUp.gates.set("/rosters", hold.promise);
  const tight = coordinator(busyUp, clock(), { policy: { ...REFRESH_POLICY, max_leagues: 1 } }), provider = new SleeperProvider({ inputs: tight });
  const first = tight.ensure(OTHER);
  const response = await handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator" }) }), { leagueIds: [], resolveProvider: () => provider });
  assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await response.json()).code, "CAPACITY");
  hold.open(); await first;
});

test("Codex 3: a forced caller waiting behind a cycle keeps its league from eviction", async () => {
  const u = upstream(), g = gate(), inputs = coordinator(u, clock(), { policy: { ...REFRESH_POLICY, max_leagues: 1 } });
  u.gates.set("/rosters", g.promise);
  const plain = inputs.ensure(LEAGUE), forced = inputs.ensure(LEAGUE, { force: true });
  g.open(); await plain;
  await assert.rejects(inputs.ensure(OTHER), e => e.code === "CAPACITY", "the waiting forced refresh is still active");
  await forced;
  assert.deepEqual(inputs.stats().league_ids, [LEAGUE]);
});

test("Codex 4: pins sit outside the arbitrary bound, are never evicted, and unpinned LRU still works", async () => {
  const pins = Array.from({ length: 20 }, (_, i) => String(300000000 + i)), arbitrary = Array.from({ length: 5 }, (_, i) => String(400000000 + i));
  const u = upstream(), inputs = coordinator(u, clock(), { policy: { ...REFRESH_POLICY, max_leagues: 3 }, isPinned: id => pins.includes(id) });
  for (const id of pins) await inputs.ensure(id);
  for (const id of arbitrary.slice(0, 3)) await inputs.ensure(id);
  await inputs.ensure(arbitrary[0]); // touch: most recently used
  for (const id of arbitrary.slice(3, 5)) await inputs.ensure(id);
  const { league_ids, unpinned, leagues } = inputs.stats();
  assert.ok(pins.every(id => league_ids.includes(id)), "every pin is retained, beyond the arbitrary bound");
  assert.equal(unpinned, 3); assert.equal(leagues, 23);
  assert.deepEqual(league_ids.filter(id => !pins.includes(id)).sort(), [arbitrary[0], arbitrary[3], arbitrary[4]].sort(), "least recently used arbitrary leagues are evicted first");
  // Active arbitrary entries are protected: with all three busy, a fourth arbitrary league is refused, a pin is not.
  const g = gate(); u.gates.set("/rosters", g.promise);
  const busy = [arbitrary[0], arbitrary[3], arbitrary[4]].map(id => inputs.ensure(id, { force: true }));
  await assert.rejects(inputs.ensure("499999999"), e => e.code === "CAPACITY");
  const extraPin = "300000099"; pins.push(extraPin);
  const pinned = inputs.ensure(extraPin);
  g.open(); await Promise.all([...busy, pinned]);
  assert.ok(inputs.stats().league_ids.includes(extraPin)); assert.equal(inputs.stats().unpinned, 3);
});

test("Codex 5: an immediate retry that is deferred stays failed; a retry after the interval succeeds and clears it", async () => {
  const u = upstream(), now = clock(), provider = new SleeperProvider({ inputs: coordinator(u, now) });
  const post = () => handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator" }) }), { leagueIds: [], resolveProvider: () => provider }).then(r => r.json());
  const r1 = await post(); assert.equal(r1.status, "ok"); assert.deepEqual(r1.unresolved, []);
  u.fail.set("/rosters", new Error("outage")); u.rosters = moved(); now.advance(REFRESH_POLICY.min_force_interval_seconds);
  const failed = await post();
  assert.equal(failed.status, "failed"); assert.equal(failed.served, "last_known_good"); assert.deepEqual(failed.failed, ["rosters"]);
  u.fail.clear();
  const retry = await post(); // immediately: inside the cooldown, nothing is attempted
  assert.deepEqual(retry.attempted.filter(n => n === "rosters"), []);
  assert.equal(retry.status, "failed", "a deferred retry is not a success"); assert.equal(retry.served, "last_known_good");
  assert.deepEqual(retry.failed, []); assert.ok(retry.unresolved.includes("rosters")); assert.ok(retry.deferred.includes("rosters"));
  assert.ok(retry.retry_after_seconds > 0 && retry.retry_after_seconds <= REFRESH_POLICY.min_force_interval_seconds);
  assert.equal(retry.input_revision, r1.input_revision); assert.deepEqual(retry.snapshot.rosters, r1.snapshot.rosters);
  assert.equal(retry.snapshot.coverage.freshness.resources.rosters.last_attempt_status, "failed");
  assert.ok(retry.snapshot.coverage.freshness.resources.rosters.error, "the error is not cleared");
  now.advance(retry.retry_after_seconds);
  const later = await post();
  assert.equal(later.status, "ok"); assert.equal(later.served, "refreshed"); assert.deepEqual(later.unresolved, []); assert.deepEqual(later.deferred, []);
  assert.notEqual(later.input_revision, r1.input_revision);
  assert.equal(later.snapshot.coverage.freshness.resources.rosters.error, null);
  // Client: the deferred failure keeps the error message with a retry hint; the later success clears it.
  const states = []; let answer = r1;
  const loader = createSnapshotLoader(s => states.push(s), async () => ({ ok: true, json: async () => answer }));
  await loader.refresh(LEAGUE, { userId: null });
  answer = retry; await loader.refresh(LEAGUE, { userId: null });
  assert.match(states.at(-1).refreshError, /could not be refreshed \(.*rosters.*\)\. Retry available in \d+ s\./);
  assert.equal(states.at(-1).refresh.status, "failed");
  answer = later; await loader.refresh(LEAGUE, { userId: null });
  assert.equal(states.at(-1).refreshError, "");
});

// ---------------------------------------------------------------- Codex delta review regressions

test("Codex delta 1: automatic due sync accepts only the held revision or a result that advanced from it; manual may switch", async () => {
  const R1 = `sleeper:${"1".repeat(64)}`, R2 = `sleeper:${"2".repeat(64)}`, R3 = `sleeper:${"3".repeat(64)}`;
  const snap = rev => ({ league: { league_id: LEAGUE, name: rev.slice(8, 9) }, coverage: { input_revision: rev } });
  const body = (previous, input, attempted = []) => ({ schema_version: "refresh-1", status: "ok", previous_input_revision: previous, input_revision: input, revision_changed: previous !== input, attempted, failed: [], snapshot: snap(input) });
  function held() {
    const states = [], requests = []; let answer = body(null, R2);
    const loader = createSnapshotLoader(s => states.push(s), async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => typeof answer === "function" ? answer(url) : answer }; });
    const rev = () => new URL(requests.at(-1).url, "http://x").searchParams.get("rev");
    const set = next => { answer = next; };
    return { states, loader, set, rememberedIs: async expected => { set(snap(expected)); await loader.load(LEAGUE, { userId: null }); assert.equal(rev(), expected); },
      init: async () => { await loader.refresh(LEAGUE, { userId: null }); assert.equal(states.at(-1).data.coverage.input_revision, R2); } };
  }
  const due = h => h.loader.refresh(LEAGUE, { userId: null }, { mode: "due" });
  const rejected = (h, why) => {
    const s = h.states.at(-1);
    assert.equal(s.data.coverage.input_revision, R2, `${why}: R2 stays visible`);
    assert.equal(s.mismatch, true); assert.match(s.refreshError, /different sync/); assert.equal(s.refreshing, false);
  };
  // 1. Other instance holds R1, nothing due: previous R1 / input R1.
  let h = held(); await h.init(); h.set(body(R1, R1)); await due(h);
  rejected(h, "previous R1/input R1"); await h.rememberedIs(R2);
  // 2. Other instance holds R1, resources due, produces R3: continuity from R2 is unproven.
  h = held(); await h.init(); h.set(body(R1, R3, ["rosters"])); await due(h);
  rejected(h, "previous R1/input R3"); assert.ok(!h.states.some(s => s.data?.coverage?.input_revision === R3)); await h.rememberedIs(R2);
  // 3. Same instance advances from R2 to R3: accepted and remembered.
  h = held(); await h.init(); h.set(body(R2, R3, ["rosters"])); await due(h);
  assert.equal(h.states.at(-1).data.coverage.input_revision, R3); assert.ok(!h.states.at(-1).mismatch); assert.equal(h.states.at(-1).refreshError, "");
  await h.rememberedIs(R3);
  // 4. Due call with no change: previous R2 / input R2 retained normally.
  h = held(); await h.init(); h.set(body(R2, R2)); await due(h);
  assert.equal(h.states.at(-1).data.coverage.input_revision, R2); assert.ok(!h.states.at(-1).mismatch); await h.rememberedIs(R2);
  // A later no-change due result for the held revision also accepts even when the instance's previous differs.
  h = held(); await h.init(); h.set(body(R1, R2, ["rosters"])); await due(h);
  assert.equal(h.states.at(-1).data.coverage.input_revision, R2); assert.ok(!h.states.at(-1).mismatch);
  // 5. Manual sync may accept the serving instance's R1 (explicit), and resolves an earlier due mismatch.
  h = held(); await h.init(); h.set(body(R1, R1)); await due(h); rejected(h, "due before manual");
  h.set(body(R1, R1)); await h.loader.refresh(LEAGUE, { userId: null });
  assert.equal(h.states.at(-1).data.coverage.input_revision, R1); assert.ok(!h.states.at(-1).mismatch); await h.rememberedIs(R1);
  // Cold (no held revision): a due result is accepted normally.
  const cold = []; const coldLoader = createSnapshotLoader(s => cold.push(s), async () => ({ ok: true, json: async () => body(R1, R3) }));
  await coldLoader.refresh(LEAGUE, { userId: null }, { mode: "due" }); assert.equal(cold.at(-1).data.coverage.input_revision, R3);
  // Stale-response guard still applies to a due refresh overtaken by a selection change.
  const pending = [], order = [];
  const guarded = createSnapshotLoader(s => order.push(s), (url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  const late = guarded.refresh(LEAGUE, { userId: null }, { mode: "due" });
  const other = guarded.load(OTHER, { userId: null });
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve({ ok: true, json: async () => ({ league: { league_id: OTHER }, coverage: { input_revision: R1 } }) }); await other;
  const count = order.length; pending[0].resolve({ ok: true, json: async () => body(null, R3) }); await late;
  assert.equal(order.length, count); assert.equal(order.at(-1).data.league.league_id, OTHER);
});

/** Refresh API caller over one coordinator; mode is manual unless given. */
function refreshCaller(u, now) {
  const provider = new SleeperProvider({ inputs: coordinator(u, now) });
  return (mode = "manual") => handleRefreshRequest(new Request("http://localhost/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ league: LEAGUE, user: "spectator", mode }) }), { leagueIds: [], resolveProvider: () => provider }).then(r => r.json());
}
/** Asserts the hint is positive and exact while `name` is deferred, then that it is attempted exactly at eligibility. */
async function hintMatchesEligibility({ post, now, u, name, path, mode, wait, recover }) {
  const failed = await post(mode);
  assert.equal(failed.retry_after_seconds, wait, `${name}: hint equals the eligibility wait`);
  let elapsed = 0;
  for (const step of [Math.min(10, wait - 1), wait - 1]) {
    now.advance(step - elapsed); elapsed = step;
    const before = u.count(path), r = await post(mode);
    assert.equal(u.count(path), before, `${name}: no attempt before eligibility`);
    assert.ok(r.deferred.includes(name)); assert.ok(r.retry_after_seconds > 0, `${name}: never claims ready early`);
    assert.equal(r.retry_after_seconds, wait - step);
  }
  now.advance(wait - elapsed); recover();
  const before = u.count(path), ok = await post(mode);
  assert.equal(u.count(path), before + 1, `${name}: attempted exactly when eligible`);
  return { failed, ok };
}

test("Codex delta 2A: manual roster failure hint is the manual cooldown and recovery runs exactly then", async () => {
  const u = upstream(), now = clock(), post = refreshCaller(u, now);
  await post(); now.advance(REFRESH_POLICY.min_force_interval_seconds); u.fail.set("/rosters", new Error("outage"));
  const { failed, ok } = await hintMatchesEligibility({ post, now, u, name: "rosters", path: "/rosters", mode: "manual", wait: REFRESH_POLICY.min_force_interval_seconds, recover: () => u.fail.clear() });
  assert.equal(failed.status, "failed"); assert.equal(ok.status, "ok"); assert.equal(ok.retry_after_seconds, null);
});

test("Codex delta 2B: due-mode roster failure hint is the failure backoff", async () => {
  const u = upstream(), now = clock(), post = refreshCaller(u, now);
  await post("due"); now.advance(REFRESH_POLICY.stale_after_seconds.dynamic); u.fail.set("/rosters", new Error("outage"));
  const { failed, ok } = await hintMatchesEligibility({ post, now, u, name: "rosters", path: "/rosters", mode: "due", wait: BACKOFF, recover: () => u.fail.clear() });
  assert.equal(failed.status, "failed"); assert.equal(ok.status, "ok");
});

test("Codex delta 2C: catalog failure reflects the 30 s backoff, not the 10 s manual cooldown", async () => {
  const u = upstream(), now = clock(), post = refreshCaller(u, now);
  await post(); now.advance(DAY); u.exact.set("/players/nfl", new Error("outage"));
  const { failed, ok } = await hintMatchesEligibility({ post, now, u, name: "players", path: "/players/nfl", mode: "manual", wait: BACKOFF, recover: () => u.exact.clear() });
  assert.equal(failed.status, "failed"); assert.equal(ok.status, "ok");
});

test("Codex delta 2D: a Retry-After longer than cooldown/backoff wins and nothing is attempted early", async () => {
  const u = upstream(), now = clock(), post = refreshCaller(u, now);
  await post(); now.advance(REFRESH_POLICY.min_force_interval_seconds);
  u.fail.set("/rosters", new SleeperResourceError("RATE_LIMITED", { status: 429, retryAfter: 120 }));
  const { failed } = await hintMatchesEligibility({ post, now, u, name: "rosters", path: "/rosters", mode: "manual", wait: 120, recover: () => u.fail.clear() });
  assert.equal(failed.snapshot.coverage.freshness.resources.rosters.error.retry_after_seconds, 120);
  // Due mode honours the same Retry-After.
  const v = upstream(), later = clock(), due = refreshCaller(v, later);
  await due("due"); later.advance(REFRESH_POLICY.stale_after_seconds.dynamic);
  v.fail.set("/rosters", new SleeperResourceError("RATE_LIMITED", { status: 429, retryAfter: 120 }));
  assert.equal((await due("due")).retry_after_seconds, 120);
});

test("Codex delta 2E: with one failed core source, the hint follows that blocker, not the held not_promoted candidates", async () => {
  // Failed catalog (30 s backoff) + fetched rosters/state held back: the 10 s roster cooldown must not set the hint.
  const u = upstream(), now = clock(), post = refreshCaller(u, now);
  await post(); now.advance(DAY); u.rosters = moved(); u.exact.set("/players/nfl", new Error("outage"));
  const held = await post();
  assert.equal(held.snapshot.coverage.freshness.resources.rosters.last_attempt_status, "not_promoted");
  assert.equal(held.status, "failed"); assert.equal(held.retry_after_seconds, BACKOFF);
  now.advance(REFRESH_POLICY.min_force_interval_seconds);
  const mid = await post();
  assert.equal(mid.retry_after_seconds, BACKOFF - REFRESH_POLICY.min_force_interval_seconds, "rosters being re-fetchable does not make recovery ready");
  now.advance(BACKOFF - REFRESH_POLICY.min_force_interval_seconds); u.exact.clear();
  const ok = await post(); assert.equal(ok.status, "ok"); assert.notEqual(ok.input_revision, held.input_revision); assert.deepEqual(ok.unresolved, []);
  // Inverse: failed rosters + a fresh catalog candidate held back: rosters' 10 s cooldown drives it, not the catalog.
  const v = upstream(), t = clock(), call = refreshCaller(v, t);
  await call(); t.advance(DAY); v.exact.set("/players/nfl", await newCatalog()); v.fail.set("/rosters", new Error("outage"));
  const blocked = await call();
  assert.equal(blocked.snapshot.coverage.freshness.resources.players.last_attempt_status, "not_promoted");
  assert.equal(blocked.retry_after_seconds, REFRESH_POLICY.min_force_interval_seconds);
  // Several failed core sources: recovery waits for the last one to become eligible.
  const w = upstream(), c = clock(), both = refreshCaller(w, c);
  await both(); c.advance(DAY); w.exact.set("/players/nfl", new Error("outage")); w.fail.set("/rosters", new Error("outage"));
  assert.equal((await both()).retry_after_seconds, BACKOFF);
});
