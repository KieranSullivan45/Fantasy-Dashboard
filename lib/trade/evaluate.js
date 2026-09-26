// Trade package evaluator (trade-1, provisional). V04-01 phase B. Specification: docs/v0.4.md → Evaluation semantics.
// Pure and deterministic over an in-memory TradeContext: no provider transport, network, signals, market or
// calibration inputs. Lineup value is model.start_value.central (next_game) only; pickup_value is never read.
import { optimizeLineup } from "../decision/optimizer.js";
import { unavailableThisWeek } from "../decision/team-strength.js";
import { SKILL_POSITIONS } from "../decision/replacement.js";
import { SLOT_POSITIONS, fantasyPositions, fitsSlot } from "../normalize/positions.js";
import {
  PACKAGE_LIMITS, capabilityAvailable, compareIds, compareIdSequences, createTradeEvaluation, effectiveProtection, emptySideResult,
  idKey, sortErrors, statusForErrors, tradeError, validateTradeContext, validateTradeProposal,
} from "./contracts.js";
import { buildTradeContext } from "./context.js";

/** Numeric keys closer than this compare as equal, so float summation order cannot decide a ranking. */
const EPSILON = 1e-9;
const byId = (a, b) => compareIds(a.player_id, b.player_id);
const ids = players => players.map(p => p.player_id).sort(compareIds);
const valueOf = (context, id) => context.values?.[id] ?? null;
/** Same availability filter as add/drop: not unavailable this week and not without a scheduled game. */
const usable = (context, p) => !unavailableThisWeek(p) && valueOf(context, p.player_id)?.schedule_status !== "no_scheduled_game";
/** Modeled football value exists only for QB/RB/WR/TE; K, DEF and IDP players have none (never zero). */
const modeledPlayer = p => fantasyPositions(p).some(pos => SKILL_POSITIONS.includes(pos));
/** A starter slot is a value slot when it accepts a modeled position; dedicated K/DEF/IDP slots count for legality only. */
const valueSlot = slot => (SLOT_POSITIONS[slot] || []).some(pos => SKILL_POSITIONS.includes(pos));
const PLACEMENTS = Object.freeze([
  { kind: "reserve", capability: "IR", open: "reserve_open" },
  { kind: "taxi", capability: "taxiSquads", open: "taxi_open" },
]);

// ---- Lineup state ----------------------------------------------------------------------------

/**
 * Values one active-roster state. Optimizer input is canonicalized (sorted by player id).
 * filled_starter_slots counts every starter slot (legality), including dedicated K/DEF/IDP slots. Football value
 * (lineup values, starter_total, bench, depth_total) covers only value slots and modeled players: unsupported dedicated
 * slots and K/DEF/IDP players are reported as unvalued, never counted as zero. If any lineup-relevant player (usable and
 * eligible for a value slot) has an unknown next_game value, or a modeled player could be needed in an unsupported slot,
 * assignment, starter_total and bench membership are undetermined (null); filled_starter_slots stays known.
 */
