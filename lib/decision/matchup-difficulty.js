const POSITIONS = ["QB", "RB", "WR", "TE"];
export function ordinal(number) {
  const mod = number % 100;
  return `${number}${mod >= 11 && mod <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[number % 10] || "th"}`;
}

export function buildMatchupDifficulty(playerGames, schedule, week) {
  const statsGames = new Set(playerGames.map(g => g.game_id));
  const historical = schedule.filter(g => g.week < week && g.home_score !== null && g.away_score !== null);
  const teams = [...new Set(schedule.flatMap(g => [g.home_team, g.away_team]))];
  const result = {};
  for (const pos of POSITIONS) {
    const rows = teams.map(team => {
      const expected = historical.filter(g => [g.home_team, g.away_team].includes(team));
      const entries = expected.filter(g => statsGames.has(g.game_id)).flatMap(game => {
        const opposing = playerGames.filter(p => p.game_id === game.game_id && p.opponent === team && p.position === pos);
        if (opposing.some(p => p.points === null)) return [];
        const raw_totals = {};
        for (const player of opposing) for (const [key, value] of Object.entries(player.raw_stats)) {
          if (["season", "week", "player_id"].includes(key) || value === "" || value == null || !Number.isFinite(Number(value))) continue;
          raw_totals[key] = (raw_totals[key] || 0) + Number(value);
        }
        return [{ game_id: game.game_id, week: game.week, points: opposing.reduce((sum, p) => sum + p.points, 0),
          raw_totals, scoring_status: opposing.some(p => p.scoring.status !== "complete") ? "partial" : "complete" }];
      }).sort((a, b) => b.week - a.week);
      const total = entries.reduce((sum, g) => sum + g.points, 0);
      const recent = entries.slice(0, 4);
      return { team, position: pos, games: entries.length, expected_games: expected.length, total_points: entries.length ? total : null,
        points_per_game: entries.length ? total / entries.length : null,
        recent_points_per_game: recent.length ? recent.reduce((sum, g) => sum + g.points, 0) / recent.length : null,
        recent_games: recent.length, through_week: week - 1, scoring_status: entries.some(g => g.scoring_status !== "complete") ? "partial" : "complete",
        small_sample: entries.length < 4, game_values: entries };
    });
    const measured = rows.filter(r => r.points_per_game !== null);
    for (const row of rows) {
      const rank = row.points_per_game === null ? null : 1 + measured.filter(r => r.points_per_game > row.points_per_game).length;
      row.rank_most = rank; row.defenses_measured = measured.length;
      row.label = rank === null ? "Matchup data unavailable" : `${ordinal(rank)}-most ${pos} points allowed per game`;
    }
    result[pos] = Object.fromEntries(rows.map(r => [r.team, r]));
  }
  return result;
}
