import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTrade, evaluateTradeFromInputs } from "../lib/trade/evaluate.js";
import { validateTradeEvaluation } from "../lib/trade/contracts.js";
import { built, leagueFixture, offer, player, sideOf, syntheticInputs } from "./trade-fixtures.js";

// Independent legality oracle for the slots used in these synthetic fixtures.
const eligible = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  LB: ["LB"], FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
const forbidden = ["fairness", "fairness_score", "trade_score", "combined_score", "winner", "loser", "verdict",
  "acceptance_probability", "accept_probability", "net_roster_improvement"];

function outputSafety(result) {
  assert.equal(result.market_value, null);
  assert.equal(result.legality, "conditional_known_rules");
  assert.ok(result.legality_limitations.length);
  const visit = value => {
    if (typeof value === "number") assert.ok(Number.isFinite(value));
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.includes(key), key); visit(child); }
  };
  visit(result);
  assert.deepEqual(validateTradeEvaluation(result), { ok: true, violations: [] });
  if (["invalid", "unsupported"].includes(result.status)) assert.deepEqual(result.sides, []);
}

function legalState(state, context) {
  assert.ok(state.lineup);
  const assigned = state.lineup.filter(s => s.player_id !== null);
  assert.equal(new Set(assigned.map(s => s.player_id)).size, assigned.length, "one player occupies one slot");
  assert.equal(assigned.length, state.filled_starter_slots);
  for (const slot of assigned) {
    const p = context.rosters.flatMap(r => r.players).find(p => p.player_id === slot.player_id);
    assert.ok(eligible[slot.slot].some(pos => p.fantasy_positions.includes(pos)), `${p.player_id} cannot fill ${slot.slot}`);
  }
}

for (const format of ["superflex-te-premium", "full-ppr"]) {
  for (const [a, b] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    test(`SYNTHETIC ${format}: ${a}-for-${b} legal package and safe output`, () => {
      const { inputs, label } = leagueFixture(format), context = built(inputs);
      assert.match(label, /SYNTHETIC/);
      assert.equal(context.rosters.length, format === "full-ppr" ? 12 : 10);
      assert.equal(context.league.team_count, context.rosters.length);
      const sends = ["r1_bench1", "r1_bench2"].slice(0, a), receives = ["r2_bench1", "r2_bench2"].slice(0, b);
      const proposal = offer(sends, receives), saved = structuredClone({ context, proposal });
      const result = evaluateTrade(context, proposal);
      assert.equal(result.status, "evaluated", JSON.stringify(result.errors));
      outputSafety(result);
      assert.deepEqual({ context, proposal }, saved, "evaluation must not mutate inputs");
      assert.deepEqual(sideOf(result).sends, sends);
      assert.deepEqual(sideOf(result).receives, receives);
      for (const side of result.sides) {
        legalState(side.before, context); legalState(side.after, context);
        assert.equal(side.after.lineup.filter(s => s.player_id?.endsWith("_dual")).length, 1);
        assert.ok(side.after.active_count <= side.after.active_capacity);
        assert.equal(side.forced_drops.required, Math.max(0, side.receives.length - side.sends.length));
        if (side.forced_drops.required) assert.equal(side.forced_drops.dropped.length, 1);
        const remaining = new Set([...side.after.lineup.map(s => s.player_id), ...side.after.bench]);
        side.sends.forEach(id => assert.ok(!remaining.has(id)));
        (side.forced_drops.dropped ?? []).forEach(id => assert.ok(!remaining.has(id)));
      }
      const reversed = structuredClone(proposal); reversed.sides.reverse();
      assert.deepEqual(evaluateTrade(context, reversed), result, "proposal side order is immaterial");
    });
  }
}