export function evaluateLineupState(context, activePlayers) {
  const slots = context.league.starter_slots, players = [...activePlayers].sort(byId);
  const valueSlots = slots.filter(valueSlot), otherSlots = slots.filter(s => !valueSlot(s));
  const fitsAny = (p, list) => list.some(s => fitsSlot(p, s)), zeros = list => Object.fromEntries(list.map(p => [p.player_id, 0]));
  const fill = (list, slotList) => optimizeLineup(list, slotList, zeros(list));
  const filledIn = lineup => lineup.filter(s => s.player_id !== null).length;
  const available = players.filter(p => usable(context, p));
  const relevant = available.filter(p => modeledPlayer(p) && fitsAny(p, valueSlots));
  const unvalued = available.filter(p => !modeledPlayer(p) && fitsAny(p, otherSlots));
  const unknownRelevant = ids(relevant.filter(p => valueOf(context, p.player_id)?.next_game == null));
  const filled = filledIn(fill(available.filter(p => fitsAny(p, slots)), slots)), otherLineup = fill(unvalued, otherSlots);
  // Modeled players eligible for an unsupported slot would couple the value lineup to legality: never guessed.
  const separable = filledIn(fill(relevant, valueSlots)) + filledIn(otherLineup) === filled;
  const state = { active_ids: ids(players), active_count: players.length, active_capacity: context.league.active_capacity,
    filled_starter_slots: filled, lineup: null, starter_total: null, bench: null, depth_total: null,
    unvalued_slots: otherSlots, unvalued_players: ids(players.filter(p => !modeledPlayer(p))),
    positions: positionalContext(context, players), unknown_lineup_players: unknownRelevant, unknown_bench_vor: [],
    undetermined_reason: unknownRelevant.length ? "Lineup-relevant player with unknown next_game value: assignment, starter_total and bench membership are undetermined."
      : !separable ? "A modeled player is eligible for an unsupported K/DEF/IDP slot; the valued lineup cannot be separated from legality." : null };
  if (state.undetermined_reason) return state;
  const valueLineup = optimizeLineup(relevant, valueSlots, Object.fromEntries(relevant.map(p => [p.player_id, valueOf(context, p.player_id).next_game])));
  let vi = 0, oi = 0;
  state.lineup = slots.map(slot => {
    if (valueSlot(slot)) { const { player_id, value } = valueLineup[vi++]; return { slot, player_id, value, valued: true }; }
    return { slot, player_id: otherLineup[oi++].player_id, value: null, valued: false };
  });
  const starters = new Set(state.lineup.map(s => s.player_id).filter(id => id !== null));
  state.starter_total = valueLineup.reduce((sum, s) => (s.player_id === null ? sum : sum + s.value), 0);
  state.bench = ids(players.filter(p => modeledPlayer(p) && !starters.has(p.player_id)));
  state.unknown_bench_vor = state.bench.filter(id => valueOf(context, id)?.vor == null);
  state.depth_total = state.unknown_bench_vor.length ? null : state.bench.reduce((sum, id) => sum + Math.max(0, valueOf(context, id).vor), 0);
  return state;
}

/** Positive-VOR assets per position (each player once, at its best single VOR position) vs starter demand. Context only. */
function positionalContext(context, players) {
  return Object.fromEntries(SKILL_POSITIONS.map(pos => {
    const at = players.filter(p => valueOf(context, p.player_id)?.vor_position === pos);
    return [pos, { positive_vor_assets: at.filter(p => valueOf(context, p.player_id).vor > 0).length,
      unknown_vor_assets: players.filter(p => fantasyPositions(p).includes(pos) && valueOf(context, p.player_id)?.vor == null).length,
      eligible_starter_demand: context.league.starter_demand?.[pos] ?? null }];
  }));
}

const publicState = state => state && ({ lineup: state.lineup, filled_starter_slots: state.filled_starter_slots, starter_total: state.starter_total,
  bench: state.bench, depth_total: state.depth_total, active_count: state.active_count, active_capacity: state.active_capacity,
  unvalued_slots: state.unvalued_slots, unvalued_players: state.unvalued_players, positions: state.positions });

// ---- Reserve / taxi allocation ----------------------------------------------------------------

/**
 * Feasible placements of incoming players. Reserve/taxi is an option only when the provider capability is available,
 * the open slot count is verified and positive, and the player's placement eligibility is verified; injury status is never
 * read. Players are never assumed to share a slot: each allocation respects the open counts. The all-active allocation is first.
 */
export function reserveAllocations(context, roster, incoming, outgoing) {
  const openAfter = Object.fromEntries(PLACEMENTS.map(({ kind, open }) => [kind,
    roster[open]?.verified ? roster[open].count + outgoing.filter(p => p.roster_status === kind).length : null]));
  const options = incoming.map(p => {
    const limits = [], choices = ["active"];
    for (const { kind, capability } of PLACEMENTS) {
      const failed = [!capabilityAvailable(context, capability) && `${capability} capability unavailable`,
        openAfter[kind] == null ? `${kind} slot capacity unverified` : openAfter[kind] < 1 && `no open ${kind} slot`,
        p.placement?.[kind] !== "verified" && `${kind} eligibility unverified`].filter(Boolean);
      if (failed.length) limits.push(...failed); else choices.push(kind);
    }
    return { player: p, choices, limits };
  });
  let allocations = [{}];
  for (const { player, choices } of [...options].sort((a, b) => byId(a.player, b.player)))
    allocations = allocations.flatMap(a => choices.map(choice => ({ ...a, [player.player_id]: choice })));
  allocations = allocations.filter(a => PLACEMENTS.every(({ kind }) => Object.values(a).filter(c => c === kind).length <= (openAfter[kind] ?? 0)));
  return { options, allocations: allocations.map(placement => ({ placement,
    reserve_keys: Object.entries(placement).filter(([, c]) => c !== "active").map(([id, c]) => `${id}\u0000${c}`).sort(compareIds) })) };
}

