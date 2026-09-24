"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDashboard, useViewState, DataRequired, DecisionPending } from "../DashboardShell.js";
import PlayerContextCard from "../../components/PlayerContextCard.js";
import PlayerQuickContext from "../../components/PlayerQuickContext.js";
export default function PlayersView() {
  const { data, decision } = useDashboard(), params = useSearchParams(), playerId = params.get("player");
  const [filters, setFilters] = useViewState("playerFilters", { query:"", position:"ALL", availability:"ALL", page:0 });
  const pool = useMemo(() => {
    if (!data) return [];
    const players = new Map([...data.rosters.flatMap(r => r.all_players), ...Object.values(data.free_agents).flat(), ...Object.values(decision?.player_context || {}).map(c => c.player)].map(p => [p.player_id,p]));
    return [...players.values()].sort((a,b) => a.name.localeCompare(b.name));
  },[data,decision]);
  if (!data) return <><h1>Players</h1><DataRequired /></>;
  const owners = new Map(data.rosters.flatMap(r => r.all_players.map(p => [p.player_id,r.team_name]))), positions = [...new Set(pool.flatMap(p => p.fantasy_positions || [p.position]))].filter(Boolean).sort();
  const position = positions.includes(filters.position) ? filters.position : "ALL";
  const results = pool.filter(p => p.name.toLowerCase().includes(filters.query.toLowerCase().trim()) && (position === "ALL" || (p.fantasy_positions || [p.position]).includes(position)) && (filters.availability === "ALL" || owners.has(p.player_id) === (filters.availability === "ROSTERED")));
  const selected = pool.find(p => p.player_id === playerId), context = decision?.player_context[playerId], page = filters.page * 15 < results.length ? filters.page : 0;
  const change = values => setFilters({ ...filters,...values,page:0 });
  return <><h1>Players</h1><DecisionPending />{playerId ? <><Link href="/dashboard/players">← Back to player results</Link>{selected ? <article className="card playerDetail"><h2>{selected.name}</h2><p>{(selected.fantasy_positions || [selected.position]).join("/")} · {owners.get(playerId) || "Available in this league"}</p><PlayerQuickContext context={context} /><details open><summary>Player analytics and evidence</summary>{context ? <PlayerContextCard context={context} /> : <p>Decision context unavailable for this returned player.</p>}</details><details><summary>Active signals</summary>{decision?.signals.records.filter(s => s.player_id === playerId).map(s => <div key={s.signal_id}><strong>{s.type.replaceAll("_"," ")}</strong><p>{s.explanation} · {s.confidence} · {s.sample_size} games · through W{s.data_through_week}</p><pre className="evidenceJson">{JSON.stringify(s.evidence,null,2)}</pre>{s.warnings.map(w => <p key={w}>{w}</p>)}</div>)}</details></article> : <p className="card">Player not found in this league's returned data. The link is preserved; choose another league or return to search.</p>}</> : <>
    <div className="playerFilters"><label>Search players <input type="search" value={filters.query} onChange={e => change({query:e.target.value})} /></label><label>Player position <select value={position} onChange={e => change({position:e.target.value})}>{["ALL",...positions].map(p => <option key={p}>{p}</option>)}</select></label><label>Availability <select value={filters.availability} onChange={e => change({availability:e.target.value})}><option value="ALL">All returned players</option><option value="AVAILABLE">Available</option><option value="ROSTERED">Rostered</option></select></label></div>
    <p className="muted">{results.length} matches in {pool.length} returned players; this is not the complete NFL catalog. Showing {Math.min(page*15+1,results.length)}–{Math.min((page+1)*15,results.length)}.</p><div className="playerResults">{results.slice(page*15,(page+1)*15).map(p => <article className="card" key={p.player_id}><Link href={`/dashboard/players?player=${encodeURIComponent(p.player_id)}`}>{p.name}</Link><p className="muted">{(p.fantasy_positions || [p.position]).join("/")} · {p.team || "No NFL team"} · {owners.get(p.player_id) || "Available"}{p.injury_status ? ` · ${p.injury_status}` : ""}</p><PlayerQuickContext context={decision?.player_context[p.player_id]} /></article>)}</div><div className="pager"><button disabled={!page} onClick={() => setFilters({...filters,page:page-1})}>Previous players</button><button disabled={(page+1)*15>=results.length} onClick={() => setFilters({...filters,page:page+1})}>Next players</button></div>
  </>}</>;
}
