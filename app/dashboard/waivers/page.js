"use client";
import { useDashboard, useViewState, DataRequired, DecisionPending } from "../DashboardShell.js";
import WaiverRecommendations from "../../components/WaiverRecommendations.js";
import { PlayerRow } from "../../components/RosterCard.js";
import { leaguePositions } from "../../../lib/normalize/positions.js";
export default function WaiversView() {
  const { data, decision } = useDashboard(), [tab, setTab] = useViewState("waiverTab", "recommendations"), [filters, setFilters] = useViewState("waiverFilters", { position: "ALL", category: "best_overall" });
  const [position, setPosition] = useViewState("availablePosition", "RB"), [offset, setOffset] = useViewState("availableOffset", 0);
  if (!data) return <><h1>Waivers</h1><DataRequired /></>;
  const positions = leaguePositions(data.league.roster_positions), active = positions.includes(position) ? position : positions[0], pool = data.free_agents[active] || [];
  const start = offset < pool.length ? offset : 0;
  return <><h1>Waivers</h1><div className="tabs" aria-label="Waiver views"><button aria-pressed={tab === "recommendations"} className={tab === "recommendations" ? "active" : ""} onClick={() => setTab("recommendations")}>Recommendations</button><button aria-pressed={tab === "available"} className={tab === "available" ? "active" : ""} onClick={() => setTab("available")}>All Available</button></div><DecisionPending />
    {tab === "recommendations" ? decision ? <WaiverRecommendations data={decision} filters={filters} onFilters={setFilters} /> : null : <section className="section"><h2>Available players</h2><div className="tabs" aria-label="Available positions">{positions.map(p => <button key={p} aria-pressed={p === active} className={p === active ? "active" : ""} onClick={() => { setPosition(p); setOffset(0); }}>{p}</button>)}</div><p className="muted">Showing {Math.min(start + 1, pool.length)}–{Math.min(start + 15, pool.length)} of {pool.length} returned {active} players. The snapshot pool may be truncated; recommendations evaluate the full eligible pool.</p><div className="card">{pool.slice(start, start + 15).map(p => <PlayerRow key={p.player_id} player={p} context={decision?.player_context[p.player_id]} />)}{!pool.length ? <p>No eligible available players at this position.</p> : null}</div><div className="pager"><button disabled={start === 0} onClick={() => setOffset(Math.max(0, start - 15))}>Previous players</button><button disabled={start + 15 >= pool.length} onClick={() => setOffset(start + 15)}>Next players</button></div></section>}
  </>;
}
