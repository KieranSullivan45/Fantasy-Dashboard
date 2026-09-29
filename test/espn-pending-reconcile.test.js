// ESPN-PENDING-01: stale pending ESPN transactions are reconciled against later records. SYNTHETIC rows only.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {espnFactsFromFlaim} from "../lib/providers/flaim/espn-map.js";
import {unwrapFlaimResult} from "../lib/providers/flaim/schema.js";
import {snapshotFromEspnFacts} from "../lib/providers/espn-normalize.js";
import {reconcilePendingTransactions} from "../lib/providers/espn-transactions.js";
import {summarizeTransactions} from "../lib/derive.js";

const RAW=JSON.parse(readFileSync(new URL("./fixtures/flaim-espn/synthetic-league.json",import.meta.url),"utf8"));
const NOW="2030-09-26T12:00:00.000Z",OWNER="1",OTHER="2";
const player=id=>({id,name:`Synthetic Player ${id}`,position:"WR",team:"ATL"});
const row=(id,type,status,timestamp,teams,{add=[],drop=[],sides}={})=>({transaction_id:id,type,status,timestamp,week:3,team_ids:teams,players_added:add.map(player),players_dropped:drop.map(player),...(sides?{trade_sides:sides}:{}),faab_bid:0});
const side=(team,acquired,gave)=>({team_id:team,acquired:acquired.map(player),gave_up:gave.map(player)});
const swap=(a,b,x,y)=>[side(a,[x],[y]),side(b,[y],[x])];
// Trade sides are read only from completed trades; proposals and decline/veto/uphold rows carry flat player lists.
const trade=(id,type,status,ts,x,y,teams=[OWNER,OTHER])=>type==="trade"?row(id,type,status,ts,teams,{sides:swap(OWNER,OTHER,x,y)}):row(id,type,status,ts,teams,{add:[x],drop:[y]});

/** Unwrapped synthetic Flaim bundle whose transaction window is replaced by `rows`. */
function bundle(rows){
 const r=structuredClone(RAW),u=unwrapFlaimResult;
 const b={session:u(r.session),leagueInfo:u(r.leagueInfo),rosters:r.rosters.map(u),historicalRosters:r.historicalRosters.map(u),standings:u(r.standings),matchups:u(r.matchups),freeAgents:u(r.freeAgents),transactions:u(r.transactions),draft:u(r.draft)};
 b.transactions.transactions=rows;
 return b;
}
const factsItems=rows=>espnFactsFromFlaim(bundle(rows)).transactions.items;
const verdicts=rows=>[...reconcilePendingTransactions(factsItems(rows)).values()];
function view(rows,{includeOwnPending=true,rosterId=null}={}){
 const s=snapshotFromEspnFacts(espnFactsFromFlaim(bundle(rows)),{now:NOW,includeOwnPending,rosterId});
 return {s,ids:s.recent_transactions.map(t=>t.transaction_id),pending:s.recent_transactions.filter(t=>t.status==="pending").map(t=>t.transaction_id)};
}
const CLAIM=row("p-claim","waiver","pending",1000,[OWNER],{add:["930002"],drop:["910007"]});
// A proposal names exactly its owner's team (as the synthetic fixture does); multi-team items are never surfaced (ADR 0005).
const PROPOSAL=trade("p-prop","trade_proposal","pending",1000,"930009","910005",[OWNER]);

test("a genuinely pending waiver claim stays visible to its owner",()=>{
 const {s,pending}=view([CLAIM,row("t-other","waiver","complete",2000,[OTHER],{add:["920002"]})]);
 assert.deepEqual(pending,["p-claim"]);
 assert.equal(s.recent_transactions.find(t=>t.transaction_id==="p-claim").visibility,"owner_private");
 assert.equal(s.coverage.transactions.owner_pending_reconciled_out,undefined);
});

test("a waiver claim still marked pending but later completed is hidden",()=>{
 for(const [type,status] of [["waiver","complete"],["add","complete"],["waiver","failed"]]){
  const {s,ids}=view([CLAIM,row("p-done",type,status,2000,[OWNER],{add:["930002"],drop:["910007"]})]);
  assert.ok(!ids.includes("p-claim"),`${type}/${status} resolves the claim`);
  assert.ok(ids.includes("p-done"),"the terminal record itself stays visible");
  assert.equal(s.coverage.transactions.owner_pending_reconciled_out,1);
  assert.ok(s.warnings.some(w=>/hidden: a later record/.test(w.message)));
  assert.ok(!s.warnings.some(w=>/private pending transaction item\(s\) withheld/.test(w.message)),"own stale items are not reported as withheld");
  assert.deepEqual(verdicts([CLAIM,row("p-done",type,status,2000,[OWNER],{add:["930002"]})]),["resolved"]);
 }
 // The provider id arriving again as a terminal row is deterministic too.
 assert.deepEqual(view([CLAIM,row("p-claim","waiver","complete",2000,[OWNER],{add:["930002"]})]).pending,[]);
});

test("a genuinely pending trade proposal stays visible to its owner",()=>{
 const {pending}=view([PROPOSAL,
  row("t-other","waiver","complete",2000,[OTHER],{add:["920002"]}),
  trade("t-trade","trade","complete",2000,"910001","910002")]);
 assert.deepEqual(pending,["p-prop"],"a different trade between the same teams in other players does not touch the proposal");
});

