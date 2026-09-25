import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TRADE_SCHEMA_VERSION, ERROR_CODES, HORIZONS, horizonFor, compareIds, compareIdSequences, canonicalIdSequence,
  validateTradeProposal, validateTradeContext, effectiveProtection, checkBasis, compareContextMetadata, slotStructure,
  capabilityAvailable, createTradeEvaluation, emptySideResult, packageStatus, validateTradeEvaluation, statusForErrors, tradeError,
} from "../lib/trade/contracts.js";

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
    protection: { provider: "sleeper", league_id: "L1", season: 2026, week: 3, model_version: "m", feature_version: "f" } });
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
  const spectator = sources(); for (const s of [spectator.snapshot, spectator.value_source]) { s.identity_mode = "spectator"; s.selected_roster_id = null; }
  assert.equal(compareContextMetadata(spectator).ok, true);
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
  assert.equal(statusForErrors([]), "evaluated");
  assert.equal(statusForErrors([tradeError("UNSUPPORTED_DROP_COUNT")]), "unsupported");
  assert.equal(statusForErrors([tradeError("OVER_CAPACITY_BEFORE"), tradeError("CAPACITY_UNKNOWN")]), "withheld");
  assert.throws(() => tradeError("NOT_A_CODE"));
  for (const code of ["STALE_BASIS", "CONTEXT_MISMATCH", "UNKNOWN_ROSTER", "SAME_ROSTER", "EMPTY_SIDE", "ASSET_NOT_OWNED", "DUPLICATE_ASSET", "UNSUPPORTED_ASSET",
    "UNSUPPORTED_HORIZON", "PACKAGE_TOO_LARGE", "UNSUPPORTED_TRADE_SHAPE", "UNSUPPORTED_SLOTS", "UNSUPPORTED_DROP_COUNT", "CAPACITY_UNKNOWN",
    "OVER_CAPACITY_BEFORE", "FORCED_DROP_BLOCKED", "FORCED_DROP_UNDETERMINED"]) assert.ok(ERROR_CODES[code], `spec code ${code}`);
});
