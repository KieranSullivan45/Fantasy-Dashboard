import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { numeric, canonicalGame, forecast } from "../decision/features.js";
import { buildProduction } from "../decision/production.js";
import { CALIBRATION } from "../decision/calibration/weights.js";
import { POLICY, POSITION_MODELS } from "../decision/model-config.js";
import { digest, evidenceOnly, captureObservations } from "../history/contracts.js";

/**
 * H9 prospective shadow (ADR 0009, candidate `ew2_h16`). Research-only: it reads a finished decision and never feeds
 * Start Value, lineups, Pickup Rating, trades or any user-facing route (Evaluation Protocol v1 §11.5.7).
 */
export const H9_SHADOW_SCHEMA = "h9-shadow-1";
export const H9_SHADOW_CAPTURE_SCHEMA = "h9-shadow-capture-1";
export const H9_CANDIDATE = Object.freeze({ id: "ew2_h16", adr: "docs/decisions/0009-m4-tier-a-adjudication.md", half_life_games: 16,
  prior_seasons: ["Y-2", "Y-1"], replaces: "last-8 prior mean P inside Q only",
  // ADR 0009 is effective at the merge of PR #17 (merged_at); it is not backdated.
  effective_at: "2026-10-03T03:15:40Z", effective_basis: "PR #17 merge (ADR 0009 accepted)" });
export const CLASSIFICATIONS = Object.freeze(["prospective", "replay", "test"]);
/** A prospective record must be computed at (not reconstructed after) its decision time. */
export const PROSPECTIVE_TOLERANCE_MS = 30 * 60 * 1000;

const regularRows = (rows, season) => rows.filter(g => Number(g.season) === season && (g.season_type == null || g.season_type === "REG"))
  .map(canonicalGame).sort((a, b) => a.week - b.week);

/**
 * ew2_h16 prior: Y−2 then Y−1 regular-season rows; non-numeric points are excluded before g is assigned (no g, no
 * weight, never zero); w_g = 0.5^(g/16) with g = 0 for the most recent included game; absent when Y−1 has no numeric row.
 * Rows from season Y or later can never enter.
 */
export function h9Prior(priorHistory, season) {
  const Y = Number(season), older = regularRows(priorHistory, Y - 2), latest = regularRows(priorHistory, Y - 1);
  const olderIncluded = older.filter(g => numeric(g.points)), latestIncluded = latest.filter(g => numeric(g.points));
  const counts = { included_games: { y_minus_2: olderIncluded.length, y_minus_1: latestIncluded.length },
    excluded_non_numeric: { y_minus_2: older.length - olderIncluded.length, y_minus_1: latest.length - latestIncluded.length } };
  if (!latestIncluded.length) return { status: "absent", ppg: null, reason: "No numeric-point season Y−1 regular-season row; no fallback to Y−2 alone", ...counts, input_sha256: null };
  const included = [...olderIncluded, ...latestIncluded];
  let sum = 0, weights = 0;
  included.forEach((g, i) => { const w = 0.5 ** ((included.length - 1 - i) / H9_CANDIDATE.half_life_games); sum += w * g.points; weights += w; });
  return { status: "present", ppg: sum / weights, reason: null, ...counts, weight_sum: weights,
    input_sha256: digest(included.map(g => [Number(g.season), g.week, g.game_id ?? null, g.points])) };
}

/** Q with only P replaced. S, n and k (including the k = 1 changed-team/role branch) are production's own values. */
export function h9Quality(features, prior) {
  const S = features.season_ppg, n = features.current_games, k = features.prior.effective_games, P = prior.ppg;
  return S == null ? P : P == null ? S : (S * n + P * k) / (n + k);
}

/** Recomputes production's last-8 prior and Q from the same Y−1 rows, proving both forecasts share one decision state. */
export function basisCheck(features, priorHistory, season) {
  const last8 = regularRows(priorHistory, Number(season) - 1).slice(-8), points = last8.map(g => g.points).filter(numeric);
  const ppg = points.length ? points.reduce((a, b) => a + b, 0) / points.length : null;
  const S = features.season_ppg, n = features.current_games, k = features.prior.effective_games;
  const q = S == null ? ppg : ppg == null ? S : (S * n + ppg * k) / (n + k);
  const same = (a, b) => a === b || (numeric(a) && numeric(b) && Math.abs(a - b) < 1e-9);
  const consistent = last8.length === features.prior.games && same(ppg, features.prior.ppg) && same(q, features.quality_points);
  return { status: consistent ? "consistent" : "mismatch", recomputed_prior_ppg: ppg, recomputed_prior_games: last8.length };
}

