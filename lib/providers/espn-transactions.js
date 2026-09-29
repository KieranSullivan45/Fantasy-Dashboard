// Reconcile ESPN pending transactions against later records (ESPN-PENDING-01, ADR 0006).
//
// ESPN keeps the original claim or proposal row as `pending` and records the outcome as a separate row with its own
// id. Nothing in the provider payload updates the original row, so a resolved item can stay `pending` forever.
// A pending item is therefore shown only when no later record can be its outcome. Evidence comes from structured
// fields only (provider id, timestamps, team ids, ESPN player ids); names never link records. Whatever cannot be
// proven fails closed: the item is hidden, never shown as pending.

const FAMILY=Object.freeze({
 waiver:new Set(["waiver","free_agent"]),
 trade_proposal:new Set(["trade","trade_decline","trade_veto","trade_uphold"]),
});
const ids=list=>new Set((list||[]).map(p=>p?.espn_id).filter(id=>id!=null).map(String));
const teams=t=>new Set((t.team_ids||[]).map(String));
const overlap=(a,b)=>[...a].some(x=>b.has(x));
const sameSet=(a,b)=>a.size===b.size&&[...a].every(x=>b.has(x));
const subset=(a,b)=>[...a].every(x=>b.has(x));
const finite=v=>typeof v==="number"&&Number.isFinite(v);

/**
 * How a later record R bears on a pending item P.
 * "resolved": R is a completed/failed outcome that provably belongs to P. "ambiguous": R may belong to P but the
 * structured fields cannot prove it (missing detail, another team, unknown status, unordered timestamps). null: unrelated.
 */
function relation(p,r){
 if(r===p||r.status==="pending")return null;
 const terminal=r.status==="complete"||r.status==="failed";
 if(r.id===p.id)return terminal?"resolved":"ambiguous";
 if(!FAMILY[p.type]?.has(r.type))return null;
 let ordered=true;
 if(finite(p.timestamp)&&finite(r.timestamp)){if(r.timestamp<p.timestamp)return null;ordered=r.timestamp>p.timestamp;}else ordered=false;
 let verdict;
 if(p.type==="waiver"){
  const pa=ids(p.adds),ra=ids(r.adds),pt=teams(p),rt=teams(r);
  if(pa.size&&ra.size){if(!overlap(pa,ra))return null;verdict=pt.size===1&&sameSet(pt,rt)?"resolved":"ambiguous";}
  else if(pt.size===1&&sameSet(pt,rt))verdict="ambiguous";
  else return null;
 }else{
  const pt=teams(p),rt=teams(r);
  if(!pt.size||!rt.size||!overlap(pt,rt)||!(subset(pt,rt)||subset(rt,pt)))return null;
  const pp=ids([...(p.adds||[]),...(p.drops||[])]),rp=ids([...(r.adds||[]),...(r.drops||[])]);
  if(pp.size&&rp.size){if(!overlap(pp,rp))return null;verdict=sameSet(pp,rp)?"resolved":"ambiguous";}
  else verdict="ambiguous";
 }
 return terminal&&ordered?verdict:"ambiguous";
}

/**
 * Returns a Map of the pending items that must not be surfaced as pending, each with why:
 * "resolved" (a deterministic later outcome exists) or "ambiguous" (possible outcome that cannot be proven).
 * Items without any possibly related later record are kept: the provider's pending status stands.
 * Pure: it never mutates the items.
 */
export function reconcilePendingTransactions(items){
 const list=Array.isArray(items)?items:[],stale=new Map();
 for(const p of list){
  if(p?.status!=="pending")continue;
  let verdict=null;
  for(const r of list){const v=relation(p,r);if(v==="resolved"){verdict="resolved";break;}if(v)verdict="ambiguous";}
  if(verdict)stale.set(p,verdict);
 }
 return stale;
}
