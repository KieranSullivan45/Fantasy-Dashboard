/**
 * Consistency basis of a snapshot: the inputs a decision/trade result depends on. A committed provider input revision
 * (`coverage.input_revision`, Sleeper since SLEEPER-REFRESH-01) is appended when present, so any refreshed evidence
 * invalidates older results; snapshots without one keep the original basis unchanged.
 */
export function decisionBasis(snapshot) {
  const revision = snapshot.coverage?.input_revision;
  return JSON.stringify([
    snapshot.league.league_id, snapshot.league.season, snapshot.matchup_week,
    snapshot.identity?.provider_user_id ?? null, snapshot.my_roster?.roster_id ?? null,
    Object.entries(snapshot.league.scoring_settings || {}).sort(([a], [b]) => a.localeCompare(b)),
    [...snapshot.rosters].sort((a, b) => a.roster_id - b.roster_id).map(roster => [roster.roster_id,
      roster.starter_slots, roster.all_players.map(p => [p.player_id, p.reserve, p.taxi, p.injury_status]).sort(([a], [b]) => a.localeCompare(b))]),
    ...(typeof revision === "string" && revision ? [["input_revision", revision]] : []),
  ]);
}
/** The input revision carried by a basis string, or null. */
export function basisRevision(basis) {
  try { const last = JSON.parse(basis).at(-1); return Array.isArray(last) && last[0] === "input_revision" && typeof last[1] === "string" ? last[1] : null; } catch { return null; }
}
