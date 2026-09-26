import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TRADE_SCHEMA_VERSION, ERROR_CODES, HORIZONS, horizonFor, compareIds, compareIdSequences, canonicalIdSequence,
  validateTradeProposal, validateTradeContext, effectiveProtection, checkBasis, compareContextMetadata, slotStructure,
  capabilityAvailable, createTradeEvaluation, emptySideResult, packageStatus, validateTradeEvaluation, statusForErrors, tradeError,
  FORBIDDEN_EVALUATION_KEYS,
} from "../lib/trade/contracts.js";
import { buildTradeContext } from "../lib/trade/context.js";
import { evaluateTrade, evaluateTradeFromInputs, resolveForcedDrops, compareCandidates, reserveAllocations } from "../lib/trade/evaluate.js";
import { dropProtections, transactionEvaluator } from "../lib/decision/add-drop.js";
import { decisionBasis } from "../lib/decision/basis.js";

// Synthetic two-roster context (not league data).
const provenance = { producer: "add-drop protections (synthetic test)", population: "full_internal_contexts", provider: "sleeper",
  league_id: "L1", season: 2026, week: 3, model_version: "decision-0.3.2", feature_version: "weekly-features-2" };
const player = (player_id, positions, extra = {}) => ({ player_id, fantasy_positions: positions, roster_status: "active", injury_status: null, status: "Active",
  placement: { reserve: "unknown", taxi: "unknown" }, ...extra });
const unknownOpen = { count: null, verified: false };
const context = (overrides = {}) => ({
  basis: "basis-1", provider: "sleeper", identity: { mode: "spectator", roster_id: null },
  capabilities: { IR: { status: "available", reason: null }, taxiSquads: { status: "unsupported", reason: "x" } },
  versions: { model_version: "decision-0.3.2", feature_version: "weekly-features-2" },
  league: { league_id: "L1", season: 2026, week: 3, roster_positions: ["QB", "RB", "FLEX", "BN", "IR"], starter_slots: ["QB", "RB", "FLEX"],
    active_capacity: 4, reserve_slots: { count: 1, verified: true }, taxi_slots: { count: 0, verified: true }, team_count: 2,
    scoring_profile: { superflex: false, te_premium: false }, scoring_identity: null, unsupported_rules: [] },
  rosters: [
    { roster_id: 1, owner_id: "u1", players: [player("a1", ["QB"]), player("a2", ["RB"]), player("a3", ["RB", "WR"])], reserve_open: unknownOpen, taxi_open: unknownOpen },
    { roster_id: 2, owner_id: "u2", players: [player("b1", ["QB"]), player("b2", ["WR"]), player("b3", ["TE"], { roster_status: "reserve" })], reserve_open: unknownOpen, taxi_open: unknownOpen },
  ],
  values: { a1: { next_game: 18.2, quality: 17, vor: 3, vor_position: "QB", supported: true, schedule_status: "scheduled", injury_status: null },
    a2: { next_game: null, quality: null, vor: null, vor_position: null, supported: false, schedule_status: "scheduled", injury_status: null } },
  replacement: { QB: 14, RB: 8, WR: null },
  protection: [
    { player_id: "a1", evidence: "sufficient", protected: true, droppable: false, reasons: ["Upper-tier football asset"], provenance },
    { player_id: "a2", evidence: "sufficient", protected: false, droppable: true, reasons: [], provenance },
    { player_id: "a3", evidence: "insufficient", protected: null, droppable: null, reasons: [], provenance },
  ],
  ...overrides,
});
const proposal = (a = ["a2"], b = ["b2"], extra = {}) => ({ sides: [{ roster_id: 1, sends: a.map(id => ({ type: "player", id })) },
  { roster_id: 2, sends: b.map(id => ({ type: "player", id })) }], horizon: "next_game", ...extra });
const codes = result => result.errors.map(e => e.code);

