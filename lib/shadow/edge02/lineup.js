import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { numeric } from "../../decision/features.js";
import { optimizeLineup } from "../../decision/optimizer.js";
import { SLOT_POSITIONS, fantasyPositions } from "../../normalize/positions.js";
import { digest, evidenceOnly } from "../../history/contracts.js";
import { assertApprovedContext, assertClassification, writeImmutable, CANDIDATE_SHADOW_CAPTURE_SCHEMA } from "./capture.js";

/**
 * EDGE-02 as-of roster/lineup evidence (`candidate-lineup-1`, ADR 0014). Freezes every roster's membership, slots, eligibility,
 * schedule and the values each variant gave, plus the legal offensive-slot assignment the existing optimizer makes for each
 * variant. Research-only; never read by production.
 */
export const CANDIDATE_LINEUP_SCHEMA = "candidate-lineup-1";
export const CANDIDATE_LINEUP_CAPTURE_SCHEMA = "candidate-lineup-capture-1";
const OFFENSE = new Set(["QB", "RB", "WR", "TE"]);
const NON_ACTIVE = new Set(["BN", "IR", "TAXI"]);
export const VARIANTS = Object.freeze(["production", "h9", "a2", "x2", "production_noX"]);

async function fileDigests(paths) {
  const out = {};
  for (const p of paths) try { out[p] = createHash("sha256").update(await readFile(new URL(`../../../${p}`, import.meta.url))).digest("hex"); } catch { out[p] = null; }
  return out;
}

/** Variant value for lineup use: only players production marks available this week; otherwise null (never zero). */
export function lineupValue(record, variant) {
  if (!record || record.predictions.available_this_week !== true) return null;
  const p = record.predictions;
  const v = { production: p.production_start_value, h9: p.h9_quality_points, a2: p.a2, x2: p.x2, production_noX: p.production_noX }[variant];
  return numeric(v) ? v : null;
}

/** Legal assignment over the offensive active slots only: one player per slot, IR/taxi excluded, unsupported slots disclosed. */
export function scopedLineup(players, rosterPositions, values) {
  const active = rosterPositions.filter(s => !NON_ACTIVE.has(s));
  const included = active.filter(s => SLOT_POSITIONS[s] && SLOT_POSITIONS[s].every(p => OFFENSE.has(p)));
  const excluded = active.filter(s => !included.includes(s));
  const pool = players.filter(p => !p.reserve && !p.taxi && numeric(values[p.player_id])).sort((a, b) => String(a.player_id).localeCompare(String(b.player_id)));
  const assignment = included.length ? optimizeLineup(pool, included, values) : [];
  if (assignment === null) return { status: "unsupported", assignment: null, scope: { included_slots: included, excluded_slots: excluded } };
  const filled = assignment.filter(a => a.player_id);
  return { status: "computed", assignment, total: filled.reduce((s, a) => s + a.value, 0), filled: filled.length, unfilled_slots: assignment.filter(a => !a.player_id).map(a => ({ slot: a.slot, index: a.index, reason: "no available eligible player with a finite value" })),
    scope: { kind: "offensive_slots_only", included_slots: included, excluded_slots: excluded, complete_lineup: excluded.length === 0,
      note: excluded.length ? "Unsupported slots (K/DEF/IDP) are excluded and disclosed, never zero-valued; this is not a full lineup." : "All active slots are offensive; still not a confirmatory lineup metric (lock semantics unverified)." } };
}