const badPackages = [
  ["empty side", p => { p.sides[0].sends = []; }, "EMPTY_SIDE", "unsupported"],
  ["three assets", p => { p.sides[0].sends = ["r1_bench1", "r1_bench2", "r1_bench3"].map(id => ({ type: "player", id })); }, "PACKAGE_TOO_LARGE", "unsupported"],
  ["three rosters", p => { p.sides.push({ roster_id: 3, sends: [{ type: "player", id: "r3_bench1" }] }); }, "UNSUPPORTED_TRADE_SHAPE", "unsupported"],
  ["same roster", p => { p.sides[1] = { roster_id: "1", sends: [{ type: "player", id: "r1_bench2" }] }; }, "SAME_ROSTER", "invalid"],
  ["duplicate within side", p => { p.sides[0].sends.push({ ...p.sides[0].sends[0] }); }, "DUPLICATE_ASSET", "invalid"],
  ["duplicate across sides", p => { p.sides[1].sends = [...p.sides[0].sends]; }, "DUPLICATE_ASSET", "invalid"],
  ["asset not owned", p => { p.sides[0].sends[0].id = "r3_bench1"; }, "ASSET_NOT_OWNED", "invalid"],
  ["unknown roster", p => { p.sides[0].roster_id = 999; }, "UNKNOWN_ROSTER", "invalid"],
  ["draft pick", p => { p.sides[0].sends = [{ type: "draft_pick", id: "synthetic-2027-1" }]; }, "UNSUPPORTED_ASSET", "unsupported"],
  ["FAAB", p => { p.sides[1].sends = [{ type: "faab", amount: 5 }]; }, "UNSUPPORTED_ASSET", "unsupported"],
];
for (const [name, mutate, code, status] of badPackages) test(`${name}: reject the whole package before valuation`, () => {
  const context = built(leagueFixture("full-ppr").inputs), proposal = offer(["r1_bench1"], ["r2_bench1"]);
  mutate(proposal);
  const result = evaluateTrade(context, proposal);
  assert.equal(result.status, status);
  assert.ok(result.errors.some(e => e.code === code));
  assert.deepEqual(result.sides, []);
  outputSafety(result);
});

test("Superflex: second QB fills SUPER_FLEX, stays protected, and dual VOR counts only once", () => {
  const context = built(leagueFixture("superflex-te-premium").inputs);
  const result = evaluateTrade(context, offer(["r1_bench1"], ["r2_bench1", "r2_bench2"])), side = sideOf(result);
  assert.equal(result.status, "evaluated");
  assert.equal(side.after.lineup.find(s => s.slot === "SUPER_FLEX").player_id, "r1_q2");
  assert.equal(side.before.starter_total, 125, "24+18+15+10+16+12+17+13; no new scarcity weight");
  assert.ok(side.forced_drops.excluded.some(p => p.player_id === "r1_q2" && p.reasons.includes("Structural Superflex QB asset")));
  assert.ok(!side.forced_drops.candidates.includes("r1_q2"));
  assert.equal(context.values.r1_dual.vor, 9, "quality 14 minus RB replacement 5, not RB+WR VOR");
  assert.equal(context.values.r1_dual.vor_position, "RB");
  assert.equal(side.before.positions.QB.eligible_starter_demand, 2);
});

test("TE premium uses supplied points exactly; toggling a label adds no weight", () => {
  const context = built(leagueFixture("superflex-te-premium").inputs), p = offer(["r1_bench1"], ["r2_bench1"]);
  const normal = evaluateTrade(context, p), tagged = structuredClone(context);
  tagged.league.scoring_profile.te_premium = false;
  assert.deepEqual(evaluateTrade(tagged, p), normal);
  const raised = structuredClone(context); raised.values.r1_te.next_game += 4;
  const side = sideOf(evaluateTrade(raised, p));
  assert.equal(side.before.starter_total, sideOf(normal).before.starter_total + 4);
  assert.equal(side.before.lineup.find(s => s.slot === "TE").value, 21);
});

test("equal-value optimizer choices survive roster, value-map and proposal permutations", () => {
  const inputs = syntheticInputs({ slots: ["RB", "WR", "FLEX", "BN", "BN"], rosters: [
    [player("Z-dual", ["RB", "WR"], 10, { quality: 8 }), player("a-dual", ["RB", "WR"], 10, { quality: 17 }),
      player("rb", "RB", 10), player("wr", "WR", 10), player("send", "TE", 1)],
    [player("receive", "TE", 1)],
  ] });
  const context = built(inputs), p = offer(["send"], ["receive"]), expected = evaluateTrade(context, p);
  for (let offset = 0; offset < 5; offset++) {
    const c = structuredClone(context), list = c.rosters[0].players;
    c.rosters[0].players = [...list.slice(offset), ...list.slice(0, offset)].reverse();
    c.values = Object.fromEntries(Object.entries(c.values).reverse()); c.protection.reverse(); c.rosters.reverse();
    const reversed = structuredClone(p); reversed.sides.reverse();
    assert.deepEqual(evaluateTrade(c, reversed), expected);
  }
  legalState(sideOf(expected).before, context);
});