test("trade contracts are pure: no provider, transport, network or model-weight imports", async () => {
  const source = await readFile(new URL("../lib/trade/contracts.js", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map(m => m[1]);
  assert.deepEqual(imports, ["../normalize/positions.js"]);
  assert.equal([...source.matchAll(/\bimport\b/g)].length, 1, "no other static or dynamic imports");
  assert.doesNotMatch(source, /\bfetch\s*\(|\brequire\s*\(|process\.env/);
});

test("next_game is the only supported horizon and discloses its limits; other horizons are unsupported", () => {
  assert.deepEqual(Object.keys(HORIZONS), ["next_game"]);
  const h = horizonFor("next_game");
  assert.equal(h.supported, true); assert.equal(h.lineup_value_source, "model.start_value.central");
  assert.equal(h.depth_label, "descriptive_quality"); assert.ok(h.limitations.some(l => /pickup_value/.test(l)));
  assert.ok(Object.isFrozen(h));
  for (const id of ["rest_of_season", "dynasty", "multi_week", "three_week"]) {
    assert.equal(horizonFor(id).supported, false);
    assert.deepEqual(codes(validateTradeProposal(proposal(["a2"], ["b2"], { horizon: id }))), ["UNSUPPORTED_HORIZON"]);
  }
  assert.equal(horizonFor(undefined), null);
  assert.deepEqual(codes(validateTradeProposal({ sides: proposal().sides })), ["MALFORMED_PROPOSAL"], "horizon is explicit, never defaulted");
});

test("supported package shapes: exactly two rosters, 1-for-1, 2-for-1, 1-for-2, 2-for-2", () => {
  for (const [a, b] of [[["a2"], ["b2"]], [["a2", "a3"], ["b2"]], [["a2"], ["b1", "b2"]], [["a2", "a3"], ["b1", "b2"]]]) {
    const result = validateTradeProposal(proposal(a, b), context());
    assert.deepEqual(result, { ok: true, status: "evaluated", errors: [] }, `${a.length}-for-${b.length}`);
  }
});

test("out-of-scope shapes return explicit codes and status classes", () => {
  const empty = validateTradeProposal(proposal([], ["b2"]));
  assert.deepEqual(codes(empty), ["EMPTY_SIDE"]); assert.equal(empty.status, "unsupported"); assert.equal(empty.errors[0].roster_id, "1");
  const large = validateTradeProposal(proposal(["a1", "a2", "a3"], ["b2"]));
  assert.deepEqual(codes(large), ["PACKAGE_TOO_LARGE"]); assert.equal(large.status, "unsupported");
  const three = proposal(); three.sides.push({ roster_id: 3, sends: [{ type: "player", id: "c1" }] });
  assert.deepEqual(codes(validateTradeProposal(three)), ["UNSUPPORTED_TRADE_SHAPE"]);
  const one = proposal(); one.sides.pop();
  assert.deepEqual(codes(validateTradeProposal(one)), ["UNSUPPORTED_TRADE_SHAPE"]);
});

test("picks and FAAB are unsupported assets; malformed input is invalid, never repaired", () => {
  const picks = proposal(); picks.sides[0].sends.push({ type: "draft_pick", id: "2027-1" }); picks.sides[1].sends = [{ type: "faab", amount: 10 }];
  const result = validateTradeProposal(picks);
  assert.deepEqual(codes(result), ["UNSUPPORTED_ASSET", "UNSUPPORTED_ASSET"]); assert.equal(result.status, "unsupported");
  assert.ok(result.errors.every(e => /not verified trade inputs/.test(e.message)));
  for (const bad of [null, [], { sides: "x", horizon: "next_game" }, proposal(["a2"], ["b2"], { fairness: 1 })])
    assert.equal(validateTradeProposal(bad).status, "invalid");
  const noId = proposal(); noId.sides[0].sends[0] = { type: "player", id: "" };
  assert.deepEqual(codes(validateTradeProposal(noId)), ["MALFORMED_PROPOSAL"]);
  const extraSide = proposal(); extraSide.sides[0].receives = [{ type: "player", id: "b2" }];
  assert.deepEqual(codes(validateTradeProposal(extraSide)), ["MALFORMED_PROPOSAL"]);
  const badRoster = proposal(); badRoster.sides[0].roster_id = 1.5;
  assert.deepEqual(codes(validateTradeProposal(badRoster)), ["MALFORMED_PROPOSAL"]);
  // Invalid outranks unsupported when both are present.
  assert.equal(validateTradeProposal({ ...proposal([], ["b2"]), sides: [...proposal([], ["b2"]).sides.slice(0, 1), { roster_id: 1, sends: [{ type: "player", id: "x" }] }] }).status, "invalid");
});

test("ownership, duplicates, same roster and unknown roster validate the whole package", () => {
  const same = proposal(); same.sides[1].roster_id = "1";
  assert.deepEqual(codes(validateTradeProposal(same)), ["SAME_ROSTER"], "roster ids compare by canonical key");
  assert.deepEqual(codes(validateTradeProposal(proposal(["a2", "a2"], ["b2"]))), ["DUPLICATE_ASSET"]);
  assert.deepEqual(codes(validateTradeProposal(proposal(["a2"], ["a2"]))), ["DUPLICATE_ASSET"]);
  const all = validateTradeProposal(proposal(["b1", "zz"], ["a1"]), context());
  assert.deepEqual(all.errors.map(e => [e.code, e.roster_id, e.asset_id]),
    [["ASSET_NOT_OWNED", "1", "b1"], ["ASSET_NOT_OWNED", "1", "zz"], ["ASSET_NOT_OWNED", "2", "a1"]]);
  const unknown = proposal(); unknown.sides[1].roster_id = 9;
  assert.deepEqual(codes(validateTradeProposal(unknown, context())), ["UNKNOWN_ROSTER"]);
  // Deterministic: side order does not change the error list.
  const swapped = proposal(["b1", "zz"], ["a1"]); swapped.sides.reverse();
  assert.deepEqual(validateTradeProposal(swapped, context()).errors, all.errors);
});

test("canonical id order is UTF-16 code-unit order, never locale or numeric", () => {
  assert.deepEqual(canonicalIdSequence(["10", "9", "a", "B", "é", "Z"]), ["10", "9", "B", "Z", "a", "é"]);
  assert.equal(compareIds("10", "9"), -1); assert.equal(compareIds("a", "a"), 0);
  assert.ok(compareIdSequences(["2", "1"], ["1", "3"]) < 0, "sets are sorted before element-wise comparison");
  assert.ok(compareIdSequences(["1"], ["1", "2"]) < 0);
  assert.equal(compareIdSequences(["b", "a"], ["a", "b"]), 0);
});

test("a well-formed synthetic context validates; slot structure mirrors add/drop", () => {
  assert.deepEqual(validateTradeContext(context()), { ok: true, status: "evaluated", errors: [] });
  assert.deepEqual(slotStructure(["QB", "SUPER_FLEX", "BN", "BN", "IR", "TAXI"]),
    { starter_slots: ["QB", "SUPER_FLEX"], active_capacity: 4, reserve_positions: 1, taxi_positions: 1, unsupported_slots: [] });
  const odd = context(); odd.league = { ...odd.league, roster_positions: ["QB", "OP", "BN"], starter_slots: ["QB", "OP"], active_capacity: 3 };
  const result = validateTradeContext(odd);
  assert.deepEqual(codes(result), ["UNSUPPORTED_SLOTS"]); assert.equal(result.status, "unsupported");
});

test("context validation rejects malformed or coerced fields instead of repairing them", () => {
  const cases = {
    versions: c => { c.versions = { model_version: "decision-0.3.2" }; },
    "league.week": c => { c.league.week = null; },
    "league.active_capacity": c => { c.league.active_capacity = 5; },
    "league.reserve_slots": c => { c.league.reserve_slots = { count: null, verified: true }; },
    "identity.roster_id": c => { c.identity = { mode: "selected_roster", roster_id: null }; },
    "values.a1": c => { c.values.a1 = { ...c.values.a1, next_game: Number.NaN }; },
    "rosters[1].players[0].player_id": c => { c.rosters[1].players[0] = player("a1", ["QB"]); },
    "rosters[0].players[0].placement": c => { c.rosters[0].players[0].placement = { reserve: "eligible", taxi: "unknown" }; },
    replacement: c => { c.replacement.QB = Infinity; },
  };
  for (const [field, mutate] of Object.entries(cases)) {
    const c = structuredClone(context()); mutate(c);
    const result = validateTradeContext(c);
    assert.equal(result.status, "invalid", field);
    assert.ok(result.errors.some(e => e.code === "INVALID_CONTEXT" && e.field === field), `${field}: ${JSON.stringify(result.errors)}`);
  }
  const spectatorWithRoster = structuredClone(context()); spectatorWithRoster.identity = { mode: "spectator", roster_id: 1 };
  assert.equal(validateTradeContext(spectatorWithRoster).ok, false, "spectator never owns a roster");
  const selected = structuredClone(context()); selected.identity = { mode: "selected_roster", roster_id: 2 };
  assert.equal(validateTradeContext(selected).ok, true);
});

test("protection records: blocked vs undetermined inputs are explicit, insufficient is never unprotected", () => {
  const bad = [
    { evidence: "insufficient", protected: false, droppable: true, reasons: [] },
    { evidence: "sufficient", protected: false, droppable: false, reasons: [] },
    { evidence: "sufficient", protected: true, droppable: false, reasons: [] },
    { evidence: "sufficient", protected: false, droppable: true, reasons: ["Upper-tier football asset"] },
    { evidence: "maybe", protected: null, droppable: null, reasons: [] },
  ];
  for (const record of bad) {
    const c = context(); c.protection = [{ player_id: "a2", provenance, ...record }];
    assert.equal(validateTradeContext(c).status, "invalid", JSON.stringify(record));
  }
  const c = context();
  assert.deepEqual(effectiveProtection(c, "a1"), { player_id: "a1", evidence: "sufficient", protected: true, droppable: false, reasons: ["Upper-tier football asset"], cause: null });
  assert.equal(effectiveProtection(c, "a2").droppable, true);
  assert.deepEqual(effectiveProtection(c, "a3"), { player_id: "a3", evidence: "insufficient", protected: null, droppable: null, reasons: [], cause: "record_insufficient" });
  assert.equal(effectiveProtection(c, "b2").cause, "no_record");
});

test("protection provenance must be authoritative: subset population or mismatched metadata is insufficient", () => {
  const withProvenance = patch => { const c = context(); c.protection = [{ ...c.protection[1], provenance: { ...provenance, ...patch } }]; return c; };
  assert.equal(effectiveProtection(withProvenance({ population: "decision_support_player_context" }), "a2").cause, "provenance_population");
  for (const [key, value] of [["week", 4], ["league_id", "L2"], ["season", 2025], ["model_version", "decision-0.3.1"], ["feature_version", "x"], ["provider", "espn"]]) {
    const result = effectiveProtection(withProvenance({ [key]: value }), "a2");
    assert.equal(result.evidence, "insufficient"); assert.equal(result.droppable, null); assert.equal(result.cause, `provenance_mismatch:${key}`);
  }
  assert.equal(effectiveProtection(withProvenance({ week: undefined }), "a2").cause, "provenance_mismatch:week");
});

test("existing basis check is applied unchanged; trade-local metadata mismatches name the field", () => {
  assert.deepEqual(checkBasis("b", "b"), []);
  assert.deepEqual(checkBasis("b", "c").map(e => e.code), ["STALE_BASIS"]);
  assert.deepEqual(checkBasis("", "").map(e => e.code), ["STALE_BASIS"]);
  const base = { provider: "sleeper", league_id: "L1", season: 2026, week: 3, roster_positions: ["QB", "FLEX", "BN"], identity_mode: "selected_roster", selected_roster_id: 2 };
  const sources = () => ({ snapshot: { ...base, roster_ids: [2, 1] }, value_source: { ...base, season: "2026", model_version: "m", feature_version: "f", roster_ids: ["1", "2"] },
    protection: { provider: "sleeper", league_id: "L1", season: 2026, week: 3, roster_positions: ["QB", "FLEX", "BN"], model_version: "m", feature_version: "f" } });
  assert.deepEqual(compareContextMetadata(sources()), { ok: true, status: "evaluated", errors: [] }, "canonical scalars and roster-id sets");
  const mismatches = {
    week: s => { s.value_source.week = 4; }, model_version: s => { s.protection.model_version = "m2"; },
    roster_positions: s => { s.value_source.roster_positions = ["QB", "SUPER_FLEX", "BN"]; },
    selected_roster_id: s => { s.value_source.selected_roster_id = null; }, identity_mode: s => { s.snapshot.identity_mode = "spectator"; },
    scoring_identity: s => { s.snapshot.scoring_identity = "ppr"; s.value_source.scoring_identity = "half"; },
    roster_ids: s => { s.value_source.roster_ids = ["1", "3"]; }, league_id: s => { s.protection.league_id = "L2"; },
  };
  for (const [field, mutate] of Object.entries(mismatches)) {
    const s = sources(); mutate(s);
    const result = compareContextMetadata(s);
    assert.equal(result.status, "invalid", field);
    assert.deepEqual(result.errors.map(e => [e.code, e.field]), [["CONTEXT_MISMATCH", field]], field);
  }
  const absent = sources(); delete absent.value_source.feature_version;
  assert.deepEqual(compareContextMetadata(absent).errors.map(e => e.field), ["feature_version"]);
  const missing = sources(); delete missing.protection;
  assert.deepEqual(compareContextMetadata(missing).errors.map(e => e.field), ["protection"]);
  const optional = sources(); optional.snapshot.scoring_identity = "ppr";
  assert.equal(compareContextMetadata(optional).ok, true, "scoring identity compared only where both sources carry it");
  const protectionRosters = sources(); protectionRosters.protection.roster_ids = ["2", "1"];
  assert.equal(compareContextMetadata(protectionRosters).ok, true, "protection roster_ids compared where declared");
  protectionRosters.protection.roster_ids = ["1", "9"];
  assert.deepEqual(compareContextMetadata(protectionRosters).errors.map(e => [e.code, e.field]), [["CONTEXT_MISMATCH", "roster_ids"]]);
  const spectator = sources(); for (const s of [spectator.snapshot, spectator.value_source]) { s.identity_mode = "spectator"; s.selected_roster_id = null; }
  assert.equal(compareContextMetadata(spectator).ok, true);
});

test("roster identities and protection lineup structure are required trade-local metadata", () => {
  const base = { provider: "sleeper", league_id: "L1", season: 2026, week: 3, roster_positions: ["QB", "SUPER_FLEX", "BN"], identity_mode: "selected_roster", selected_roster_id: 2 };
  const sources = () => ({ snapshot: { ...base, roster_ids: [1, 2] }, value_source: { ...base, model_version: "m", feature_version: "f", roster_ids: ["2", "1"] },
    protection: { provider: "sleeper", league_id: "L1", season: 2026, week: 3, roster_positions: ["QB", "SUPER_FLEX", "BN"], model_version: "m", feature_version: "f" } });
  assert.equal(compareContextMetadata(sources()).ok, true);
  const cases = {
    "missing snapshot roster_ids": s => { delete s.snapshot.roster_ids; },
    "null value_source roster_ids": s => { s.value_source.roster_ids = null; },
    "missing value_source roster_ids": s => { delete s.value_source.roster_ids; },
    "mismatched roster_ids": s => { s.snapshot.roster_ids = [1, 3]; },
    "extra roster in one source": s => { s.value_source.roster_ids = ["1", "2", "3"]; },
    "single roster cannot cover a two-roster proposal": s => { s.snapshot.roster_ids = [2]; s.value_source.roster_ids = ["2"]; },
    "duplicate roster ids": s => { s.snapshot.roster_ids = [2, 2]; s.value_source.roster_ids = ["2", "2"]; },
    "missing protection roster_positions": s => { delete s.protection.roster_positions; },
    "mismatched protection roster_positions": s => { s.protection.roster_positions = ["QB", "FLEX", "BN"]; },
  };
  const malformed = { string: "1,2", object: { a: 1, b: 2 }, number: 12, boolean: true, "non-id elements": [1, {}], "empty string id": ["", "2"] };
  for (const [kind, value] of Object.entries(malformed)) for (const where of ["snapshot", "value_source", "protection"]) {
    cases[`malformed ${where} roster_ids (${kind})`] = s => { s[where].roster_ids = value; };
  }
  for (const [name, mutate] of Object.entries(cases)) {
    const s = sources(); mutate(s);
    let result;
    assert.doesNotThrow(() => { result = compareContextMetadata(s); }, name);
    assert.equal(result.ok, false, name); assert.equal(result.status, "invalid", name);
    assert.ok(result.errors.length && result.errors.every(e => e.code === "CONTEXT_MISMATCH"), name);
    const field = name.includes("roster_positions") ? "roster_positions" : "roster_ids";
    assert.ok(result.errors.some(e => e.field === field), `${name} names ${field}`);
  }
  const stringIds = sources(); stringIds.snapshot.roster_ids = "1,2";
  assert.deepEqual(compareContextMetadata(stringIds), { ok: false, status: "invalid",
    errors: [tradeError("CONTEXT_MISMATCH", { field: "roster_ids", message: "roster_ids in snapshot must list at least two distinct roster ids." })] });
});

test("capabilities are explicit; anything but available is unsupported", () => {
  const c = context();
  assert.equal(capabilityAvailable(c, "IR"), true); assert.equal(capabilityAvailable(c, "taxiSquads"), false);
  assert.equal(capabilityAvailable(c, "draftPickTrading"), false); assert.equal(capabilityAvailable({}, "IR"), false);
});

test("evaluation envelope: market value null, conditional legality, no score, verdict or acceptance probability", () => {
  const sides = [emptySideResult(1, { sends: ["a2"], receives: ["b2"] }), emptySideResult(2, { sends: ["b2"], receives: ["a2"] })];
  for (const s of sides) { s.forced_drops.required = 0; s.forced_drops.status = "none"; }
  const evaluation = createTradeEvaluation({ context: context(), horizon: "next_game", sides });
  assert.equal(evaluation.schema_version, TRADE_SCHEMA_VERSION); assert.equal(evaluation.market_value, null);
  assert.equal(evaluation.legality, "conditional_known_rules"); assert.equal(evaluation.status, "evaluated");
  assert.equal(evaluation.model_version, "decision-0.3.2"); assert.equal(evaluation.feature_version, "weekly-features-2");
  assert.deepEqual(validateTradeEvaluation(evaluation), { ok: true, violations: [] });
  assert.equal(sides[0].starter_change, null, "unknown until computed, never zero");
  for (const key of ["fairness_score", "winner", "acceptance_probability", "combined_score", "verdict"]) {
    const bad = structuredClone(evaluation); bad.sides[1][key] = 1;
    assert.equal(validateTradeEvaluation(bad).ok, false, key);
  }
  assert.equal(validateTradeEvaluation({ ...evaluation, market_value: 12 }).ok, false);
  const { market_value, ...withoutMarket } = evaluation;
  assert.equal(validateTradeEvaluation(withoutMarket).ok, false);
  const nan = structuredClone(evaluation); nan.sides[0].starter_change = Number.NaN;
  assert.equal(validateTradeEvaluation(nan).ok, false);
});

test("package status: blocked beats withheld; blocked/undetermined sides carry no drop set or after valuation", () => {
  const side = (id, status, required = 1) => { const s = emptySideResult(id); s.forced_drops = { ...s.forced_drops, required, status, diagnostics: status === "none" || status === "selected" ? [] : ["why"], dropped: status === "selected" ? ["z"] : null }; return s; };
  assert.equal(packageStatus([side(1, "blocked"), side(2, "undetermined")]), "blocked");
  assert.equal(packageStatus([side(1, "none", 0), side(2, "undetermined")]), "withheld");
  assert.equal(packageStatus([side(1, "none", 0), side(2, "selected")]), "evaluated");
  const ctx = context();
  const blocked = createTradeEvaluation({ context: ctx, horizon: "next_game", sides: [side(1, "blocked"), side(2, "undetermined")],
    errors: [tradeError("FORCED_DROP_BLOCKED", { roster_id: 1 }), tradeError("FORCED_DROP_UNDETERMINED", { roster_id: 2 })] });
  assert.equal(blocked.status, "blocked"); assert.deepEqual(validateTradeEvaluation(blocked).violations, []);
  const leaked = structuredClone(blocked); leaked.sides[0].forced_drops.dropped = ["a2"];
  assert.ok(validateTradeEvaluation(leaked).violations.some(v => /dropped must be null/.test(v)));
  const valued = structuredClone(blocked); valued.sides[1].starter_change = 2.5;
  assert.ok(validateTradeEvaluation(valued).violations.some(v => /null deltas/.test(v)));
  const after = structuredClone(blocked); after.sides[0].after = { lineup: [], starter_total: 10, depth_total: null };
  assert.ok(validateTradeEvaluation(after).violations.some(v => /after-state/.test(v)));
  const noError = structuredClone(blocked); noError.errors = [noError.errors[1]];
  assert.equal(validateTradeEvaluation(noError).ok, false, "a blocked side needs its FORCED_DROP_BLOCKED error");
  const mislabeled = structuredClone(blocked); mislabeled.status = "evaluated";
  assert.equal(validateTradeEvaluation(mislabeled).ok, false);
  const tooMany = createTradeEvaluation({ context: ctx, horizon: "next_game", sides: [side(1, "none", 0), side(2, "none", 0)] });
  tooMany.sides[1].forced_drops = { ...tooMany.sides[1].forced_drops, required: 3, status: "selected", dropped: ["x", "y", "z"] };
  assert.ok(validateTradeEvaluation(tooMany).violations.some(v => /required out of range/.test(v)), "k > 2 is never a selected outcome");
  const unsorted = createTradeEvaluation({ context: ctx, horizon: "next_game", sides: [side(1, "none", 0), side(2, "none", 0)] });
  unsorted.sides[1].forced_drops = { ...unsorted.sides[1].forced_drops, required: 2, status: "selected", dropped: ["b", "a"] };
  assert.equal(validateTradeEvaluation(unsorted).ok, false, "dropped ids are returned in canonical order");
});

test("invalid and unsupported envelopes carry matching errors and no valuation", () => {
  const unsupported = createTradeEvaluation({ context: context(), horizon: "dynasty", errors: [tradeError("UNSUPPORTED_HORIZON", { field: "horizon" })] });
  assert.equal(unsupported.status, "unsupported"); assert.equal(unsupported.horizon.supported, false); assert.deepEqual(unsupported.sides, []);
  assert.deepEqual(validateTradeEvaluation(unsupported).violations, []);
  const invalid = createTradeEvaluation({ errors: [tradeError("STALE_BASIS"), tradeError("PACKAGE_TOO_LARGE")] });
  assert.equal(invalid.status, "invalid"); assert.equal(invalid.market_value, null);
  assert.equal(validateTradeEvaluation({ ...invalid, status: "unsupported" }).ok, false);
  const valuedSide = () => { const s = emptySideResult(1, { sends: ["a2"], receives: ["b2"] }); s.forced_drops = { ...s.forced_drops, required: 0, status: "none" }; return s; };
  const injections = {
    "valued side": s => { s.before = { lineup: [], starter_total: 10, depth_total: 2 }; s.after = { lineup: [], starter_total: 12, depth_total: 1 }; s.starter_change = 2; s.depth_change = -1; },
    "before/after lineup valuation": s => { s.before = { lineup: [{ slot: "QB", player_id: "a1" }], starter_total: 10, depth_total: null }; s.after = { lineup: [{ slot: "QB", player_id: "b1" }], starter_total: null, depth_total: null }; },
    "numeric deltas": s => { s.starter_change = 1.5; s.depth_change = 0; },
    "selected forced drops": s => { s.forced_drops = { ...s.forced_drops, required: 1, status: "selected", dropped: ["a3"] }; },
    "empty skeleton side": () => {},
  };
  for (const envelope of [invalid, unsupported]) for (const [name, inject] of Object.entries(injections)) {
    const side = valuedSide(); inject(side);
    const bad = { ...structuredClone(envelope), sides: [side] };
    const result = validateTradeEvaluation(bad);
    assert.equal(result.ok, false, `${envelope.status}: ${name}`);
    assert.ok(result.violations.some(v => /carry no sides or partial valuation/.test(v)), `${envelope.status}: ${name}`);
  }
  assert.equal(statusForErrors([]), "evaluated");
  assert.equal(statusForErrors([tradeError("UNSUPPORTED_DROP_COUNT")]), "unsupported");
  assert.equal(statusForErrors([tradeError("OVER_CAPACITY_BEFORE"), tradeError("CAPACITY_UNKNOWN")]), "withheld");
  assert.throws(() => tradeError("NOT_A_CODE"));
  for (const code of ["STALE_BASIS", "CONTEXT_MISMATCH", "UNKNOWN_ROSTER", "SAME_ROSTER", "EMPTY_SIDE", "ASSET_NOT_OWNED", "DUPLICATE_ASSET", "UNSUPPORTED_ASSET",
    "UNSUPPORTED_HORIZON", "PACKAGE_TOO_LARGE", "UNSUPPORTED_TRADE_SHAPE", "UNSUPPORTED_SLOTS", "UNSUPPORTED_DROP_COUNT", "CAPACITY_UNKNOWN",
    "OVER_CAPACITY_BEFORE", "FORCED_DROP_BLOCKED", "FORCED_DROP_UNDETERMINED"]) assert.ok(ERROR_CODES[code], `spec code ${code}`);
});

// ---- Phase B: protection helper, context builder and evaluator ---------------------------------
// Synthetic fixtures only (not league data). Protection evidence is produced by the add/drop helper on a full
// synthetic contexts population (rostered players plus free-agent fillers), never hand-written.

const TRADE_ROSTER = ["QB", "RB", "WR", "FLEX", "BN", "BN"];
const LEVELS = { QB: { replacement_value: 10, eligible_starter_demand: 1 }, RB: { replacement_value: 8, eligible_starter_demand: 1.5 },
  WR: { replacement_value: 8, eligible_starter_demand: 1.5 }, TE: { replacement_value: 6, eligible_starter_demand: 0.5 } };
/** A rostered player: q = quality (Q), start = next_game start value. */
const sp = (id, positions, q, start, extra = {}) => ({ id, positions, q, start, ...extra });
/** Pickup value is deliberately extreme to prove the evaluator never reads it. */
const decisionContext = (id, positions, { q, start, pickup = 999, games = 6, prior = 10, schedule = "scheduled", features = {}, signals = [], supported = true } = {}) => ({
  player: { player_id: id, fantasy_positions: positions },
  model: { supported, player_value: q, start_value: { central: start }, pickup_value: { central: pickup },
    features: { current_games: games, prior: { ppg: prior }, feature_inputs: { snap_share: 0, carry_share: 0 }, ...features } },
  schedule: { status: schedule }, analytics: { signals } });
const FILLERS = Object.fromEntries(["QB", "RB", "WR", "TE"].flatMap(pos => Array.from({ length: 12 }, (_, i) => {
  const id = `fa_${pos}${i}`; return [id, decisionContext(id, [pos], { q: 60, start: 60 })];
})));
const META = { provider: "sleeper", league_id: "L1", season: "2026", week: 3 };
const VERSIONS = { model_version: "decision-0.3.2", feature_version: "weekly-features-2" };

function tradeInputs({ rosters, positions = TRADE_ROSTER, levels = LEVELS, settings = { reserve_slots: 0, taxi_slots: 0 }, scoring = { rec: 1 },
  capabilities = { IR: { status: "available" }, taxiSquads: { status: "available" } }, placement = {}, omitEvidence = [], identity } = {}) {
  const snapshotPlayer = p => ({ player_id: p.id, fantasy_positions: p.positions, injury_status: p.injury ?? null, status: p.status ?? "Active", reserve: !!p.reserve, taxi: !!p.taxi });
  const snapshot = { identity: identity ?? { provider: "sleeper", provider_user_id: null, selected_roster_id: null, mode: "spectator" },
    league: { league_id: "L1", season: "2026", total_rosters: rosters.length, roster_positions: positions, scoring_settings: scoring, settings },
    matchup_week: 3, my_roster: null,
    rosters: rosters.map((players, i) => ({ roster_id: i + 1, owner_id: `u${i + 1}`, starter_slots: [], all_players: players.map(snapshotPlayer) })) };
  const contexts = structuredClone(FILLERS);
  for (const p of rosters.flat()) contexts[p.id] = decisionContext(p.id, p.positions, { q: p.q, start: p.start, ...p.context });
  const players = dropProtections(snapshot.rosters.flatMap(r => r.all_players), positions, contexts).filter(p => !omitEvidence.includes(p.player_id));
  const metadata = { ...META, roster_positions: positions, identity_mode: snapshot.identity.mode, selected_roster_id: snapshot.identity.selected_roster_id,
    roster_ids: snapshot.rosters.map(r => r.roster_id), ...VERSIONS };
  return { snapshot, capabilities, placement,
    valueSource: { basis: decisionBasis(snapshot), metadata, contexts, levels },
    protectionEvidence: { players, producer: "add-drop dropProtections (synthetic test)", population: "full_internal_contexts", metadata: { ...META, roster_positions: positions, ...VERSIONS } } };
}
const built = options => { const b = buildTradeContext(tradeInputs(options)); assert.deepEqual(b.errors, []); return b.context; };
const offer = (a, b, horizon = "next_game") => ({ sides: [{ roster_id: 1, sends: a.map(id => ({ type: "player", id })) }, { roster_id: 2, sends: b.map(id => ({ type: "player", id })) }], horizon });
const evaluated = (context, a, b) => { const e = evaluateTrade(context, offer(a, b)); assert.deepEqual(validateTradeEvaluation(e).violations, [], "contract invariants hold"); return e; };
const sideOf = (e, id) => e.sides.find(s => s.roster_id === String(id));
const close = (actual, expected, message) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

// Roster 1 has one open active slot; roster 2 is full (6 active for capacity 6).
const ROSTER_1 = [sp("a_qb", ["QB"], 20, 20), sp("a_rb1", ["RB"], 15, 15), sp("a_rb2", ["RB"], 12, 12), sp("a_wr1", ["WR"], 14, 14), sp("a_wr2", ["WR"], 9, 9)];
const ROSTER_2 = [sp("b_qb", ["QB"], 18, 18), sp("b_rb", ["RB"], 13, 13), sp("b_wr1", ["WR"], 16, 16), sp("b_wr2", ["WR"], 11, 11), sp("b_te", ["TE"], 9, 9), sp("b_wr3", ["WR"], 7, 7)];
const base = (overrides = {}) => built({ rosters: [ROSTER_1, ROSTER_2], ...overrides });
const injure = (roster, ids = null) => roster.map(p => (ids === null || ids.includes(p.id) ? { ...p, injury: "Out" } : p));

test("protection helper is identical to transactionEvaluator's protected players on the same full inputs", () => {
  const players = [
    { player_id: "p_ok", fantasy_positions: ["WR"] }, { player_id: "p_unknown", fantasy_positions: ["WR"] },
    { player_id: "p_rookie", fantasy_positions: ["RB"] }, { player_id: "p_inj", fantasy_positions: ["WR"], injury_status: "IR" },
    { player_id: "p_kick", fantasy_positions: ["WR"] }, { player_id: "p_k", fantasy_positions: ["K"] }, { player_id: "p_qb", fantasy_positions: ["QB"] },
    { player_id: "p_role", fantasy_positions: ["WR"] }, { player_id: "p_rb", fantasy_positions: ["RB"] }, { player_id: "p_elite", fantasy_positions: ["WR"] },
    { player_id: "p_reserve", fantasy_positions: ["WR"], reserve: true },
  ];
  const contexts = { ...structuredClone(FILLERS),
    p_ok: decisionContext("p_ok", ["WR"], { q: 12, start: 12 }), p_unknown: decisionContext("p_unknown", ["WR"], { q: null, start: 5 }),
    p_rookie: decisionContext("p_rookie", ["RB"], { q: 9, start: 9, games: 2, prior: null }), p_inj: decisionContext("p_inj", ["WR"], { q: 10, start: 10 }),
    p_kick: decisionContext("p_kick", ["WR"], { q: 10, start: 10, schedule: "kickoff_passed" }), p_k: decisionContext("p_k", ["K"], { q: 8, start: null }),
    p_qb: decisionContext("p_qb", ["QB"], { q: 15, start: 15 }), p_role: decisionContext("p_role", ["WR"], { q: 9, start: 9, signals: [{ label: "Target share rising" }] }),
    p_rb: decisionContext("p_rb", ["RB"], { q: 9, start: 9, features: { feature_inputs: { snap_share: 0.5, carry_share: 0.4 } } }),
    p_elite: decisionContext("p_elite", ["WR"], { q: 99, start: 30 }), p_reserve: decisionContext("p_reserve", ["WR"], { q: 5, start: 5 }) };
  const levels = { WR: { replacement_value: 5 }, RB: { replacement_value: 5 }, QB: { replacement_value: 5 } };
  const rules = new Set();
  for (const positions of [["QB", "WR", "FLEX", "BN", "BN"], ["QB", "SUPER_FLEX", "WR", "BN", "IR"]]) {
    const active = players.filter(p => !p.reserve && !p.taxi);
    const expected = transactionEvaluator({ all_players: players }, positions, contexts, levels)({ player_id: "fa_WR0", fantasy_positions: ["WR"] }).protected_players;
    const helper = dropProtections(active, positions, contexts);
    for (const p of expected) p.reasons.forEach(r => rules.add(r.split(":")[0]));
    assert.deepEqual(helper.filter(p => p.reasons.length), expected, positions.join(","));
    assert.deepEqual(helper.map(p => p.player_id), active.map(p => p.player_id), "one entry per player, input order, unprotected included");
    assert.deepEqual(helper.find(p => p.player_id === "p_ok").reasons, []);
  }
  assert.equal(rules.size, 9, `the fixture exercises every protection rule: ${[...rules]}`);
  assert.ok(dropProtections(players, ["QB", "SUPER_FLEX", "BN"], contexts).find(p => p.player_id === "p_qb").reasons.includes("Structural Superflex QB asset"));
  assert.ok(!dropProtections(players, ["QB", "WR", "BN"], contexts).find(p => p.player_id === "p_qb").reasons.includes("Structural Superflex QB asset"));
  // The upper-tier percentile ranges over the full contexts map: a subset population changes the result.
  const lows = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`low${i}`, decisionContext(`low${i}`, ["WR"], { q: 1, start: 1 })]));
  assert.deepEqual(dropProtections([players[0]], ["WR"], contexts)[0].reasons, []);
  assert.deepEqual(dropProtections([players[0]], ["WR"], { p_ok: contexts.p_ok, ...lows })[0].reasons, ["Upper-tier football asset"]);
});

test("context builder: basis, trade-local metadata, identity as supplied, values null when unknown", () => {
  const context = base();
  assert.equal(context.league.active_capacity, 6); assert.deepEqual(context.league.starter_slots, ["QB", "RB", "WR", "FLEX"]);
  assert.deepEqual(context.identity, { mode: "spectator", roster_id: null }, "spectator: no inferred roster");
  assert.deepEqual(context.values.a_wr2, { next_game: 9, quality: 9, vor: 1, vor_position: "WR", supported: true, schedule_status: "scheduled", injury_status: null });
  assert.equal(context.replacement.QB, 10); assert.equal(context.league.starter_demand.QB, 1);
  assert.deepEqual(context.league.reserve_slots, { count: 0, verified: true });
  assert.equal(context.protection.length, 11);
  assert.ok(context.protection.every(r => r.evidence === "sufficient" && r.provenance.population === "full_internal_contexts"));
  const selected = built({ rosters: [ROSTER_1, ROSTER_2], identity: { provider: "sleeper", provider_user_id: "u2", selected_roster_id: 2, mode: "selected_roster" } });
  assert.deepEqual(selected.identity, { mode: "selected_roster", roster_id: 2 });
  const noValues = tradeInputs({ rosters: [ROSTER_1, ROSTER_2] }); delete noValues.valueSource.contexts.a_wr2;
  assert.deepEqual(buildTradeContext(noValues).context.values.a_wr2,
    { next_game: null, quality: null, vor: null, vor_position: null, supported: false, schedule_status: null, injury_status: null });
  const stale = tradeInputs({ rosters: [ROSTER_1, ROSTER_2] }); stale.valueSource.basis = "other";
  assert.deepEqual(buildTradeContext(stale).errors.map(e => e.code), ["STALE_BASIS"]);
  const mismatch = tradeInputs({ rosters: [ROSTER_1, ROSTER_2] }); mismatch.protectionEvidence.metadata.week = 4;
  assert.deepEqual(buildTradeContext(mismatch).errors.map(e => [e.code, e.field]), [["CONTEXT_MISMATCH", "week"]]);
  const noProvider = tradeInputs({ rosters: [ROSTER_1, ROSTER_2] }); delete noProvider.snapshot.identity.provider;
  assert.deepEqual(buildTradeContext(noProvider).errors.map(e => [e.code, e.field]), [["CONTEXT_MISMATCH", "provider"]], "provider is never defaulted");
  const staleEval = evaluateTradeFromInputs(stale, offer(["a_wr2"], ["b_wr3"]));
  assert.equal(staleEval.status, "invalid"); assert.deepEqual(staleEval.sides, []); assert.deepEqual(validateTradeEvaluation(staleEval).violations, []);
});

test("1-for-1: lineups re-optimized per roster, deltas from actual bench membership", () => {
  const e = evaluated(base(), ["a_wr2"], ["b_wr3"]);
  assert.equal(e.status, "evaluated"); assert.equal(e.market_value, null); assert.equal(e.legality, "conditional_known_rules");
  const one = sideOf(e, 1), two = sideOf(e, 2);
  assert.deepEqual([one.sends, one.receives], [["a_wr2"], ["b_wr3"]]);
  close(one.before.starter_total, 61, "roster 1 before"); close(one.after.starter_total, 61, "roster 1 after");
  assert.deepEqual(one.before.bench, ["a_wr2"]); assert.deepEqual(one.after.bench, ["b_wr3"]);
  assert.equal(one.starter_change, 0); close(one.depth_change, -1, "positive VOR 1 leaves; VOR −1 adds max(0, −1)");
  assert.equal(one.forced_drops.status, "none"); assert.equal(one.forced_drops.required, 0); assert.equal(one.forced_drops.dropped, null);
  close(two.before.starter_total, 58, "roster 2 before"); close(two.depth_change, 1, "roster 2 gains VOR 1 on the bench");
  assert.equal(two.after.filled_starter_slots, 4); assert.equal(two.after.active_count, 6);
});

test("2-for-1, 1-for-2 and 2-for-2 apply both sides simultaneously; uneven packages force explicit drops", () => {
  const twoForOne = evaluated(base(), ["a_rb2", "a_wr2"], ["b_wr1"]);
  assert.equal(twoForOne.status, "evaluated");
  const receiver = sideOf(twoForOne, 2);
  assert.equal(receiver.forced_drops.required, 1); assert.equal(receiver.forced_drops.status, "selected");
  assert.deepEqual(receiver.forced_drops.dropped, ["b_wr3"], "keeps every starter and the most positive bench VOR");
  assert.equal(receiver.forced_drops.evaluated_combinations, 7);
  assert.deepEqual(receiver.forced_drops.candidates, ["a_rb2", "a_wr2", "b_qb", "b_rb", "b_te", "b_wr2", "b_wr3"]);
  close(receiver.after.starter_total, 54, "QB 18 + RB 13 + WR 11 + FLEX 12"); assert.equal(receiver.after.active_count, 6);
  assert.equal(sideOf(twoForOne, 1).forced_drops.status, "none"); assert.equal(sideOf(twoForOne, 1).after.active_count, 4);
  // 1-for-2 from the first side's view: roster 2 sends one player and receives two.
  const oneForTwo = evaluateTrade(base(), { sides: [{ roster_id: 2, sends: [{ type: "player", id: "b_wr1" }] },
    { roster_id: 1, sends: [{ type: "player", id: "a_rb2" }, { type: "player", id: "a_wr2" }] }], horizon: "next_game" });
  assert.deepEqual(validateTradeEvaluation(oneForTwo).violations, []);
  assert.deepEqual(oneForTwo.sides, twoForOne.sides, "side order in the proposal does not change the result");
  const twoForTwo = evaluated(base(), ["a_rb2", "a_wr2"], ["b_te", "b_wr3"]);
  assert.equal(twoForTwo.status, "evaluated"); assert.ok(twoForTwo.sides.every(s => s.forced_drops.status === "none"));
  assert.deepEqual(sideOf(twoForTwo, 1).receives, ["b_te", "b_wr3"]); assert.deepEqual(sideOf(twoForTwo, 2).receives, ["a_rb2", "a_wr2"]);
});

test("retained players move between starter and bench; depth change uses actual membership", () => {
  const one = sideOf(evaluated(base(), ["a_wr1"], ["b_wr3"]), 1);
  assert.deepEqual(one.before.bench, ["a_wr2"]);
  assert.ok(one.after.lineup.some(s => s.player_id === "a_wr2"), "a_wr2 promoted to a starter");
  assert.deepEqual(one.after.bench, ["b_wr3"]);
  close(one.starter_change, -5, "WR 14 replaced by 9"); close(one.depth_change, -1, "a_wr2 leaves the bench, b_wr3 adds 0");
});

test("lineup input is canonicalized: roster order never changes lineups, benches or deltas", () => {
  const tied = [sp("a_qb", ["QB"], 20, 20), sp("a_rb1", ["RB"], 15, 15), sp("a_rb2", ["RB"], 12, 12), sp("t_wr_b", ["WR"], 12, 10), sp("t_wr_a", ["WR"], 9, 10), sp("a_wr2", ["WR"], 9, 9)];
  const forward = evaluated(built({ rosters: [tied, ROSTER_2] }), ["a_wr2"], ["b_wr3"]);
  const reversed = evaluated(built({ rosters: [[...tied].reverse(), [...ROSTER_2].reverse()] }), ["a_wr2"], ["b_wr3"]);
  assert.deepEqual(reversed, forward);
  const bench = sideOf(forward, 1).before.bench;
  assert.equal(bench.filter(id => id.startsWith("t_wr")).length, 1, "equal next_game values: one tied WR benched, the same one every run");
});

test("dual-position players fill one slot and count once at their best single VOR", () => {
  const context = built({ rosters: [[sp("a_qb", ["QB"], 20, 20), sp("d_rbwr", ["RB", "WR"], 16, 16), sp("a_wr2", ["WR"], 9, 9)], ROSTER_2] });
  assert.equal(context.values.d_rbwr.vor, 8); assert.equal(context.values.d_rbwr.vor_position, "RB");
  const before = sideOf(evaluated(context, ["a_wr2"], ["b_wr3"]), 1).before;
  assert.equal(before.lineup.filter(s => s.player_id === "d_rbwr").length, 1);
  assert.equal(before.filled_starter_slots, 3, "one player cannot fill both RB and WR");
  assert.equal(before.positions.RB.positive_vor_assets, 1); assert.equal(before.positions.WR.positive_vor_assets, 1, "d_rbwr counted once, at RB");
});

test("Superflex QB scarcity: structural QB protection from the helper, QB demand as context only", () => {
  const positions = ["QB", "SUPER_FLEX", "WR", "BN"];
  const sfLevels = { ...LEVELS, QB: { replacement_value: 10, eligible_starter_demand: 2 } };
  const one = [sp("s_qb1", ["QB"], 20, 20), sp("s_qb2", ["QB"], 12, 12), sp("s_wr1", ["WR"], 14, 14), sp("s_wr2", ["WR"], 9, 9)];
  const two = [sp("t_qb", ["QB"], 18, 18), sp("t_wr1", ["WR"], 15, 15), sp("t_wr2", ["WR"], 11, 11)];
  const context = built({ rosters: [one, two], positions, levels: sfLevels });
  assert.equal(context.league.scoring_profile.superflex, true);
  assert.ok(context.protection.find(r => r.player_id === "s_qb2").reasons.includes("Structural Superflex QB asset"));
  const side = sideOf(evaluated(context, ["s_wr2"], ["t_wr1", "t_wr2"]), 1);
  assert.equal(side.forced_drops.required, 1); assert.deepEqual(side.forced_drops.dropped, ["t_wr2"]);
  assert.ok(side.forced_drops.excluded.some(x => x.player_id === "s_qb2" && x.reasons.includes("Structural Superflex QB asset")), "Superflex QBs are never candidates");
  assert.equal(side.before.positions.QB.eligible_starter_demand, 2); assert.equal(side.before.positions.QB.positive_vor_assets, 2);
});

test("TE premium enters only through league-scored values; the flex follows scored next_game values", () => {
  const roster = tep => [sp("a_qb", ["QB"], 20, 20), sp("a_rb1", ["RB"], 15, 15), sp("a_wr1", ["WR"], 14, 14), sp("x_te", ["TE"], 9, tep ? 12 : 9), sp("x_wr", ["WR"], 10, 10)];
  const standard = built({ rosters: [roster(false), ROSTER_2] }), premium = built({ rosters: [roster(true), ROSTER_2], scoring: { rec: 1, bonus_rec_te: 0.5 } });
  assert.equal(standard.league.scoring_profile.te_premium, false); assert.equal(premium.league.scoring_profile.te_premium, true);
  const flex = context => sideOf(evaluated(context, ["a_rb1"], ["b_rb"]), 1).before.lineup.find(s => s.slot === "FLEX").player_id;
  assert.equal(flex(standard), "x_wr"); assert.equal(flex(premium), "x_te");
});

test("pickup_value is never trade value; no score, verdict, probability or Market Value; pure imports", async () => {
  const inputs = tradeInputs({ rosters: [ROSTER_1, ROSTER_2] }), changed = structuredClone(inputs);
  for (const c of Object.values(changed.valueSource.contexts)) c.model.pickup_value.central = -999;
  const e = evaluateTradeFromInputs(inputs, offer(["a_rb2", "a_wr2"], ["b_wr1"]));
  assert.deepEqual(evaluateTradeFromInputs(changed, offer(["a_rb2", "a_wr2"], ["b_wr1"])), e);
  assert.deepEqual(validateTradeEvaluation(e).violations, []); assert.equal(e.market_value, null);
  const json = JSON.stringify(e);
  for (const key of FORBIDDEN_EVALUATION_KEYS) assert.ok(!json.includes(`"${key}"`), key);
  for (const file of ["evaluate.js", "context.js"]) {
    const source = await readFile(new URL(`../lib/trade/${file}`, import.meta.url), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map(m => m[1]);
    assert.ok(imports.every(i => /^\.\/(contracts|context)\.js$|^\.\.\/decision\/(optimizer|team-strength|replacement|basis)\.js$|^\.\.\/normalize\/positions\.js$/.test(i)), `${file}: ${imports}`);
    assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /pickup_value|\bfetch\s*\(|process\.env|signals|market/);
  }
});

test("forced drops: filled slots outrank raw starter total; canonical dropped-id order breaks ties", () => {
  const plan = (context, k) => [{ placement: {}, reserve_keys: [], active: context.rosters[0].players, k }];
  const filled = built({ rosters: [[sp("f_qb", ["QB"], 20, 20), sp("f_te", ["TE"], 8, -2), sp("f_wr", ["WR"], 12, 30), sp("f_qb2", ["QB"], 11, 11)], ROSTER_2], positions: ["QB", "TE", "BN"] });
  const r = resolveForcedDrops(filled, plan(filled, 1));
  assert.equal(r.status, "selected"); assert.deepEqual(r.selected.dropped, ["f_qb2"]);
  assert.equal(r.selected.state.filled_starter_slots, 2);
  close(r.selected.state.starter_total, 18, "full legal lineup containing the −2 TE ranks above dropping the TE (one slot empty, total 20)");
  const tie = built({ rosters: [[sp("a_qb", ["QB"], 20, 20), sp("Zed", ["WR"], 7, 1), sp("abe", ["WR"], 7, 1), sp("a_wr1", ["WR"], 14, 14)], ROSTER_2], positions: ["QB", "WR", "BN"] });
  const t = resolveForcedDrops(tie, plan(tie, 1));
  assert.deepEqual(t.selected.dropped, ["Zed"], "UTF-16 code-unit order: 'Z' (0x5A) sorts before 'a' (0x61), unlike locale order");
  assert.equal(t.evaluated_combinations, 4);
  const state = bench => ({ filled_starter_slots: 2, starter_total: 34, bench, unknown_lineup_players: [] });
  assert.deepEqual(compareCandidates(tie, { dropped: ["Zed"], reserve_keys: [], state: state(["abe"]) }, { dropped: ["abe"], reserve_keys: [], state: state(["Zed"]) }),
    { order: -1, key: "dropped_ids" });
});

test("k > 2 is unsupported and never truncated; the package cap keeps k ≤ 2 through evaluateTrade", () => {
  const context = base();
  const r = resolveForcedDrops(context, [{ placement: {}, reserve_keys: [], active: context.rosters[1].players, k: 3 }]);
  assert.equal(r.status, "unsupported"); assert.equal(r.required, 3); assert.equal(r.evaluated_combinations, 0); assert.equal(r.selected, null);
  // Through the evaluator k = active_before − outgoing_active + incoming_active − capacity ≤ 2: sending a reserve player frees no active slot.
  const sender = [...ROSTER_2.map(p => ({ ...p, id: `c_${p.id}` })), sp("c_ir", ["WR"], 5, 5, { reserve: true, injury: "IR" })];
  const receiver = [...ROSTER_1.map(p => ({ ...p, id: `d_${p.id}` })), sp("d_x", ["WR"], 8, 8)];
  const side = sideOf(evaluated(built({ rosters: [sender, receiver], settings: { reserve_slots: 1, taxi_slots: 0 } }), ["c_ir"], ["d_a_rb2", "d_a_wr2"]), 1);
  assert.equal(side.forced_drops.required, 2); assert.equal(side.forced_drops.dropped.length, 2); assert.equal(side.forced_drops.evaluated_combinations, 28);
});

test("protected players are never dropped; blocked only when demonstrably not enough droppable players", () => {
  const side = sideOf(evaluated(built({ rosters: [ROSTER_1, injure(ROSTER_2, ["b_te", "b_wr3", "b_wr2"])] }), ["a_rb2", "a_wr2"], ["b_wr1"]), 2);
  assert.equal(side.forced_drops.status, "selected");
  assert.ok(!["b_te", "b_wr3", "b_wr2"].includes(side.forced_drops.dropped[0]), "injured players are protected");
  assert.deepEqual(side.forced_drops.excluded.map(x => x.player_id), ["b_te", "b_wr2", "b_wr3"]);
  const blocked = evaluated(built({ rosters: [injure(ROSTER_1), injure(ROSTER_2)] }), ["a_rb2", "a_wr2"], ["b_wr1"]);
  assert.equal(blocked.status, "blocked");
  const b = sideOf(blocked, 2);
  assert.equal(b.forced_drops.status, "blocked"); assert.equal(b.forced_drops.dropped, null); assert.equal(b.after, null);
  assert.equal(b.starter_change, null); assert.equal(b.depth_change, null);
  assert.equal(b.forced_drops.diagnostics[0].reason, "not_enough_droppable_players");
  assert.deepEqual(blocked.errors.map(e => [e.code, e.roster_id]), [["FORCED_DROP_BLOCKED", "2"]]);
  assert.ok(sideOf(blocked, 1).after, "the resolved side keeps its results as diagnostics");
});

test("insufficient protection evidence is undetermined, never assumed droppable, unless demonstrably blocked", () => {
  const e = evaluated(built({ rosters: [ROSTER_1, ROSTER_2], omitEvidence: ["b_wr3"] }), ["a_rb2", "a_wr2"], ["b_wr1"]);
  assert.equal(e.status, "withheld");
  const side = sideOf(e, 2);
  assert.equal(side.forced_drops.status, "undetermined"); assert.equal(side.forced_drops.dropped, null); assert.equal(side.after, null);
  assert.deepEqual(side.forced_drops.excluded.map(x => [x.player_id, x.evidence, x.cause]), [["b_wr3", "insufficient", "no_record"]]);
  assert.deepEqual(e.errors.map(x => [x.code, x.roster_id]), [["FORCED_DROP_UNDETERMINED", "2"]]);
  // Every other active player protected: 0 droppable + 1 insufficient ≥ k = 1 ⇒ not demonstrably blocked.
  const u = evaluated(built({ rosters: [injure(ROSTER_1), injure(ROSTER_2, ["b_qb", "b_rb", "b_wr1", "b_wr2", "b_te"])], omitEvidence: ["b_wr3"] }), ["a_rb2", "a_wr2"], ["b_wr1"]);
  assert.equal(sideOf(u, 2).forced_drops.status, "undetermined"); assert.equal(u.status, "withheld");
  // A single record with mismatched provenance is insufficient for that player only.
  const context = base(); context.protection = context.protection.map(r => r.player_id === "b_te" ? { ...r, provenance: { ...r.provenance, week: 2 } } : r);
  const m = sideOf(evaluated(context, ["a_rb2", "a_wr2"], ["b_wr1"]), 2);
  assert.equal(m.forced_drops.status, "undetermined");
  assert.ok(m.forced_drops.excluded.some(x => x.player_id === "b_te" && x.cause === "provenance_mismatch:week"));
});

test("unknown lineup-relevant next_game makes assignment, totals and bench undetermined; filled slots stay known", () => {
  const unknown = ROSTER_1.map(p => p.id === "a_wr2" ? { ...p, start: null } : p);
  const e = evaluated(built({ rosters: [unknown, ROSTER_2] }), ["a_rb2"], ["b_rb"]);
  const side = sideOf(e, 1);
  assert.equal(e.status, "evaluated", "no forced drop needed; unknowns are disclosed, not guessed");
  for (const state of [side.before, side.after]) {
    assert.equal(state.lineup, null); assert.equal(state.starter_total, null); assert.equal(state.bench, null); assert.equal(state.depth_total, null);
    assert.equal(state.filled_starter_slots, 4);
  }
  assert.equal(side.starter_change, null); assert.equal(side.depth_change, null);
  assert.ok(side.unknowns.some(u => u.field === "before.starter_total" && u.player_ids.includes("a_wr2")));
  // An unknown value on a player who cannot play this week is not lineup-relevant.
  const benchOnly = ROSTER_1.map(p => p.id === "a_wr2" ? { ...p, start: null, injury: "Out" } : p);
  assert.notEqual(sideOf(evaluated(built({ rosters: [benchOnly, ROSTER_2] }), ["a_rb2"], ["b_rb"]), 1).before.starter_total, null);
  // Unknowns that prevent ranking forced-drop candidates ⇒ undetermined, naming the key and players.
  const receiver = ROSTER_2.map(p => p.id === "b_te" ? { ...p, start: null, positions: ["WR"] } : p);
  const r = evaluated(built({ rosters: [ROSTER_1, receiver] }), ["a_rb2", "a_wr2"], ["b_wr1"]);
  const d = sideOf(r, 2).forced_drops;
  assert.equal(d.status, "undetermined"); assert.equal(r.status, "withheld");
  assert.ok(d.diagnostics.some(x => x.reason === "ranking_undetermined" && x.key === "starter_total" && x.player_ids.includes("b_te")));
});

test("depth: same-player unknown VOR cancels only on the bench in both states; absolute total stays null", () => {
  const context = built({ rosters: [[...ROSTER_1, sp("m_wr", ["WR"], null, null, { injury: "Out" })], ROSTER_2] });
  const kept = sideOf(evaluated(context, ["a_wr2"], ["b_wr3"]), 1);
  assert.ok(kept.before.bench.includes("m_wr") && kept.after.bench.includes("m_wr"));
  assert.equal(kept.before.depth_total, null); assert.equal(kept.after.depth_total, null);
  close(kept.depth_change, -1, "m_wr cancels; a_wr2 (1) out, b_wr3 (0) in");
  const traded = sideOf(evaluated(context, ["m_wr"], ["b_wr3"]), 1);
  assert.equal(traded.depth_change, null, "the unknown player leaves the bench: no cancellation");
  assert.ok(traded.unknowns.some(u => u.field === "depth_change" && u.player_ids.includes("m_wr")));
  assert.equal(traded.before.depth_total, null); assert.notEqual(traded.after.depth_total, null);
});

test("reserve placement only when slot, eligibility and capability are verified; otherwise active capacity", () => {
  const incoming = [sp("b_inj", ["WR"], 7, 7, { injury: "IR" }), ...ROSTER_2.filter(p => p.id !== "b_wr3")];
  const full = [...ROSTER_1, sp("a_x", ["WR"], 10, 10)];
  const eligible = { b_inj: { reserve: "verified", taxi: "unknown" } };
  const run = options => evaluated(built({ rosters: [full, incoming], settings: { reserve_slots: 1, taxi_slots: 0 }, ...options }), ["a_wr2"], ["b_inj", "b_te"]);
  const verified = sideOf(run({ placement: eligible }), 1);
  assert.equal(verified.reserve_placement.find(p => p.player_id === "b_inj").placement, "reserve");
  assert.equal(verified.forced_drops.status, "none"); assert.equal(verified.after.active_count, 6);
  for (const [label, options, limit] of [
    ["eligibility unknown (injury status alone never places a player)", {}, "reserve eligibility unverified"],
    ["capability missing", { placement: eligible, capabilities: {} }, "IR capability unavailable"],
    ["slot count unverified", { placement: eligible, settings: {} }, "reserve slot capacity unverified"],
  ]) {
    const e = run(options), side = sideOf(e, 1), placed = side.reserve_placement.find(p => p.player_id === "b_inj");
    assert.equal(placed.placement, "active", label); assert.ok(placed.limitations.includes(limit), label);
    assert.equal(side.forced_drops.required, 1, `${label}: counts against active capacity`);
    assert.ok(side.warnings.some(w => w.includes("b_inj")), label); assert.equal(e.legality, "conditional_known_rules");
  }
});

test("two incoming players competing for one verified reserve slot are allocated jointly, never sharing it", () => {
  const incoming = [sp("b_inj1", ["WR"], 7, 7, { injury: "IR" }), sp("b_inj2", ["WR"], 7, 7, { injury: "IR" }), ...ROSTER_2.slice(0, 4)];
  const placement = { b_inj1: { reserve: "verified", taxi: "unknown" }, b_inj2: { reserve: "verified", taxi: "unknown" } };
  const context = built({ rosters: [[...ROSTER_1, sp("a_x", ["WR"], 10, 10)], incoming], settings: { reserve_slots: 1, taxi_slots: 0 }, placement });
  const roster = context.rosters[0], arriving = context.rosters[1].players.filter(p => p.player_id.startsWith("b_inj"));
  const { allocations } = reserveAllocations(context, roster, arriving, roster.players.filter(p => p.player_id === "a_wr2"));
  assert.deepEqual(allocations.map(a => a.placement),
    [{ b_inj1: "active", b_inj2: "active" }, { b_inj1: "active", b_inj2: "reserve" }, { b_inj1: "reserve", b_inj2: "active" }], "never both in one slot");
  const side = sideOf(evaluated(context, ["a_wr2"], ["b_inj1", "b_inj2"]), 1);
  assert.deepEqual(side.reserve_placement.map(p => [p.player_id, p.placement]), [["b_inj1", "reserve"], ["b_inj2", "active"]], "canonical reserve-placement tiebreak");
  assert.equal(side.forced_drops.status, "none"); assert.equal(side.after.active_count, 6);
  assert.equal(side.forced_drops.evaluated_combinations, 7, "5 all-active drop combinations + 2 single-reserve allocations");
});

test("over capacity before the trade is withheld; malformed and unsupported proposals stay unvalued", () => {
  const e = evaluated(built({ rosters: [ROSTER_1, [...ROSTER_2, sp("b_extra", ["WR"], 6, 6)]] }), ["a_wr2"], ["b_wr3"]);
  assert.equal(e.status, "withheld"); assert.deepEqual(e.errors.map(x => [x.code, x.roster_id]), [["OVER_CAPACITY_BEFORE", "2"]]);
  assert.equal(sideOf(e, 2).after, null); assert.equal(sideOf(e, 2).starter_change, null);
  const context = base();
  for (const [proposal, status] of [[offer(["a_wr2"], ["b_wr3"], "rest_of_season"), "unsupported"], [offer(["a_wr2", "a_wr1", "a_rb1"], ["b_wr3"]), "unsupported"],
    [offer(["b_wr3"], ["a_wr2"]), "invalid"], [offer([], ["b_wr3"]), "unsupported"], [{ ...offer(["a_wr2"], ["b_wr3"]), score: 1 }, "invalid"]]) {
    const result = evaluateTrade(context, proposal);
    assert.equal(result.status, status); assert.deepEqual(result.sides, []); assert.deepEqual(validateTradeEvaluation(result).violations, []);
  }
  const picks = offer(["a_wr2"], ["b_wr3"]); picks.sides[1].sends.push({ type: "draft_pick", id: "2027-1" });
  assert.deepEqual(evaluateTrade(context, picks).errors.map(x => x.code), ["UNSUPPORTED_ASSET"]);
  const invalid = evaluateTrade({ ...context, versions: null }, offer(["a_wr2"], ["b_wr3"]));
  assert.equal(invalid.status, "invalid"); assert.deepEqual(invalid.sides, []);
});

test("a relevant game already kicked off withholds starter change (lock unverified); totals stay reported", () => {
  const started = ROSTER_1.map(p => p.id === "a_qb" ? { ...p, context: { schedule: "kickoff_passed" } } : p);
  const side = sideOf(evaluated(built({ rosters: [started, ROSTER_2] }), ["a_wr2"], ["b_wr3"]), 1);
  assert.equal(side.starter_change, null); assert.notEqual(side.after.starter_total, null);
  assert.ok(side.unknowns.some(u => u.field === "starter_change" && u.player_ids.includes("a_qb")));
});

// ---- Owner amendment 2026-09-26: unsupported K/DEF/IDP slots; drop count before bench VOR -------

const KDEF_ROSTER = ["QB", "RB", "WR", "FLEX", "K", "DEF", "BN", "BN"];
const kicker = (id, q = 8) => sp(id, ["K"], q, null, { context: { supported: false } });
const defense = id => sp(id, ["DEF"], 7, null, { context: { supported: false } });
const kdef = (extra = {}) => built({ rosters: [[...ROSTER_1, kicker("k1"), defense("d1")], [...ROSTER_2, kicker("k2"), defense("d2")]], positions: KDEF_ROSTER, ...extra });

test("K and DEF slots count for legality but never poison supported valuation; their value stays null, never zero", () => {
  const context = kdef();
  assert.equal(context.values.k1.next_game, null); assert.equal(context.values.k1.vor, null);
  const e = evaluated(context, ["a_wr1"], ["b_wr3"]), one = sideOf(e, 1);
  assert.equal(e.status, "evaluated");
  close(one.before.starter_total, 61, "offensive value slots only"); close(one.starter_change, -5, "determined supported starter change");
  close(one.depth_change, -1, "K/DEF excluded from bench VOR");
  assert.equal(one.before.filled_starter_slots, 6, "K and DEF slots are filled for legality");
  const k = one.before.lineup.find(s => s.slot === "K");
  assert.deepEqual(k, { slot: "K", player_id: "k1", value: null, valued: false }, "unvalued, never zero");
  assert.deepEqual(one.before.unvalued_slots, ["K", "DEF"]); assert.deepEqual(one.before.unvalued_players, ["d1", "k1"]);
  assert.ok(!one.before.bench.includes("k1") && !one.before.bench.includes("d1"));
  assert.ok(one.unknowns.some(u => u.field === "unvalued_starter_slots" && u.slots.join() === "K,DEF"));
  assert.ok(one.warnings.some(w => /K, DEF are excluded from football-value totals/.test(w)));
  // An empty K slot lowers the legal fill but still does not poison the value.
  const noKicker = built({ rosters: [[...ROSTER_1, defense("d1")], [...ROSTER_2, kicker("k2"), defense("d2")]], positions: KDEF_ROSTER });
  const empty = sideOf(evaluated(noKicker, ["a_wr2"], ["b_wr3"]), 1).before;
  assert.equal(empty.filled_starter_slots, 5); close(empty.starter_total, 61, "value unchanged by the empty K slot");
});

test("K/DEF missing values do not poison forced-drop ranking; K/DEF are never forced-drop candidates", () => {
  const e = evaluated(kdef(), ["a_rb2", "a_wr2"], ["b_wr1"]), receiver = sideOf(e, 2);
  assert.equal(e.status, "evaluated");
  assert.equal(receiver.forced_drops.status, "selected"); assert.deepEqual(receiver.forced_drops.dropped, ["b_wr3"]);
  close(receiver.after.starter_total, 54, "same modeled lineup as the league without K/DEF");
  assert.ok(receiver.forced_drops.excluded.some(x => x.player_id === "k2" && x.reasons.includes("K/DST/IDP advanced value unsupported")));
});

test("explicitly trading a player without modeled football value is unsupported, never a completed valuation", () => {
  const context = kdef();
  for (const [a, b] of [[["k1"], ["b_wr3"]], [["a_wr2"], ["d2"]], [["a_wr2", "k1"], ["b_wr3"]]]) {
    const e = evaluated(context, a, b);
    assert.equal(e.status, "unsupported"); assert.deepEqual(e.sides, []);
    assert.ok(e.errors.every(x => x.code === "UNSUPPORTED_ASSET") && e.errors.some(x => ["k1", "d2"].includes(x.asset_id)));
  }
  // A skill-position player whose model is unsupported is not silently valued either.
  const unmodeled = built({ rosters: [ROSTER_1.map(p => p.id === "a_wr2" ? { ...p, context: { supported: false } } : p), ROSTER_2] });
  const u = evaluated(unmodeled, ["a_wr2"], ["b_wr3"]);
  assert.equal(u.status, "unsupported"); assert.deepEqual(u.errors.map(x => [x.code, x.asset_id]), [["UNSUPPORTED_ASSET", "a_wr2"]]);
});

test("verified reserve or taxi placement beats an unnecessary forced drop when the lineup is equal", () => {
  const incoming = [sp("b_star", ["WR"], 30, 30, { injury: "IR" }), ...ROSTER_2.filter(p => p.id !== "b_wr3")];
  const full = [...ROSTER_1, sp("a_x", ["WR"], 10, 10)];
  const run = options => sideOf(evaluated(built({ rosters: [full, incoming], ...options }), ["a_wr2"], ["b_star", "b_te"]), 1);
  const ir = run({ settings: { reserve_slots: 1, taxi_slots: 0 }, placement: { b_star: { reserve: "verified", taxi: "unknown" } } });
  assert.deepEqual(ir.reserve_placement.map(p => [p.player_id, p.placement]), [["b_star", "reserve"], ["b_te", "active"]]);
  assert.equal(ir.forced_drops.status, "none"); assert.equal(ir.forced_drops.dropped, null);
  const taxi = run({ settings: { reserve_slots: 0, taxi_slots: 1 }, placement: { b_star: { reserve: "unknown", taxi: "verified" } } });
  assert.equal(taxi.reserve_placement.find(p => p.player_id === "b_star").placement, "taxi"); assert.equal(taxi.forced_drops.status, "none");
  // Without verified eligibility the player is never placed: one forced drop, the high-VOR injured player stays active.
  const unverified = run({ settings: { reserve_slots: 1, taxi_slots: 1 } });
  assert.equal(unverified.reserve_placement.find(p => p.player_id === "b_star").placement, "active");
  assert.equal(unverified.forced_drops.status, "selected"); assert.equal(unverified.forced_drops.dropped.length, 1);
  const noTaxiCapability = run({ settings: { reserve_slots: 0, taxi_slots: 1 }, placement: { b_star: { reserve: "unknown", taxi: "verified" } },
    capabilities: { IR: { status: "available" }, taxiSquads: { status: "unsupported" } } });
  assert.equal(noTaxiCapability.reserve_placement.find(p => p.player_id === "b_star").placement, "active");
});

test("a better modeled starting lineup still outranks a zero-drop reserve placement", () => {
  const incoming = [sp("b_star", ["WR"], 30, 30), ...ROSTER_2.filter(p => p.id !== "b_wr3")];
  const context = built({ rosters: [[...ROSTER_1, sp("a_x", ["WR"], 10, 10)], incoming], settings: { reserve_slots: 1, taxi_slots: 0 },
    placement: { b_star: { reserve: "verified", taxi: "unknown" } } });
  const side = sideOf(evaluated(context, ["a_wr2"], ["b_star", "b_te"]), 1);
  assert.equal(side.reserve_placement.find(p => p.player_id === "b_star").placement, "active", "starting b_star beats reserving him");
  assert.equal(side.forced_drops.status, "selected"); assert.equal(side.forced_drops.dropped.length, 1);
  assert.ok(side.after.lineup.some(s => s.player_id === "b_star"));
  const state = (total, bench) => ({ filled_starter_slots: 4, starter_total: total, bench, unknown_lineup_players: [] });
  assert.deepEqual(compareCandidates(context, { dropped: [], reserve_keys: [], state: state(60, []) }, { dropped: ["a_x"], reserve_keys: [], state: state(60, ["b_te"]) }),
    { order: -1, key: "drop_count" }, "equal lineups: fewer drops first, before bench VOR");
  assert.deepEqual(compareCandidates(context, { dropped: [], reserve_keys: [], state: state(60, []) }, { dropped: ["a_x"], reserve_keys: [], state: state(61, []) }),
    { order: 1, key: "starter_total" });
});
