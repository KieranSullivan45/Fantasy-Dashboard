import PlayerContextCard from "./PlayerContextCard.js";
import { useState } from "react";
export default function WaiverRecommendations({ data }) {
  const [position, setPosition] = useState("ALL");
  const recommendations = data.waivers.recommendations.filter(r => position === "ALL" || r.position === position);
  return <section className="section waiverRecommendations" aria-label="Waiver recommendations">
    <div className="sectionTitle"><div><p className="eyebrow">WEEKLY DECISIONS</p><h2>Waiver recommendations</h2></div><span className="muted">{data.waivers.evaluated_count} eligible players evaluated before truncation</span></div>
    <p className="muted">Historical heuristic, not projected points. Scores compare within the same component group; missing weights are not redistributed. Showing the top {data.waivers.truncation.limit} overall candidates.</p>
    <label className="muted">Recommendation position <select aria-label="Recommendation position" value={position} onChange={event => setPosition(event.target.value)}>{["ALL", "QB", "RB", "WR", "TE", "K", "DEF"].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    <div className="rosterGrid">{recommendations.map(item => <article className="card" key={item.player_id}>
      <div className="cardHeader"><h3>{data.player_context[item.player_id]?.player.name || item.player_id} <span className="muted">{item.position}</span></h3><span className="pill">{item.score.toFixed(1)} / 100</span></div>
      <p className="muted">Evidence coverage {item.coverage_percent}%{item.small_sample ? " · small sample" : ""}{item.scoring_status === "partial" ? " · partial historical scoring" : ""}</p>
      <details><summary>Score components</summary><div className="scoreComponents">{Object.entries(item.components).map(([key, component]) => <div key={key}>
        <strong>{key.replaceAll("_", " ")}: {component.score == null ? "Unavailable" : `${component.score.toFixed(1)} × ${component.weight}% = ${component.contribution.toFixed(1)}`}</strong>
        <p className="muted">{component.explanation}</p>
      </div>)}</div><p className="muted">Comparison group: {item.comparable_group.replaceAll("+", ", ")}</p></details>
      <details><summary>Player context</summary><PlayerContextCard context={data.player_context[item.player_id]} /></details>
    </article>)}</div>
    {!recommendations.length ? <div className="card">No {position} recommendation in the returned top candidates with sufficient evidence. The available-player pool below remains accessible.</div> : null}
    <p className="muted">{data.waivers.scored_count} candidates scored; {data.waivers.limited_count} have insufficient data or injury/bye limitations.</p>
    <details><summary>Limited-data / stash examples</summary><ul>{data.waivers.limited_candidates.map(p => <li key={p.player_id}>{data.player_context[p.player_id]?.player.name || p.player_id} · {p.status.replaceAll("_", " ")}</li>)}</ul></details>
  </section>;
}
