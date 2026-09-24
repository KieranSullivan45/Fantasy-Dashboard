import ExpandableDetail from "./ExpandableDetail.js";
import { useViewState } from "../dashboard/DashboardShell.js";
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
  const [limits, setLimits] = useViewState("waiverVisibleLimits", {});
  const limitKey = `${data.league.league_id}:${category}:${position}`, limit = limits[limitKey] || 5;
  const categories = data.waivers.categories;
  const selected = categories?.[category];
  const items = selected ? selected.players.map(p => data.waivers.candidate_details?.[p.player_id] || p) : data.waivers.recommendations;
  const recommendations = items.filter(r => position === "ALL" || (r.fantasy_positions || [r.position]).includes(position));
  return <section className="section waiverRecommendations" aria-label="Waiver recommendations">
    <p className="compactNote">Pickup Rating · acquisition heuristic, not a projection.</p>
    <div className="recommendationFilters">
      {categories ? <label>Category <select aria-label="Recommendation type" value={category} onChange={event => setCategory(event.target.value)}>{Object.entries(categories).map(([key, c]) => <option key={key} value={key}>{c.label} ({c.total})</option>)}</select></label> : null}
      <label>Position <select aria-label="Recommendation position" value={position} onChange={event => setPosition(event.target.value)}>{["ALL", ...leaguePositions(data.league.roster_positions)].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    </div>
    <div className="rosterGrid">{recommendations.slice(0, limit).map((item, index) => <article className="card compactCard recommendationCard" key={item.player_id}>
      <div className="cardHeader"><h3>{index + 1}. {data.player_context[item.player_id]?.player.name || item.player_id} <span className="muted">{(item.fantasy_positions || [item.position]).join("/")} · {data.player_context[item.player_id]?.player.team || "No team"}</span></h3><span className="pill">Pickup Rating {item.pickup_rating == null ? "Unavailable" : item.pickup_rating.toFixed(1)}</span></div>
      <p className="compactMetrics">Net roster gain {item.roster_value.net_roster_improvement?.toFixed(1) ?? "—"} · {item.coverage_percent}% evidence{item.small_sample ? " · small sample" : ""}{item.scoring_status === "partial" ? " · partial scoring" : ""}</p>
      {data.player_context[item.player_id]?.player.injury_status ? <span className="badge warn">{data.player_context[item.player_id].player.injury_status}</span> : null}
      <p className="transactionHeadline">{item.explanations?.find(text => text.startsWith("ADD ")) || "Review legal transaction evidence"}</p>
      <p className="compactNote">Next: {data.player_context[item.player_id]?.schedule?.opponent || "Unavailable"}</p>
      {data.signals?.records.find(s => s.player_id === item.player_id) ? <p className="compactNote">{data.signals.records.find(s => s.player_id === item.player_id).type.replaceAll("_", " ")} · {data.signals.records.find(s => s.player_id === item.player_id).confidence} confidence</p> : null}
      <ExpandableDetail id={`waiver:${item.player_id}`} label="Recommendation details">
      <p>{(item.recommendation_types || []).map(type => categories?.[type]?.label || type).join(" · ")}</p>
      <p className="muted">Starter gain {item.roster_value.starter_gain?.toFixed(1) ?? "—"} · Depth change {item.roster_value.depth_gain?.toFixed(1) ?? "—"} · Net roster heuristic {item.roster_value.net_roster_improvement?.toFixed(1) ?? "—"}</p>
      <details><summary>Recommendation notes</summary>{(item.explanations || []).map(text => <p className="muted" key={text}>{text}</p>)}</details>
      <PlayerQuickContext context={data.player_context[item.player_id]} />
      <details><summary>Score components</summary><div className="scoreComponents">{Object.entries(item.components).map(([key, component]) => <div key={key}>
        <strong>{key.replaceAll("_", " ")}: {component.score == null ? "Unavailable" : `${component.score.toFixed(1)} × ${component.weight}% = ${component.contribution.toFixed(1)}`}</strong>
        <p className="muted">{component.explanation}</p><pre className="evidenceJson">Raw inputs: {JSON.stringify(component.raw_value, null, 2)}</pre>
      </div>)}</div><p className="muted">Comparison group: {item.comparable_group.replaceAll("+", ", ")}</p></details>
      <details><summary>Lineup replacement evidence</summary><pre className="evidenceJson">{JSON.stringify(item.roster_value, null, 2)}</pre><p className="muted">Legal add/drop estimates include the lost asset. Platform locks and reserve moves require verification; unknown compatible players prevent an assumed upgrade.</p></details>
      <details><summary>Player context</summary><PlayerContextCard context={data.player_context[item.player_id]} /></details>
      </ExpandableDetail>
    </article>)}</div>
    {limit < recommendations.length ? <button onClick={() => setLimits({...limits,[limitKey]:limit + 5})}>Show more recommendations ({recommendations.length - limit} remaining)</button> : null}
    <p className="compactNote">Showing {Math.min(limit,recommendations.length)} of {recommendations.length} returned candidates.</p>
    {!recommendations.length ? <div className="card">No {position} candidates with qualifying evidence in the returned category. The available-player pool below remains accessible.</div> : null}
    <details><summary>Coverage, warnings and model notes</summary><p>{data.waivers.evaluated_count} eligible players evaluated before truncation. {selected?.total ?? data.waivers.scored_count} candidates; {selected?.omitted ?? data.waivers.truncation.ranked_omitted} omitted. Filters apply to returned candidates. Compare only within the same evidence group; missing weights are not redistributed.</p>
    <p className="muted">{data.waivers.scored_count} currently available candidates scored; {data.waivers.limited_count} have insufficient data or injury/bye/kickoff limitations. Stashes can retain an acquisition rating.</p>
    <details><summary>Limited-data / stash examples</summary><ul>{data.waivers.limited_candidates.map(p => <li key={p.player_id}>{data.player_context[p.player_id]?.player.name || p.player_id} · {p.status.replaceAll("_", " ")}</li>)}</ul></details>
    </details>
  </section>;
}
