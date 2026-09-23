import { mean, numeric } from "./features.js";
import { ordinal } from "./matchup-difficulty.js";
import { POLICY } from "./model-config.js";
/** Independent residual model, not an implementation of any provider's proprietary aFPA. */
export function adjustedMatchups(games, raw, week, scoringProfile) {
  const past = games.filter(g => g.week < week && numeric(g.points));
  return Object.fromEntries(Object.entries(raw).map(([position, defenses]) => {
    const leagueMean = mean(Object.values(defenses).map(d => d.points_per_game));
    const rows = Object.values(defenses).map(d => {
      const meetings = (d.game_values || []).map(game => {
        const players = past.filter(p => p.game_id === game.game_id && p.opponent === d.team && p.position === position);
        const baselines = players.map(p => ({ player_id: p.source_player_id || p.player_id, actual: p.points,
          baseline: mean(past.filter(h => (h.source_player_id || h.player_id) === (p.source_player_id || p.player_id) && h.game_id !== p.game_id && h.opponent !== d.team).map(h => h.points)) }));
        // Incomplete opposing lineups cannot be treated as zero-strength opponents.
        const complete = baselines.length > 0 && baselines.every(p => p.player_id && p.baseline != null);
        return { game_id: game.game_id, week: game.week, raw_points: game.points,
          opponent_baseline: complete ? baselines.reduce((s, p) => s + p.baseline, 0) : null,
          residual: complete ? baselines.reduce((s, p) => s + p.actual - p.baseline, 0) : null,
          measured_players: baselines.filter(p => p.baseline != null).length, opposing_players: baselines.length };
      });
      const observed = meetings.filter(g => g.residual != null), residual = mean(observed.map(g => g.residual));
      const factor = observed.length / (observed.length + POLICY.matchupPriorGames);
      return { team: d.team, position, raw_points_per_game: d.points_per_game, raw_total_points: d.total_points,
        adjusted_points_per_game: residual == null || leagueMean == null ? null : leagueMean + factor * residual,
        residual_per_game: residual, shrunk_residual: residual == null ? null : residual * factor, shrinkage_weight: factor,
        games: observed.length, raw_games: d.games, through_week: d.through_week, scoring_profile: scoringProfile,
        recent_window: { games: Math.min(4, observed.length), residual_per_game: mean(observed.slice(0, 4).map(g => g.residual)) },
        small_sample: observed.length < 6, game_evidence: meetings,
        basis: "Leave-defense-out opposing-player mean using only weeks before decision cutoff; residual shrunk by n/(n+6). Incomplete baselines omitted." };
    });
    const measured = rows.filter(r => r.adjusted_points_per_game != null);
    for (const r of rows) { r.rank_most_favorable = r.adjusted_points_per_game == null ? null : 1 + measured.filter(x => x.adjusted_points_per_game > r.adjusted_points_per_game).length;
      r.label = r.rank_most_favorable == null ? "Schedule-adjusted matchup unavailable" : `${ordinal(r.rank_most_favorable)}-most favorable ${position} matchup (schedule-adjusted)`;
      r.defenses_measured = measured.length;
    }
    return [position, Object.fromEntries(rows.map(r => [r.team, r]))];
  }));
}
