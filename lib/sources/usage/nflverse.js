import { loadCsvSource } from "../http.js";
// Published nflverse CSV, originally supplied by PFR. No HTML scraping in this application.
export function loadSnaps(season, options) {
  if (!/^20\d{2}$/.test(String(season))) throw new Error("Invalid snap season");
  return loadCsvSource("nflverse_snaps", `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`, {
    ...options, required: ["pfr_player_id", "game_id", "season", "game_type", "week", "team", "offense_snaps", "offense_pct"],
  });
}
