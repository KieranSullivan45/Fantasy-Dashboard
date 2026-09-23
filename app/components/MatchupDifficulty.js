export default function MatchupDifficulty({ matchup }) {
  if (!matchup || matchup.points_per_game === null) return <span className="muted">Positional matchup: unavailable</span>;
  return <div><strong>{matchup.label}</strong><div className="muted">{matchup.points_per_game.toFixed(1)} points/game · {matchup.games} games · {matchup.defenses_measured} defenses measured{matchup.small_sample ? " · small sample" : ""}{matchup.scoring_status === "partial" ? " · supported scoring rules only" : ""}</div></div>;
}