// ---- Forced drops -----------------------------------------------------------------------------

function combinations(list, k) {
  if (k === 0) return [[]];
  const out = [];
  list.forEach((x, i) => { for (const rest of combinations(list.slice(i + 1), k - 1)) out.push([x, ...rest]); });
  return out;
}

/**
 * Lexicographic comparison of two candidate after-states (negative ⇒ a ranks first). Keys (owner amendment of
 * 2026-09-26): filled starter slots desc, modeled starter total desc, forced-drop count asc, preserved positive bench VOR desc
 * (same-player-both-benches cancellation only), dropped-id sequence asc, reserve-placement sequence asc.
 * An unknown at the starter-total key or an uncancelled unknown at the bench-VOR key ⇒ undetermined.
 */
export function compareCandidates(context, a, b) {
  if (a.state.filled_starter_slots !== b.state.filled_starter_slots)
    return { order: b.state.filled_starter_slots - a.state.filled_starter_slots, key: "filled_starter_slots" };
  if (a.state.starter_total === null || b.state.starter_total === null)
    return { undetermined: true, key: "starter_total", player_ids: canonicalUnion(a.state.unknown_lineup_players, b.state.unknown_lineup_players) };
  if (Math.abs(a.state.starter_total - b.state.starter_total) > EPSILON)
    return { order: b.state.starter_total > a.state.starter_total ? 1 : -1, key: "starter_total" };
  if (a.dropped.length !== b.dropped.length) return { order: a.dropped.length - b.dropped.length, key: "drop_count" };
  const onA = new Set(a.state.bench), onB = new Set(b.state.bench);
  const onlyA = a.state.bench.filter(id => !onB.has(id)), onlyB = b.state.bench.filter(id => !onA.has(id));
  const unknown = [...onlyA, ...onlyB].filter(id => valueOf(context, id)?.vor == null);
  if (unknown.length) return { undetermined: true, key: "bench_vor", player_ids: canonicalUnion(unknown) };
  const depth = list => list.reduce((sum, id) => sum + Math.max(0, valueOf(context, id).vor), 0);
  const diff = depth(onlyB) - depth(onlyA);
  if (Math.abs(diff) > EPSILON) return { order: diff > 0 ? 1 : -1, key: "bench_vor" };
  const dropped = compareIdSequences(a.dropped, b.dropped);
  if (dropped) return { order: dropped, key: "dropped_ids" };
  return { order: compareIdSequences(a.reserve_keys, b.reserve_keys), key: "reserve_placement" };
}
const canonicalUnion = (...lists) => [...new Set(lists.flat())].sort(compareIds);

/**
 * Forced-drop resolution over one side's allocation plans (`{ placement, reserve_keys, active, k }`).
 * k > 2 in any plan ⇒ unsupported with no search (never truncated). Per plan with k > 0: droppable + insufficient < k ⇒
 * blocked; otherwise any insufficient-evidence active player ⇒ undetermined; otherwise every k-combination of droppable players
 * is a candidate. All plans blocked ⇒ blocked; any plan undetermined ⇒ undetermined; else the candidate that ranks
 * determinably first against every other is selected, or the side is undetermined.
 */
