import { kickoffUtc } from "./schedule.js";

// Week 1 opens 3 days before its first kickoff. Week w is current from ROLLOVER after week w-1's last kickoff until ROLLOVER after week w's last kickoff.
// Near a rollover a provider may still report the previous week; that disagreement fails closed as a mismatch.
export const WEEK_ROLLOVER_MS = 8 * 3600000, WEEK_ONE_LEAD_MS = 3 * 86400000;

/**
 * Derives the current NFL regular-season week from nflverse schedule kickoffs and cross-checks it against the week a
 * fantasy provider reports. Provider-neutral and pure. Only `status: "verified"` may populate `nfl_state`; any other
 * status leaves season type and week unknown. A fantasy league's own season phase is never an input.
 */
export function verifyNflSeasonState(rows, { season, providerWeek, now = Date.now() } = {}) {
  const result = (status, extra = {}) => ({ status, season: Number(season), provider_week: providerWeek ?? null, derived_week: null, season_type: null, week: null,
    basis: "nflverse schedule regular-season kickoffs; week w runs from 8h after week w-1's last kickoff to 8h after week w's last kickoff", ...extra });
  if (!Array.isArray(rows) || !Number.isSafeInteger(Number(season))) return result("unavailable", { reason: "No schedule rows were available." });
  const games = rows.filter(r => Number(r.season) === Number(season) && r.game_type === "REG");
  if (!games.length) return result("unavailable", { reason: `No regular-season schedule rows for ${season}.` });
  const lastKickoff = new Map();
  for (const game of games) {
    const week = Number(game.week), kickoff = Date.parse(kickoffUtc(game.gameday, game.gametime) ?? "");
    if (!Number.isSafeInteger(week) || week < 1 || !Number.isFinite(kickoff)) return result("unavailable", { reason: "A regular-season game has an unknown week or kickoff time." });
    lastKickoff.set(week, Math.max(lastKickoff.get(week) ?? -Infinity, kickoff));
  }
  const weeks = [...lastKickoff.keys()].sort((a, b) => a - b);
  if (weeks.some((week, i) => week !== i + 1)) return result("unavailable", { reason: "Regular-season weeks are not contiguous from week 1." });
  const firstKickoff = Math.min(...games.filter(g => Number(g.week) === 1).map(g => Date.parse(kickoffUtc(g.gameday, g.gametime))));
  if (now < firstKickoff - WEEK_ONE_LEAD_MS) return result("outside_regular_season", { reason: "Before the regular-season week-1 window." });
  const derived = weeks.find(week => now < lastKickoff.get(week) + WEEK_ROLLOVER_MS);
  if (derived == null) return result("outside_regular_season", { reason: "After the final regular-season week." });
  if (!Number.isSafeInteger(providerWeek) || providerWeek !== derived)
    return result("mismatch", { derived_week: derived, reason: `Schedule-derived NFL week ${derived} does not match the provider week ${providerWeek ?? "unknown"}.` });
  return result("verified", { derived_week: derived, season_type: "regular", week: derived });
}

/** Applies a verification result to a snapshot copy: verified state is populated; anything else stays null with a warning. */
export function withNflSeasonState(snapshot, verification) {
  const verified = verification.status === "verified";
  const nfl_state = verified ? { ...snapshot.nfl_state, season_type: "regular", week: verification.week, leg: verification.week } : { ...snapshot.nfl_state, season_type: null };
  const warnings = verified ? snapshot.warnings : [...snapshot.warnings, { code: "UNVERIFIED_SEASON_STATE", resource: "nfl_state",
    message: `NFL season state is not verified (${verification.status}): ${verification.reason} Current-season statistics are not loaded.` }];
  return { ...snapshot, nfl_state, warnings, coverage: { ...snapshot.coverage, nfl_state_verification: verification } };
}
