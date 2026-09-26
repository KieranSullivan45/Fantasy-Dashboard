import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { evaluateTrade, evaluateTradeFromInputs, resolveForcedDrops } from "../lib/trade/evaluate.js";
import { buildTradeContext } from "../lib/trade/context.js";
import { compareContextMetadata, effectiveProtection, validateTradeEvaluation, tradeError } from "../lib/trade/contracts.js";
import { dropProtections, transactionEvaluator } from "../lib/decision/add-drop.js";
import { built, leagueFixture, offer, player, reserveInputs, sideOf, syntheticInputs, twoDropInputs } from "./trade-fixtures.js";

const twoDropOffer = () => offer(["outgoing-ir"], ["incoming-C", "incoming-D"]);
const reserveOffer = () => offer(["send"], ["incoming-A", "incoming-B"]);
const errorCode = (result, code) => assert.ok(result.errors.some(e => e.code === code), `${code}: ${JSON.stringify(result.errors)}`);
function withheldSide(result, state, roster = 1) {
  const side = sideOf(result, roster);
  assert.equal(side.forced_drops.status, state);
  assert.equal(side.forced_drops.dropped, null); assert.equal(side.after, null);
  assert.equal(side.starter_change, null); assert.equal(side.depth_change, null);
  assert.ok(side.forced_drops.diagnostics.length);
  assert.deepEqual(validateTradeEvaluation(result), { ok: true, violations: [] });
  return side;
}

test("filled-slot count beats higher raw points from dropping a negative-value starter", () => {
  const inputs = syntheticInputs({ slots: ["WR", "TE", "BN"], rosters: [
    [player("anchor", "WR", 20), player("negative-te", "TE", -5), player("send", "WR", 1)],
    [player("receive-C", "WR", 8, { quality: 8 }), player("receive-D", "WR", 9, { quality: 12 })],
  ] });
  const side = sideOf(evaluateTradeFromInputs(inputs, offer(["send"], ["receive-C", "receive-D"])));
  assert.equal(side.forced_drops.evaluated_combinations, 4);
  assert.deepEqual(side.forced_drops.dropped, ["receive-C"]);
  assert.equal(side.after.filled_starter_slots, 2);
  assert.equal(side.after.starter_total, 15);
  assert.equal(side.after.lineup.find(s => s.slot === "TE").value, -5);
  assert.ok(20 > side.after.starter_total, "dropping the only TE would yield 20 points but one empty slot");
});

test("all ten legal k=2 combinations are considered; a hand-enumerated oracle chooses the best", () => {
  const context = built(twoDropInputs());
  const quality = { anchor: 20, "low-A": 8, "low-B": 9, "incoming-C": 13, "incoming-D": 14 };
  for (const [id, q] of Object.entries(quality)) { context.values[id].quality = q; context.values[id].vor = q - 7; }
  // Small independent oracle: exactly one WR slot; no optimizer or candidate comparator imports.
  const ids = Object.keys(quality), outcomes = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const dropped = [ids[i], ids[j]].sort(), left = ids.filter(id => !dropped.includes(id));
    const starter = left.reduce((best, id) => context.values[id].next_game > context.values[best].next_game ? id : best);
    outcomes.push({ dropped, total: context.values[starter].next_game,
      bench: left.filter(id => id !== starter).reduce((s, id) => s + Math.max(0, quality[id] - 7), 0) });
  }
  outcomes.sort((a, b) => b.total - a.total || b.bench - a.bench || (a.dropped.join("|") < b.dropped.join("|") ? -1 : 1));
  assert.equal(outcomes.length, 10); assert.deepEqual(outcomes[0].dropped, ["low-A", "low-B"]);
  const result = evaluateTrade(context, twoDropOffer()), side = sideOf(result);
  assert.equal(result.status, "evaluated"); assert.equal(side.forced_drops.required, 2);
  assert.equal(side.forced_drops.evaluated_combinations, outcomes.length);
  assert.deepEqual(side.forced_drops.dropped, outcomes[0].dropped);
  assert.equal(side.after.starter_total, outcomes[0].total); assert.equal(side.after.depth_total, outcomes[0].bench);
});

