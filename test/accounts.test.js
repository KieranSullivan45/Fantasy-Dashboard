import test from "node:test";
import assert from "node:assert/strict";
import { discoverSleeper, resolveSeason } from "../lib/accounts/sleeper.js";
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { fixtureFetch } from "./fixtures.js";
import { decisionBasis } from "../lib/decision/basis.js";
test("username discovery retains stable identity, handles rename, multiple leagues and future seasons", async () => {
  const calls = [], fetcher = async path => { calls.push(path);
    if (path === "/state/nfl") return { season: "2026" };
    if (path.startsWith("/user/") && !path.includes("/leagues/")) return { user_id: "123456789", username: "renamed" };
    return Array.from({ length: 4 }, (_, i) => ({ league_id: String(1000000 + i), season: "2027", sport: "nfl", name: `League ${i}` }));
  };
  const result = await discoverSleeper({ username: "oldname", season: 2027 }, fetcher);
  assert.equal(result.account.provider_user_id, "123456789"); assert.equal(result.leagues.length, 4);
  assert.ok(calls.includes("/user/123456789/leagues/nfl/2027"));
  assert.equal(resolveSeason(null, { season: "2028" }, new Date("2028-02-01")), 2028);
  await assert.rejects(() => discoverSleeper({ username: "bad/path" }, fetcher));
});
test("direct league mode is spectator; explicit roster and different users cannot collide", async () => {
  const base = fixtureFetch(), fetchData = async path => {
    if (path === "/user/second") return { user_id: "other" };
    if (path.endsWith("/rosters")) return [...await base(path), { roster_id: 3, owner_id: null, players: [] }];
    return base(path);
  };
  const first = await buildLeagueSnapshot("A", { fetchData, userId: "first" });
  const second = await buildLeagueSnapshot("A", { fetchData, userId: "second" });
  const spectator = await buildLeagueSnapshot("A", { fetchData, userId: null });
  const selected = await buildLeagueSnapshot("A", { fetchData, userId: null, rosterId: 2 });
  assert.equal(first.my_roster.roster_id, 1); assert.equal(second.my_roster.roster_id, 2);
  assert.equal(spectator.my_roster, null); assert.ok(spectator.rosters.every(r => !r.is_user));
  assert.equal(selected.my_roster.roster_id, 2); assert.notEqual(decisionBasis(first), decisionBasis(second));
  await assert.rejects(() => buildLeagueSnapshot("A", { fetchData, userId: null, season: 2027 }), /another season/);
  await assert.rejects(() => buildLeagueSnapshot("A", { fetchData, userId: null, rosterId: 99 }), /does not exist/);
  const direct = await discoverSleeper({ leagueId: "123456789" }, async path => path === "/state/nfl" ? { season: "2026" } : { league_id: "123456789", season: "2025", sport: "nfl" });
  assert.equal(direct.mode, "spectator"); assert.equal(direct.season, 2025);
});