test("a proposal with a deterministic later decline, veto, upheld or completed trade is hidden",()=>{
 for(const type of ["trade_decline","trade_veto","trade_uphold","trade"]){
  const rows=[PROPOSAL,trade(`t-${type}`,type,"complete",2000,"930009","910005")];
  assert.ok(!view(rows).ids.includes("p-prop"),`${type} resolves the proposal`);
  assert.deepEqual(verdicts(rows),["resolved"],type);
 }
});

test("an unrelated terminal transaction does not cancel a pending item",()=>{
 const {pending}=view([CLAIM,PROPOSAL,
  row("u-1","waiver","complete",2000,[OWNER],{add:["920002"]}),                 // same team, different player
  row("u-2","add","complete",2000,[OTHER],{add:["920001"]}),             // other team, different player
  row("u-3","drop","complete",2000,[OWNER],{drop:["930002"]}),                  // a drop is not an outcome of a claim
  row("u-4","waiver","complete",500,[OWNER],{add:["930002"]}),                  // same player, but before the claim
  trade("u-5","trade_veto","complete",2000,"910001","910002"), // same teams, other players
  trade("u-6","trade_decline","complete",2000,"910003","910004"), // same teams, other players again
 ]);
 assert.deepEqual(pending.sort(),["p-claim","p-prop"]);
});

test("ambiguous evidence fails closed instead of showing a false pending item",()=>{
 const cases={
  "claim without player detail, later same-team waiver":[row("a-1","waiver","pending",1000,[OWNER]),row("a-2","waiver","complete",2000,[OWNER],{add:["920002"]})],
  "later waiver without player detail":[CLAIM,row("a-3","waiver","complete",2000,[OWNER])],
  "the claimed player was taken by another team":[CLAIM,row("a-4","waiver","complete",2000,[OTHER],{add:["930002"]})],
  "later record with unknown status":[CLAIM,row("a-5","waiver","unknown",2000,[OWNER],{add:["930002"]})],
  "later record that cannot be ordered":[CLAIM,row("a-6","waiver","complete",null,[OWNER],{add:["930002"]})],
  "proposal without player detail, later trade between the same teams":[row("a-7","trade_proposal","pending",1000,[OWNER]),trade("a-8","trade_decline","complete",2000,"910003","910004")],
  "proposal naming one team, later trade naming two":[row("a-9","trade_proposal","pending",1000,[OWNER]),trade("a-10","trade","complete",2000,"910003","910004")],
 };
 for(const [name,rows] of Object.entries(cases)){
  assert.deepEqual(view(rows).pending,[],name);
  assert.deepEqual(verdicts(rows),["ambiguous"],name);
 }
});

test("another team's pending items stay private and reconciliation reveals nothing about them",()=>{
 const {s,ids}=view([
  row("o-claim","waiver","pending",1000,[OTHER],{add:["920001"]}),
  row("o-stale","waiver","pending",1000,[OTHER],{add:["920002"]}),
  row("o-done","waiver","complete",2000,[OTHER],{add:["920002"]}),
  row("o-multi","trade_proposal","pending",1000,[OWNER,OTHER])]);
 for(const id of ["o-claim","o-stale","o-multi"])assert.ok(!ids.includes(id),`${id} never appears`);
 assert.ok(ids.includes("o-done"),"the public completed record is unaffected");
 assert.equal(s.coverage.transactions.owner_pending_included,0);
 assert.equal(s.coverage.transactions.owner_pending_reconciled_out,undefined,"another manager's stale items are not itemised");
 assert.equal(s.coverage.transactions.withheld_private,3,"they stay inside the existing withheld count");
 // Without private mode nothing pending appears, resolved or not, and no owner-only counter is added.
 const pub=view([CLAIM,PROPOSAL,row("p-done","waiver","complete",2000,[OWNER],{add:["930002"]})],{includeOwnPending:false});
 assert.deepEqual(pub.pending,[]);assert.ok(!JSON.stringify(pub.s.coverage).includes("owner_pending"));
 // Selecting another roster never unlocks the owner's items.
 assert.ok(!view([CLAIM],{includeOwnPending:false,rosterId:2}).ids.includes("p-claim"));
});

test("reconciliation is pure and leaves Sleeper and the ESPN gates untouched",()=>{
 const rows=[CLAIM,row("p-done","waiver","complete",2000,[OWNER],{add:["930002"]})],before=JSON.stringify(rows);
 view(rows);assert.equal(JSON.stringify(rows),before);
 const items=factsItems(rows),snap=JSON.stringify(items);reconcilePendingTransactions(items);assert.equal(JSON.stringify(items),snap);
 // Sleeper keeps surfacing provider-pending items as before; it never touches the ESPN reconciler.
 const txs=summarizeTransactions({transactions:[{transaction_id:"s-1",type:"waiver",status:"pending",status_updated:1,adds:{1:1}},{transaction_id:"s-2",type:"waiver",status:"complete",status_updated:2,adds:{1:1}}]});
 assert.deepEqual(txs.map(t=>[t.transaction_id,t.status]).sort(),[["s-1","pending"],["s-2","complete"]]);
 for(const file of ["../lib/sleeper.js","../lib/derive.js","../lib/providers/sleeper.js"])assert.ok(!/espn-transactions/.test(readFileSync(new URL(file,import.meta.url),"utf8")),file);
 // Incomplete-pool and truncation disclosures are unchanged.
 const {s}=view(rows);
 assert.equal(s.coverage.transactions.truncated,true);assert.equal(s.capabilities.completePlayerPool,false);
 assert.ok(s.warnings.some(w=>/may be truncated/.test(w.message)));
});
