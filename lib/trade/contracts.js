// Trade domain contracts (trade-1, provisional name). V04-01 phase A checkpoint.
// Pure and deterministic: no provider transport, network, calibration or model-config imports.
// Specification: docs/v0.4.md; architecture: docs/decisions/0001-trade-engine-architecture.md.
import { SLOT_POSITIONS } from "../normalize/positions.js";

/**
 * @typedef {string|number} RosterId  Compared by canonical string key (String(id)); never inferred.
 * @typedef {{ status: string, reason?: string|null }} Capability
 *
 * @typedef {object} TradePlayer
 * @property {string} player_id
 * @property {string[]} fantasy_positions   Platform eligibility (authoritative for slots).
 * @property {"active"|"reserve"|"taxi"} roster_status
 * @property {string|null} injury_status
 * @property {string|null} status           Platform player status (read by the availability filter).
 * @property {{ reserve: "verified"|"unknown", taxi: "verified"|"unknown" }} placement
 *           Reserve/taxi placement eligibility; `verified` only from provider data, never from injury status.
 *
 * @typedef {object} TradeRoster
 * @property {RosterId} roster_id
 * @property {string|null} owner_id
 * @property {TradePlayer[]} players
 * @property {{ count: number|null, verified: boolean }} reserve_open
 * @property {{ count: number|null, verified: boolean }} taxi_open
 *
 * @typedef {object} TradeValue  Per player; every number is finite or null (unknown), never coerced to zero.
 * @property {number|null} next_game       model.start_value.central (calibrated next observed game).
 * @property {number|null} quality         model.player_value (Q, descriptive quality).
 * @property {number|null} vor
 * @property {string|null} vor_position
 * @property {boolean} supported
 * @property {string|null} schedule_status
 * @property {string|null} injury_status
 *
 * @typedef {object} ProtectionProvenance
 * @property {string} producer
 * @property {string} population           Must be "full_internal_contexts" to be authoritative.
 * @property {string} provider
 * @property {string|number} league_id
 * @property {string|number} season
 * @property {number} week
 * @property {string} model_version
 * @property {string} feature_version
 *
 * @typedef {object} ProtectionRecord  Produced by the add/drop protection logic on full inputs; never recomputed here.
 * @property {string} player_id
 * @property {"sufficient"|"insufficient"} evidence
 * @property {boolean|null} protected      null when evidence is insufficient.
 * @property {string[]} reasons            Existing add/drop reason strings, unchanged.
 * @property {boolean|null} droppable      null when evidence is insufficient; otherwise !protected.
 * @property {ProtectionProvenance} provenance
 *
 * @typedef {object} TradeContext
 * @property {string} basis                decisionBasis(snapshot); checked unchanged against the value source.
 * @property {string} provider
 * @property {{ mode: "account"|"selected_roster"|"spectator", roster_id: RosterId|null }} identity
 * @property {Object<string, Capability>} capabilities  Absent entry ⇒ unsupported.
 * @property {{ model_version: string, feature_version: string }} versions
 * @property {object} league  league_id, season, week, roster_positions, starter_slots, active_capacity,
 *           reserve_slots/taxi_slots {count, verified}, team_count, scoring_profile, scoring_identity, unsupported_rules.
 * @property {TradeRoster[]} rosters
 * @property {Object<string, TradeValue>} values
 * @property {Object<string, number|null>} replacement
 * @property {ProtectionRecord[]} protection
 *
 * @typedef {{ roster_id: RosterId, sends: { type: "player", id: string }[] }} TradeSide
 * @typedef {{ sides: TradeSide[], horizon: "next_game" }} TradeProposal
 *
 * @typedef {object} TradeError
 * @property {string} code
 * @property {string} status               Status class of the code (ERROR_CODES).
 * @property {string|null} roster_id
 * @property {string|null} asset_id
 * @property {string|null} field
 * @property {string} message
 */

