export function decisionBasis(snapshot) {
  return JSON.stringify([
    snapshot.league.league_id, snapshot.league.season, snapshot.matchup_week,
    snapshot.identity?.provider_user_id ?? null, snapshot.my_roster?.roster_id ?? null,
    Object.entries(snapshot.league.scoring_settings || {}).sort(([a], [b]) => a.localeCompare(b)),
    [...snapshot.rosters].sort((a, b) => a.roster_id - b.roster_id).map(roster => [roster.roster_id,
      roster.starter_slots, roster.all_players.map(p => [p.player_id, p.reserve, p.taxi, p.injury_status]).sort(([a], [b]) => a.localeCompare(b))]),
  ]);
}
