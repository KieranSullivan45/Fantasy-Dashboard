// Presentation only: never mutate source records or model scores.
const severity = { critical:4, high:3, notable:2, context:1 }, confidence = { high:3, moderate:2, low:1 };
export function groupSignals(records, contexts = {}, ownIds = []) {
  const mine=new Set(ownIds), relevance=s=>mine.has(s.player_id)?2:contexts[s.player_id]?.player.fantasy_positions?.length?1:0;
  const compare=(a,b)=>(severity[b.severity]||0)-(severity[a.severity]||0)||(confidence[b.confidence]||0)-(confidence[a.confidence]||0)||relevance(b)-relevance(a)||(b.data_through_week||0)-(a.data_through_week||0)||a.type.localeCompare(b.type)||Math.abs(b.evidence?.delta||0)-Math.abs(a.evidence?.delta||0)||a.signal_id.localeCompare(b.signal_id);
  const groups=new Map();
  for(const s of [...records].sort(compare)){if(!groups.has(s.player_id))groups.set(s.player_id,[]);groups.get(s.player_id).push(s);}
  return [...groups.values()].sort((a,b)=>compare(a[0],b[0]));
}
export function signalMetrics(s) {
 const e=s.evidence||{},rows=[];
 const add=(label,xs,share=false)=>{if(Array.isArray(xs)&&xs.length&&xs.every(Number.isFinite))rows.push(`${label}: ${xs.map(v=>share?`${Math.round(v*100)}%`:v.toFixed(1)).join(" → ")}`)};
 add("Snap",e.snap_share,true);add("Target share",e.target_share,true);add("Carry share",e.carry_share,true);add("xFP",e.xfp);
 if(e.weekly?.every(Number.isFinite))add(/TARGET/.test(s.type)?"Target share":/CARRY|BACKFIELD/.test(s.type)?"Carry share":/SNAP|STABILITY/.test(s.type)?"Snap":"xFP",e.weekly,!/XFP/.test(s.type));
 if(e.weekly?.[0]?.opportunities!=null)add("High-value opportunities",e.weekly.map(x=>x.opportunities));
 if(Number.isFinite(e.recent_xfp))rows.push(`Recent xFP ${e.recent_xfp.toFixed(1)} · FPOE ${e.recent_fpoe?.toFixed(1)??"Unavailable"}`);
 return rows.slice(0,2);
}
