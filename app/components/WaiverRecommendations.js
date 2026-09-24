import PlayerContextCard from "./PlayerContextCard.js";
import PlayerQuickContext from "./PlayerQuickContext.js";
import { useState } from "react";
import { leaguePositions } from "../../lib/normalize/positions.js";
export default function WaiverRecommendations({ data, filters, onFilters }) {
  const [local, setLocal] = useState({ position: "ALL", category: "immediate_upgrades" });
  const state = filters || local, update = onFilters || setLocal;
  const position = state.position === "ALL" || leaguePositions(data.league.roster_positions).includes(state.position) ? state.position : "ALL";
  const category = data.waivers.categories?.[state.category] ? state.category : "best_overall";
  const setPosition = value => update({ ...state, position: value }), setCategory = value => update({ ...state, category: value });
  const categories = data.waivers.categories;
  const selected = categories?.[category];
  const items = selected ? selected.players.map(p => data.waivers.candidate_details?.[p.player_id] || p) : data.waivers.recommendations;
  const recommendations = items.filter(r => position === "ALL" || (r.fantasy_positions || [r.position]).includes(position));
  return <section className="section waiverRecommendations" aria-label="Waiver recommendations">
    <div className="sectionTitle"><div><p className="eyebrow">WEEKLY DECISIONS</p><h2>Waiver recommendations</h2></div><span className="muted">{data.waivers.evaluated_count} eligible players evaluated before truncation</span></div>
    <p className="muted">Pickup Rating is an acquisition heuristic, not projected points or a probability. Compare only within the same evidence group; missing weights are not redistributed. Groups with more evidence appear first, then rating within each group.</p>
    <div className="recommendationFilters">
      {categories ? <label>Recommendation type <select aria-label="Recommendation type" value={category} onChange={event => setCategory(event.target.value)}>{Object.entries(categories).map(([key, c]) => <option key={key} value={key}>{c.label} ({c.total})</option>)}</select></label> : null}
      <label>Recommendation position <select aria-label="Recommendation position" value={position} onChange={event => setPosition(event.target.value)}>{["ALL", ...leaguePositions(data.league.roster_positions)].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    </div>
    <p className="muted">{selected?.label || "Overall candidates"} · {selected?.total ?? data.waivers.scored_count} candidates; {selected?.omitted ?? data.waivers.truncation.ranked_omitted} omitted. Position filters apply to returned candidates in this category.</p>
    <div className="rosterGrid">{recommendations.map(item => <article className="card" key={item.player_id}>
      <div className="cardHeader"><h3>{data.player_context[item.player_id]?.player.name || item.player_id} <span className="muted">{(item.fantasy_positions || [item.position]).join("/")}</span></h3><span className="pill">Pickup Rating {item.pickup_rating == null ? "Unavailable" : item.pickup_rating.toFixed(1)}</span></div>
      <p>{(item.recommendation_types || []).map(type => categories?.[type]?.label || type).join(" · ")}</p>
      <p className="muted">Evidence coverage {item.coverage_percent}%{item.small_sample ? " · small sample" : ""}{item.scoring_status === "partial" ? " · partial historical scoring" : ""}</p>
      <p className="transactionHeadline">{item.explanations?.find(text => text.startsWith("ADD ")) || "Review legal transaction evidence"}</p>
      <p className="muted">Starter gain {item.roster_value.starter_gain?.toFixed(1) ?? "—"} · Depth change {item.roster_value.depth_gain?.toFixed(1) ?? "—"} · Net roster heuristic {item.roster_value.net_roster_improvement?.toFixed(1) ?? "—"}</p>
      <details><summary>Recommendation notes</summary>{(item.explanations || []).map(text => <p className="muted" key={text}>{text}</p>)}</details>
      <PlayerQuickContext context={data.player_context[item.player_id]} />
      <details><summary>Score components</summary><div className="scoreComponents">{Object.entries(item.components).map(([key, component]) => <div key={key}>
        <strong>{key.replaceAll("_", " ")}: {component.score == null ? "Unavailable" : `${component.score.toFixed(1)} × ${component.weight}% = ${component.contribution.toFixed(1)}`}</strong>
        <p className="muted">{component.explanation}</p><pre className="evidenceJson">Raw inputs: {JSON.stringify(component.raw_value, null, 2)}</pre>
      </div>)}</div><p className="muted">Comparison group: {item.comparable_group.replaceAll("+", ", ")}</p></details>
      <details><summary>Lineup replacement evidence</summary><pre className="evidenceJson">{JSON.stringify(item.roster_value, null, 2)}</pre><p className="muted">Legal add/drop estimates include the lost asset. Platform locks and reserve moves require verification; unknown compatible players prevent an assumed upgrade.</p></details>
      <details><summary>Player context</summary><PlayerContextCard context={data.player_context[item.player_id]} /></details>
    </article>)}</div>
    {!recommendations.length ? <div className="card">No {position} candidates with qualifying evidence in the returned category. The available-player pool below remains accessible.</div> : null}
    <p className="muted">{data.waivers.scored_count} currently available candidates scored; {data.waivers.limited_count} have insufficient data or injury/bye/kickoff limitations. Stashes can retain an acquisition rating.</p>
    <details><summary>Limited-data / stash examples</summary><ul>{data.waivers.limited_candidates.map(p => <li key={p.player_id}>{data.player_context[p.player_id]?.player.name || p.player_id} · {p.status.replaceAll("_", " ")}</li>)}</ul></details>
  </section>;
}