test("canonical UTF-16 dropped IDs break a complete k=2 tie independently of input order", () => {
  const inputs = syntheticInputs({ rosters: [
    [player("star", "WR", 30), player("10", "WR", 1), player("9", "WR", 1), player("out", "TE", 1, { taxi: true })],
    [player("Z", "WR", 1), player("a", "WR", 1)],
  ] });
  const c = built(inputs), p = offer(["out"], ["Z", "a"]), result = evaluateTrade(c, p);
  assert.deepEqual(sideOf(result).forced_drops.dropped, ["10", "9"]);
  c.rosters.forEach(r => r.players.reverse()); c.protection.reverse(); p.sides.forEach(s => s.sends.reverse());
  assert.deepEqual(evaluateTrade(c, p), result);
});

test("k > 2 is unsupported with no enumeration or truncation at the exposed resolver boundary", () => {
  const context = built(twoDropInputs());
  const result = resolveForcedDrops(context, [{ active: context.rosters[0].players.filter(p => p.roster_status === "active"),
    placement: {}, reserve_keys: [], k: 3 }]);
  assert.equal(result.status, "unsupported"); assert.equal(result.required, 3);
  assert.equal(result.selected, null); assert.equal(result.evaluated_combinations, 0);
  assert.ok(result.diagnostics.length);
  assert.equal(tradeError("UNSUPPORTED_DROP_COUNT").status, "unsupported");
});

function protectedDropInputs() {
  const protectedPlayer = (id, extra = {}) => player(id, "WR", 5,
    { features: { current_games: 0, prior: { ppg: null } }, ...extra });
  return syntheticInputs({ rosters: [
    [protectedPlayer("a"), protectedPlayer("b"), protectedPlayer("c"), protectedPlayer("out", { reserve: true })],
    [protectedPlayer("in1"), protectedPlayer("in2")],
  ] });
}
for (const missingCount of [0, 1, 2]) test(`k=2, protected roster with ${missingCount} insufficient records: blocked iff provable`, () => {
  const inputs = protectedDropInputs();
  inputs.protectionEvidence.players = inputs.protectionEvidence.players.filter(p => !["a", "b"].slice(0, missingCount).includes(p.player_id));
  const result = evaluateTradeFromInputs(inputs, offer(["out"], ["in1", "in2"]));
  const state = missingCount < 2 ? "blocked" : "undetermined";
  assert.equal(result.status, state === "blocked" ? "blocked" : "withheld");
  const side = withheldSide(result, state);
  assert.deepEqual(side.forced_drops.candidates, []);
  errorCode(result, state === "blocked" ? "FORCED_DROP_BLOCKED" : "FORCED_DROP_UNDETERMINED");
  assert.ok(sideOf(result, 2).after, "resolved counterparty diagnostics are retained");
});

test("missing protection does not become droppable even if known drops could fill capacity", () => {
  const inputs = twoDropInputs();
  inputs.protectionEvidence.players = inputs.protectionEvidence.players.filter(p => p.player_id !== "low-A");
  const result = evaluateTradeFromInputs(inputs, twoDropOffer());
  assert.equal(result.status, "withheld"); const side = withheldSide(result, "undetermined");
  assert.ok(side.forced_drops.candidates.length >= 2);
  assert.ok(!side.forced_drops.candidates.includes("low-A"));
  assert.ok(side.forced_drops.excluded.some(p => p.player_id === "low-A" && p.evidence === "insufficient"));
});

