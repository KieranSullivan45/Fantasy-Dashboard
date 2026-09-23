import { finiteNumber } from "../sources/contracts.js";

export function weeklyMatchup(snapshot) {
  const mine = snapshot.current_matchups.find(m => String(m.roster_id) === String(snapshot.my_roster?.roster_id));
  if (!mine || mine.matchup_id == null) return { status: "unavailable", week: snapshot.matchup_week, reason: "No current head-to-head matchup is available.", teams: [] };
  const pairs = snapshot.current_matchups.filter(m => m.matchup_id === mine.matchup_id);
  if (pairs.length !== 2) return { status: "unavailable", week: snapshot.matchup_week, reason: "The matchup does not have exactly two teams.", teams: [] };
  const slots = snapshot.league.roster_positions.filter(p => !["BN", "IR", "TAXI"].includes(p));
  const teams = [mine, pairs.find(m => m !== mine)].map(matchup => {
    const roster = snapshot.rosters.find(r => String(r.roster_id) === String(matchup.roster_id));
    const override = finiteNumber(matchup.custom_points);
    return { roster_id: matchup.roster_id, team_name: roster?.team_name || `Team ${matchup.roster_id}`,
      is_user: matchup === mine, actual_points: override ?? finiteNumber(matchup.points),
      reported_points: finiteNumber(matchup.points), commissioner_override: override,
      projected_points: null, projection_status: "unavailable", remaining_players: null,
      starters: Array.from({ length: Math.max(slots.length, matchup.starters?.length || 0) }, (_, i) => {
        const raw = matchup.starters?.[i];
        const id = raw == null || String(raw) === "0" ? null : String(raw);
        return { slot: slots[i] || "STARTER", player_id: id,
          actual_points: id ? finiteNumber(matchup.starters_points?.[i]) ?? finiteNumber(matchup.players_points?.[id]) : null,
          projected_points: null };
      }) };
  });
  return { status: "available", week: snapshot.matchup_week, matchup_id: mine.matchup_id, teams,
    scope: "Current week only; multi-week playoff aggregate totals are not calculated." };
}
