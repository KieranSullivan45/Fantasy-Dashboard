"use client";
import Link from "next/link";
import { useDashboard, DataRequired, DecisionPending } from "../DashboardShell.js";
import { weeklyMatchup } from "../../../lib/decision/weekly-matchup.js";
const value = n => n == null ? "Unavailable" : n.toFixed(1);
export default function HomeView() {
  const { data, decision } = useDashboard();
  if (!data) return <><h1>Home</h1><DataRequired /></>;
  const matchup = decision?.matchup || weeklyMatchup(data), top = decision?.waivers.recommendations[0];
  return <><h1>Home</h1><p className="viewIntro">What deserves your attention this week.</p>
    <div className="summaryGrid"><div className="stat"><span>League</span><strong>{data.league.name}</strong></div><div className="stat"><span>Week / teams</span><strong>{data.matchup_week ?? "—"} / {data.league.total_rosters}</strong></div></div>
    <section className="card homeCard" aria-label="Matchup summary"><h2>Current matchup</h2>{matchup.status === "available" ? <div className="homeMatchup">{matchup.teams.map(t => <div key={t.roster_id}><span className="muted">{t.is_user ? "Your team" : "Current opponent"}</span><strong>{t.team_name}</strong><span>{value(t.actual_points)} actual points</span></div>)}</div> : <p>{matchup.reason}</p>}<Link href="/dashboard/lineup">Open lineup and matchup →</Link></section>
    <DecisionPending />
    <section className="card homeCard" aria-label="Top waiver"><h2>First recommended add</h2>{top ? <><p><strong>ADD {decision.player_context[top.player_id]?.player.name || top.player_id}</strong>{top.roster_value.best?.drop_player_id ? ` · DROP ${decision.player_context[top.roster_value.best.drop_player_id]?.player.name || top.roster_value.best.drop_player_id}` : " · use vacant active slot"}</p><p className="muted">Pickup Rating {value(top.pickup_rating)} · net roster heuristic {value(top.roster_value.net_roster_improvement)} · {top.coverage_percent}% evidence. Existing recommendation order; not a projection.</p></> : <p>No supported positive transaction currently returned.</p>}<Link href="/dashboard/waivers">Review waivers →</Link></section>
    <section className="card homeCard"><h2>Lineup check</h2><p>{data.my_roster ? "Review current starters and compare existing StartValue estimates with bench alternatives." : "Spectator mode: choose a roster above to inspect roster-specific decisions."} No separate start/sit recommendation is inferred here.</p><Link href="/dashboard/lineup">Compare roster players →</Link></section>
    <section className="card homeCard" aria-label="Top signals"><h2>Recent signals</h2>{decision?.signals.records.slice(0, 3).map(s => <div className="homeSignal" key={s.signal_id}><Link href={`/dashboard/players?player=${encodeURIComponent(s.player_id)}`}>{decision.player_context[s.player_id]?.player.name || s.player_id}</Link><strong>{s.type.replaceAll("_", " ")}</strong><span className="muted">{s.direction} · {s.confidence} confidence · {s.sample_size} games · through W{s.data_through_week}</span></div>)}{!decision?.signals.records.length ? <p>No qualifying signals currently returned.</p> : null}<Link href="/dashboard/signals">Open all signals →</Link></section>
    {decision?.warnings.length ? <details className="card homeCard"><summary>Decision warnings ({decision.warnings.length})</summary>{decision.warnings.map((w,i) => <p key={i}>{w}</p>)}</details> : null}
    <div className="quickLinks"><Link href="/dashboard/league">League</Link><Link href="/dashboard/players">Find a player</Link><Link href="/dashboard/more">Accounts and data info</Link></div>
  </>;
}