export const TRADE_SCHEMA_VERSION = "trade-1";
export const LEGALITY = "conditional_known_rules";
export const LEGALITY_LIMITATIONS = Object.freeze([
  "Legal under known roster rules only: platform transaction locks and trade deadlines are not available from provider data.",
]);
export const PACKAGE_LIMITS = Object.freeze({ rosters: 2, minAssetsPerSide: 1, maxAssetsPerSide: 2, maxForcedDropsPerSide: 2 });
export const SUPPORTED_ASSET_TYPES = Object.freeze(["player"]);
export const KNOWN_UNSUPPORTED_ASSET_TYPES = Object.freeze(["draft_pick", "faab"]);
export const EVALUATION_STATUS = Object.freeze({ EVALUATED: "evaluated", BLOCKED: "blocked", WITHHELD: "withheld", INVALID: "invalid", UNSUPPORTED: "unsupported" });
export const FORCED_DROP_STATUS = Object.freeze({ NONE: "none", SELECTED: "selected", BLOCKED: "blocked", UNDETERMINED: "undetermined" });
export const PROTECTION_EVIDENCE = Object.freeze({ SUFFICIENT: "sufficient", INSUFFICIENT: "insufficient" });
export const PROTECTION_POPULATION = "full_internal_contexts";
export const ROSTER_STATUS = Object.freeze(["active", "reserve", "taxi"]);
export const PLACEMENT_ELIGIBILITY = Object.freeze(["verified", "unknown"]);
export const IDENTITY_MODES = Object.freeze(["account", "selected_roster", "spectator"]);
export const NON_STARTER_SLOTS = Object.freeze(["BN", "IR", "TAXI"]);
/** Output keys that must never appear anywhere in a TradeEvaluation (owner decision: separate components only). */
export const FORBIDDEN_EVALUATION_KEYS = Object.freeze(["fairness", "fairness_score", "trade_score", "combined_score",
  "winner", "loser", "verdict", "acceptance_probability", "accept_probability", "net_roster_improvement"]);

/** Error code → status class. Package precedence: invalid > unsupported > blocked > withheld > evaluated. */
export const ERROR_CODES = Object.freeze({
  MALFORMED_PROPOSAL: "invalid", INVALID_CONTEXT: "invalid", STALE_BASIS: "invalid", CONTEXT_MISMATCH: "invalid",
  UNKNOWN_ROSTER: "invalid", SAME_ROSTER: "invalid", ASSET_NOT_OWNED: "invalid", DUPLICATE_ASSET: "invalid",
  EMPTY_SIDE: "unsupported", UNSUPPORTED_ASSET: "unsupported", UNSUPPORTED_HORIZON: "unsupported", PACKAGE_TOO_LARGE: "unsupported",
  UNSUPPORTED_TRADE_SHAPE: "unsupported", UNSUPPORTED_SLOTS: "unsupported", UNSUPPORTED_DROP_COUNT: "unsupported",
  FORCED_DROP_BLOCKED: "blocked",
  CAPACITY_UNKNOWN: "withheld", OVER_CAPACITY_BEFORE: "withheld", FORCED_DROP_UNDETERMINED: "withheld",
});
const STATUS_PRECEDENCE = ["invalid", "unsupported", "blocked", "withheld"];

// ---- Horizon -------------------------------------------------------------------------------

export const HORIZONS = Object.freeze({
  next_game: Object.freeze({
    id: "next_game", supported: true,
    lineup_value_source: "model.start_value.central",
    calibration_status: "calibrated_next_observed_game",
    depth_value_source: "model.player_value value over replacement",
    depth_label: "descriptive_quality",
    limitations: Object.freeze([
      "Single next observed game only: players on bye, unavailable this week or without a scheduled game add no lineup value.",
      "Depth uses descriptive-quality VOR, not a forecast; replacement levels are held fixed for before and after states.",
      "The three-week acquisition estimate (pickup_value) is not used; no rest-of-season or dynasty value exists.",
    ]),
  }),
});
export const KNOWN_UNSUPPORTED_HORIZONS = Object.freeze(["rest_of_season", "dynasty", "multi_week"]);

/** Horizon object for an id; unsupported ids get `supported: false`. Non-string ids return null. */
export function horizonFor(id) {
  if (typeof id !== "string" || !id) return null;
  return HORIZONS[id] ?? Object.freeze({ id, supported: false, limitations: Object.freeze(["Only next_game is supported in the first wave."]) });
}

// ---- Canonical ids -------------------------------------------------------------------------

/** Locale-independent order: UTF-16 code units (JS string `<`/`>`); never localeCompare, Intl or numeric parsing. */
export const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const idKey = id => (typeof id === "string" ? id : typeof id === "number" && Number.isSafeInteger(id) ? String(id) : null);
export const canonicalIdSequence = ids => ids.map(String).sort(compareIds);
/** Compares two id sets after canonical sorting, element-wise; a strict prefix sorts first. */
export function compareIdSequences(a, b) {
  const x = canonicalIdSequence(a), y = canonicalIdSequence(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = compareIds(x[i], y[i]); if (c) return c; }
  return x.length - y.length;
}
const isId = id => idKey(id) !== null && idKey(id) !== "";
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const finiteOrNull = v => v === null || (typeof v === "number" && Number.isFinite(v));

// ---- Errors and status ---------------------------------------------------------------------