for (const kind of ["reserve", "taxi"]) {
  test(`verified ${kind}: equal lineup prefers zero drops even over more bench VOR`, () => {
    const result = evaluateTradeFromInputs(reserveInputs(kind), reserveOffer()), side = sideOf(result);
    assert.equal(result.status, "evaluated"); assert.equal(side.after.starter_total, 20);
    assert.equal(side.forced_drops.status, "none"); assert.equal(side.forced_drops.required, 0);
    assert.equal(side.forced_drops.dropped, null);
    assert.equal(side.reserve_placement.find(p => p.player_id === "incoming-A").placement, kind);
    assert.equal(side.after.depth_total, 19, "bench (8-7) + one incoming (25-7), not two incoming players");
  });
  for (const gap of ["eligibility", "capability", "slots"]) test(`${kind}: unverified ${gap} never permits placement`, () => {
    const inputs = reserveInputs(kind);
    if (gap === "eligibility") inputs.placement = {};
    if (gap === "capability") inputs.capabilities = {};
    if (gap === "slots") inputs.snapshot.league.settings = {};
    const result = evaluateTradeFromInputs(inputs, reserveOffer()), side = sideOf(result);
    assert.equal(result.status, "evaluated"); assert.equal(side.forced_drops.required, 1);
    assert.ok(side.reserve_placement.every(p => p.placement === "active"));
    assert.ok(side.reserve_placement.every(p => p.limitations.length)); assert.ok(side.warnings.length);
  });
  test(`${kind}: better modeled starting lineup may beat a zero-drop allocation`, () => {
    const side = sideOf(evaluateTradeFromInputs(reserveInputs(kind, { usable: true }), reserveOffer()));
    assert.equal(side.forced_drops.status, "selected"); assert.equal(side.forced_drops.required, 1);
    assert.equal(side.after.starter_total, 40); assert.equal(side.starter_change, 20);
    assert.equal(side.reserve_placement.find(p => p.player_id === "incoming-A").placement, "active");
  });
  test(`${kind}: two incoming players jointly share only one open slot; canonical placement resolves tie`, () => {
    const inputs = reserveInputs(kind, { both: true }), c = built(inputs), p = reserveOffer();
    const result = evaluateTrade(c, p), side = sideOf(result);
    assert.equal(side.forced_drops.status, "none"); assert.equal(side.after.active_count, 3);
    assert.deepEqual(side.reserve_placement.map(p => [p.player_id, p.placement]), [["incoming-A", kind], ["incoming-B", "active"]]);
    assert.equal(side.reserve_placement.filter(p => p.placement === kind).length, 1);
    assert.equal(side.forced_drops.evaluated_combinations, 4, "two eligible active drops plus two distinct reserve allocations");
    p.sides[1].sends.reverse(); c.rosters[1].players.reverse();
    assert.deepEqual(evaluateTrade(c, p), result);
  });
}

test("existing reserve/taxi occupants are not re-slotted to make extra room", () => {
  const inputs = syntheticInputs({ rosters: [
    [player("starter", "WR", 20), player("send", "WR", 3), player("bench", "WR", 2),
      player("kept-ir", "WR", 40, { reserve: true }), player("kept-taxi", "RB", 50, { taxi: true })],
    [player("receive", "WR", 4)],
  ] });
  const side = sideOf(evaluateTradeFromInputs(inputs, offer(["send"], ["receive"])));
  assert.equal(side.before.active_count, 3); assert.equal(side.after.active_count, 3);
  assert.equal(side.after.starter_total, 20);
  assert.ok(!JSON.stringify(side.after.lineup).includes("kept-"));
});

test("lineup-relevant unknown points preserve known fill and null all assignment-dependent values", () => {
  const inputs = syntheticInputs({ rosters: [
    [player("known", "WR", 15), player("unknown", "WR", null), player("send", "WR", 2)], [player("receive", "WR", 3)],
  ] });
  const side = sideOf(evaluateTradeFromInputs(inputs, offer(["send"], ["receive"])));
  for (const state of [side.before, side.after]) {
    assert.equal(state.filled_starter_slots, 1); assert.equal(state.lineup, null);
    assert.equal(state.starter_total, null); assert.equal(state.bench, null); assert.equal(state.depth_total, null);
  }
  assert.equal(side.starter_change, null); assert.equal(side.depth_change, null); assert.ok(side.unknowns.length);
});

for (const missing of ["next_game", "vor"]) test(`unknown ${missing} that can change drop ordering yields undetermined`, () => {
  const c = built(twoDropInputs()); c.values["low-A"][missing] = null;
  const result = evaluateTrade(c, twoDropOffer());
  assert.equal(result.status, "withheld"); withheldSide(result, "undetermined");
});

