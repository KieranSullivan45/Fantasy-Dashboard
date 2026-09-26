// SYNTHETIC trade-endpoint league (V04-04). Built through the real Sleeper snapshot builder and decision pipeline from
// fixture transport only: no network, no private league data. RB/RB/FLEX/K starters with two bench slots (active
// capacity 6); roster 2 is at capacity and holds a kicker, so uneven packages can require forced drops.
import { buildLeagueSnapshot } from "../lib/sleeper.js";
import { buildDecisionState } from "../lib/decision/build-context.js";
import { fixtureFetch } from "./fixtures.js";
import { decisionFixtureOptions, source } from "./decision-fixtures.js";

export const TRADE_LEAGUE = "1401373864818192384";
export const ME = "1395496956687581184", RIVAL = "1395496956687581185";
export const TRADE_ROSTERS = [
  { roster_id: 1, owner_id: ME, players: ["1", "2", "10", "11", "12", "3", "4"], starters: ["12", "11", "10", "0"], reserve: ["3"], taxi: ["4"],
    settings: { wins: 2, waiver_position: 1, waiver_budget_used: 0, fpts: 100, fpts_decimal: 25 } },
  { roster_id: 2, owner_id: RIVAL, players: ["6", "20", "21", "22", "23", "66"], starters: ["23", "22", "21", "66"], settings: { wins: 1 } },
];

export function tradeFixtureFetch({ rosters = TRADE_ROSTERS } = {}) {
  const base = fixtureFetch();
  return async path => {
    if (path.endsWith("/rosters")) return structuredClone(rosters);
    if (path.startsWith("/user/")) return { user_id: ME };
    if (path.endsWith("/users")) return [{ user_id: ME, display_name: "My team" }, { user_id: RIVAL, display_name: "Rival team" }];
    const data = await base(path);
    if (path === "/players/nfl") return { ...data, "66": { full_name: "Kicker 66", position: "K", fantasy_positions: ["K"], team: "BUF", active: true, search_rank: 66 } };
    if (path.includes("/matchups/")) return [];
    if (path.startsWith("/league/") && !path.includes("/", "/league/".length)) return { ...data, roster_positions: ["RB", "RB", "FLEX", "K", "BN", "BN"] };
    return data;
  };
}

/** Decision options for the synthetic league; prior-season rows establish players so ordinary ones are droppable. */
export function tradeFixtureOptions({ rosters } = {}) {
  const options = decisionFixtureOptions();
  const rows = season => Array.from({ length: 65 }, (_, i) => [1, 2].map(week => ({ player_id: `g${i + 1}`, position: "RB", season: String(season), season_type: "REG",
    week: String(week), game_id: `game${season}${week}`, team: "BUF", opponent_team: "NE", receptions: String(i), passing_tds: "0", targets: String(i), carries: "0" }))).flat();
  return { ...options, statsSource: async season => source("nflverse_stats", rows(season)),
    loadLeague: (id, identity = {}) => buildLeagueSnapshot(id, { fetchData: tradeFixtureFetch({ rosters }), freeAgentLimit: Number.MAX_SAFE_INTEGER, ...identity }) };
}

/** `build` for handleTradeRequest: the real decision state pipeline over the synthetic league. */
export const tradeFixtureBuild = (fixture = {}) => (league, options) => buildDecisionState(league, { ...tradeFixtureOptions(fixture), ...options });

export const proposal = (a, b, extra = {}) => ({ horizon: "next_game", sides: [
  { roster_id: 1, sends: a.map(id => ({ type: "player", id })) }, { roster_id: 2, sends: b.map(id => ({ type: "player", id })) }], ...extra });
export const tradeRequest = (body, headers = { "content-type": "application/json" }) =>
  new Request("http://localhost/api/trade", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