export function tradeError(code, { roster_id = null, asset_id = null, field = null, message } = {}) {
  if (!ERROR_CODES[code]) throw new Error(`Unknown trade error code: ${code}`);
  return { code, status: ERROR_CODES[code], roster_id: roster_id == null ? null : String(roster_id), asset_id: asset_id == null ? null : String(asset_id), field, message: message ?? code };
}
const nullsFirst = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : compareIds(a, b));
export const sortErrors = errors => [...errors].sort((a, b) => compareIds(a.code, b.code) || nullsFirst(a.roster_id, b.roster_id)
  || nullsFirst(a.asset_id, b.asset_id) || nullsFirst(a.field, b.field) || compareIds(a.message, b.message));
/** Package status implied by a set of errors; no errors ⇒ evaluated. */
export const statusForErrors = errors => STATUS_PRECEDENCE.find(s => errors.some(e => e.status === s)) ?? EVALUATION_STATUS.EVALUATED;

// ---- Slots and capabilities ----------------------------------------------------------------

/** Slot structure exactly as add/drop derives it: starters exclude BN/IR/TAXI; active capacity excludes IR/TAXI. */
export function slotStructure(rosterPositions) {
  const starter_slots = rosterPositions.filter(p => !NON_STARTER_SLOTS.includes(p));
  return { starter_slots, active_capacity: rosterPositions.filter(p => !["IR", "TAXI"].includes(p)).length,
    reserve_positions: rosterPositions.filter(p => p === "IR").length, taxi_positions: rosterPositions.filter(p => p === "TAXI").length,
    unsupported_slots: [...new Set(starter_slots.filter(s => !SLOT_POSITIONS[s]))] };
}
/** Capabilities are an explicit input; anything but an explicit "available" is unsupported. */
export const capabilityAvailable = (context, name) => context?.capabilities?.[name]?.status === "available";

// ---- Proposal validation -------------------------------------------------------------------

const PROPOSAL_KEYS = ["sides", "horizon"], SIDE_KEYS = ["roster_id", "sends"], ASSET_KEYS = ["type", "id"];
const unknownKeys = (value, allowed) => Object.keys(value).filter(k => !allowed.includes(k)).sort(compareIds);

/**
 * Validates the whole proposal before any valuation. Structural checks always run; with a TradeContext it also
 * checks roster existence (UNKNOWN_ROSTER) and ownership at this basis (ASSET_NOT_OWNED). All errors are reported.
 * @returns {{ ok: boolean, status: string, errors: TradeError[] }}
 */