test("dedicated K/DEF/IDP count for legal fill, stay null, and allow determined offensive change", () => {
  const slots = ["WR", "K", "DEF", "LB", "BN"];
  const roster = (prefix, start) => [player(`${prefix}-wr`, "WR", start),
    ...["K", "DEF", "LB"].map(pos => player(`${prefix}-${pos}`, pos, null, { quality: null, supported: false }))];
  const context = built(syntheticInputs({ slots, rosters: [roster("a", 8), roster("b", 13)] }));
  const result = evaluateTrade(context, offer(["a-wr"], ["b-wr"])), side = sideOf(result);
  assert.equal(result.status, "evaluated"); assert.equal(side.starter_change, 5);
  for (const state of [side.before, side.after]) {
    assert.equal(state.filled_starter_slots, 4);
    for (const slot of state.lineup.filter(s => ["K", "DEF", "LB"].includes(s.slot))) {
      assert.equal(slot.value, null); assert.equal(slot.valued, false);
    }
    assert.deepEqual(state.bench, []);
  }
  for (const slot of ["K", "DEF", "LB"]) {
    assert.ok(side.warnings.some(w => w.includes(slot)));
    assert.ok(side.unknowns.some(u => u.slots?.includes(slot)));
    const unsupported = evaluateTrade(context, offer([`a-${slot}`], ["b-wr"]));
    assert.equal(unsupported.status, "unsupported");
    assert.ok(unsupported.errors.some(e => e.code === "UNSUPPORTED_ASSET")); outputSafety(unsupported);
  }
  outputSafety(result);
});

test("a modeled/unsupported dual-slot player cannot be guessed into an ambiguous lineup", () => {
  const context = built(syntheticInputs({ slots: ["WR", "LB", "BN", "BN"], rosters: [
    [player("hybrid", ["WR", "LB"], 50), player("ordinary", "WR", 10), player("send", "TE", 3)],
    [player("receive", "TE", 4)],
  ] }));
  const side = sideOf(evaluateTrade(context, offer(["send"], ["receive"])));
  assert.equal(side.before.filled_starter_slots, 2);
  assert.equal(side.before.lineup, null); assert.equal(side.after.lineup, null);
  assert.equal(side.starter_change, null); assert.equal(side.depth_change, null);
  assert.ok(side.unknowns.length);
});

test("unsupported modeled asset is rejected even when a finite input value exists", () => {
  const { inputs } = leagueFixture("full-ppr"); inputs.valueSource.contexts.r1_bench1.model.supported = false;
  const result = evaluateTradeFromInputs(inputs, offer(["r1_bench1"], ["r2_bench1"]));
  assert.equal(result.status, "unsupported"); assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_ASSET"));
  outputSafety(result);
});

for (const horizon of ["rest_of_season", "dynasty", "multi_week", "three_week"]) test(`${horizon} never produces partial valuation`, () => {
  const result = evaluateTradeFromInputs(leagueFixture("full-ppr").inputs, offer(["r1_bench1"], ["r2_bench1"], horizon));
  assert.equal(result.status, "unsupported");
  assert.ok(result.errors.some(e => e.code === "UNSUPPORTED_HORIZON")); outputSafety(result);
});

test("over-capacity-before remains withheld, diagnostic, unvalued after, and uses a contracted drop status", () => {
  const inputs = syntheticInputs({ slots: ["WR", "BN"], rosters: [
    [player("a", "WR", 10), player("b", "WR", 8), player("extra", "WR", 5)], [player("in", "WR", 9)],
  ] });
  const result = evaluateTradeFromInputs(inputs, offer(["b"], ["in"])), side = sideOf(result);
  assert.equal(result.status, "withheld");
  assert.ok(result.errors.some(e => e.code === "OVER_CAPACITY_BEFORE"));
  assert.equal(side.after, null); assert.equal(side.starter_change, null); assert.equal(side.depth_change, null);
  assert.equal(side.forced_drops.dropped, null); assert.ok(side.forced_drops.diagnostics.length);
  // docs/v0.4.md TradeEvaluation declares these four states; null is not one.
  assert.ok(["none", "selected", "blocked", "undetermined"].includes(side.forced_drops.status),
    `forced_drops.status must use the approved enum; observed ${JSON.stringify(side.forced_drops.status)}`);
});

test("spectator and explicit selected roster preserve identity without inferring ownership", () => {
  const { inputs } = leagueFixture("full-ppr");
  assert.deepEqual(built(inputs).identity, { mode: "spectator", roster_id: null });
  inputs.snapshot.identity = { ...inputs.snapshot.identity, mode: "selected_roster", selected_roster_id: 2 };
  for (const meta of [inputs.valueSource.metadata, inputs.protectionEvidence.metadata]) {
    meta.identity_mode = "selected_roster"; meta.selected_roster_id = 2;
  }
  assert.deepEqual(built(inputs).identity, { mode: "selected_roster", roster_id: 2 });
});