export function assertClassification(classification, generatedAt, wallClock = Date.now()) {
  if (!CLASSIFICATIONS.includes(classification)) throw new Error(`Unknown H9 shadow classification: ${classification}`);
  if (classification !== "prospective") return classification;
  const at = Date.parse(generatedAt);
  if (!Number.isFinite(at) || at < Date.parse(H9_CANDIDATE.effective_at)) throw new Error("Prospective H9 records must be generated after the ADR 0009 effective boundary");
  if (Math.abs(wallClock - at) > PROSPECTIVE_TOLERANCE_MS) throw new Error("Prospective H9 records must be computed at decision time; use replay for reconstructed decisions");
  return classification;
}

const configDigests = { calibration_sha256: digest(CALIBRATION), model_config_sha256: digest({ POLICY, POSITION_MODELS }) };
const sourceVersion = s => s ? { source: s.source_id, status: s.status, digest: s.digest ?? null, fetched_at: s.fetched_at ?? null, url: s.url ?? null } : null;
const byPlayer = games => { const m = new Map(); for (const g of games) if (g.player_id) (m.get(g.player_id) ?? m.set(g.player_id, []).get(g.player_id)).push(g); return m; };

/**
 * Builds one shadow capture for a finished decision. `internals` come from build-context's `shadowObserver` hook (the exact
 * Y−1 rows production used). Y−2 is loaded here with the same identity map, scoring and player set. Never mutates `decision`.
 */
