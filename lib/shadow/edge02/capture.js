import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { numeric, mean, forecast, canonicalGame } from "../../decision/features.js";
import { CALIBRATION } from "../../decision/calibration/weights.js";
import { POLICY, POSITION_MODELS } from "../../decision/model-config.js";
import { digest, evidenceOnly, captureObservations } from "../../history/contracts.js";
import { EDGE02_CONFIG, EDGE02_CONFIG_SHA256, computedConfigSha256, EDGE02_BOUNDARY, CANDIDATES, FALLBACK, VIP_COEFFICIENTS } from "./config.js";
import { classifyScoring, scoringPositionCheck, auditCurrentRows, vipLast2 } from "./inputs.js";

/**
 * EDGE-02 candidate shadow (Evaluation Protocol v2, ADR 0014). Capture-only research: it reads a finished decision and the
 * same-run H9 capture, never mutates either, and is never read by production routes, models or the UI.
 */
export const CANDIDATE_SHADOW_SCHEMA = "candidate-shadow-1";
export const CANDIDATE_SHADOW_CAPTURE_SCHEMA = "candidate-shadow-capture-1";
export const CLASSIFICATIONS = Object.freeze(["prospective", "replay", "test"]);
/** A prospective record must be computed at (not reconstructed after) its decision time (ADR 0011 pattern). */
export const PROSPECTIVE_TOLERANCE_MS = 30 * 60 * 1000;
export const PROTOCOL = Object.freeze({ version: "evaluation-protocol-v2", path: "docs/evaluation-protocol-v2.md" });

const same = (a, b) => a === b || (numeric(a) && numeric(b) && Math.abs(a - b) < 1e-9);

/** The frozen configuration must hash to its registered identity and carry coefficients; otherwise nothing is captured. */
export function assertConfigIdentity() {
  if (!VIP_COEFFICIENTS) throw new Error("EDGE-02 VIP coefficients are not frozen");
  const computed = computedConfigSha256();
  if (computed !== EDGE02_CONFIG_SHA256) throw new Error(`EDGE-02 configuration digest ${computed} differs from the registered ${EDGE02_CONFIG_SHA256}`);
  return computed;
}

/**
 * Positive proof of an approved public context: an explicit Sleeper decision for a configured archive league with no
 * visibility field at all. A missing `visibility: "private"` is never enough on its own (Protocol v2 §8).
 */
export function approvedContextProblem(decision, approvedLeagueIds) {
  if (!decision || typeof decision !== "object") return "No decision";
  if (Object.hasOwn(decision, "visibility")) return `Decision carries a visibility field (${JSON.stringify(decision.visibility)}); only approved public contexts are captured`;
  if (Object.hasOwn(decision, "provider")) return "Non-Sleeper decision";
  if (decision.identity?.provider !== "sleeper") return "Decision identity is not an explicit Sleeper identity";
  const approved = new Set((Array.isArray(approvedLeagueIds) ? approvedLeagueIds : []).map(String));
  if (!approved.size) return "No approved archive league list";
  if (!approved.has(String(decision.league?.league_id ?? ""))) return "League is not a configured public archive league";
  return null;
}
export function assertApprovedContext(decision, approvedLeagueIds) {
  const problem = approvedContextProblem(decision, approvedLeagueIds);
  if (problem) throw new Error(`EDGE-02 capture refused: ${problem}`);
}

export function assertClassification(classification, generatedAt, wallClock = Date.now()) {
  if (!CLASSIFICATIONS.includes(classification)) throw new Error(`Unknown EDGE-02 classification: ${classification}`);
  if (classification !== "prospective") return classification;
  const at = Date.parse(generatedAt);
  if (!Number.isFinite(at)) throw new Error("Prospective EDGE-02 records require a finite generated_at");
  if (EDGE02_BOUNDARY.effective_at !== null && at < Date.parse(EDGE02_BOUNDARY.effective_at)) throw new Error("Prospective EDGE-02 records must follow the effective boundary");
  if (Math.abs(wallClock - at) > PROSPECTIVE_TOLERANCE_MS) throw new Error("Prospective EDGE-02 records must be computed at decision time; use replay for reconstructed decisions");
  return classification;
}

