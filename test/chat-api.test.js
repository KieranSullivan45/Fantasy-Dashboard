import test from "node:test";
import assert from "node:assert/strict";
import { handleChatRequest } from "../lib/chat-api.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";
import { createDecisionService } from "../lib/decision-service.js";
test("machine routes return compact versioned JSON with provenance and validate queries", async () => {
  const d = await buildDecisionContext("A", decisionFixtureOptions());
  const options = { build: async () => d, configured: ["A"], state: async () => ({ season: 2026 }), archive: async () => ({ status: "available", data: { captures: [] } }) };
  for (const resource of ["model-meta", "league-summary", "waivers", "signals", "player", "matchup", "history"]) {
    const response = await handleChatRequest(new Request("http://localhost/api/chat/" + resource + "?league=A&player=65&limit=3"), resource, options);
    assert.equal(response.status, 200, resource); assert.match(response.headers.get("content-type"), /application\/json/);
    const text = await response.text(); assert.ok(text.length < 70000, `${resource}: ${text.length}`);
    const data = JSON.parse(text); assert.equal(data.schema_version, "chat-1"); assert.ok(data.generated_at); assert.ok("data_through_week" in data); assert.ok(Array.isArray(data.warnings));
  }
  for (const query of ["limit=999", "offset=-1", "user=bad/path", "unknown=1", "week=99", "user=111111&user=222222"]) assert.equal((await handleChatRequest(new Request(`http://localhost?league=A&${query}`), "waivers", options)).status, 400);
  assert.equal((await handleChatRequest(new Request("http://localhost?league=A&player=missing"), "player", options)).status, 404);
});
test("coalesced decision cache is isolated by stable user, roster and season", async () => {
  let calls = 0; const service = createDecisionService(async (league, opts) => ({ call: ++calls, league, ...opts.identity }));
  const one = await service("L", { identity: { userId: "one", season: 2026 } });
  assert.equal((await service("L", { identity: { userId: "one", season: 2026 } })).call, one.call);
  assert.notEqual((await service("L", { identity: { userId: "two", season: 2026 } })).call, one.call);
  assert.notEqual((await service("L", { identity: { userId: "one", season: 2027 } })).call, one.call);
  assert.notEqual((await service("L", { identity: { userId: "one", season: 2026, rosterId: 2 } })).call, one.call);
  assert.notEqual((await service("L")).call, (await service("L", { identity: { userId: null } })).call);
});