export async function buildH9ShadowCapture({ decision, internals, statsSource, classification, wallClock = Date.now(), linkedCaptureId = null }) {
  if (decision?.visibility === "private") throw new Error("Private league decisions are never captured.");
  assertClassification(classification, decision.generated_at, wallClock);
  if (!internals?.currentRegular) return null;
  const season = Number(internals.season);
  const y2 = await (async () => { try { return await statsSource(season - 2); } catch (e) { return { source_id: "nflverse_stats", status: "unavailable", data: null, warnings: [e.message] }; } })();
  const y2Ok = y2?.status === "available" && Array.isArray(y2.data);
  const olderGames = y2Ok ? buildProduction(y2.data, internals.idMap, { season: season - 2, week: 19, settings: internals.scoringSettings, platformPlayers: internals.players }).games : [];
  const older = byPlayer(olderGames.map(g => ({ ...g, season: season - 2 }))), latest = byPlayer(internals.priorGames.map(g => ({ ...g, season: season - 1 })));
  const statIds = new Map([...internals.idMap].map(([statId, playerId]) => [playerId, statId]));
  const priorY1 = decision.sources.find(s => s.source_id === "nflverse_prior_stats");
  const observationIds = new Map(captureObservations(decision).map(o => [o.player_id, o.observation_id]));
  const decisionBasisSha = digest(decision.basis ?? null);
  const records = Object.values(decision.player_context).map(c => {
    const f = c.model?.features, id = c.player.player_id, start = c.model?.start_value;
    const priorRows = [...(older.get(id) ?? []), ...(latest.get(id) ?? [])];
    const check = f ? basisCheck(f, priorRows, season) : { status: "mismatch", recomputed_prior_ppg: null, recomputed_prior_games: null };
    const withheld = !f ? "No production features" : !y2Ok ? "Season Y−2 statistics unavailable; H9 is not computed from Y−1 alone" : check.status !== "consistent" ? "Basis check failed: Y−1 rows do not reproduce production's prior" : null;
    const prior = withheld ? null : h9Prior(priorRows, season);
    const quality = prior ? h9Quality(f, prior) : null;
    const weights = CALIBRATION[f?.position]?.start.weights;
    const frame = prior && weights ? forecast({ ...f, quality_points: quality }, weights) : null;
    const record = JSON.parse(JSON.stringify({ schema_version: H9_SHADOW_SCHEMA, classification, candidate: H9_CANDIDATE,
      generated_at: decision.generated_at, provider: decision.identity?.provider || "sleeper", league_id: decision.league.league_id,
      season, week: decision.league.week, data_through_week: decision.data_through_week,
      model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision ?? null, config: configDigests,
      decision_basis_sha256: decisionBasisSha, linked_observation_id: observationIds.get(id) ?? null, linked_capture_id: linkedCaptureId,
      scoring: { profile: decision.scoring?.profile ?? null, unsupported_rules: decision.scoring?.unsupported_rules ?? [], scoring_settings_sha256: digest(decision.league.scoring_settings ?? null) },
      source_versions: { prior_y1: sourceVersion(priorY1), prior_y2: sourceVersion(y2) },
      player: { player_id: id, stat_player_id: statIds.get(id) ?? null, identity_status: statIds.has(id) ? "exact_crosswalk" : "unresolved", position: f?.position ?? null, fantasy_positions: c.player.fantasy_positions, team: c.player.team ?? null },
      schedule: { status: c.schedule?.status ?? null, opponent: c.schedule?.opponent ?? null, kickoff: c.schedule?.kickoff ?? null,
        kickoff_after_generated_at: c.schedule?.kickoff ? Date.parse(c.schedule.kickoff) > Date.parse(decision.generated_at) : null },
      production: { supported: c.model?.supported ?? false, start_value: start?.central ?? null, weekly_start_value: start?.weekly_start_value ?? null,
        available_this_week: start?.available_this_week ?? null, start_coverage: start?.coverage ?? null, start_fallback: start?.fallback ?? null,
        quality_points: f?.quality_points ?? null, season_ppg: f?.season_ppg ?? null, current_games: f?.current_games ?? null, prior: f?.prior ?? null,
        changed_team: f?.changed_team ?? null, role_change: f?.role_change ?? null },
      frame_inputs: { recent_ppg: f?.recent_ppg ?? null, recent_xfp: f?.recent_xfp ?? null, opportunity_score: f?.opportunity?.score ?? null, opportunity_coverage: f?.opportunity?.coverage ?? null },
      h9: { status: withheld ? "withheld" : prior.status === "present" ? "computed" : "computed_without_prior", withheld_reason: withheld, prior,
        effective_games: f?.prior?.effective_games ?? null, k_basis: "Production k: existing last-8 definition and branches, unchanged (ADR 0009)",
        existing_prior_absent_h9_present: !!prior && prior.status === "present" && f.prior.ppg == null,
        quality_points: quality, start_frame: frame?.central ?? null,
        start_frame_basis: "Comparator only: production start weights with H9 Q substituted; not a production forecast" },
      basis_check: check,
    }));
    return { record_id: digest({ ...evidenceOnly(record), capture_bucket: Math.floor(Date.parse(record.generated_at) / 21600000) }), ...record };
  });
  return { schema_version: H9_SHADOW_CAPTURE_SCHEMA, classification, generated_at: decision.generated_at, shadow_computed_at: new Date(wallClock).toISOString(),
    linked_capture_id: linkedCaptureId, capture_id: digest(records.map(r => r.record_id).sort()), records };
}

const safe = value => { const s = String(value); if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw new Error("Invalid archive partition"); return s; };
/** Immutable write under `shadow/h9-ew2_h16/<classification>/…`; prospective and replay/test records never share a partition. */
export async function appendH9ShadowCapture(directory, capture, { wallClock = Date.now() } = {}) {
  if (!capture) return { created: false, skipped: "No current regular-season decision" };
  assertClassification(capture.classification, capture.generated_at, wallClock);
  if (capture.records.some(r => r.classification !== capture.classification || r.schema_version !== H9_SHADOW_SCHEMA)) throw new Error("Mixed H9 shadow classifications");
  const first = capture.records[0], provider = safe(first?.provider || "sleeper");
  const partition = ["shadow", `h9-${H9_CANDIDATE.id}`, safe(capture.classification), ...(provider === "sleeper" ? [] : [provider]), safe(first?.season ?? "none"), safe(first?.league_id ?? "none")].join("/");
  const folder = join(directory, partition), file = `${capture.capture_id}.json.gz`;
  await mkdir(folder, { recursive: true });
  try { await writeFile(join(folder, file), gzipSync(JSON.stringify(capture)), { flag: "wx" }); }
  catch (e) { if (e.code !== "EEXIST") throw e;
    const stored = JSON.parse(gunzipSync(await readFile(join(folder, file))));
    return { created: false, path: `${partition}/${file}`, generated_at: stored.generated_at, records: stored.records.length }; }
  return { created: true, path: `${partition}/${file}`, generated_at: capture.generated_at, records: capture.records.length,
    computed: capture.records.filter(r => r.h9.status !== "withheld").length };
}