function depthInputs({ start = 3, quality = null } = {}) {
  return syntheticInputs({ slots: ["WR", "BN", "BN", "BN"], rosters: [
    [player("star", "WR", 20), player("unknown", "WR", start, { quality }), player("send", "WR", 2, { quality: 9 })],
    [player("receive", "WR", 4, { quality: 12 }), player("upgrade", "WR", 30, { quality: 20 })],
  ] });
}
test("same-player bench unknown cancels in the delta, never in absolute depth totals", () => {
  const side = sideOf(evaluateTradeFromInputs(depthInputs(), offer(["send"], ["receive"])));
  assert.ok(side.before.bench.includes("unknown") && side.after.bench.includes("unknown"));
  assert.equal(side.before.depth_total, null); assert.equal(side.after.depth_total, null);
  assert.equal(side.depth_change, 3, "received positive VOR 5 minus sent positive VOR 2");
});
for (const change of ["traded", "received", "promoted", "demoted"]) test(`${change} unknown VOR cannot cancel`, () => {
  const inputs = depthInputs(change === "demoted" ? { start: 25 } : {});
  const proposal = change === "traded" || change === "received" ? offer(["unknown"], ["receive"])
    : change === "promoted" ? offer(["star"], ["receive"]) : offer(["send"], ["upgrade"]);
  // For promotion, the arriving player must be weaker than the unknown-quality retained player.
  if (change === "promoted") inputs.valueSource.contexts.receive.model.start_value.central = 1;
  const side = sideOf(evaluateTradeFromInputs(inputs, proposal), change === "received" ? 2 : 1);
  if (change === "promoted") assert.ok(side.before.bench.includes("unknown") && !side.after.bench.includes("unknown"));
  if (change === "demoted") assert.ok(!side.before.bench.includes("unknown") && side.after.bench.includes("unknown"));
  assert.equal(side.depth_change, null); assert.ok(side.unknowns.some(u => u.field === "depth_change"));
});

test("missing retained player values remain missing; they do not become zero", () => {
  const inputs = depthInputs(); delete inputs.valueSource.contexts.unknown;
  const c = built(inputs);
  for (const key of ["quality", "next_game", "vor"]) assert.equal(c.values.unknown[key], null);
  const side = sideOf(evaluateTrade(c, offer(["send"], ["receive"])));
  assert.equal(side.before.starter_total, null); assert.equal(side.depth_change, null);
});

test("bye/injury unknowns do not pollute modeled lineup, but their missing bench VOR stays null", () => {
  for (const kind of ["bye", "injury"]) {
    const inputs = depthInputs(); inputs.valueSource.contexts.unknown.model.start_value.central = null;
    if (kind === "bye") inputs.valueSource.contexts.unknown.schedule.status = "no_scheduled_game";
    else inputs.snapshot.rosters[0].all_players.find(p => p.player_id === "unknown").status = "Injured reserve";
    // Use the direct context boundary for status changes, preserving the fixture basis.
    const c = built(inputs);
    const side = sideOf(evaluateTrade(c, offer(["send"], ["receive"])));
    assert.equal(side.before.starter_total, 20); assert.equal(side.before.depth_total, null);
    assert.equal(side.depth_change, 3);
  }
});

for (const field of ["provider", "league_id", "season", "week", "model_version", "feature_version"]) test(`record provenance ${field} mismatch is insufficient, not a bundle error`, () => {
  const c = built(twoDropInputs()); c.protection.find(p => p.player_id === "low-A").provenance[field] = "different";
  assert.equal(effectiveProtection(c, "low-A").evidence, "insufficient");
  assert.equal(effectiveProtection(c, "low-A").droppable, null);
  const result = evaluateTrade(c, twoDropOffer()); withheldSide(result, "undetermined");
  assert.ok(!result.errors.some(e => e.code === "CONTEXT_MISMATCH"));
});
for (const population of ["decision_support_player_context", "signals-1", "market-1", "sleeper_add_interest"]) test(`${population} is not authoritative protection evidence`, () => {
  const inputs = twoDropInputs(); inputs.protectionEvidence.population = population;
  const c = built(inputs);
  assert.ok(c.protection.every(p => effectiveProtection(c, p.player_id).evidence === "insufficient"));
  withheldSide(evaluateTrade(c, twoDropOffer()), "undetermined");
});

test("signals, market attention and add-interest neither create missing protection nor change helper results", () => {
  const inputs = twoDropInputs(), changed = structuredClone(inputs);
  for (const c of Object.values(changed.valueSource.contexts)) {
    c.signals = { schema_version: "signals-1", signals: [{ label: "Role expanding", strength: 999 }] };
    c.market = { schema_version: "market-1", attention: 999 }; c.add_interest = 100;
  }
  const players = inputs.snapshot.rosters.flatMap(r => r.all_players), slots = inputs.snapshot.league.roster_positions;
  assert.deepEqual(dropProtections(players, slots, changed.valueSource.contexts), inputs.protectionEvidence.players);
  changed.protectionEvidence.players = changed.protectionEvidence.players.filter(p => p.player_id !== "low-A");
  withheldSide(evaluateTradeFromInputs(changed, twoDropOffer()), "undetermined");
});

