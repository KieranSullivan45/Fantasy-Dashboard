"use client";
import { useState } from "react";
const sections = { ALL: "All changes", RISERS: "Risers", FALLERS: "Fallers", BREAKOUTS: "Breakout evidence", OPPORTUNITY: "Opportunity risers / fallers", BACKFIELD: "Backfield changes", TARGET: "Target share movers", XFP: "xFP vs results", HIGH_VALUE: "High-value opportunities", SCHEDULE: "Schedule swings", MARKET: "Market / buzz / quiet breakouts" };
const match = (s, group) => group === "ALL" || (group === "RISERS" ? s.direction === "up" : group === "FALLERS" ? s.direction === "down" : ({ BREAKOUTS: /BREAKOUT|ROLE_EXPANSION|BUZZ_AND/, OPPORTUNITY: /ROLE|SNAP/, BACKFIELD: /CARRY|BACKFIELD/, TARGET: /TARGET/, XFP: /XFP|OPPORTUNITY_OVER|PRODUCTION_OVER/, HIGH_VALUE: /HIGH_VALUE/, SCHEDULE: /SCHEDULE/, MARKET: /MARKET|BUZZ|HYPE|QUIET/ }[group]).test(s.type));
export default function SignalFeed({ data, filters, onFilters }) {
  const [local, setLocal] = useState({ group: "ALL", page: 0 });
  const { group, page: requestedPage } = filters || local, update = onFilters || setLocal;
  const setGroup = group => update({ group, page: 0 });
  const feed = data.signals, all = (feed?.records || []).filter(s => match(s, group)), page = requestedPage * 20 < all.length ? requestedPage : 0, rows = all.slice(page * 20, (page + 1) * 20);
  return <section className="section" aria-label="Signal Feed"><div className="sectionTitle"><div><p className="eyebrow">WHAT CHANGED?</p><h2>Signal Feed</h2></div><label>Signal group <select value={group} onChange={e => setGroup(e.target.value)}>{Object.entries(sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    <p className="muted">Evidence flags, not predictions or score boosts. {feed?.total || 0} signals; {feed?.omitted || 0} omitted. Market changes require archived comparable windows; missing social attention is not zero.</p>
    <div className="signalGrid">{rows.map(s => <article className="card" key={s.signal_id}><strong>{data.player_context[s.player_id]?.player.name || s.player_id} · {s.type.replaceAll("_", " ")}</strong><p>{s.explanation}</p><p className="muted">{s.direction} · {s.confidence} confidence · {s.sample_size} games/observations · through W{s.data_through_week}</p>{s.warnings.map(w => <p className="muted" key={w}>{w}</p>)}<details><summary>Signal evidence</summary><pre className="evidenceJson">{JSON.stringify(s.evidence, null, 2)}</pre></details></article>)}</div>
    {!rows.length ? <p className="card">No qualifying changes in this section. Small movements and missing evidence do not become breakout claims.</p> : null}
    <p className="muted">Showing {Math.min(page * 20 + 1, all.length)}–{Math.min((page + 1) * 20, all.length)} of {all.length} returned matching signals.</p><div className="pager"><button disabled={!page} onClick={() => update({ group, page: page - 1 })}>Previous signals</button><button disabled={(page + 1) * 20 >= all.length} onClick={() => update({ group, page: page + 1 })}>Next signals</button></div>
  </section>;
}
