import { numeric } from "../../decision/features.js";
import { finiteNumber, normalizeTeam } from "../../sources/contracts.js";
import { digest } from "../../history/contracts.js";
import { FROZEN_FORMATS, EXPLICIT_KEYS, VIP_INPUTS, VIP_RAW_COLUMNS, VIP_COEFFICIENTS } from "./config.js";

/**
 * EDGE-02 candidate inputs: exact scoring-format classification and VIP_last2 (Protocol v2 §3–§4, ADR 0014).
 * Research-only. Nothing here substitutes a generic format, refits VIP or fills a missing value.
 */

// Keys that score only kickers, team defenses or IDP by namespace, exactly the sets production `scoreStats` never applies to
// a QB/RB/WR/TE (lib/normalize/scoring.js). Every other key must equal the frozen format, or be absent/zero when unregistered.
const KICKING = /^(fg|xp)/;
const DEFENSE_KEYS = new Set(["sack", "int", "ff", "fum_rec", "def_td", "safe", "blk_kick", "tkl", "tkl_solo", "tkl_ast", "tkl_loss", "qb_hit", "pass_def"]);
const DEFENSE = /^(def_|pts_allow|yds_allow|idp_)/;
export const nonOffensiveKey = key => KICKING.test(key) || DEFENSE_KEYS.has(key) || DEFENSE.test(key);

/**
 * League-level verdict. Returns { verdict: "compatible", format } only when every offensive key equals one frozen format
 * exactly; otherwise { verdict: "incompatible" | "incomplete" | "unavailable", reasons: [...] }. Never a nearest format.
 */
export function classifyScoring(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || !Object.keys(settings).length)
    return { verdict: "unavailable", format: null, reasons: [{ code: "scoring_unavailable" }], scoring_sha256: digest(settings ?? null) };
  const reasons = [], value = key => settings[key];
  for (const key of EXPLICIT_KEYS) if (!Object.hasOwn(settings, key) || typeof value(key) !== "number" || !Number.isFinite(value(key))) reasons.push({ code: "incomplete_scoring", key, value: value(key) ?? null });
  for (const [key, v] of Object.entries(settings)) if (typeof v !== "number" || !Number.isFinite(v)) { if (!EXPLICIT_KEYS.includes(key) && !nonOffensiveKey(key)) reasons.push({ code: "non_numeric_scoring_value", key }); }
  if (reasons.length) return { verdict: "incomplete", format: null, reasons, scoring_sha256: digest(settings) };
  // Offensive vector: the registered keys plus every key not provably non-offensive. Unregistered keys must be zero.
  const unregistered = Object.keys(settings).filter(k => !Object.hasOwn(FROZEN_FORMATS.ppr, k) && !nonOffensiveKey(k) && settings[k] !== 0).sort();
  for (const key of unregistered) reasons.push({ code: /^bonus_rec_(rb|wr)$/.test(key) ? "position_reception_premium" : /^bonus_/.test(key) ? "unregistered_bonus" : "unregistered_offensive_rule", key, value: settings[key] });
  const vector = Object.fromEntries(Object.keys(FROZEN_FORMATS.ppr).map(k => [k, Object.hasOwn(settings, k) ? settings[k] : 0]));
  const format = Object.entries(FROZEN_FORMATS).find(([, f]) => Object.keys(f).every(k => f[k] === vector[k]))?.[0] ?? null;
  if (!format) for (const key of Object.keys(vector)) if (!Object.values(FROZEN_FORMATS).some(f => f[key] === vector[key])) reasons.push({ code: "registered_rule_differs", key, value: vector[key] });
  if (!format && !reasons.length) reasons.push({ code: "no_frozen_format_matches", vector });
  const ignored = Object.keys(settings).filter(nonOffensiveKey).sort();
  return { verdict: format && !reasons.length ? "compatible" : "incompatible", format: format && !reasons.length ? format : null, reasons,
    offensive_vector: vector, ignored_non_offensive_keys: ignored, scoring_sha256: digest(settings) };
}

/**
 * Player-level scoring position (Protocol v2 §3.3). The VIP model is the EDGE-01 case position: the nflverse position of the
 * latest VIP game. It must equal production's model position, and under TE premium the fantasy eligibility may not mix TE
 * with another offensive position (the TE bonus would apply ambiguously).
 */
export function scoringPositionCheck({ format, modelPosition, vipPosition, eligibility, productionAmbiguous }) {
  const offensive = [...new Set((eligibility || []).filter(p => ["QB", "RB", "WR", "TE"].includes(p)))];
  if (productionAmbiguous) return { ok: false, code: "ambiguous_scoring_position", detail: "Production marks the reception premium position ambiguous" };
  if (!["QB", "RB", "WR", "TE"].includes(modelPosition)) return { ok: false, code: "unsupported_position", detail: modelPosition ?? null };
  if (format === "te_premium" && (offensive.length !== 1 || offensive[0] !== modelPosition) && (offensive.includes("TE") || modelPosition === "TE"))
    return { ok: false, code: "ambiguous_tep_scoring_position", detail: { eligibility: offensive, model_position: modelPosition } };
  if (vipPosition && vipPosition !== modelPosition) return { ok: false, code: "scoring_position_mismatch", detail: { model_position: modelPosition, vip_position: vipPosition } };
  return { ok: true, code: null, detail: null };
}