export function validateTradeProposal(proposal, context = null) {
  const errors = [], add = (code, detail) => errors.push(tradeError(code, detail));
  const done = () => { const sorted = sortErrors(errors); return { ok: !sorted.length, status: statusForErrors(sorted), errors: sorted }; };
  if (!isObject(proposal) || !Array.isArray(proposal.sides)) { add("MALFORMED_PROPOSAL", { field: "sides", message: "Proposal must be an object with a sides array." }); return done(); }
  for (const key of unknownKeys(proposal, PROPOSAL_KEYS)) add("MALFORMED_PROPOSAL", { field: key, message: `Unknown proposal field ${key}.` });
  if (typeof proposal.horizon !== "string" || !proposal.horizon) add("MALFORMED_PROPOSAL", { field: "horizon", message: "An explicit horizon is required." });
  else if (!horizonFor(proposal.horizon).supported) add("UNSUPPORTED_HORIZON", { field: "horizon", message: `Horizon ${proposal.horizon} is not supported; only next_game.` });
  if (proposal.sides.length !== PACKAGE_LIMITS.rosters) add("UNSUPPORTED_TRADE_SHAPE", { field: "sides", message: `Exactly two rosters are required; received ${proposal.sides.length}.` });

  const rosterSeen = new Map(), assetSeen = new Map();
  proposal.sides.forEach((side, index) => {
    const field = `sides[${index}]`;
    if (!isObject(side)) { add("MALFORMED_PROPOSAL", { field, message: "Side must be an object." }); return; }
    for (const key of unknownKeys(side, SIDE_KEYS)) add("MALFORMED_PROPOSAL", { field: `${field}.${key}`, message: `Unknown side field ${key}.` });
    const rosterId = isId(side.roster_id) ? idKey(side.roster_id) : null;
    if (rosterId === null) add("MALFORMED_PROPOSAL", { field: `${field}.roster_id`, message: "roster_id must be a non-empty string or safe integer." });
    else rosterSeen.set(rosterId, (rosterSeen.get(rosterId) || 0) + 1);
    if (!Array.isArray(side.sends)) { add("MALFORMED_PROPOSAL", { roster_id: rosterId, field: `${field}.sends`, message: "sends must be an array." }); return; }
    if (!side.sends.length) add("EMPTY_SIDE", { roster_id: rosterId, field: `${field}.sends`, message: "Each side must send one or two players." });
    if (side.sends.length > PACKAGE_LIMITS.maxAssetsPerSide) add("PACKAGE_TOO_LARGE", { roster_id: rosterId, field: `${field}.sends`, message: `A side may send at most two assets; received ${side.sends.length}.` });
    side.sends.forEach((asset, j) => {
      const assetField = `${field}.sends[${j}]`;
      if (!isObject(asset)) { add("MALFORMED_PROPOSAL", { roster_id: rosterId, field: assetField, message: "Asset must be an object." }); return; }
      if (typeof asset.type !== "string" || !asset.type) { add("MALFORMED_PROPOSAL", { roster_id: rosterId, field: `${assetField}.type`, message: "Asset type is required." }); return; }
      if (!SUPPORTED_ASSET_TYPES.includes(asset.type)) {
        add("UNSUPPORTED_ASSET", { roster_id: rosterId, asset_id: isId(asset.id) ? asset.id : null, field: `${assetField}.type`,
          message: KNOWN_UNSUPPORTED_ASSET_TYPES.includes(asset.type) ? `${asset.type} assets are not supported: pick holdings and FAAB are not verified trade inputs.` : `Unknown asset type ${asset.type}.` });
        return;
      }
      for (const key of unknownKeys(asset, ASSET_KEYS)) add("MALFORMED_PROPOSAL", { roster_id: rosterId, field: `${assetField}.${key}`, message: `Unknown asset field ${key}.` });
      if (typeof asset.id !== "string" || !asset.id) { add("MALFORMED_PROPOSAL", { roster_id: rosterId, field: `${assetField}.id`, message: "Player asset id must be a non-empty string." }); return; }
      assetSeen.set(asset.id, [...(assetSeen.get(asset.id) || []), rosterId]);
    });
  });
  for (const [rosterId, count] of rosterSeen) if (count > 1) add("SAME_ROSTER", { roster_id: rosterId, field: "sides", message: "Both sides name the same roster." });
  for (const [assetId, owners] of assetSeen) if (owners.length > 1) add("DUPLICATE_ASSET", { asset_id: assetId, field: "sides", message: "Asset appears more than once in the package." });

  if (context && Array.isArray(context.rosters)) {
    const rosters = new Map(context.rosters.map(r => [idKey(r.roster_id), r]));
    for (const side of proposal.sides.filter(isObject)) {
      const rosterId = isId(side.roster_id) ? idKey(side.roster_id) : null;
      if (rosterId === null) continue;
      const roster = rosters.get(rosterId);
      if (!roster) { add("UNKNOWN_ROSTER", { roster_id: rosterId, field: "roster_id", message: "Roster does not exist in this trade context." }); continue; }
      const owned = new Set((roster.players || []).map(p => p.player_id));
      for (const asset of (Array.isArray(side.sends) ? side.sends : []).filter(a => isObject(a) && a.type === "player" && typeof a.id === "string" && a.id))
        if (!owned.has(asset.id)) add("ASSET_NOT_OWNED", { roster_id: rosterId, asset_id: asset.id, message: "Player is not on the sending roster at this basis." });
    }
  }
  return done();
}

// ---- Context validation --------------------------------------------------------------------

/**
 * Structural validation of a built TradeContext (malformed ⇒ INVALID_CONTEXT; unsupported starter slots ⇒
 * UNSUPPORTED_SLOTS). Cross-source consistency is `compareContextMetadata`; the basis check is `checkBasis`.
 * @returns {{ ok: boolean, status: string, errors: TradeError[] }}
 */
