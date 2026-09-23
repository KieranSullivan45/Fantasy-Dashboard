export function fixtureFetch({ fail = [], season = "2026" } = {}) {
  const players = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i + 1), {
    full_name: `Player ${i + 1}`, position: "RB", fantasy_positions: ["RB"], team: "BUF", active: true, search_rank: i,
  }]));
  const transaction = { transaction_id: "tx1", type: "trade", status: "complete", created: 1, status_updated: 2,
    roster_ids: [1, 2], adds: { "6": 2 }, drops: { "6": 1 }, settings: { waiver_bid: 0 },
    draft_picks: [{ season: "2027", round: 1, roster_id: 3, previous_owner_id: 1, owner_id: 2 }],
    waiver_budget: [{ sender: 2, receiver: 1, amount: 15 }],
  };
  return async path => {
    if (fail.some(part => path.includes(part))) throw new Error("fixture outage");
    if (path.startsWith("/user/")) return { user_id: "me" };
    if (path === "/state/nfl") return { season: "2026", week: 3, leg: 3, season_type: "regular" };
    if (path.includes("/trending/")) return [{ player_id: "5", count: 12 }, { player_id: "1", count: 100 }];
    if (path === "/players/nfl") return players;
    if (path.endsWith("/rosters")) return [
      { roster_id: 1, owner_id: "me", players: ["1", "2", "3", "4"], starters: ["2", "0"], reserve: ["3"], taxi: ["4"], settings: { wins: 2, waiver_position: 0, waiver_budget_used: 0, fpts: 100, fpts_decimal: 25 } },
      { roster_id: 2, owner_id: "other", players: ["6"], starters: ["6"], settings: { wins: 1 } },
    ];
    if (path.endsWith("/users")) return [{ user_id: "me", display_name: "My team" }];
    if (path.includes("/transactions/")) return [transaction];
    if (path.includes("/matchups/")) return [{ roster_id: 1, matchup_id: 1, starters: ["2", "0"], players: ["1", "2", "3", "4", "7"], players_points: { "7": 2 }, starters_points: [10, 0], points: 10, custom_points: 0 }];
    return { league_id: path.split("/").at(-1), name: "Fixture League", season, sport: "nfl", season_type: "regular", total_rosters: 2,
      roster_positions: ["RB", "FLEX", "BN"], scoring_settings: { rec: 1, pass_td: 4 }, settings: { type: 2, reserve_slots: 2, taxi_slots: 3, waiver_budget: 100 } };
  };
}