/**
 * Technical prospective timing: effective_at <= generated_at <= frozen_at < target kickoff, all finite. When the boundary is not
 * yet recorded in code it is `pending_registration_record`: the evaluator applies it from main's merge commit.
 */
export function prospectiveTiming({ classification, generatedAt, frozenAt, kickoff, effectiveAt = EDGE02_BOUNDARY.effective_at }) {
  const g = Date.parse(generatedAt), f = Date.parse(frozenAt), k = Date.parse(kickoff ?? ""), e = effectiveAt == null ? null : Date.parse(effectiveAt);
  const reason = classification !== "prospective" ? "not_prospective_classification"
    : !Number.isFinite(g) || !Number.isFinite(f) ? "non_finite_timestamps"
    : !kickoff || !Number.isFinite(k) ? "no_target_kickoff"
    : f < g ? "frozen_before_generated"
    : k <= f ? "kickoff_not_after_freeze"
    : e !== null && !(Number.isFinite(e) && e <= g) ? "generated_before_effective_boundary"
    : null;
  return { technical_eligible: reason === null, reason, boundary_status: e === null ? "pending_registration_record" : reason === "generated_before_effective_boundary" ? "violated" : "satisfied" };
}
export function candidateEligibility(timing, candidate) {
  const reason = !timing.technical_eligible ? timing.reason : candidate.status === "withheld" ? "candidate_withheld" : !numeric(candidate.value) ? "no_candidate_prediction" : null;
  return { eligible: reason === null, reason };
}

/** Additive trusted-writer metadata from the GitHub Actions environment (no secrets). Absent outside Actions. */
export function trustedWriter(env = process.env) {
  const actions = env.GITHUB_ACTIONS === "true", v = key => actions ? env[key] ?? null : null;
  const meta = { github_actions: actions, run_id: v("GITHUB_RUN_ID"), run_attempt: v("GITHUB_RUN_ATTEMPT"), workflow: v("GITHUB_WORKFLOW"),
    ref: v("GITHUB_REF"), event_name: v("GITHUB_EVENT_NAME"), repository: v("GITHUB_REPOSITORY"), sha: v("GITHUB_SHA") };
  return { ...meta, witness_available: actions && meta.ref === "refs/heads/main" && !!meta.run_id && !!meta.sha };
}

/** Confirmatory status is never granted at write time; the evaluator also needs the data-archive publication witness. */
export function confirmatoryStatus({ classification, timing, writer }) {
  if (classification !== "prospective") return { status: "non_confirmatory", reason: `${classification}_classification` };
  if (!timing.technical_eligible) return { status: "non_confirmatory", reason: timing.reason };
  if (!writer.witness_available) return { status: "non_confirmatory", reason: "no_trusted_writer_witness" };
  return { status: "requires_publication_witness", reason: null,
    requirement: "The evaluator must show this file was committed to data-archive by the approved capture workflow and pushed before target kickoff, and that generated_at follows the registered effective boundary." };
}

/** H9 evidence for X2 from the same run (ADR 0011 record), with its integrity checks. Never recomputed here. */
export function h9Evidence(h9, decision, playerId, productionQ) {
  if (!h9?.capture) return { ok: false, code: "h9_unavailable", detail: h9?.error ?? "No same-run H9 capture" };
  if (!h9.persisted) return { ok: false, code: "h9_not_persisted", detail: "Same-run H9 capture was not written to the archive" };
  const record = h9.capture.records?.find(r => r.player?.player_id === playerId);
  if (!record) return { ok: false, code: "h9_unavailable", detail: "No H9 record for this player" };
  if (h9.capture.generated_at !== decision.generated_at || record.generated_at !== decision.generated_at || record.decision_basis_sha256 !== digest(decision.basis ?? null))
    return { ok: false, code: "h9_basis_mismatch", detail: "H9 record is not from this decision build" };
  if (!same(record.production?.quality_points ?? null, productionQ)) return { ok: false, code: "h9_basis_mismatch", detail: "H9 record production Q differs" };
  if (record.h9?.status === "withheld") return { ok: false, code: "h9_withheld", detail: record.h9.withheld_reason ?? null };
  if (record.basis_check?.status !== "consistent") return { ok: false, code: "h9_invalid", detail: "H9 basis check not consistent" };
  if (!numeric(record.h9?.quality_points)) return { ok: false, code: "h9_invalid", detail: "H9 Q is not finite" };
  return { ok: true, code: null, quality_points: record.h9.quality_points, start_frame: record.h9.start_frame ?? null, status: record.h9.status,
    reference: { h9_record_id: record.record_id, h9_capture_id: h9.capture.capture_id, h9_path: h9.path ?? null } };
}