test("full-input helper preserves transactionEvaluator reasons, order, and all existing protections", () => {
  const players = [player("ordinary", "WR", 5), player("unknown", "WR", 5, { quality: null }),
    player("rookie", "WR", 5, { features: { current_games: 1, prior: { ppg: null } } }),
    player("injured", "WR", 5, { injury: "Out" }), player("started", "WR", 5, { schedule: "kickoff_passed" }),
    player("kicker", "K", null, { supported: false }), player("sf-qb", "QB", 20),
    player("role", "WR", 5, { legacySignals: [{ label: "Role expanding" }] }),
    player("backfield", "RB", 5, { features: { feature_inputs: { snap_share: 1, carry_share: 1 } } }),
    player("elite", "WR", 30, { quality: 100 }), player("reserved", "WR", 5, { reserve: true, injury: "IR" })];
  const inputs = syntheticInputs({ rosters: [players, [player("candidate", "WR", 10)]], slots: ["QB", "SUPER_FLEX", "WR", ...Array(10).fill("BN"), "IR"] });
  const roster = inputs.snapshot.rosters[0], active = roster.all_players.filter(p => !p.reserve && !p.taxi);
  const helper = dropProtections(active, inputs.snapshot.league.roster_positions, inputs.valueSource.contexts);
  const transaction = transactionEvaluator(roster, inputs.snapshot.league.roster_positions, inputs.valueSource.contexts, inputs.valueSource.levels)(inputs.snapshot.rosters[1].all_players[0]);
  assert.deepEqual(helper.filter(p => p.reasons.length), transaction.protected_players);
  assert.deepEqual(helper.map(p => p.player_id), active.map(p => p.player_id));
  const reasons = Object.fromEntries(helper.map(p => [p.player_id, p.reasons]));
  const expected = { unknown: "Unknown asset value", rookie: "Unestablished asset", injured: "Injured/reserve asset protected",
    started: "Game has started", kicker: "K/DST/IDP advanced value unsupported", "sf-qb": "Structural Superflex QB asset",
    role: "Expanding-role stash", backfield: "Meaningful observed backfield role", elite: "Upper-tier football asset" };
  for (const [id, reason] of Object.entries(expected)) assert.ok(reasons[id].some(r => r.startsWith(reason)), id);
  assert.deepEqual(reasons.ordinary, []);
  const c = built(inputs);
  assert.equal(effectiveProtection(c, "unknown").evidence, "sufficient");
  assert.equal(effectiveProtection(c, "unknown").protected, true, "unknown value is a protection, not absent evidence");
});

const mismatches = {
  week: 7, provider: "espn", league_id: "another-synthetic-league", season: "2025", roster_ids: [1, 3],
  roster_positions: ["QB", "BN", "BN"], identity_mode: "selected_roster", selected_roster_id: 1,
  model_version: "different-model", feature_version: "different-features",
};
for (const [field, value] of Object.entries(mismatches)) test(`equal basis, mismatched ${field}: CONTEXT_MISMATCH and no sides`, () => {
  const inputs = twoDropInputs(), basis = inputs.valueSource.basis;
  inputs.valueSource.metadata[field] = value;
  const result = evaluateTradeFromInputs(inputs, twoDropOffer());
  assert.equal(inputs.valueSource.basis, basis);
  assert.equal(result.status, "invalid"); assert.deepEqual(result.sides, []);
  errorCode(result, "CONTEXT_MISMATCH"); assert.ok(result.errors.some(e => e.field === field));
});

test("bundle protection lineup/week mismatch rejects the context, not merely individual evidence", () => {
  for (const [field, value] of [["week", 7], ["roster_positions", ["QB", "BN", "BN"]]]) {
    const inputs = twoDropInputs(); inputs.protectionEvidence.metadata[field] = value;
    const result = evaluateTradeFromInputs(inputs, twoDropOffer());
    assert.equal(result.status, "invalid"); errorCode(result, "CONTEXT_MISMATCH"); assert.deepEqual(result.sides, []);
  }
});

test("stale basis is rejected even when all trade-local metadata matches", () => {
  const inputs = twoDropInputs(); inputs.valueSource.basis = "stale-synthetic-basis";
  const result = evaluateTradeFromInputs(inputs, twoDropOffer());
  assert.equal(result.status, "invalid"); errorCode(result, "STALE_BASIS"); assert.deepEqual(result.sides, []);
});

