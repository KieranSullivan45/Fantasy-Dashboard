import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotLoader } from "../lib/snapshot-loader.js";

function setup() {
  const pending = [], states = [];
  const loader = createSnapshotLoader(s => states.push(s), (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })));
  const complete = (index, league, ok = true) => pending[index].resolve({ ok, json: async () => ({ league: { league_id: league }, error: "failed" }) });
  return { loader, pending, states, complete };
}

test("new league wins over late success, error, and loading updates", async () => {
  for (const fail of [false, true]) {
    const s = setup();
    const a = s.loader.load("A"), b = s.loader.load("B");
    assert.equal(s.pending[0].options.signal.aborted, true);
    s.complete(1, "B"); await b;
    const before = s.states.length;
    if (fail) s.pending[0].reject(new Error("old failure")); else s.complete(0, "A");
    await a;
    assert.equal(s.states.length, before);
    assert.equal(s.states.at(-1).data.league.league_id, "B");
  }
});

test("A to B to A and overlapping refreshes use the latest request", async () => {
  const s = setup();
  const requests = [s.loader.load("A"), s.loader.load("B"), s.loader.load("A"), s.loader.load("A")];
  s.complete(3, "A"); await requests[3];
  const before = s.states.length;
  for (const [i, id] of ["A", "B", "A"].entries()) s.complete(i, id);
  await Promise.all(requests);
  assert.equal(s.states.length, before);
});

test("cleanup suppresses updates and wrong-league responses become errors", async () => {
  const s = setup();
  const request = s.loader.load("A"); s.loader.cancel();
  s.complete(0, "A"); await request;
  assert.equal(s.states.length, 1);
  const next = s.loader.load("B"); s.complete(1, "A"); await next;
  assert.match(s.states.at(-1).error, /mismatch/);
  assert.equal(s.states.at(-1).loading, false);
});

test("a superseded response still parsing JSON cannot publish", async () => {
  let finishJson;
  const s = setup();
  const a = s.loader.load("A");
  s.pending[0].resolve({ ok: true, json: () => new Promise(resolve => { finishJson = resolve; }) });
  await Promise.resolve();
  const b = s.loader.load("B"); s.complete(1, "B"); await b;
  finishJson({ league: { league_id: "A" } }); await a;
  assert.equal(s.states.at(-1).data.league.league_id, "B");
});