/**
 * One candidate's value under the whole-candidate fallback contract (Protocol v2 §5). `blocked` is an integrity or scoring
 * reason that withholds; `quality` is the candidate's Q term (production Q for A2, H9 Q for X2).
 */
export function candidateValue({ blocked, quality, recent, vip, fallback }) {
  const w = CANDIDATES.a2.weights;
  if (blocked) return { status: "withheld", value: null, reasons: [blocked], fallback: null };
  if (!numeric(fallback)) return { status: "withheld", value: null, reasons: [{ code: "quality_missing" }], fallback: null };
  const ordinary = [...(!numeric(vip) ? [{ code: "vip_missing" }] : []), ...(!numeric(recent) ? [{ code: "r3_missing" }] : [])];
  if (ordinary.length) return { status: "fallback", value: fallback, reasons: ordinary, fallback: { id: FALLBACK.id, value: fallback } };
  return { status: "computed", value: w.quality * quality + w.recent * recent + w.vip * vip, reasons: [], fallback: null };
}

const ew = (pts, h) => { if (!pts.length) return null; let s = 0, wt = 0; pts.forEach((p, i) => { const x = 0.5 ** ((pts.length - 1 - i) / h); s += x * p; wt += x; }); return s / wt; };
const configDigests = () => ({ calibration_sha256: digest(CALIBRATION), model_config_sha256: digest({ POLICY, POSITION_MODELS }) });
const sourceVersion = s => s ? { source: s.source_id, status: s.status, digest: s.digest ?? null, fetched_at: s.fetched_at ?? null, published_at: s.published_at ?? null, url: s.url ?? null } : null;
async function protocolDigest() {
  try { return createHash("sha256").update(await readFile(new URL(`../../../${PROTOCOL.path}`, import.meta.url))).digest("hex"); } catch { return null; }
}

/**
 * Builds one EDGE-02 capture for a finished decision. `internals` come from build-context's `shadowObserver` hook; `h9` is the
 * same run's H9 result `{ capture, persisted, path, error }`. Never mutates `decision` or `h9`.
 */
