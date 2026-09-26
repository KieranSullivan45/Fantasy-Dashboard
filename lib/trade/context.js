// TradeContext construction (trade-1, provisional). V04-01 phase B.
// Pure and provider-independent: consumes a normalized snapshot, an injected value source and authoritative
// protection evidence (the add/drop `dropProtections` output); imports no provider transport.
import { fantasyPositions } from "../normalize/positions.js";
import { decisionBasis } from "../decision/basis.js";
import { valueOverReplacement, SKILL_POSITIONS } from "../decision/replacement.js";
import {
  checkBasis, compareContextMetadata, slotStructure, sortErrors, statusForErrors, tradeError, validateTradeContext,
} from "./contracts.js";

const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const orNull = v => (v === undefined ? null : v);

/** Trade-local metadata of a normalized snapshot, compared against the value source and protection evidence. */
export function snapshotMetadata(snapshot) {
  return { provider: orNull(snapshot?.identity?.provider), league_id: orNull(snapshot?.league?.league_id), season: orNull(snapshot?.league?.season),
    week: orNull(snapshot?.matchup_week), roster_positions: orNull(snapshot?.league?.roster_positions),
    roster_ids: Array.isArray(snapshot?.rosters) ? snapshot.rosters.map(r => r?.roster_id) : null,
    identity_mode: orNull(snapshot?.identity?.mode), selected_roster_id: orNull(snapshot?.identity?.selected_roster_id) };
}

/**
 * Converts `dropProtections` output into authoritative protection records. The caller states the producer, the
 * population it ran on and the metadata it ran under; nothing here re-derives protection status.
 */
export function protectionRecords({ players, producer, population, metadata }) {
  if (!Array.isArray(players)) return [];
  const provenance = { producer, population, provider: metadata?.provider, league_id: metadata?.league_id, season: metadata?.season,
    week: metadata?.week, model_version: metadata?.model_version, feature_version: metadata?.feature_version };
  return players.map(p => {
    const reasons = Array.isArray(p?.reasons) ? [...p.reasons] : p?.reasons;
    const isProtected = Array.isArray(reasons) ? reasons.length > 0 : null;
    return { player_id: p?.player_id, evidence: "sufficient", protected: isProtected, reasons, droppable: isProtected === null ? null : !isProtected, provenance: { ...provenance } };
  });
}

const slotCount = value => (Number.isInteger(value) && value >= 0 ? { count: value, verified: true } : { count: null, verified: false });

/**
 * Builds and validates a TradeContext.
 * @param {object} inputs
 * @param {object} inputs.snapshot            Normalized snapshot (schema 0.2 vocabulary).
 * @param {object} inputs.valueSource         `{ basis, metadata, contexts, levels }`: the decision result for the same basis
 *        (`contexts[player_id].model.start_value.central`, `.model.player_value`, `.model.supported`, `.schedule.status`;
 *        `levels` from `replacementLevels`) and its trade-local metadata (see CONTEXT_SOURCE_REQUIREMENTS.value_source).
 * @param {object} inputs.protectionEvidence  `{ players, producer, population, metadata }`: `dropProtections` output on the
 *        full internal contexts, with the metadata it was produced under (CONTEXT_SOURCE_REQUIREMENTS.protection).
 * @param {object} [inputs.capabilities]      Provider capabilities; absent ⇒ every gated feature unsupported.
 * @param {object} [inputs.placement]         Verified reserve/taxi placement eligibility by player id,
 *        `{ [player_id]: { reserve: "verified"|"unknown", taxi: "verified"|"unknown" } }`; absent ⇒ unknown (never from injury status).
 * @returns {{ ok: boolean, status: string, errors: object[], context: object|null }}
 */
