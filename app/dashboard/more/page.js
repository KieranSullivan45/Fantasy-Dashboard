"use client";
import Link from "next/link";
import { useDashboard } from "../DashboardShell.js";
import SourceStatus from "../../components/SourceStatus.js";
export default function MoreView() {
  const { data, decision, query } = useDashboard();
  return <><h1>More</h1><div className="moreLinks"><Link className="card" href="/dashboard/league"><strong>League</strong><span>Standings, transactions, teams and settings</span></Link><Link className="card" href="/dashboard/players"><strong>Players</strong><span>Search, player details and evidence</span></Link></div><p>Use the account controls above to add a Sleeper account or league, choose a roster, or discover another season. These are public read-only connections.</p>
    {data ? <section className="card endpoint"><h2>History and assistant access</h2><div className="moreLinks"><a href={`/api/chat/history?${query}`}>Recorded recommendation history</a><a href={`/api/chat/league-summary?${query}`}>Open decision summary</a><a href={`/api/snapshot?${query}&compact=1`}>Open ChatGPT snapshot</a></div><p className="muted">JSON opens directly. History capture covers installation-configured leagues only.</p></section> : null}
    <section className="card homeCard"><h2>Model and data info</h2><a href="/api/chat/model-meta">Read model metadata</a>{decision ? <><p className="muted">{decision.model_version} · {decision.feature_version} · data through week {decision.data_through_week}</p><SourceStatus data={decision} /></> : <p className="muted">Select a league to inspect source diagnostics.</p>}</section><p className="muted">Trade tools and notifications are not implemented.</p>
  </>;
}
