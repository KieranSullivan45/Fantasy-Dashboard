// EDGE-RANK-01 research harness tests (synthetic data only): lineup-draft parity with EDGE-01, legal lineups, walk-forward
// isolation, no betting-derived candidate inputs, fallback behaviour.
import test from "node:test";
import assert from "node:assert/strict";
import { draftLeagues as edge01Draft } from "../lib/research/edge01/lineup.js";
import { STRUCTURES, draftLeagues, lineup, simulate } from "../lib/research/edgerank01/lineup.js";
import { CANDIDATES, BASELINES, gridFold, selectParams, fitLinear, withFallback } from "../lib/research/edgerank01/candidates.js";

const POS = ["QB", "RB", "WR", "TE"];
function synthCases(season, week, n = 200, seed = 1) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return Array.from({ length: n }, (_, i) => {
    const position = POS[i % 4], Q = 4 + r() * 16, snap = 0.2 + r() * 0.8;
    return { season, week, player_id: `p${i}`, position, rosterable: i < n / 2,
      inputs: { Q, S: Q + r(), R3: Q + r() * 2 - 1, n: 4, prod: Q, noX: Q, ewall: { 16: Q + r() - 0.5 },
        opp: { metrics: { vip: { last2: Q, season: Q }, snap_share: { last2: snap, season: snap } } } },
      outcome: { actual: Q * 0.8 + snap * 4 + r() * 4 } };
  });
}

test("standard structure seed 0 drafts exactly the EDGE-01 rosters", () => {
  const cases = synthCases(2024, 5, 240);
  const a = edge01Draft(cases, 202405).map(t => t.map(c => c.player_id));
  const b = draftLeagues(cases, 202405, STRUCTURES.standard_1qb).map(t => t.map(x => x.c.player_id));
  assert.deepEqual(b, a);
});

test("lineups are legal: every slot filled, one player per slot, eligibility respected", () => {
  const cases = synthCases(2024, 6, 240);
  for (const [name, st] of Object.entries(STRUCTURES)) {
    for (const roster of draftLeagues(cases, 7, st).slice(0, 5)) {
      const lu = lineup(roster, st.slots, Object.fromEntries(roster.map(x => [x.c.player_id, x.c.inputs.Q])));
      assert.ok(lu, name); assert.equal(lu.length, st.slots.length);
      assert.equal(new Set(lu.map(s => s.player_id)).size, lu.length);
      for (const s of lu) {
        const pos = roster.find(x => x.c.player_id === s.player_id).positions;
        const ok = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], SUPER_FLEX: POS }[s.slot];
        assert.ok(pos.some(p => ok.includes(p)), `${name} ${s.slot}`);
      }
    }
  }
});

test("walk-forward fits never read the test or selection season outcomes", () => {
  const cases = {}; for (let s = 2016; s <= 2020; s++) cases[s] = synthCases(s, 5, 120, s);
  const y = c => c.outcome.actual;
  const before = gridFold(CANDIDATES.P5_ew_r3_snap, cases, 2020, y);
  for (const c of [...cases[2019], ...cases[2020]]) c.outcome.actual = 999;
  const after = gridFold(CANDIDATES.P5_ew_r3_snap, cases, 2020, y);
  for (const p of POS) assert.deepEqual(after[p][0].model.coef, before[p][0].model.coef);
});

test("no candidate or non-control baseline reads xFP; production controls are labelled betting-derived", () => {
  const all = { ...BASELINES, ...CANDIDATES };
  for (const [id, spec] of Object.entries(all)) {
    const uses = (spec.features || []).filter(f => typeof f === "string");
    if (uses.includes("prod") || id === "prod") assert.equal(spec.betting_derived, true, id);
    else assert.equal(spec.betting_derived, false, id);
    assert.ok(!uses.some(f => /xfp|^X/i.test(f)), id);
  }
});

test("missing inputs fall back to noX and are never zero-filled in fits", () => {
  const c = synthCases(2024, 5, 4)[0]; c.inputs.opp.metrics.snap_share.last2 = null;
  assert.equal(withFallback(null, c), c.inputs.noX);
  const train = synthCases(2023, 5, 80); train.forEach((x, i) => { if (i % 2) x.inputs.opp.metrics.snap_share.last2 = null; });
  const model = fitLinear(CANDIDATES.P1_q_snap, train.filter(x => x.position === "WR"), 0, x => x.outcome.actual);
  assert.equal(model.n, train.filter(x => x.position === "WR" && x.inputs.opp.metrics.snap_share.last2 !== null).length);
});

test("objective selection returns one shared parameter when a joint (lineup) scorer is used", () => {
  const cases = {}; for (let s = 2016; s <= 2020; s++) cases[s] = synthCases(s, 5, 120, s);
  const grid = gridFold(CANDIDATES.C_ridge7, cases, 2020, c => c.outcome.actual);
  const choice = selectParams(grid, { jointScore: sel => [...sel.values()].length });
  assert.equal(new Set(POS.map(p => choice[p].param)).size, 1);
  assert.ok(simulate(new Map([["2020:5", synthCases(2020, 5, 240)]]), { q: c => c.inputs.Q }, STRUCTURES.standard_1qb).length > 0);
});