export async function buildEdge02Capture({ decision, internals, h9 = null, classification, approvedLeagueIds, clock = Date.now, env = process.env, linkedCaptureId = null }) {
  assertApprovedContext(decision, approvedLeagueIds);
  const configSha = assertConfigIdentity();
  assertClassification(classification, decision.generated_at, clock());
  if (!internals?.currentRegular) return null;
  const candidateStartedAt = new Date(clock()).toISOString();
  const season = Number(decision.league.season), week = Number(decision.league.week);
  const scoring = classifyScoring(decision.league.scoring_settings);
  const statsSource = decision.sources.find(s => s.source_id === "nflverse_stats");
  const statsOk = statsSource?.status === "available" && Array.isArray(internals.currentRawRows);
  const statIdsByPlayer = new Map();
  for (const [statId, playerId] of internals.idMap ?? []) (statIdsByPlayer.get(playerId) ?? statIdsByPlayer.set(playerId, []).get(playerId)).push(statId);
  const rawByStatId = new Map();
  for (const r of statsOk ? internals.currentRawRows : []) (rawByStatId.get(r.player_id) ?? rawByStatId.set(r.player_id, []).get(r.player_id)).push(r);
  const productionPlayers = internals.productionPlayers ?? {};
  const observationIds = new Map(captureObservations(decision).map(o => [o.player_id, o.observation_id]));
  const schedule = decision.sources.find(s => s.source_id === "nflverse_schedule");
  const sources = { current_stats: sourceVersion(statsSource), prior_stats: sourceVersion(decision.sources.find(s => s.source_id === "nflverse_prior_stats")), schedule: sourceVersion(schedule),
    ids: sourceVersion(decision.sources.find(s => s.source_id === "ffverse_ids")) };
  const versions = { schema_version: CANDIDATE_SHADOW_SCHEMA, candidate_ids: [CANDIDATES.a2.id, CANDIDATES.x2.id], protocol: { ...PROTOCOL, sha256: await protocolDigest() },
    config_sha256: configSha, model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision ?? null, ...configDigests() };
  const records = [];
  for (const c of Object.values(decision.player_context)) {
    const id = c.player.player_id, f = c.model?.features ?? null, statIds = statIdsByPlayer.get(id) ?? [];
    const identity = statIds.length === 1 ? "exact_crosswalk" : statIds.length ? "ambiguous_crosswalk" : "unresolved";
    const audit = identity === "exact_crosswalk" && statsOk ? auditCurrentRows(rawByStatId.get(statIds[0]) ?? [], season, week) : null;
    const format = scoring.verdict === "compatible" ? scoring.format : null;
    const vip = audit?.status === "valid" && format ? vipLast2(audit.rows, format, { platformTeam: c.player.team }) : null;
    const Q = f?.quality_points ?? null, R3 = f?.recent_ppg ?? null, vipValue = vip?.status === "computed" ? vip.value : null;
    const N = f && numeric(Q) ? forecast(f, FALLBACK.weights).central : null;
    const position = scoringPositionCheck({ format, modelPosition: f?.position ?? null, vipPosition: vip?.position ?? null, eligibility: c.player.fantasy_positions,
      productionAmbiguous: (productionPlayers[id]?.missing_stats ?? []).includes("ambiguous platform position for reception premium") });
    // Integrity and scoring problems withhold both candidates; they are never disguised as ordinary missingness.
    const blocked = scoring.verdict !== "compatible" ? { code: `scoring_${scoring.verdict}`, detail: scoring.reasons }
      : !f ? { code: "no_production_features" }
      : identity !== "exact_crosswalk" ? { code: `identity_${identity}` }
      : !statsOk ? { code: "current_stats_unavailable", detail: statsSource?.status ?? "missing" }
      : audit.status !== "valid" ? { code: "source_integrity", detail: audit.problems }
      : !position.ok ? { code: position.code, detail: position.detail } : null;
    const a2 = candidateValue({ blocked, quality: Q, recent: R3, vip: vipValue, fallback: N });
    // X2 needs a valid same-run H9 Q; its missing-VIP/R3 fallback is still production N (production Q), never H9.
    const h9e = !blocked && numeric(Q) ? h9Evidence(h9, decision, id, Q) : null;
    const x2 = candidateValue({ blocked: blocked ?? (h9e && !h9e.ok ? { code: h9e.code, detail: h9e.detail ?? null } : null), quality: h9e?.ok ? h9e.quality_points : null, recent: R3, vip: vipValue, fallback: N });
    const history = (c.analytics?.history ?? []).filter(g => Number(g.week) < week).map(canonicalGame).sort((a, b) => a.week - b.week);
    const pts = history.map(g => g.points).filter(numeric), start = c.model?.start_value;
    records.push(JSON.parse(JSON.stringify({ schema_version: CANDIDATE_SHADOW_SCHEMA, classification, generated_at: decision.generated_at,
      identity: { provider: "sleeper", league_id: decision.league.league_id, season, player_id: id, stat_player_id: statIds.length === 1 ? statIds[0] : null,
        identity_status: identity, position: f?.position ?? null, fantasy_eligibility: c.player.fantasy_positions ?? [], platform_team: c.player.team ?? null },
      target: { season, season_type: "REG", week, game_id: c.schedule?.game_id ?? null, team: c.player.team ?? null, opponent: c.schedule?.opponent ?? null,
        kickoff: c.schedule?.kickoff ?? null, schedule_status: c.schedule?.status ?? null, schedule_source: sources.schedule },
      linkage: { observation_id: observationIds.get(id) ?? null, capture_id: linkedCaptureId, h9: h9e?.reference ?? null },
      scoring: { verdict: scoring.verdict, format: scoring.format, reasons: scoring.reasons, offensive_vector: scoring.offensive_vector ?? null,
        ignored_non_offensive_keys: scoring.ignored_non_offensive_keys ?? [], scoring_sha256: scoring.scoring_sha256, settings: decision.league.scoring_settings ?? null },
      predictions: { production_start_value: start?.central ?? null, production_weekly_start_value: start?.weekly_start_value ?? null, available_this_week: start?.available_this_week ?? null,
        production_quality_points: Q, recent_ppg: R3, h9_quality_points: h9e?.ok ? h9e.quality_points : null,
        h9_start_frame_comparator: h9e?.ok ? h9e.start_frame : null, a2: a2.value, x2: x2.value, production_noX: N,
        baselines: { B1_season_ppg: f?.season_ppg ?? null, B2_recent3_ppg: R3, B3_ew3: ew(pts, 3), B3_ew5: ew(pts, 5), B4_last_week: pts.at(-1) ?? null, B7_quality: Q, B9_production: start?.central ?? null } },
      candidates: { a2: { id: CANDIDATES.a2.id, role: CANDIDATES.a2.role, ...a2 }, x2: { id: CANDIDATES.x2.id, role: CANDIDATES.x2.role, ...x2 } },
      inputs: { vip: vip ? { ...vip, format: scoring.format } : { status: "not_evaluated", reason: audit && audit.status !== "valid" ? "source_integrity" : "blocked_before_vip" },
        source_audit: audit ? { status: audit.status, problems: audit.problems, excluded_non_skill_rows: audit.excluded_non_skill_rows ?? null } : null,
        quality: f ? { season_ppg: f.season_ppg, current_games: f.current_games, prior: f.prior, changed_team: f.changed_team, role_change: f.role_change } : null,
        recent: { rows: history.slice(-3).map(g => ({ game_id: g.game_id ?? null, week: g.week, team: g.team ?? null, points: numeric(g.points) ? g.points : null })),
          basis: "production weeklyFeatures recent_ppg: mean of numeric points over the last three as-of rows" } },
      versions, sources, context: { approval: "configured public Sleeper archive league", visibility_field_present: false },
    })));
  }
  // Freeze time is taken after every candidate value is computed; eligibility is judged against it.
  const frozenAt = new Date(clock()).toISOString();
  assertClassification(classification, decision.generated_at, Date.parse(frozenAt));
  const writer = trustedWriter(env);
  const finished = records.map(r => {
    const timing = prospectiveTiming({ classification, generatedAt: r.generated_at, frozenAt, kickoff: r.target.kickoff });
    const run = { candidate_started_at: candidateStartedAt, frozen_at: frozenAt, trusted_writer: writer,
      acquisition: { completion_at: "unknown", upper_bound: candidateStartedAt, acquired_before_freeze: Date.parse(candidateStartedAt) <= Date.parse(frozenAt),
        basis: "Every decision source resolved before buildDecisionState returned and the same-run H9 capture finished before this builder started; fetched_at is request start, not completion" },
      publication_witness: { in_record: false, requirement: "data-archive commit by the approved capture workflow, pushed before target kickoff" },
      prospective: { ...timing, candidates: { a2: candidateEligibility(timing, r.candidates.a2), x2: candidateEligibility(timing, r.candidates.x2) },
        confirmatory: confirmatoryStatus({ classification, timing, writer }) } };
    return { record_id: recordId(r), ...r, run };
  });
  return { schema_version: CANDIDATE_SHADOW_CAPTURE_SCHEMA, classification, generated_at: decision.generated_at, candidate_started_at: candidateStartedAt, frozen_at: frozenAt,
    linked_capture_id: linkedCaptureId, config_sha256: configSha, boundary: EDGE02_BOUNDARY, capture_id: digest(finished.map(r => r.record_id).sort()), records: finished };
}