export function validateTradeContext(context) {
  const errors = [], bad = (field, message) => errors.push(tradeError("INVALID_CONTEXT", { field, message }));
  const done = () => { const sorted = sortErrors(errors); return { ok: !sorted.length, status: statusForErrors(sorted), errors: sorted }; };
  if (!isObject(context)) { bad("context", "TradeContext must be an object."); return done(); }
  if (typeof context.basis !== "string" || !context.basis) bad("basis", "basis is required.");
  if (typeof context.provider !== "string" || !context.provider) bad("provider", "provider is required.");
  if (context.capabilities !== undefined && !isObject(context.capabilities)) bad("capabilities", "capabilities must be an object when present.");
  const v = context.versions;
  if (!isObject(v) || typeof v.model_version !== "string" || !v.model_version || typeof v.feature_version !== "string" || !v.feature_version)
    bad("versions", "model_version and feature_version of the consumed value source are required.");

  const league = context.league;
  if (!isObject(league)) bad("league", "league is required.");
  else {
    if (!isId(league.league_id)) bad("league.league_id", "league_id is required.");
    if (!isId(league.season)) bad("league.season", "season is required.");
    if (!Number.isInteger(league.week) || league.week < 1) bad("league.week", "A current week is required for the next_game horizon.");
    if (!Array.isArray(league.roster_positions) || !league.roster_positions.length || !league.roster_positions.every(p => typeof p === "string" && p))
      bad("league.roster_positions", "roster_positions must be a non-empty array of slot names.");
    else {
      const s = slotStructure(league.roster_positions);
      if (JSON.stringify(league.starter_slots) !== JSON.stringify(s.starter_slots)) bad("league.starter_slots", "starter_slots must equal roster_positions without BN/IR/TAXI.");
      if (league.active_capacity !== s.active_capacity) bad("league.active_capacity", "active_capacity must equal the non-IR/TAXI position count.");
      for (const slot of s.unsupported_slots) errors.push(tradeError("UNSUPPORTED_SLOTS", { field: "league.roster_positions", message: `Unsupported lineup slot ${slot}.` }));
    }
    for (const key of ["reserve_slots", "taxi_slots"]) if (!verifiedCount(league[key])) bad(`league.${key}`, `${key} must be { count, verified } with a non-negative integer count when verified.`);
  }

  const identity = context.identity;
  if (!isObject(identity) || !IDENTITY_MODES.includes(identity.mode)) bad("identity.mode", "identity.mode must be account, selected_roster or spectator.");
  else if (identity.mode === "spectator" ? identity.roster_id !== null : !isId(identity.roster_id))
    bad("identity.roster_id", "spectator has no roster; account/selected_roster require an explicit roster_id (never inferred).");

  const playerOwner = new Map();
  if (!Array.isArray(context.rosters) || context.rosters.length < 2) bad("rosters", "At least two rosters are required.");
  else {
    const rosterIds = new Set();
    context.rosters.forEach((roster, i) => {
      const field = `rosters[${i}]`;
      if (!isObject(roster) || !isId(roster.roster_id)) { bad(`${field}.roster_id`, "roster_id is required."); return; }
      const key = idKey(roster.roster_id);
      if (rosterIds.has(key)) bad(`${field}.roster_id`, "Duplicate roster_id.");
      rosterIds.add(key);
      if (!(roster.owner_id === null || isId(roster.owner_id))) bad(`${field}.owner_id`, "owner_id must be an id or null.");
      for (const k of ["reserve_open", "taxi_open"]) if (!verifiedCount(roster[k])) bad(`${field}.${k}`, `${k} must be { count, verified }.`);
      if (!Array.isArray(roster.players)) { bad(`${field}.players`, "players must be an array."); return; }
      roster.players.forEach((p, j) => {
        const pf = `${field}.players[${j}]`;
        if (!isObject(p) || typeof p.player_id !== "string" || !p.player_id) { bad(`${pf}.player_id`, "player_id must be a non-empty string."); return; }
        if (playerOwner.has(p.player_id)) bad(`${pf}.player_id`, `Player ${p.player_id} appears on more than one roster.`);
        playerOwner.set(p.player_id, key);
        if (!Array.isArray(p.fantasy_positions) || !p.fantasy_positions.every(x => typeof x === "string")) bad(`${pf}.fantasy_positions`, "fantasy_positions must be an array of strings.");
        if (!ROSTER_STATUS.includes(p.roster_status)) bad(`${pf}.roster_status`, "roster_status must be active, reserve or taxi.");
        if (!isObject(p.placement) || !PLACEMENT_ELIGIBILITY.includes(p.placement.reserve) || !PLACEMENT_ELIGIBILITY.includes(p.placement.taxi))
          bad(`${pf}.placement`, "placement.reserve and placement.taxi must be verified or unknown.");
      });
    });
    if (isObject(identity) && identity.mode !== "spectator" && isId(identity.roster_id) && !rosterIds.has(idKey(identity.roster_id)))
      bad("identity.roster_id", "Identity roster is not in the context.");
  }

  if (!isObject(context.values)) bad("values", "values must be an object keyed by player_id.");
  else for (const [id, value] of Object.entries(context.values).sort(([a], [b]) => compareIds(a, b))) {
    if (!isObject(value) || !["next_game", "quality", "vor"].every(k => finiteOrNull(value[k])) || typeof value.supported !== "boolean"
      || !["vor_position", "schedule_status", "injury_status"].every(k => value[k] === null || typeof value[k] === "string"))
      bad(`values.${id}`, "Value numbers must be finite or null (never coerced); supported must be boolean.");
  }
  if (!isObject(context.replacement) || !Object.values(context.replacement).every(finiteOrNull)) bad("replacement", "replacement levels must be finite numbers or null.");

  if (!Array.isArray(context.protection)) bad("protection", "protection must be an array of authoritative records (may be empty).");
  else {
    const seen = new Set();
    context.protection.forEach((record, i) => {
      const problem = protectionRecordProblem(record);
      if (problem) bad(`protection[${i}]`, problem);
      else if (seen.has(record.player_id)) bad(`protection[${i}]`, `Duplicate protection record for ${record.player_id}.`);
      else seen.add(record.player_id);
    });
  }
  return done();
}
const verifiedCount = x => isObject(x) && typeof x.verified === "boolean"
  && (x.verified ? Number.isInteger(x.count) && x.count >= 0 : x.count === null || (Number.isInteger(x.count) && x.count >= 0));

