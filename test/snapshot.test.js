import test from "node:test";
import assert from "node:assert/strict";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { compactSnapshot } from "../lib/compact.js";
import { handleSnapshotRequest } from "../lib/snapshot-api.js";
import { fixtureFetch } from "./fixtures.js";

test("compact v0.2 retains analysis fields and resolves every player reference", async () => {
  const full = await buildLeagueSnapshot("A", { fetchData: fixtureFetch(), freeAgentLimit: 35 });
  const compact = compactSnapshot(full);
  assert.equal(compact.schema_version, "0.2");
  assert.deepEqual(compact.league, full.league);
  assert.equal(compact.my_roster_id, 1);
  assert.equal(compact.rosters.length, 2);
  assert.deepEqual(compact.rosters[0].starters, [{ slot: "RB", player_id: "2" }, { slot: "FLEX", player_id: null }]);
  assert.deepEqual(compact.rosters[0].bench, ["1"]);
  assert.deepEqual(compact.rosters[0].ir, ["3"]);
  assert.deepEqual(compact.rosters[0].taxi, ["4"]);
  assert.equal(compact.rosters[0].waiver_budget_used, 0);
  assert.equal(compact.rosters[0].waiver_position, 0);
  assert.equal(compact.rosters[0].settings.fpts_decimal, 25);
  assert.deepEqual(compact.standings, full.standings);
  assert.deepEqual(compact.current_matchups, full.current_matchups);
  assert.equal(compact.matchup_week, 3);
  assert.ok(compact.players["7"]);
  assert.equal(compact.recent_transactions.length, 1);
  assert.equal(compact.recent_transactions[0].waiver_bid, 0);
  assert.deepEqual(compact.recent_transactions[0].draft_picks, full.recent_transactions[0].draft_picks);
  assert.deepEqual(compact.recent_transactions[0].waiver_budget, full.recent_transactions[0].waiver_budget);
  assert.deepEqual(compact.truncation.free_agents.RB, { total: 60, returned: 35, omitted: 25, limit: 35 });
  assert.deepEqual(compact.coverage.transaction_weeks, [2, 3]);
  assert.equal(compact.partial, false);
  const refs = [...compact.free_agents.RB.map(p => p.player_id), ...compact.trending_available.map(p => p.player_id),
    ...compact.rosters.flatMap(r => [...r.starters.map(s => s.player_id), ...r.bench, ...r.ir, ...r.taxi]),
    ...compact.recent_transactions.flatMap(tx => [...tx.adds, ...tx.drops].map(p => p.player_id))].filter(Boolean);
  refs.forEach(id => assert.ok(compact.players[id], id));
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)) * 0.8);
});

test("optional outages are explicit; core outages fail rather than invent data", async () => {
  const full = await buildLeagueSnapshot("A", { fetchData: fixtureFetch({ fail: ["/trending/", "/transactions/2", "/matchups/"] }) });
  assert.equal(full.partial, true);
  assert.equal(full.warnings.length, 3);
  assert.equal(full.recent_transactions.length, 1);
  assert.deepEqual(compactSnapshot(full).warnings, full.warnings);
  await assert.rejects(buildLeagueSnapshot("A", { fetchData: fixtureFetch({ fail: ["/rosters"] }) }), /outage/);
});

test("old-season leagues do not masquerade as current-week matchups", async () => {
  const full = await buildLeagueSnapshot("A", { fetchData: fixtureFetch({ season: "2025" }) });
  assert.equal(full.matchup_week, null);
  assert.deepEqual(full.current_matchups, []);
  assert.ok(full.warnings.some(w => w.code === "SEASON_MISMATCH"));
});

test("transaction truncation counts unique records and missing identities are flagged", async () => {
  const base = fixtureFetch();
  const fetchData = async path => {
    if (path.includes("/transactions/")) return Array.from({ length: 45 }, (_, i) => ({ transaction_id: String(i), status: "complete", type: "free_agent", created: i, adds: { MISSING: 1 } }));
    return base(path);
  };
  const full = await buildLeagueSnapshot("A", { fetchData });
  assert.deepEqual(full.truncation.recent_transactions, { total: 45, returned: 40, omitted: 5, limit: 40 });
  assert.equal(full.recent_transactions[0].transaction_id, "44");
  assert.ok(full.warnings.some(w => w.code === "MISSING_PLAYER_METADATA"));
  assert.equal(compactSnapshot(full).players.MISSING.name, "MISSING");
});

test("API handles default compact, full, all, invalid league and upstream errors", async () => {
  const options = { leagueIds: ["A", "B"], buildSnapshot: (id, opts) => buildLeagueSnapshot(id, { ...opts, fetchData: fixtureFetch() }) };
  const request = query => new Request(`http://localhost/api/snapshot${query}`);
  for (const [query, view] of [["", "compact"], ["?league=A&compact=0", "full"]]) {
    const response = await handleSnapshotRequest(request(query), options);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /s-maxage=30/);
    assert.equal((await response.json()).view, view);
  }
  const all = await handleSnapshotRequest(request("?league=all"), options);
  assert.deepEqual((await all.json()).leagues.map(s => s.league.league_id), ["A", "B"]);
  assert.equal((await handleSnapshotRequest(request("?league=unknown"), options)).status, 400);
  const failure = await handleSnapshotRequest(request("?league=A"), { ...options, buildSnapshot: async () => { throw new Error("outage"); } });
  assert.equal(failure.status, 502);
  assert.equal(failure.headers.get("cache-control"), null);
});
