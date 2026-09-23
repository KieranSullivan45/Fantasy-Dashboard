import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { fixtureFetch } from "./fixtures.js";
export const source = (source_id, data) => ({ source_id, data, status: "available", warnings: [], fetched_at: "2026-09-23T00:00:00Z", published_at: null, url: "https://example.com/fixture" });
export function decisionFixtureOptions() {
  const rows = Array.from({ length: 65 }, (_, i) => [1, 2].map(week => ({ player_id: `g${i + 1}`, position: "RB", season: "2026", season_type: "REG", week: String(week), game_id: `game${week}`, team: "BUF", opponent_team: "NE", receptions: String(i), passing_tds: "0", targets: String(i), carries: "0" }))).flat();
  return {
    now: Date.parse("2026-09-23"),
    snapSource: async () => source("nflverse_snaps", []),
    opportunitySource: async () => source("ffopportunity", []),
    loadLeague: id => buildLeagueSnapshot(id, { fetchData: fixtureFetch(), freeAgentLimit: Number.MAX_SAFE_INTEGER }),
    statsSource: async () => source("nflverse_stats", rows),
    idsSource: async () => source("ffverse_ids", Array.from({ length: 65 }, (_, i) => ({ gsis_id: `g${i + 1}`, sleeper_id: String(i + 1) }))),
    scheduleSource: async () => source("nflverse_schedule", [1, 2, 3].map(week => ({ game_id: `game${week}`, game_type: "REG", season: "2026", week: String(week), home_team: "BUF", away_team: "NE", gameday: week === 3 ? "2026-09-27" : "2026-09-13", gametime: "13:00", home_score: week === 3 ? "" : "10", away_score: week === 3 ? "" : "20" }))),
  };
}
