import MatchupDifficulty from "./MatchupDifficulty.js";
const number = value => value == null ? "Unavailable" : value.toFixed(1);
export default function PlayerContextCard({ context }) {
  if (!context) return <p className="muted">Weekly context unavailable for this player.</p>;
  const production = context.production, schedule = context.schedule;
  return <div className="contextContent">
    <div className="contextMetrics">
      <div><span className="muted">{production?.scoring_status === "partial" ? "Supported-rule PPG" : "Season PPG"}</span><strong>{number(production?.ppg)}</strong></div>
      <div><span className="muted">Recent average</span><strong>{number(production?.recent_average)}</strong></div>
      <div><span className="muted">Recorded games</span><strong>{production?.recorded_games ?? "Unavailable"}</strong></div>
    </div>
    {production ? <>
      <p className="muted">PPG uses recorded statistical appearances. Missing zero-action games and DNPs are not assumed.</p>
      {production.unsupported_rules.length ? <p className="muted">Scoring excludes: {production.unsupported_rules.join(", ")}. These are partial historical totals.</p> : null}
      {production.missing_stats.length ? <p className="muted">Missing statistics: {production.missing_stats.join(", ")}</p> : null}
      <div className="recentGames">{production.recent_games.map(game => <span className="badge" key={game.game_id}>W{game.week} vs {game.opponent}: {number(game.points)} pts</span>)}</div>
      <p className="muted">Usage change: {number(production.usage_trend)} · {production.usage_basis}</p>
    </> : null}
    <p>Upcoming: {schedule.opponent ? `${schedule.home ? "vs" : "@"} ${schedule.opponent}` : schedule.status === "no_scheduled_game" ? "No game scheduled this week" : "Unavailable"}
      {schedule.kickoff ? <span className="muted"> · {new Date(schedule.kickoff).toLocaleString()}</span> : null}
      {schedule.status === "kickoff_passed" ? <span className="muted"> · kickoff passed; live status unavailable</span> : null}</p>
    <MatchupDifficulty matchup={context.matchup} />
    <p className="muted">Status: {context.player.injury_status || context.player.status || "Unavailable"}</p>
    <p className="muted">Weekly expert rank: unavailable · Consensus: unavailable · Projection: unavailable · Rostered: unavailable · Ownership change: unavailable</p>
    <p className="muted">Sleeper 24h adds: {context.interest.sleeper_adds_24h}. Interest only; not rostered percentage or usage growth.</p>
  </div>;
}