export function buildTradeContext({ snapshot, valueSource, protectionEvidence, capabilities, placement = {} } = {}) {
  const errors = [];
  const fail = () => { const sorted = sortErrors(errors); return { ok: false, status: statusForErrors(sorted), errors: sorted, context: null }; };
  if (!isObject(snapshot) || !isObject(snapshot.league) || !Array.isArray(snapshot.rosters)) {
    errors.push(tradeError("INVALID_CONTEXT", { field: "snapshot", message: "A normalized snapshot with league and rosters is required." })); return fail();
  }
  if (!isObject(valueSource)) { errors.push(tradeError("INVALID_CONTEXT", { field: "value_source", message: "A value source is required." })); return fail(); }
  let snapshotBasis = null;
  try { snapshotBasis = decisionBasis(snapshot); } catch { errors.push(tradeError("INVALID_CONTEXT", { field: "basis", message: "The snapshot basis could not be derived." })); }
  if (snapshotBasis !== null) errors.push(...checkBasis(snapshotBasis, valueSource.basis));
  errors.push(...compareContextMetadata({ snapshot: snapshotMetadata(snapshot), value_source: valueSource.metadata, protection: protectionEvidence?.metadata }).errors);
  if (errors.length) return fail();

  const { league } = snapshot, contexts = isObject(valueSource.contexts) ? valueSource.contexts : {}, levels = isObject(valueSource.levels) ? valueSource.levels : {};
  const positions = [...league.roster_positions], structure = slotStructure(positions), settings = isObject(league.settings) ? league.settings : {};
  const reserveSlots = slotCount(settings.reserve_slots), taxiSlots = slotCount(settings.taxi_slots);
  const verifiedPlacement = (id, kind) => (placement?.[id]?.[kind] === "verified" ? "verified" : "unknown");
  const tradePlayer = p => ({ player_id: p.player_id, fantasy_positions: fantasyPositions(p), roster_status: p.reserve ? "reserve" : p.taxi ? "taxi" : "active",
    injury_status: orNull(p.injury_status), status: orNull(p.status), placement: { reserve: verifiedPlacement(p.player_id, "reserve"), taxi: verifiedPlacement(p.player_id, "taxi") } });
  const open = (slots, used) => (slots.verified ? { count: Math.max(0, slots.count - used), verified: true } : { count: null, verified: false });
  const rosters = snapshot.rosters.map(r => {
    const players = (Array.isArray(r.all_players) ? r.all_players : []).map(tradePlayer);
    return { roster_id: r.roster_id, owner_id: orNull(r.owner_id), players,
      reserve_open: open(reserveSlots, players.filter(p => p.roster_status === "reserve").length),
      taxi_open: open(taxiSlots, players.filter(p => p.roster_status === "taxi").length) };
  });
  const values = {};
  for (const roster of snapshot.rosters) for (const p of Array.isArray(roster.all_players) ? roster.all_players : []) {
    const model = contexts[p.player_id]?.model, quality = orNull(model?.player_value);
    const vor = valueOverReplacement(p, quality, levels);
    values[p.player_id] = { next_game: orNull(model?.start_value?.central), quality, vor: vor.value_over_replacement, vor_position: vor.position,
      supported: model?.supported === true, schedule_status: orNull(contexts[p.player_id]?.schedule?.status), injury_status: orNull(p.injury_status) };
  }
  const scoring = isObject(league.scoring_settings) ? league.scoring_settings : null;
  const context = {
    basis: snapshotBasis, provider: snapshot.identity.provider,
    identity: { mode: snapshot.identity.mode, roster_id: orNull(snapshot.identity.selected_roster_id) },
    capabilities: isObject(capabilities) ? capabilities : {},
    versions: { model_version: valueSource.metadata.model_version, feature_version: valueSource.metadata.feature_version },
    league: { league_id: league.league_id, season: league.season, week: snapshot.matchup_week, roster_positions: positions,
      starter_slots: structure.starter_slots, active_capacity: structure.active_capacity, reserve_slots: reserveSlots, taxi_slots: taxiSlots,
      team_count: league.total_rosters ?? snapshot.rosters.length,
      scoring_profile: { superflex: positions.includes("SUPER_FLEX"), te_premium: scoring ? (scoring.bonus_rec_te ?? 0) > 0 : null },
      scoring_identity: null, unsupported_rules: [...(snapshot.coverage?.unsupported_scoring || [])],
      starter_demand: Object.fromEntries(SKILL_POSITIONS.map(pos => [pos, orNull(levels[pos]?.eligible_starter_demand)])) },
    rosters, values,
    replacement: Object.fromEntries(SKILL_POSITIONS.map(pos => [pos, orNull(levels[pos]?.replacement_value)])),
    protection: protectionRecords(protectionEvidence),
  };
  const checked = validateTradeContext(context);
  if (!checked.ok) { errors.push(...checked.errors); return fail(); }
  return { ok: true, status: "evaluated", errors: [], context };
}
