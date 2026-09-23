import { loadCsvSource } from "../http.js";
export const loadSchedules = options => loadCsvSource("nflverse_schedule", "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv", {
  ttl: 300000, ...options, required: ["game_id", "season", "week", "game_type", "gameday", "gametime", "home_team", "away_team", "home_score", "away_score"],
});
