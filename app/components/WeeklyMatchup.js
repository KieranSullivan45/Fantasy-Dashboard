import { weeklyMatchup } from "../../lib/decision/weekly-matchup.js";
const points = value => value == null ? "Unavailable" : value.toFixed(1);
export default function WeeklyMatchup({ snapshot, decision }) {
  const matchup = decision?.matchup || weeklyMatchup(snapshot);
  const players = new Map([...snapshot.rosters.flatMap(r => r.all_players), ...snapshot.matchup_players].map(p => [p.player_id, p]));
  return <section className="section weeklyMatchup" aria-label="Weekly matchup">
    <div className="sectionTitle"><div><p className="eyebrow">THIS WEEK</p><h2>Week {matchup.week ?? "—"} matchup</h2></div><span className="muted">Actual points from Sleeper · projections unavailable</span></div>
    {matchup.status !== "available" ? <div className="card">{matchup.reason}</div> : <>
      <div className="twoCol">{matchup.teams.map(team => <article className={`card ${team.is_user ? "mine" : ""}`} key={team.roster_id}>
        <p className="eyebrow">{team.is_user ? "YOUR TEAM" : "CURRENT OPPONENT"}</p><h3>{team.team_name}</h3>
        <p className="matchupTotal">{points(team.actual_points)} <span className="muted">actual points</span></p>
        {team.commissioner_override !== null ? <p className="muted">Commissioner override applied; lineup sums may differ.</p> : null}
        <div className="lineupRow muted"><span>Starting lineup</span><span>Actual</span><span>Projection</span></div>
        {team.starters.map((starter, index) => <div className="lineupRow" key={index}>
          <span><span className="slotLabel">{starter.slot}</span> {starter.player_id ? players.get(starter.player_id)?.name || starter.player_id : "Empty slot"}</span>
          <strong>{starter.actual_points == null ? "—" : points(starter.actual_points)}</strong><span className="muted">—</span>
        </div>)}
        <p className="muted">{team.scheduled_later == null ? "Schedule context loading or unavailable." : `${team.scheduled_later} starters scheduled to play later.`} Live remaining-player counts unavailable.</p>
      </article>)}</div>
      <p className="muted">Current-week totals only. Projection values are not estimated from actual points.</p>
    </>}
  </section>;
}