// Canonical nflverse weekly player-stat season_type domain (ADR 0011): REG candidate, POST excluded, anything else invalid.
const SEASON_TYPES = new Set(["REG", "POST"]);
const STAT_POSITIONS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FB: "RB" };

/**
 * Validates one player's raw current-season statistical rows before any lossy step, then returns the EDGE-01 VIP rows:
 * REG, position QB/RB/WR/TE/FB (FB scored as RB), week strictly before the target week. Integrity failures are returned
 * as `invalid`, never silently dropped: non-canonical season type, non-positive-integer week, missing game_id, a duplicate
 * player-game, or two games in one week.
 */
export function auditCurrentRows(rawRows, season, targetWeek) {
  const rows = (rawRows || []).filter(r => Number(r?.season) === Number(season));
  const problems = [];
  for (const r of rows) {
    if (!SEASON_TYPES.has(r.season_type)) problems.push({ code: "invalid_season_type", value: r.season_type ?? null });
    const week = Number(r.week);
    if (!/^\d+$/.test(String(r.week ?? "").trim()) || !Number.isInteger(week) || week <= 0) problems.push({ code: "invalid_week", value: r.week ?? null });
    if (typeof r.game_id !== "string" || !r.game_id.trim()) problems.push({ code: "missing_game_id" });
  }
  if (problems.length) return { status: "invalid", problems, rows: [] };
  const regular = rows.filter(r => r.season_type === "REG" && Number(r.week) < targetWeek);
  const games = regular.map(r => r.game_id), weeks = regular.map(r => Number(r.week));
  if (new Set(games).size !== games.length) problems.push({ code: "duplicate_player_game" });
  if (new Set(weeks).size !== weeks.length) problems.push({ code: "multiple_games_in_week" });
  if (problems.length) return { status: "invalid", problems, rows: [] };
  const vipRows = regular.filter(r => Object.hasOwn(STAT_POSITIONS, r.position)).map(r => ({ game_id: r.game_id, week: Number(r.week), team: normalizeTeam(r.team),
    position: STAT_POSITIONS[r.position], raw_position: r.position, ...Object.fromEntries(Object.entries(VIP_RAW_COLUMNS).map(([k, col]) => [k, finiteNumber(r[col])])) }))
    .sort((a, b) => a.week - b.week);
  return { status: "valid", problems: [], rows: vipRows, excluded_non_skill_rows: regular.length - vipRows.length };
}

/** VIP of one game at full precision with the frozen coefficients of `format` for the game's own position (EDGE-01 vipOf). */
export function vipOfGame(game, format) {
  const model = VIP_COEFFICIENTS?.[format]?.[game.position]; if (!model) return null;
  const xs = VIP_INPUTS[game.position].map(k => game[k]);
  if (!xs.every(numeric)) return null;
  return model.coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : xs[i - 1]), 0);
}

/**
 * VIP_last2 exactly as EDGE-01 (opportunityFeatures metrics.vip.last2): the team of the latest VIP row, the two latest rows on
 * that team, both VIPs finite, mean of exactly two. Returns status `computed` or `missing` (ordinary) with the evidence.
 */
export function vipLast2(vipRows, format, { platformTeam = null } = {}) {
  const team = vipRows.at(-1)?.team ?? null, onTeam = team ? vipRows.filter(g => g.team === team) : [];
  const games = onTeam.slice(-2).map(g => ({ ...g, required: Object.fromEntries(VIP_INPUTS[g.position].map(k => [k, g[k]])), vip: vipOfGame(g, format) }));
  const evidence = { historical_team: team, platform_team: platformTeam ? normalizeTeam(platformTeam) : null,
    team_discrepancy: !!team && !!platformTeam && normalizeTeam(platformTeam) !== team, recorded_games_on_team: onTeam.length,
    games: games.map(({ game_id, week, team: t, position, raw_position, required, vip }) => ({ game_id, week, team: t, position, raw_position, required, vip })) };
  if (onTeam.length < 2) return { status: "missing", reason: "fewer_than_two_games_on_historical_team", value: null, position: vipRows.at(-1)?.position ?? null, ...evidence };
  const missing = games.flatMap(g => Object.entries(g.required).filter(([, v]) => !numeric(v)).map(([k]) => `${g.game_id}:${k}`));
  if (missing.length) return { status: "missing", reason: "required_predictor_missing", missing_predictors: missing, value: null, position: games.at(-1).position, ...evidence };
  if (!games.every(g => numeric(g.vip))) return { status: "missing", reason: "no_frozen_coefficients", value: null, position: games.at(-1).position, ...evidence };
  return { status: "computed", reason: null, value: (games[0].vip + games[1].vip) / 2, position: games.at(-1).position, ...evidence };
}
