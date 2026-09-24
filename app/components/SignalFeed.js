"use client";
import { useState } from "react";
const sections = { ALL: "All changes", OPPORTUNITY: "Opportunity risers / fallers", BACKFIELD: "Backfield changes", TARGET: "Target share movers", XFP: "xFP vs results", HIGH_VALUE: "High-value opportunities", SCHEDULE: "Schedule swings", MARKET: "Market / buzz / quiet breakouts" };
const match = (s, group) => group === "ALL" || ({ OPPORTUNITY: /ROLE|SNAP/, BACKFIELD: /CARRY|BACKFIELD/, TARGET: /TARGET/, XFP: /XFP|OPPORTUNITY_OVER|PRODUCTION_OVER/, HIGH_VALUE: /HIGH_VALUE/, SCHEDULE: /SCHEDULE/, MARKET: /MARKET|BUZZ|HYPE|QUIET/ }[group]).test(s.type);
export default function SignalFeed({ data }) {
  const [group, setGroup] = useState("ALL");
  const feed = data.signals, rows = (feed?.records || []).filter(s => match(s, group));
  return <section className="section" aria-label="Signal Feed"><div className="sectionTitle"><div><p className="eyebrow">WHAT CHANGED?</p><h2>Signal Feed</h2></div><label>Signal group <select value={group} onChange={e => setGroup(e.target.value)}>{Object.entries(sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    <p className="muted">Evidence flags, not predictions or score boosts. {feed?.total || 0} signals; {feed?.omitted || 0} omitted. Market changes require archived comparable windows; missing social attention is not zero.</p>
    <div className="signalGrid">{rows.map(s => <article className="card" key={s.signal_id}><strong>{data.player_context[s.player_id]?.player.name || s.player_id} · {s.type.replaceAll("_", " ")}</strong><p>{s.explanation}</p><p className="muted">{s.direction} · {s.confidence} confidence · {s.sample_size} games/observations · through W{s.data_through_week}</p>{s.warnings.map(w => <p className="muted" key={w}>{w}</p>)}<details><summary>Signal evidence</summary><pre className="evidenceJson">{JSON.stringify(s.evidence, null, 2)}</pre></details></article>)}</div>
    {!rows.length ? <p className="card">No qualifying changes in this section. Small movements and missing evidence do not become breakout claims.</p> : null}
  </section>;
}