export function resolveForcedDrops(context, plans) {
  const result = { status: null, required: plans[0]?.k ?? null, selected: null, candidates: [], excluded: [], evaluated_combinations: 0, diagnostics: [] };
  const tooMany = plans.filter(p => p.k > PACKAGE_LIMITS.maxForcedDropsPerSide);
  if (tooMany.length) {
    result.status = "unsupported"; result.required = Math.max(...tooMany.map(p => p.k));
    result.diagnostics.push({ reason: "drop_count_unsupported", required: result.required, message: `${result.required} forced drops required; at most ${PACKAGE_LIMITS.maxForcedDropsPerSide} are supported and the search is never truncated.` });
    return result;
  }
  const candidates = [], candidateIds = new Set(), excluded = new Map(), planOutcomes = [];
  for (const plan of plans) {
    if (plan.k === 0) { candidates.push({ plan, dropped: [], reserve_keys: plan.reserve_keys, state: evaluateLineupState(context, plan.active) }); planOutcomes.push("candidates"); continue; }
    const evidence = [...plan.active].sort(byId).map(p => effectiveProtection(context, p.player_id));
    const droppable = evidence.filter(e => e.evidence === "sufficient" && e.droppable === true).map(e => e.player_id);
    const insufficient = evidence.filter(e => e.evidence === "insufficient");
    for (const e of evidence.filter(e => !(e.evidence === "sufficient" && e.droppable === true)))
      excluded.set(e.player_id, { player_id: e.player_id, evidence: e.evidence, reasons: e.reasons, cause: e.cause });
    droppable.forEach(id => candidateIds.add(id));
    const allocation = { placement: plan.placement, required: plan.k };
    if (droppable.length + insufficient.length < plan.k) {
      planOutcomes.push("blocked");
      result.diagnostics.push({ reason: "not_enough_droppable_players", ...allocation, droppable, insufficient: ids(insufficient),
        message: `${plan.k} forced drop(s) required but only ${droppable.length} droppable and ${insufficient.length} insufficient-evidence active player(s) exist; protected players are never dropped.` });
    } else if (insufficient.length) {
      planOutcomes.push("undetermined");
      result.diagnostics.push({ reason: "insufficient_protection_evidence", ...allocation, droppable, insufficient: ids(insufficient),
        causes: Object.fromEntries(insufficient.map(e => [e.player_id, e.cause])),
        message: "Protection evidence is insufficient for active player(s); they are never assumed droppable, so no drop set can be chosen." });
    } else {
      planOutcomes.push("candidates");
      for (const drop of combinations(droppable, plan.k)) {
        const dropped = new Set(drop);
        candidates.push({ plan, dropped: [...drop].sort(compareIds), reserve_keys: plan.reserve_keys, state: evaluateLineupState(context, plan.active.filter(p => !dropped.has(p.player_id))) });
      }
    }
  }
  result.candidates = [...candidateIds].sort(compareIds);
  result.excluded = [...excluded.values()].sort(byId);
  result.evaluated_combinations = candidates.length;
  if (planOutcomes.every(o => o === "blocked")) { result.status = "blocked"; return result; }
  if (planOutcomes.includes("undetermined")) { result.status = "undetermined"; return result; }
  let champion = candidates[0];
  for (const c of candidates.slice(1)) { const r = compareCandidates(context, champion, c); if (!r.undetermined && r.order > 0) champion = c; }
  for (const c of candidates) {
    if (c === champion) continue;
    const r = compareCandidates(context, champion, c);
    if (r.undetermined || r.order >= 0) {
      result.status = "undetermined";
      result.diagnostics.push({ reason: "ranking_undetermined", key: r.key, player_ids: r.player_ids ?? [], compared: [champion.dropped, c.dropped],
        message: `No drop set ranks determinably first: comparison at ${r.key} depends on unknown values.` });
      return result;
    }
  }
  result.selected = champion;
  result.required = champion.plan.k;
  result.status = champion.plan.k === 0 ? "none" : "selected";
  return result;
}

// ---- Side and package -------------------------------------------------------------------------