/** Evidence identity: run metadata (freeze time, writer, eligibility) is kept in the file but never in the ID. */
export const recordId = record => { const { record_id, run, ...evidence } = record; return digest({ ...evidenceOnly(evidence), capture_bucket: Math.floor(Date.parse(record.generated_at) / 21600000) }); };

const safe = value => { const s = String(value); if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw new Error("Invalid archive partition"); return s; };
/**
 * Exclusive (`wx`) immutable write. An existing file with the same ID is kept byte-for-byte; a stored payload whose record IDs
 * differ from the new one is a conflict and is refused.
 */
const hexId = value => { if (!/^[a-f0-9]{64}$/.test(String(value))) throw new Error("Invalid capture ID"); return value; };

export async function writeImmutable(directory, root, capture, { checkRecords = true } = {}) {
  if (checkRecords) {
    for (const r of capture.records) if (recordId(r) !== r.record_id) throw new Error("Record ID does not match its evidence");
    if (digest(capture.records.map(r => r.record_id).sort()) !== capture.capture_id) throw new Error("Capture ID does not match its records");
  }
  const first = capture.records[0];
  const partition = ["shadow", root, safe(capture.classification), safe(first?.identity?.season ?? first?.season ?? "none"), safe(first?.identity?.league_id ?? first?.league_id ?? "none")].join("/");
  const folder = join(directory, partition), file = `${hexId(capture.capture_id)}.json.gz`;
  await mkdir(folder, { recursive: true });
  try { await writeFile(join(folder, file), gzipSync(JSON.stringify(capture)), { flag: "wx" }); }
  catch (e) {
    if (e.code !== "EEXIST") throw e;
    const stored = JSON.parse(gunzipSync(await readFile(join(folder, file))));
    if (stored.capture_id !== capture.capture_id || JSON.stringify(stored.records.map(r => r.record_id).sort()) !== JSON.stringify(capture.records.map(r => r.record_id).sort()))
      throw new Error("Conflicting payload for an existing capture ID; the stored file is kept");
    return { created: false, path: `${partition}/${file}`, generated_at: stored.generated_at, frozen_at: stored.frozen_at, records: stored.records.length };
  }
  return { created: true, path: `${partition}/${file}`, generated_at: capture.generated_at, frozen_at: capture.frozen_at, records: capture.records.length };
}