/** Structural problem with a protection record, or null. Semantics mirror add/drop: protected ⇔ reasons present. */
export function protectionRecordProblem(record) {
  if (!isObject(record) || typeof record.player_id !== "string" || !record.player_id) return "player_id is required.";
  if (!Object.values(PROTECTION_EVIDENCE).includes(record.evidence)) return "evidence must be sufficient or insufficient.";
  if (!Array.isArray(record.reasons) || !record.reasons.every(r => typeof r === "string" && r)) return "reasons must be an array of strings.";
  if (record.evidence === "insufficient") {
    if (record.protected !== null || record.droppable !== null) return "protected and droppable must be null when evidence is insufficient.";
  } else {
    if (typeof record.protected !== "boolean" || record.droppable !== !record.protected) return "sufficient evidence requires boolean protected and droppable === !protected.";
    if (record.protected !== record.reasons.length > 0) return "protected must be true exactly when protection reasons are present.";
  }
  const p = record.provenance;
  if (!isObject(p) || typeof p.producer !== "string" || !p.producer || typeof p.population !== "string") return "provenance with producer and population is required.";
  return null;
}

const PROVENANCE_FIELDS = [["provider", c => c.provider], ["league_id", c => c.league?.league_id], ["season", c => c.league?.season],
  ["week", c => c.league?.week], ["model_version", c => c.versions?.model_version], ["feature_version", c => c.versions?.feature_version]];

/**
 * Effective protection for one player, read from authoritative evidence only (never recomputed).
 * No record, a non-full population, a provenance mismatch or a malformed record ⇒ insufficient: never assumed unprotected.
 * @returns {{ player_id: string, evidence: string, protected: boolean|null, droppable: boolean|null, reasons: string[], cause: string|null }}
 */
export function effectiveProtection(context, playerId) {
  const insufficient = cause => ({ player_id: playerId, evidence: "insufficient", protected: null, droppable: null, reasons: [], cause });
  const record = (Array.isArray(context?.protection) ? context.protection : []).find(r => isObject(r) && r.player_id === playerId);
  if (!record) return insufficient("no_record");
  if (protectionRecordProblem(record)) return insufficient("malformed_record");
  if (record.provenance.population !== PROTECTION_POPULATION) return insufficient("provenance_population");
  const mismatch = PROVENANCE_FIELDS.find(([key, read]) => record.provenance[key] == null || String(record.provenance[key]) !== String(read(context)));
  if (mismatch) return insufficient(`provenance_mismatch:${mismatch[0]}`);
  if (record.evidence === "insufficient") return { ...insufficient("record_insufficient"), reasons: [...record.reasons] };
  return { player_id: playerId, evidence: "sufficient", protected: record.protected, droppable: record.droppable, reasons: [...record.reasons], cause: null };
}

/** Existing decision basis check, unchanged: the caller passes decisionBasis(snapshot) and the value source basis. */
export const checkBasis = (snapshotBasis, valueSourceBasis) => typeof snapshotBasis === "string" && snapshotBasis !== "" && snapshotBasis === valueSourceBasis
  ? [] : [tradeError("STALE_BASIS", { field: "basis", message: "Snapshot basis does not match the value source basis." })];

// ---- Trade-local context metadata (in addition to the basis check) -------------------------