test("scoring identities supplied on value and protection sources must agree", () => {
  const inputs = twoDropInputs(); inputs.valueSource.metadata.scoring_identity = "synthetic-ppr";
  inputs.protectionEvidence.metadata.scoring_identity = "synthetic-half-ppr";
  const result = evaluateTradeFromInputs(inputs, twoDropOffer());
  errorCode(result, "CONTEXT_MISMATCH"); assert.deepEqual(result.sides, []);
});

test("explicit snapshot scoring metadata is compared without requiring a public snapshot schema change", () => {
  const meta = twoDropInputs().valueSource.metadata;
  const result = compareContextMetadata({ snapshot: { ...meta, scoring_identity: "synthetic-ppr" },
    value_source: { ...meta, scoring_identity: "synthetic-half-ppr" }, protection: { ...meta } });
  assert.equal(result.status, "invalid"); errorCode(result, "CONTEXT_MISMATCH");
});

test("malformed/missing roster_ids never throw and always yield CONTEXT_MISMATCH", () => {
  for (const ids of [undefined, null, "1,2", 2, {}, [], [1], [1, "1"], [1, null], [1, 2.5], [1, {}]]) {
    for (const source of ["snapshot", "value_source", "protection"]) {
      const inputs = twoDropInputs(), meta = inputs.valueSource.metadata;
      const sources = { snapshot: structuredClone(meta), value_source: structuredClone(meta), protection: structuredClone(meta) };
      sources[source].roster_ids = ids;
      // Optional protection roster IDs may be absent/null; when declared they must be valid.
      if (source === "protection" && ids == null) continue;
      let result; assert.doesNotThrow(() => { result = compareContextMetadata(sources); });
      assert.equal(result.ok, false, `${source}: ${JSON.stringify(ids)}`); errorCode(result, "CONTEXT_MISMATCH");
    }
  }
});

test("metadata IDs compare canonically; missing protection lineup metadata is rejected", () => {
  const inputs = twoDropInputs(); inputs.valueSource.metadata.roster_ids = ["2", "1"];
  assert.equal(buildTradeContext(inputs).ok, true);
  delete inputs.protectionEvidence.metadata.roster_positions;
  const result = evaluateTradeFromInputs(inputs, twoDropOffer());
  errorCode(result, "CONTEXT_MISMATCH"); assert.deepEqual(result.sides, []);
});

test("offline ESPN context with no capabilities remains pure and never assumes reserve eligibility", () => {
  const inputs = syntheticInputs({ provider: "espn", capabilities: {}, rosters: [
    [player("a", "WR", 10)], [player("b", "WR", 12, { injury: "IR" })],
  ], placement: { b: { reserve: "verified", taxi: "verified" } } });
  const result = evaluateTradeFromInputs(inputs, offer(["a"], ["b"]));
  assert.equal(result.status, "evaluated"); assert.equal(sideOf(result).reserve_placement[0].placement, "active");
});

test("pickup values and future observations outside the injected as-of model cannot affect evaluation", () => {
  const inputs = leagueFixture("superflex-te-premium").inputs, changed = structuredClone(inputs);
  for (const c of Object.values(changed.valueSource.contexts)) {
    c.model.pickup_value.central = -100000;
    c.future_observations = [{ season: 2026, week: 7, fantasy_points: 100000 }, { season: 2027, week: 1, fantasy_points: -100000 }];
  }
  const p = offer(["r1_bench1"], ["r2_bench1", "r2_bench2"]);
  assert.deepEqual(evaluateTradeFromInputs(changed, p), evaluateTradeFromInputs(inputs, p));
  // This proves the pure evaluator boundary, not upstream ingestion's as-of filtering.
});

test("evaluation leaves calibrated model and policy files byte-for-byte unchanged", async () => {
  const files = ["../lib/decision/model-config.js", "../lib/decision/calibration/weights.js"];
  const hashes = () => Promise.all(files.map(async file => createHash("sha256").update(await readFile(new URL(file, import.meta.url))).digest("hex")));
  const before = await hashes();
  evaluateTradeFromInputs(leagueFixture("superflex-te-premium").inputs, offer(["r1_bench1"], ["r2_bench1"]));
  assert.deepEqual(await hashes(), before);
});
