import { finiteNumber, normalizeTeam } from "../sources/contracts.js";

// nflverse gametime is America/New_York local time. Do not use the server timezone.
export function kickoffUtc(day, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !/^\d{2}:\d{2}/.test(time || "")) return null;
  const local = new Date(`${day}T${time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(local.getTime())) return null;
  const zone = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", timeZoneName: "shortOffset" }).formatToParts(local).find(p => p.type === "timeZoneName")?.value;
  const offset = Number(zone?.match(/GMT([+-]\d+)/)?.[1]);
  return Number.isFinite(offset) ? new Date(local.getTime() - offset * 3600000).toISOString() : null;
}

export function normalizeSchedule(rows, season) {
  return rows.filter(r => Number(r.season) === Number(season) && r.game_type === "REG").map(r => ({
    game_id: r.game_id, season: Number(r.season), week: Number(r.week),
    home_team: normalizeTeam(r.home_team), away_team: normalizeTeam(r.away_team),
    kickoff: kickoffUtc(r.gameday, r.gametime),
    home_score: finiteNumber(r.home_score), away_score: finiteNumber(r.away_score),
  }));
}

export function upcomingGame(team, schedule, week, now = Date.now()) {
  team = normalizeTeam(team);
  if (!team || !schedule.length) return { status: "unavailable", opponent: null, kickoff: null, game_id: null };
  const game = schedule.find(g => g.week === week && [g.home_team, g.away_team].includes(team));
  if (!game) return { status: "no_scheduled_game", opponent: null, kickoff: null, game_id: null };
  return { status: !game.kickoff ? "time_unknown" : Date.parse(game.kickoff) > now ? "scheduled" : "kickoff_passed",
    opponent: game.home_team === team ? game.away_team : game.home_team,
    home: game.home_team === team, kickoff: game.kickoff, game_id: game.game_id,
    live_status: null };
}