/** Metadata each source must declare. A required field that is absent (undefined or null) ⇒ CONTEXT_MISMATCH. */
export const CONTEXT_SOURCE_REQUIREMENTS = Object.freeze({
  snapshot: Object.freeze(["provider", "league_id", "season", "week", "roster_positions", "identity_mode", "selected_roster_id"]),
  value_source: Object.freeze(["provider", "league_id", "season", "week", "roster_positions", "identity_mode", "selected_roster_id", "model_version", "feature_version"]),
  protection: Object.freeze(["provider", "league_id", "season", "week", "model_version", "feature_version"]),
});
/** May legitimately be null (spectator); still compared exactly across sources that declare it. */
const NULLABLE_FIELDS = ["selected_roster_id"];
/** "Where available": compared only when two sources both carry a non-null value. */
export const OPTIONAL_CONTEXT_FIELDS = Object.freeze(["scoring_identity", "roster_ids"]);
const canonicalMeta = (field, value) => value == null ? null
  : field === "roster_ids" ? JSON.stringify(canonicalIdSequence(value))
  : Array.isArray(value) ? JSON.stringify(value.map(String))
  : isObject(value) ? JSON.stringify(Object.entries(value).sort(([a], [b]) => compareIds(a, b)))
  : String(value);

/**
 * Compares normalized metadata across the snapshot, value source and protection evidence.
 * `sources` maps a source name (snapshot | value_source | protection) to its metadata object.
 * Every mismatch or absent required field ⇒ CONTEXT_MISMATCH naming the field. No public schema is involved.
 */
export function compareContextMetadata(sources) {
  const errors = [], names = Object.keys(sources).sort(compareIds);
  for (const name of names) {
    const required = CONTEXT_SOURCE_REQUIREMENTS[name];
    if (!required) { errors.push(tradeError("CONTEXT_MISMATCH", { field: name, message: `Unknown metadata source ${name}.` })); continue; }
    const meta = isObject(sources[name]) ? sources[name] : {};
    for (const field of required) if (NULLABLE_FIELDS.includes(field) ? meta[field] === undefined : meta[field] == null)
      errors.push(tradeError("CONTEXT_MISMATCH", { field, message: `${field} is absent from ${name}.` }));
  }
  for (const name of Object.keys(CONTEXT_SOURCE_REQUIREMENTS)) if (!names.includes(name))
    errors.push(tradeError("CONTEXT_MISMATCH", { field: name, message: `Metadata source ${name} is missing.` }));
  const fields = [...new Set(names.flatMap(n => CONTEXT_SOURCE_REQUIREMENTS[n] || []).concat(OPTIONAL_CONTEXT_FIELDS))];
  for (const field of fields) {
    // Absent required values are reported above; only nullable fields compare null against a value.
    const values = names.filter(n => CONTEXT_SOURCE_REQUIREMENTS[n] && isObject(sources[n]) && sources[n][field] !== undefined)
      .map(n => [n, canonicalMeta(field, sources[n][field])])
      .filter(([, value]) => NULLABLE_FIELDS.includes(field) || value !== null);
    const distinct = [...new Set(values.map(([, value]) => value))];
    if (distinct.length > 1) errors.push(tradeError("CONTEXT_MISMATCH", { field, message: `${field} differs between ${values.map(([n]) => n).join(", ")}.` }));
  }
  const sorted = sortErrors(errors);
  return { ok: !sorted.length, status: statusForErrors(sorted), errors: sorted };
}

// ---- TradeEvaluation -----------------------------------------------------------------------

/** Per-side result skeleton: every valuation starts unknown (null), never zero. */
export function emptySideResult(rosterId, { sends = [], receives = [] } = {}) {
  return { roster_id: idKey(rosterId), sends: canonicalIdSequence(sends), receives: canonicalIdSequence(receives), before: null, after: null,
    forced_drops: { required: null, status: null, dropped: null, candidates: [], excluded: [], evaluated_combinations: 0, diagnostics: [] },
    reserve_placement: [], starter_change: null, depth_change: null, unknowns: [], warnings: [] };
}

/** Evaluation envelope. Status defaults from the errors; market_value is always null. */
export function createTradeEvaluation({ context = null, horizon = null, errors = [], sides = [], status = null } = {}) {
  const sorted = sortErrors(errors);
  return { schema_version: TRADE_SCHEMA_VERSION, model_version: context?.versions?.model_version ?? null, feature_version: context?.versions?.feature_version ?? null,
    basis: context?.basis ?? null, horizon: typeof horizon === "string" ? horizonFor(horizon) : horizon, status: status ?? statusForErrors(sorted), errors: sorted,
    legality: LEGALITY, legality_limitations: [...LEGALITY_LIMITATIONS], sides, market_value: null };
}

