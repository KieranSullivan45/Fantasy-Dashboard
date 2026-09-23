import MatchupDifficulty from "./MatchupDifficulty.js";
import UsageTrend from "./UsageTrend.js";
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
    {context.adjusted_matchup ? <p className="muted">{context.adjusted_matchup.label} · {context.adjusted_matchup.games} games with opponent baselines · through W{context.adjusted_matchup.through_week ?? "?"}{context.adjusted_matchup.small_sample ? " · small sample, shrunk toward neutral" : ""}</p> : null}
    {context.model ? <details><summary>Decision model · {context.model.model_version}</summary>
      <p>Start Value: {number(context.model.start_value.weekly_start_value)} · Football acquisition estimate: {number(context.model.pickup_value.central)}. These are separate model estimates, not provider projections or market value.</p>
      <p className="muted">Player quality: {number(context.model.player_value)} · Replacement: {number(context.model.replacement?.replacement_value)} · VOR: {number(context.model.replacement?.value_over_replacement)}. Evidence: {context.model.features.confidence}; {context.model.features.current_games} current games; prior contribution {(context.model.features.prior.contribution * 100).toFixed(0)}%.</p>
      <p>Covered xFP/game: {number(context.model.features.xfp_per_game)} · matching actual/game: {number(context.model.features.actual_matching_rules_per_game)} · FPOE/game: {number(context.model.features.fpoe_per_game)} · cumulative xFP: {number(context.model.features.xfp_cumulative)}.</p>
      {context.model.features.provisional_role_expansion ? <p>Provisional role expansion: only two or three games; not an established trend.</p> : null}
      <pre className="evidenceJson">{JSON.stringify({ opportunity: context.model.features.opportunity, prior: context.model.features.prior, uncertainty: context.model.features.uncertainty, denominators: context.model.features.denominators }, null, 2)}</pre>
    </details> : null}
    <p className="muted">Status: {context.player.injury_status || context.player.status || "Unavailable"}</p>
    <p className="muted">Weekly expert rank: unavailable · Consensus: unavailable · Projection: unavailable · Rostered: unavailable · Ownership change: unavailable</p>
    <p className="muted">Sleeper 24h add interest: {context.interest.sleeper_adds_24h?.toLocaleString() ?? "Not observed"}. Available-player percentile: {number(context.interest.available_percentile)}; rank: {context.interest.available_rank ?? "Unavailable"}. {context.interest.meaning}</p>
    <p className="muted">Platform eligibility: {context.player.fantasy_positions?.join("/") || context.player.position}. Statistical provider positions: {context.player.provider_positions?.join("/") || "Unavailable"}.</p>
    {context.analytics ? <details className="advancedAnalytics"><summary>Usage history and advanced analytics</summary>
      <p className="muted">{context.analytics.recorded_games} recorded games · through week {context.analytics.through_week}. Season means use recorded games; trends compare latest two with previous two. Role flags require four current games on the same team.</p>
      {context.analytics.role_warning ? <p className="muted">{context.analytics.role_warning}</p> : null}
      <UsageTrend analytics={context.analytics} /><UsageTrend analytics={context.analytics} metric="target_share" label="Target %" /><UsageTrend analytics={context.analytics} metric="carry_share" label="Carry %" />
      <p>Covered-rule xFP/game: {number(context.analytics.xfp?.average)} · Points over expected/game: {number(context.analytics.fantasy_points_over_expected?.average)} · {context.analytics.xfp?.games ?? 0} modeled games, through W{context.analytics.xfp?.through_week ?? "?"}. Partial models use matching supported rules, not full fantasy totals or projections.</p>
      <div className="analyticsTable"><table><caption>Weekly role and opportunity (raw values)</caption><thead><tr>{["Week", "Snaps", "Snap %", "Targets", "Target %", "Carries", "Carry %", "Air yards", "Air share", "WOPR", "RACR", "xFP"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{context.analytics.history.map(h => <tr key={h.game_id}><td>{h.week}</td>{[h.snap_count, h.snap_share == null ? null : h.snap_share * 100, h.targets, h.target_share == null ? null : h.target_share * 100, h.carries, h.carry_share == null ? null : h.carry_share * 100, h.air_yards, h.air_yard_share, h.wopr, h.racr, h.opportunity_model?.expected_points].map((v, i) => <td key={i}>{number(v)}</td>)}</tr>)}</tbody></table></div>
      <p className="muted">WOPR weights target and air-yard share; RACR is receiving yards per air yard. Usage has more weight than efficiency. Carry share includes all team carries, including QB runs.</p>
      {context.player.fantasy_positions?.includes("QB") ? <p>Latest passing EPA per attempt or sack: {number(context.analytics.latest?.passing_epa_per_attempt_or_sack)}. Scrambles excluded from this denominator; this is not full EPA/dropback.</p> : null}
      {context.analytics.signals.length ? context.analytics.signals.map(signal => <details key={signal.label}><summary>{signal.label}</summary><p className="muted">Evidence only, not a prediction · {signal.sample_games} games</p><pre className="evidenceJson">{JSON.stringify(signal.evidence, null, 2)}</pre></details>) : <p className="muted">No qualifying role signals. A small sample does not establish a trend.</p>}
      <details><summary>Expected-opportunity model evidence</summary><p className="muted">{context.analytics.opportunity_contract?.basis} Component arrays: actual points, expected points, raw actual count, raw expected count, league coefficient.</p><pre className="evidenceJson">{JSON.stringify(context.analytics.history.filter(h => h.opportunity_model).map(h => ({ week: h.week, ...h.opportunity_model })), null, 2)}</pre></details>
      <p className="muted">Red-zone opportunities and full play-by-play success rate unavailable.</p>
    </details> : null}
  </div>;
}
