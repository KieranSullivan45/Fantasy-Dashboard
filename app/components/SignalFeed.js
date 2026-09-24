"use client";
import { useState } from "react";
import ExpandableDetail from "./ExpandableDetail.js";
import { groupSignals, signalMetrics } from "./signal-presentation.js";
import { useViewState } from "../dashboard/DashboardShell.js";
const sections={ALL:"Top / all returned",RISERS:"Risers",FALLERS:"Fallers",BREAKOUTS:"Breakouts",OPPORTUNITY:"Role changes",BACKFIELD:"Backfield",TARGET:"Target share",XFP:"Opportunity vs results",HIGH_VALUE:"High-value opportunities",SCHEDULE:"Schedule",MARKET:"Market / buzz"};
const match=(s,g)=>g==="ALL"||(g==="RISERS"?s.direction==="up":g==="FALLERS"?s.direction==="down":({BREAKOUTS:/BREAKOUT|ROLE_EXPANSION|BUZZ_AND/,OPPORTUNITY:/ROLE|SNAP/,BACKFIELD:/CARRY|BACKFIELD/,TARGET:/TARGET/,XFP:/XFP|OPPORTUNITY_OVER|PRODUCTION_OVER/,HIGH_VALUE:/HIGH_VALUE/,SCHEDULE:/SCHEDULE/,MARKET:/MARKET|BUZZ|HYPE|QUIET/}[g]||/$^/).test(s.type));
export default function SignalFeed({data,filters,onFilters}) {
 const [local,setLocal]=useState({group:"ALL",page:0}),state=filters||local,update=onFilters||setLocal;
 const [limits,setLimits]=useViewState("signalVisibleLimits",{}),key=`${data.league.league_id}:${state.group}`,limit=limits[key]||5;
 const feed=data.signals,matching=(feed?.records||[]).filter(s=>match(s,state.group));
 const own=data.team_strength_v2?.find(t=>t.roster_id===data.my_roster_id)?.best_legal_lineup.map(p=>p.player_id)||[];
 const groups=groupSignals(matching,data.player_context,own);
 return <section className="section" aria-label="Signal Feed"><label>Signal group <select value={state.group} onChange={e=>update({group:e.target.value,page:0})}>{Object.entries(sections).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <p className="compactNote">Top evidence flags · not predictions or score boosts.</p>
 <div className="signalGrid">{groups.slice(0,limit).map(records=>{const s=records[0];return <article className="card compactCard signalCard" key={s.player_id}><strong>{data.player_context[s.player_id]?.player.name||s.player_id}</strong><p className="signalType">{s.type.replaceAll("_"," ")}{records.length>1?` · ${records.length} signals`:""}</p><p className="compactNote">{s.severity} impact · {s.direction} · {s.confidence} confidence</p>{signalMetrics(s).map(m=><p className="compactMetrics" key={m}>{m}</p>)}<p className="compactNote">{s.sample_size} games/observations · through W{s.data_through_week}{s.sample_size<4?" · Small sample":""}</p>
 {s.warnings.filter(w=>/injury|unavailable|invalid/i.test(w)).map(w=><p className="warn" key={w}>{w}</p>)}
 <ExpandableDetail id={`signals:${state.group}:${s.player_id}`} label={`View ${records.length} signal${records.length===1?"":"s"}`}>
 {records.map(record=><section className="signalRecord" key={record.signal_id}><strong>{record.type.replaceAll("_"," ")}</strong><p>{record.explanation}</p><p>{record.direction} · {record.severity} · {record.confidence} confidence · {record.sample_size} observations · through W{record.data_through_week}</p>{record.warnings.map(w=><p key={w}>{w}</p>)}<details><summary>Signal evidence</summary><pre className="evidenceJson">{JSON.stringify(record,null,2)}</pre></details></section>)}
 </ExpandableDetail></article>})}</div>
 {!groups.length?<p className="card">No qualifying changes in this section.</p>:null}
 {limit<groups.length?<button onClick={()=>setLimits({...limits,[key]:limit+5})}>Show more signals ({groups.length-limit} players remaining)</button>:null}
 <details><summary>Feed coverage and ordering</summary><p>{matching.length} returned matching signals grouped into {groups.length} players. Showing {Math.min(limit,groups.length)} players. {feed?.total||0} total signals; {feed?.omitted||0} omitted by the API. All returned signals remain available in their player group.</p><p>Presentation order: severity, confidence, own starting-roster relevance, known fantasy eligibility, through-week, then absolute change within the same signal type. No score changes. Market changes require comparable archived windows; missing social attention is not zero.</p></details>
 </section>;
}
