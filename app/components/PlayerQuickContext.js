import UsageTrend from "./UsageTrend.js";
const num = v => v == null ? "—" : v.toFixed(1);
export default function PlayerQuickContext({ context }) {
  if (!context) return null;
  const p = context.production, a = context.analytics;
  return <div className="playerQuickContext" aria-label="Player quick context">
    <div>{context.schedule?.opponent ? `Next: ${context.schedule.home ? "vs" : "@"} ${context.schedule.opponent}` : "Opponent unavailable"} · {p?.scoring_status === "partial" ? "Supported-rule PPG" : "Season PPG"} {num(p?.ppg)} · Recent {num(p?.recent_average)} <span className="muted">({p?.recorded_games ?? 0} season / {p?.recent_games?.length ?? 0} recent games)</span></div>
    {context.matchup ? <div className="muted">{context.matchup.label} · {context.matchup.games} games{context.matchup.small_sample ? " · small sample" : ""}</div> : null}
    {a && context.player.fantasy_positions?.some(p => ["RB", "WR", "TE", "QB"].includes(p)) ? <><UsageTrend analytics={a} /><UsageTrend analytics={a} metric={context.player.fantasy_positions.includes("QB") ? "carries" : context.player.fantasy_positions.includes("RB") ? "carry_share" : "target_share"} label={context.player.fantasy_positions.includes("QB") ? "Carries" : context.player.fantasy_positions.includes("RB") ? "Carry %" : "Target %"} /></> : null}
    {context.pickup?.rating != null ? <span>Pickup Rating {num(context.pickup.rating)} · {context.pickup.coverage_percent}% evidence · heuristic</span> : null}
    {a?.signals?.length ? <div>{a.signals.slice(0, 2).map(s => <span className="badge" key={s.label}>{s.label} · {s.sample_games} games</span>)}</div> : null}
  </div>;
}