function depthChange(context, before, after) {
  if (before.bench === null || after.bench === null) return { value: null, reason: "bench membership undetermined" };
  const onBefore = new Set(before.bench), onAfter = new Set(after.bench);
  const added = after.bench.filter(id => !onBefore.has(id)), removed = before.bench.filter(id => !onAfter.has(id));
  const unknown = [...added, ...removed].filter(id => valueOf(context, id)?.vor == null);
  if (unknown.length) return { value: null, reason: "unknown VOR for a player not on the bench in both states", player_ids: canonicalUnion(unknown) };
  const sum = list => list.reduce((s, id) => s + Math.max(0, valueOf(context, id).vor), 0);
  return { value: sum(added) - sum(removed) };
}

function evaluateSide(context, roster, sends, incoming) {
  const side = emptySideResult(roster.roster_id, { sends: ids(sends), receives: ids(incoming) });
  const errors = [], rosterId = side.roster_id, capacity = context.league.active_capacity;
  const noteState = (label, state) => {
    if (state.undetermined_reason) side.unknowns.push({ field: `${label}.starter_total`, player_ids: state.unknown_lineup_players, reason: state.undetermined_reason });
    else if (state.unknown_bench_vor.length) side.unknowns.push({ field: `${label}.depth_total`, player_ids: state.unknown_bench_vor, reason: "Bench player with unknown VOR; never counted as zero." });
  };
  const activeBefore = roster.players.filter(p => p.roster_status === "active");
  const before = evaluateLineupState(context, activeBefore);
  side.before = publicState(before); noteState("before", before);
  if (before.unvalued_slots.length) {
    const slots = [...new Set(before.unvalued_slots)];
    side.unknowns.push({ field: "unvalued_starter_slots", slots, reason: "No calibrated football value for these dedicated starter slots: they count for legality and filled slots, and are excluded from starter_total (never zero)." });
    side.warnings.push(`Starter slots ${slots.join(", ")} are excluded from football-value totals (unsupported value; counted for legality only).`);
  }
  if (activeBefore.length > capacity) {
    errors.push(tradeError("OVER_CAPACITY_BEFORE", { roster_id: rosterId, message: `Roster has ${activeBefore.length} active players for ${capacity} active slots before the trade.` }));
    side.forced_drops.diagnostics.push({ reason: "over_capacity_before", active_count: activeBefore.length, active_capacity: capacity, message: "Roster was over active capacity before the trade; evaluation withheld." });
    // No forced-drop resolution is attempted: unresolved (undetermined), never selected or proven blocked. The contract
    // pairs an undetermined side with its FORCED_DROP_UNDETERMINED error (both withheld).
    side.forced_drops.status = "undetermined";
    errors.push(tradeError("FORCED_DROP_UNDETERMINED", { roster_id: rosterId, message: "Forced drops not resolved: the roster was over active capacity before the trade." }));
    return { side, errors };
  }
  const sentIds = new Set(sends.map(p => p.player_id)), retained = activeBefore.filter(p => !sentIds.has(p.player_id));
  const { options, allocations } = reserveAllocations(context, roster, incoming, sends);
  const plans = allocations.map(a => { const active = [...retained, ...incoming.filter(p => a.placement[p.player_id] === "active")]; return { ...a, active, k: Math.max(0, active.length - capacity) }; });
  const drops = resolveForcedDrops(context, plans);
  Object.assign(side.forced_drops, { required: drops.required, status: drops.status === "unsupported" ? null : drops.status, candidates: drops.candidates,
    excluded: drops.excluded, evaluated_combinations: drops.evaluated_combinations, diagnostics: drops.diagnostics });
  const chosen = drops.selected?.plan.placement ?? null;
  side.reserve_placement = options.map(({ player, choices, limits }) => ({ player_id: player.player_id, placement: chosen ? chosen[player.player_id] : null,
    verified_options: choices.filter(c => c !== "active"), limitations: limits })).sort(byId);
  for (const p of side.reserve_placement.filter(p => p.placement === "active" && p.limitations.length))
    side.warnings.push(`${p.player_id} counts against active capacity: reserve/taxi placement not verified (${p.limitations.join("; ")}).`);
  if (drops.status === "unsupported") {
    errors.push(tradeError("UNSUPPORTED_DROP_COUNT", { roster_id: rosterId, message: drops.diagnostics[0].message })); return { side, errors };
  }
  if (drops.status === "blocked" || drops.status === "undetermined") {
    const code = drops.status === "blocked" ? "FORCED_DROP_BLOCKED" : "FORCED_DROP_UNDETERMINED";
    errors.push(tradeError(code, { roster_id: rosterId, message: drops.diagnostics[drops.diagnostics.length - 1].message }));
    side.unknowns.push({ field: "after", reason: `Forced drops ${drops.status}: no after-state valuation.` });
    return { side, errors };
  }
  const after = drops.selected.state;
  side.forced_drops.dropped = drops.status === "selected" ? drops.selected.dropped : null;
  side.after = publicState(after); noteState("after", after);
  const locked = [...before.active_ids, ...after.active_ids].filter(id => valueOf(context, id)?.schedule_status === "kickoff_passed");
  if (locked.length) side.unknowns.push({ field: "starter_change", player_ids: canonicalUnion(locked), reason: "A relevant game has kicked off; platform lineup lock unverified." });
  else if (before.starter_total === null || after.starter_total === null) side.unknowns.push({ field: "starter_change", reason: "Starter total undetermined before or after." });
  side.starter_change = !locked.length && before.starter_total !== null && after.starter_total !== null ? after.starter_total - before.starter_total : null;
  const depth = depthChange(context, before, after);
  side.depth_change = depth.value;
  if (depth.value === null) side.unknowns.push({ field: "depth_change", ...(depth.player_ids ? { player_ids: depth.player_ids } : {}), reason: depth.reason });
  return { side, errors };
}