export async function buildEdge02LineupCapture({ decision, internals, candidateCapture, classification, approvedLeagueIds, clock = Date.now }) {
  assertApprovedContext(decision, approvedLeagueIds);
  assertClassification(classification, decision.generated_at, clock());
  if (!candidateCapture || candidateCapture.schema_version !== CANDIDATE_SHADOW_CAPTURE_SCHEMA) return null;
  if (!Array.isArray(internals?.rosters)) throw new Error("Roster evidence was not passed to the EDGE-02 lineup capture");
  const byPlayer = new Map(candidateCapture.records.map(r => [r.identity.player_id, r]));
  const rosterPositions = decision.league.roster_positions ?? [];
  const slotCounts = rosterPositions.reduce((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
  const versions = { optimizer: "lib/decision/optimizer.js optimizeLineup (rectangular Hungarian; fill legal slots first, then value)",
    file_sha256: await fileDigests(["lib/decision/optimizer.js", "lib/normalize/positions.js"]), candidate_config_sha256: candidateCapture.config_sha256,
    model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision ?? null };
  const records = internals.rosters.map(roster => {
    const players = (roster.all_players ?? []).map(p => {
      const r = byPlayer.get(p.player_id), c = decision.player_context[p.player_id];
      return { player_id: p.player_id, fantasy_eligibility: fantasyPositions(p), scoring_position: r?.identity.position ?? c?.model?.features?.position ?? null,
        membership: p.reserve ? "ir" : p.taxi ? "taxi" : p.starter ? "starter" : "bench", reserve: !!p.reserve, taxi: !!p.taxi, active_capacity: !p.reserve && !p.taxi,
        injury_status: p.injury_status ?? null, status: p.status ?? null,
        schedule: c?.schedule ? { status: c.schedule.status, game_id: c.schedule.game_id ?? null, kickoff: c.schedule.kickoff ?? null, opponent: c.schedule.opponent ?? null } : null,
        candidate_record_id: r?.record_id ?? null, offensive: fantasyPositions(p).some(x => OFFENSE.has(x)),
        values: Object.fromEntries(VARIANTS.map(v => [v, lineupValue(r, v)])),
        candidate_status: r ? { a2: r.candidates.a2.status, x2: r.candidates.x2.status } : null };
    });
    const lineups = Object.fromEntries(VARIANTS.map(v => [v, scopedLineup(players, rosterPositions, Object.fromEntries(players.map(p => [p.player_id, p.values[v]])))]));
    return JSON.parse(JSON.stringify({ schema_version: CANDIDATE_LINEUP_SCHEMA, classification, generated_at: decision.generated_at,
      identity: { provider: "sleeper", league_id: decision.league.league_id, season: Number(decision.league.season), week: Number(decision.league.week), roster_id: roster.roster_id },
      league: { roster_positions: rosterPositions, slot_counts: slotCounts, reserve_slots: decision.league.settings?.reserve_slots ?? null, taxi_slots: decision.league.settings?.taxi_slots ?? null },
      membership: { all: players.map(p => p.player_id), starters: (roster.starter_slots ?? []).map(s => ({ slot: s.slot, player_id: s.player_id ?? null })),
        bench: players.filter(p => p.membership === "bench").map(p => p.player_id), ir: players.filter(p => p.reserve).map(p => p.player_id), taxi: players.filter(p => p.taxi).map(p => p.player_id) },
      players, lineups, versions,
      semantics: { transaction_locks: "unknown", lineup_locks: "unknown; per-player kickoff recorded, platform lock rules not verified", ir_taxi: "excluded from active capacity; eligibility rules not verified",
        values: "Variant value for players production marks available this week; otherwise null and not assigned", unsupported_values: "K/DEF/IDP have no candidate value" },
      linkage: { candidate_capture_id: candidateCapture.capture_id, capture_id: candidateCapture.linked_capture_id },
    }));
  });
  const frozenAt = new Date(clock()).toISOString();
  const finished = records.map(r => ({ record_id: digest({ ...evidenceOnly(r), capture_bucket: Math.floor(Date.parse(r.generated_at) / 21600000) }), ...r, run: { frozen_at: frozenAt } }));
  return { schema_version: CANDIDATE_LINEUP_CAPTURE_SCHEMA, classification, generated_at: decision.generated_at, frozen_at: frozenAt,
    linked_candidate_capture_id: candidateCapture.capture_id, capture_id: digest(finished.map(r => r.record_id).sort()), records: finished };
}

export async function appendEdge02LineupCapture(directory, capture, { approvedLeagueIds, wallClock = Date.now() } = {}) {
  if (!capture) return { created: false, skipped: "No candidate capture" };
  if (capture.schema_version !== CANDIDATE_LINEUP_CAPTURE_SCHEMA || capture.records.some(r => r.schema_version !== CANDIDATE_LINEUP_SCHEMA)) throw new Error("Not an EDGE-02 lineup capture");
  const approved = new Set((approvedLeagueIds ?? []).map(String));
  if (capture.records.some(r => r.identity?.provider !== "sleeper" || !approved.has(String(r.identity?.league_id)) || Object.hasOwn(r, "visibility")))
    throw new Error("EDGE-02 lineup writer refused: record is not from an approved public Sleeper context");
  assertClassification(capture.classification, capture.generated_at, wallClock);
  for (const r of capture.records) { const { record_id, run, ...evidence } = r;
    if (record_id !== digest({ ...evidenceOnly(evidence), capture_bucket: Math.floor(Date.parse(r.generated_at) / 21600000) })) throw new Error("Lineup record ID does not match its evidence"); }
  if (digest(capture.records.map(r => r.record_id).sort()) !== capture.capture_id) throw new Error("Lineup capture ID does not match its records");
  return writeImmutable(directory, "edge02-lineup", capture, { checkRecords: false });
}
