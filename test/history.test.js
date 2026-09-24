import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observationId, captureObservations } from "../lib/history/contracts.js";
import { FileObservationStore, MemoryObservationStore } from "../lib/history/stores.js";
import { evaluateObservation } from "../lib/history/outcomes.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { decisionFixtureOptions } from "./decision-fixtures.js";
import { appendCapture } from "../lib/history/git-store.js";

test("Git archive retries preserve original bytes and repair an interrupted discovery index", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fantasy-capture-"));
  try {
    const decision = await buildDecisionContext("A", decisionFixtureOptions());
    const first = await appendCapture(directory, decision), bytes = await readFile(join(directory, first.path));
    decision.generated_at = "2026-09-23T00:10:00Z";
    assert.equal((await appendCapture(directory, decision)).created, false);
    await writeFile(join(directory, "index.json"), JSON.stringify({ captures: [] }));
    const retry = await appendCapture(directory, decision);
    assert.equal(retry.created, false); assert.equal(retry.generated_at, first.generated_at);
    assert.deepEqual(await readFile(join(directory, first.path)), bytes);
    assert.equal(JSON.parse(await readFile(join(directory, "index.json"))).captures.length, 1);
  } finally { await rm(directory, { recursive: true }); }
});
test("captured observations are deep immutable copies; unchanged refreshes deduplicate within six hours", async () => {
  const d = await buildDecisionContext("A", decisionFixtureOptions());
  const rows = captureObservations(d), first = rows[0], original = JSON.stringify(first);
  d.player_context[first.player_id].model.player_value = 999;
  assert.equal(JSON.stringify(first), original);
  assert.equal(observationId({ ...first, generated_at: "2026-09-23T00:10:00Z" }), first.observation_id);
  assert.notEqual(observationId({ ...first, generated_at: "2026-09-23T06:10:00Z" }), first.observation_id);
  assert.notEqual(observationId({ ...first, football_value: 999 }), first.observation_id);
  assert.equal(first.schema_version, "observation-1"); assert.ok(first.source_versions.length);
});
test("local and memory stores are idempotent, detached, traversal-safe and never overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fantasy-history-"));
  try { for (const store of [new MemoryObservationStore(), new FileObservationStore(directory)]) {
    const row = { generated_at: "2026-09-23T00:00:00Z", points: 3 }; row.observation_id = observationId(row);
    assert.equal(await store.appendIfAbsent(row.observation_id, row), true);
    row.points = 99; assert.equal(await store.appendIfAbsent(row.observation_id, row), false);
    assert.equal((await store.get(row.observation_id)).points, 3);
    await assert.rejects(() => store.get("../escape"));
  } } finally { await rm(directory, { recursive: true }); }
});
test("outcomes are separate, require post-observation games and available-at evidence", () => {
  const observation = { observation_id: "a", player_id: "p", season: 2026, generated_at: "2026-09-23" };
  const g = { player_id: "p", season: 2026, game_id: "future", kickoff: "2026-09-27", completed_at: "2026-09-28", available_at: "2026-09-29", points: 20 };
  const before = JSON.stringify(observation);
  const result = evaluateObservation(observation, [g, { ...g, game_id: "past", kickoff: "2026-09-20" }, { ...g, game_id: "unpublished", available_at: "2026-10-10" }], { evaluatedAt: "2026-10-01" });
  assert.deepEqual(result.windows[1].games, ["future"]); assert.equal(result.windows[3].complete, false);
  assert.equal(JSON.stringify(observation), before);
});
