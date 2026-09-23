import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerCache } from "../lib/sources/sleeper/player-cache.js";
test("large player catalog requests coalesce, expire and retry after errors", async () => {
  const cache = createPlayerCache(100), catalog = { a: { position: "RB" } };
  let calls = 0;
  const loader = async () => { calls++; return catalog; };
  const [a, b] = await Promise.all([cache(loader, 0), cache(loader, 1)]);
  assert.equal(calls, 1); assert.equal(a, b);
  await cache(loader, 50); assert.equal(calls, 1);
  await cache(loader, 101); assert.equal(calls, 2);
  await assert.rejects(cache(async () => { throw new Error("outage"); }, 202), /outage/);
  await cache(loader, 203); assert.equal(calls, 3);
  await assert.rejects(cache(async () => [], 500), /Invalid player catalog/);
  assert.equal(await cache(loader, 501), catalog);
});