/** Package status from per-side forced-drop outcomes: blocked if either side is blocked, else withheld if either is undetermined. */
export function packageStatus(sides) {
  const statuses = sides.map(s => s?.forced_drops?.status);
  return statuses.includes("blocked") ? EVALUATION_STATUS.BLOCKED : statuses.includes("undetermined") ? EVALUATION_STATUS.WITHHELD : EVALUATION_STATUS.EVALUATED;
}

function findForbidden(value, path, out) {
  if (typeof value === "number" && !Number.isFinite(value)) out.push(`${path} is not finite`);
  else if (Array.isArray(value)) value.forEach((v, i) => findForbidden(v, `${path}[${i}]`, out));
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_EVALUATION_KEYS.includes(k)) out.push(`${path}.${k} is forbidden`);
    findForbidden(v, `${path}.${k}`, out);
  }
}

/**
 * Checks the contract invariants of a TradeEvaluation (does not evaluate anything).
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateTradeEvaluation(evaluation) {
  const v = [];
  if (!isObject(evaluation)) return { ok: false, violations: ["evaluation must be an object"] };
  if (evaluation.schema_version !== TRADE_SCHEMA_VERSION) v.push("schema_version");
  if (!("market_value" in evaluation) || evaluation.market_value !== null) v.push("market_value must be present and null");
  if (evaluation.legality !== LEGALITY) v.push("legality must be conditional_known_rules");
  if (!Object.values(EVALUATION_STATUS).includes(evaluation.status)) v.push("status");
  if (!Array.isArray(evaluation.errors) || !Array.isArray(evaluation.sides)) v.push("errors and sides must be arrays");
  findForbidden(evaluation, "evaluation", v);
  if (v.length) return { ok: false, violations: v };
  const { status, errors, sides } = evaluation;
  if (errors.some(e => !ERROR_CODES[e.code] || ERROR_CODES[e.code] !== e.status)) v.push("errors must use known codes with their status class");
  if (["invalid", "unsupported"].includes(status)) {
    if (statusForErrors(errors) !== status) v.push(`${status} status requires a matching error`);
  } else {
    if (evaluation.horizon?.id !== "next_game" || evaluation.horizon?.supported !== true) v.push("evaluated packages use the next_game horizon");
    if (sides.length !== 2) v.push("exactly two sides are required");
    if (errors.some(e => ["invalid", "unsupported"].includes(e.status))) v.push("invalid/unsupported errors require invalid/unsupported status");
    const implied = [packageStatus(sides), statusForErrors(errors)];
    const expected = implied.includes("blocked") ? "blocked" : implied.includes("withheld") ? "withheld" : "evaluated";
    if (status !== expected) v.push(`status ${status} does not match side outcomes and errors (${expected})`);
    if (status === "evaluated" && !sides.every(s => ["none", "selected"].includes(s?.forced_drops?.status))) v.push("evaluated requires every side's forced drops to be none or selected");
  }
  const sideCode = { blocked: "FORCED_DROP_BLOCKED", undetermined: "FORCED_DROP_UNDETERMINED" };
  for (const side of sides) {
    const code = sideCode[side?.forced_drops?.status];
    if (code && !errors.some(e => e.code === code && e.roster_id === side.roster_id)) v.push(`roster ${side.roster_id} requires a ${code} error`);
  }
  sides.forEach((side, i) => {
    const f = side?.forced_drops, at = `sides[${i}]`;
    if (!isObject(f)) { v.push(`${at}.forced_drops missing`); return; }
    if (f.required != null && (!Number.isInteger(f.required) || f.required < 0 || f.required > PACKAGE_LIMITS.maxForcedDropsPerSide)) v.push(`${at}.forced_drops.required out of range`);
    if (f.status !== "selected" && f.dropped !== null) v.push(`${at}.forced_drops.dropped must be null unless selected`);
    if (f.status === "none" && f.required !== 0) v.push(`${at}.forced_drops none requires required 0`);
    if (f.status === "selected" && (!Array.isArray(f.dropped) || f.dropped.length !== f.required || f.required < 1
      || JSON.stringify(f.dropped) !== JSON.stringify(canonicalIdSequence(f.dropped)))) v.push(`${at}.forced_drops.dropped must be the canonical sorted set of required size`);
    if (["blocked", "undetermined"].includes(f.status)) {
      if (side.starter_change !== null || side.depth_change !== null) v.push(`${at} ${f.status} requires null deltas`);
      if (side.after !== null && (side.after?.lineup != null || side.after?.starter_total != null || side.after?.depth_total != null)) v.push(`${at} ${f.status} has no after-state valuation`);
      if (!Array.isArray(f.diagnostics) || !f.diagnostics.length) v.push(`${at} ${f.status} requires diagnostics`);
    }
  });
  return { ok: !v.length, violations: v };
}
