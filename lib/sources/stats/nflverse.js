import { loadCsvSource } from "../http.js";
export function loadStats(season, options) {
  if (!/^20\d{2}$/.test(String(season))) throw new Error("Invalid statistics season");
  return loadCsvSource("nflverse_stats", `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`, {
    ...options, required: ["player_id", "season", "week", "season_type", "game_id", "position", "team", "opponent_team", "passing_yards", "receptions", "fumbles_lost_total"],
  });
}
