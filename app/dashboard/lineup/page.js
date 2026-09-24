"use client";
import Link from "next/link";
import { useDashboard, useViewState, DataRequired, DecisionPending } from "../DashboardShell.js";
import { RosterCard } from "../../components/RosterCard.js";
import WeeklyMatchup from "../../components/WeeklyMatchup.js";
const n = v => v == null ? "Unavailable" : v.toFixed(1);
export default function LineupView() {
  const { data, decision } = useDashboard(), [tab, setTab] = useViewState("lineupTab", "roster"), [position, setPosition] = useViewState("lineupPosition", "ALL");
  if (!data) return <><h1>Lineup</h1><DataRequired /></>;
  const mine = data.my_roster, players = mine?.all_players || [], positions = [...new Set(players.flatMap(p => p.fantasy_positions || [p.position]))], active = positions.includes(position) ? position : "ALL";
  const starters = new Set(mine?.starters.map(p => p.player_id));
  const alternatives = players.filter(p => active === "ALL" || (p.fantasy_positions || [p.position]).includes(active)).map(p => ({ p, c: decision?.player_context[p.player_id] })).sort((a,b) => (b.c?.model?.start_value.weekly_start_value ?? -Infinity) - (a.c?.model?.start_value.weekly_start_value ?? -Infinity));
  return <><h1>Lineup</h1><div className="tabs" aria-label="Lineup views">{[["roster","My roster"],["matchup","Matchup"],["alternatives","Compare alternatives"]].map(([id,name]) => <button key={id} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{name}</button>)}</div><DecisionPending />
    {tab === "matchup" ? <WeeklyMatchup snapshot={data} decision={decision} /> : !mine ? <div className="card">Spectator mode: choose “Analyze roster” above to inspect a team. No roster is assumed.</div> : tab === "roster" ? <RosterCard roster={mine} settings={data.league.settings} contexts={decision?.player_context} /> : <section><h2>Compare roster alternatives</h2><p className="muted">Existing StartValue estimates, not actual points or a new lineup recommendation. IR/taxi, injury and slot eligibility still apply; examine evidence before moving a player.</p><label>Compare position <select value={active} onChange={e => setPosition(e.target.value)}>{["ALL", ...positions].map(p => <option key={p}>{p}</option>)}</select></label><div className="comparisonList">{alternatives.map(({p,c}) => <article className="card" key={p.player_id}><Link href={`/dashboard/players?player=${encodeURIComponent(p.player_id)}`}>{p.name}</Link><p>{starters.has(p.player_id) ? "Current starter" : p.reserve ? "IR" : p.taxi ? "Taxi" : "Bench"} · {(p.fantasy_positions || [p.position]).join("/")}</p><strong>Start Value: {n(c?.model?.start_value.weekly_start_value)}</strong><p className="muted">{c?.model?.features.confidence || "Unknown"} confidence · {c?.model?.features.current_games ?? 0} games · {c?.schedule?.opponent || "Opponent unavailable"}{p.injury_status ? ` · ${p.injury_status}` : ""}</p></article>)}</div><details className="card"><summary>Existing legal-lineup and replacement evidence</summary><pre className="evidenceJson">{JSON.stringify(decision?.team_strength_v2.find(t => t.roster_id === mine.roster_id) || { status: "unavailable" }, null, 2)}</pre></details></section>}
  </>;
}