/** Writer-side checks, independent of the builder: context, configuration, classification, prompt write, eligibility. */
export async function appendEdge02Capture(directory, capture, { approvedLeagueIds, wallClock = Date.now() } = {}) {
  if (!capture) return { created: false, skipped: "No current regular-season decision" };
  if (capture.schema_version !== CANDIDATE_SHADOW_CAPTURE_SCHEMA || capture.records.some(r => r.schema_version !== CANDIDATE_SHADOW_SCHEMA)) throw new Error("Not an EDGE-02 candidate capture");
  const approved = new Set((approvedLeagueIds ?? []).map(String));
  if (capture.records.some(r => r.identity?.provider !== "sleeper" || !approved.has(String(r.identity?.league_id)) || Object.hasOwn(r, "visibility") || r.context?.visibility_field_present !== false))
    throw new Error("EDGE-02 writer refused: record is not from an approved public Sleeper context");
  if (capture.config_sha256 !== assertConfigIdentity()) throw new Error("EDGE-02 capture configuration differs from the registered configuration");
  assertClassification(capture.classification, capture.generated_at, wallClock);
  if (capture.records.some(r => r.classification !== capture.classification)) throw new Error("Mixed EDGE-02 classifications");
  if (capture.classification === "prospective") {
    if (!(Date.parse(capture.frozen_at) >= Date.parse(capture.generated_at)) || !(Date.parse(capture.frozen_at) <= wallClock) || wallClock - Date.parse(capture.frozen_at) > PROSPECTIVE_TOLERANCE_MS)
      throw new Error("Prospective EDGE-02 records must be written promptly after their freeze time");
    for (const r of capture.records) {
      if (r.generated_at !== capture.generated_at || r.run?.frozen_at !== capture.frozen_at) throw new Error("Record timestamps differ from the capture");
      const timing = prospectiveTiming({ classification: r.classification, generatedAt: r.generated_at, frozenAt: r.run.frozen_at, kickoff: r.target?.kickoff });
      for (const k of ["a2", "x2"]) {
        const e = candidateEligibility(timing, r.candidates[k]), stored = r.run.prospective?.candidates?.[k];
        if (e.eligible !== stored?.eligible || e.reason !== stored?.reason) throw new Error("Prospective EDGE-02 eligibility does not match the record");
      }
    }
  }
  const result = await writeImmutable(directory, "edge02-vip", capture);
  return { ...result, computed: { a2: capture.records.filter(r => r.candidates.a2.status === "computed").length, x2: capture.records.filter(r => r.candidates.x2.status === "computed").length },
    fallback: { a2: capture.records.filter(r => r.candidates.a2.status === "fallback").length, x2: capture.records.filter(r => r.candidates.x2.status === "fallback").length },
    withheld: { a2: capture.records.filter(r => r.candidates.a2.status === "withheld").length, x2: capture.records.filter(r => r.candidates.x2.status === "withheld").length } };
}

export { EDGE02_CONFIG };