/**
 * Evaluates one proposal against a TradeContext. The context and the whole package are validated before any valuation;
 * invalid/unsupported results carry no sides. Sides are returned in canonical roster-id order.
 * @returns {object} TradeEvaluation (validateTradeEvaluation-conformant)
 */
export function evaluateTrade(context, proposal) {
  const horizon = typeof proposal?.horizon === "string" && proposal.horizon ? proposal.horizon : null;
  const contextCheck = validateTradeContext(context);
  if (!contextCheck.ok) return createTradeEvaluation({ horizon, errors: contextCheck.errors });
  const proposalCheck = validateTradeProposal(proposal, context);
  if (!proposalCheck.ok) return createTradeEvaluation({ context, horizon, errors: proposalCheck.errors });
  const rosters = new Map(context.rosters.map(r => [idKey(r.roster_id), r]));
  const sent = proposal.sides.map(s => { const roster = rosters.get(idKey(s.roster_id)), want = new Set(s.sends.map(a => a.id)); return { roster, players: roster.players.filter(p => want.has(p.player_id)) }; });
  // A player with no modeled football value cannot be valued in a trade: never valued as zero or ignored.
  const unvaluedAssets = sent.flatMap(s => s.players.filter(p => !modeledPlayer(p) || valueOf(context, p.player_id)?.supported !== true)
    .map(p => tradeError("UNSUPPORTED_ASSET", { roster_id: s.roster.roster_id, asset_id: p.player_id, field: "sends",
      message: "Football value for this player is not supported by the current model (K/DEF/IDP or unmodeled); it is never valued as zero." })));
  if (unvaluedAssets.length) return createTradeEvaluation({ context, horizon, errors: unvaluedAssets });
  const results = sent.map((s, i) => evaluateSide(context, s.roster, s.players, sent[1 - i].players))
    .sort((a, b) => compareIds(a.side.roster_id, b.side.roster_id));
  const errors = sortErrors(results.flatMap(r => r.errors)), status = statusForErrors(errors);
  return createTradeEvaluation({ context, horizon, errors, sides: ["invalid", "unsupported"].includes(status) ? [] : results.map(r => r.side) });
}

/** Builds the TradeContext from injected inputs (see buildTradeContext) and evaluates; build failures return an unvalued envelope. */
export function evaluateTradeFromInputs(inputs, proposal) {
  const built = buildTradeContext(inputs);
  if (!built.ok) return createTradeEvaluation({ horizon: typeof proposal?.horizon === "string" && proposal.horizon ? proposal.horizon : null, errors: built.errors });
  return evaluateTrade(built.context, proposal);
}
