"use client";
import Link from "next/link";
import { useDashboard, useViewState, DataRequired } from "../DashboardShell.js";
import { RosterCard, Transaction } from "../../components/RosterCard.js";
export default function LeagueView() {
  const { data, decision } = useDashboard(), [tab,setTab] = useViewState("leagueTab","standings"), [team,setTeam] = useViewState("leagueTeam",null);
  if (!data) return <><h1>League</h1><DataRequired /></>;
  const selected = data.rosters.find(r => String(r.roster_id) === team) || data.rosters[0];
  return <><h1>League</h1><p className="viewIntro">{data.league.name} · {data.league.total_rosters} teams</p><div className="tabs" aria-label="League views">{["standings","activity","teams","format"].map(id => <button key={id} aria-pressed={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{id[0].toUpperCase()+id.slice(1)}</button>)}</div>
    {tab === "standings" ? <><h2>League table</h2><div className="card standings">{data.standings.map(t => <div className={t.is_user ? "standing mineLine" : "standing"} key={t.roster_id}><span>{t.rank}. {t.team_name}</span><strong>{t.wins}-{t.losses} · {t.points_for.toFixed(1)}</strong></div>)}</div><Link className="quickLink" href="/dashboard/lineup">Current matchup →</Link></> : null}
    {tab === "activity" ? <><h2>Recent moves</h2><div className="card activity">{data.recent_transactions.slice(0,24).map(tx => <Transaction key={tx.transaction_id} tx={tx} rosters={data.rosters} />)}{!data.recent_transactions.length ? <p>No recent transactions returned.</p> : null}</div></> : null}
    {tab === "teams" ? <><label>Team <select aria-label="League team" value={selected?.roster_id || ""} onChange={e => setTeam(e.target.value)}>{data.rosters.map(r => <option key={r.roster_id} value={r.roster_id}>{r.team_name}</option>)}</select></label>{selected ? <><p className="muted">Waiver priority: {selected.waiver_position ?? "Unavailable"} · FAAB used: {selected.waiver_budget_used ?? "Unavailable"} / {data.league.settings.waiver_budget ?? "Unavailable"}</p><RosterCard roster={selected} contexts={decision?.player_context} settings={data.league.settings} /><details className="card"><summary>Team strength and depth evidence</summary><pre className="evidenceJson">{JSON.stringify(decision?.team_strength_v2.find(t => t.roster_id === selected.roster_id) || { status:"unavailable" },null,2)}</pre></details></> : null}</> : null}
    {tab === "format" ? <><h2>League format and scoring</h2><p>{data.league.roster_positions.join(" · ")}</p><details className="card"><summary>Scoring rules</summary><pre className="evidenceJson">{JSON.stringify(data.league.scoring_settings,null,2)}</pre></details><details className="card"><summary>Roster, reserve and league settings</summary><pre className="evidenceJson">{JSON.stringify(data.league.settings,null,2)}</pre></details></> : null}
  </>;
}
