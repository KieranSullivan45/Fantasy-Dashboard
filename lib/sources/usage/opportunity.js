import { loadCsvSource } from "../http.js";
export function loadOpportunity(season, options) {
  if (!/^20\d{2}$/.test(String(season))) throw new Error("Invalid opportunity season");
  return loadCsvSource("ffopportunity", `https://github.com/ffverse/ffopportunity/releases/download/latest-data/ep_weekly_${season}.csv`, {
    ...options, required: ["player_id", "season", "week", "game_id", "receptions_exp", "rec_yards_gained_exp", "rush_yards_gained_exp"],
  });
}
