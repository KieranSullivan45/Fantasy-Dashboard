// V05-FLAIM-01: offline Flaim → ESPN facts → snapshot mapping over SYNTHETIC fixtures (no network, no auth).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {espnFactsFromFlaim,DISCARDED_FIELDS,FLAIM_SLOT_LABELS} from "../lib/providers/flaim/espn-map.js";
import {unwrapFlaimResult} from "../lib/providers/flaim/schema.js";
import {snapshotFromEspnFacts,normalizeEspn} from "../lib/providers/espn-normalize.js";
import {ESPNProvider} from "../lib/providers/espn.js";
import {fantasyDomain} from "../lib/providers/domain.js";
import {buildDecisionContext,buildDecisionState} from "../lib/decision/build-context.js";
import {scoreStats} from "../lib/normalize/scoring.js";
import {handleTradeRequest} from "../lib/trade-api.js";
import {handleDecisionRequest} from "../lib/decision-api.js";
import {decisionFixtureOptions} from "./decision-fixtures.js";
import {TRADE_LEAGUE,ME,proposal,tradeRequest} from "./trade-api-fixtures.js";
import {espnFixture} from "./provider-fixtures.js";

const RAW=JSON.parse(readFileSync(new URL("./fixtures/flaim-espn/synthetic-league.json",import.meta.url),"utf8"));
const LEAGUE="424242",NOW="2030-09-26T12:00:00.000Z";
const mapped=["910001","910002","910003","910004","910005","910006","920001","920002","930001","930002","930009"];
const CROSSWALK=mapped.map((id,i)=>({espn_id:id,gsis_id:`00-99${String(i).padStart(5,"0")}`,sleeper_id:"NA"}));
const gsis=id=>`nfl:${CROSSWALK.find(r=>r.espn_id===id).gsis_id}`;
/** Fresh, unwrapped Flaim payload bundle; `edit` may mutate it before mapping. */
function bundle(edit=b=>b){
 const r=structuredClone(RAW),u=unwrapFlaimResult;
 const b={session:u(r.session),leagueInfo:u(r.leagueInfo),rosters:r.rosters.map(u),historicalRosters:r.historicalRosters.map(u),standings:u(r.standings),matchups:u(r.matchups),freeAgents:u(r.freeAgents),transactions:u(r.transactions),draft:u(r.draft)};
 edit(b);return b;
}
const facts=(edit)=>espnFactsFromFlaim(bundle(edit));
const snapshot=(edit,options={})=>snapshotFromEspnFacts(facts(edit),{crosswalk:CROSSWALK,now:NOW,...options});
const roster=(s,id)=>s.rosters.find(r=>r.roster_id===id);
const byEspn=(players,id)=>players.find(p=>p.identity.provider_player_id===id);
const hasWarning=(s,pattern)=>s.warnings.some(w=>pattern.test(w.message));
const keysDeep=(value,out=new Set())=>{if(value&&typeof value==="object")for(const [k,v]of Object.entries(value)){out.add(k);keysDeep(v,out);}return out;};

test("provider identity stays ESPN; Flaim appears only as provenance",()=>{
 const s=snapshot();
 assert.equal(s.identity.provider,"espn");assert.equal(s.league.provider,"espn");assert.equal(s.league.league_id,LEAGUE);assert.equal(s.league.season,2030);
 assert.equal(s.coverage.source_transport,"flaim");assert.equal(s.coverage.access,"flaim_live");assert.equal(s.schema_version,"0.2");
 const {coverage,source,...rest}=s;assert.ok(!/flaim/i.test(JSON.stringify(rest)),"Flaim must not leak outside provenance");
 assert.equal(fantasyDomain(s).provider,"espn");
 assert.deepEqual(s.league.roster_positions,["QB","RB","RB","WR","WR","TE","DEF","K","BN","BN","BN","BN","BN","BN","IR","IR","FLEX"]);
 assert.equal(s.matchup_week,3);assert.equal(s.coverage.current_season_verified,true);
});

test("starters, bench and IR come from the lineup slot; injury status never implies IR",()=>{
 const one=roster(snapshot(),1);
 assert.deepEqual(one.starter_slots.find(x=>x.slot==="QB"),{slot:"QB",player_id:gsis("910001")});
 assert.equal(one.starter_slots.find(x=>x.slot==="FLEX").player_id,gsis("910005"));
 assert.deepEqual(one.bench.map(p=>p.identity.provider_player_id).sort(),["910003","910007"]);
 assert.deepEqual(one.reserve.map(p=>p.identity.provider_player_id),["910004"]);
 const irOnBench=byEspn(one.all_players,"910003");assert.equal(irOnBench.injury_status,"IR");assert.equal(irOnBench.reserve,false);
 assert.equal(byEspn(one.all_players,"910004").injury_status,"Questionable");
 assert.equal(byEspn(one.all_players,"910002").team,"WAS","ESPN abbreviations use the shared team normalizer");
 assert.equal(one.starters.length,5);
});

test("eligibility keeps verified positions and dual eligibility; ignores Rookie, flex groupings and unverified IDP labels",()=>{
 const s=snapshot(),one=roster(s,1);
 assert.deepEqual(byEspn(one.all_players,"910005").fantasy_positions,["RB","WR"]);
 assert.deepEqual(byEspn(one.all_players,"910003").fantasy_positions,["WR"]);
 assert.deepEqual(byEspn(one.all_players,"910001").fantasy_positions,["QB"]);
 const waiver=byEspn(s.free_agents.WR,"930002");assert.deepEqual(waiver.fantasy_positions,["WR"]);
 assert.ok(hasWarning(s,/Unverified eligibility labels/));
 assert.deepEqual(byEspn(s.free_agents.K,"930003").fantasy_positions,["K"]);
});

test("unknown lineup label fails closed as an unsupported slot",()=>{
 assert.deepEqual(Object.keys(FLAIM_SLOT_LABELS),["QB","RB","WR","TE","FLEX","K","D/ST","Bench","IR"]);
 const s=snapshot(b=>{b.rosters[1].roster[1].lineupSlot="Taxi Squad";});
 assert.deepEqual(s.coverage.unsupported_slots,["UNSUPPORTED_ESPN_LABEL_TAXI_SQUAD"]);
 assert.equal(s.capabilities.legalLineup,false);
 const two=roster(s,2);assert.ok(!two.starters.concat(two.bench,two.reserve).some(p=>p.identity.provider_player_id==="920002"));
});

test("kickers map through the crosswalk; negative D/ST ids and unmapped ids stay unresolved",()=>{
 const s=snapshot(),one=roster(s,1);
 const k=byEspn(one.all_players,"910006");assert.equal(k.player_id,gsis("910006"));assert.equal(k.identity.mapping_status,"exact_crosswalk");
 const dst=byEspn(one.all_players,"-16012");
 assert.equal(dst.player_id,"unresolved:espn:-16012");assert.equal(dst.identity.canonical_id,null);assert.equal(dst.position,"DEF");assert.deepEqual(dst.fantasy_positions,["DEF"]);assert.equal(dst.injury_status,null);
 assert.equal(one.starter_slots.find(x=>x.slot==="DEF").player_id,"unresolved:espn:-16012");
 const unmapped=byEspn(one.all_players,"910007");
 assert.equal(unmapped.identity.canonical_id,null);assert.equal(unmapped.identity.provider_player_id,"910007");assert.equal(unmapped.identity.mapping_status,"unresolved");
 assert.ok(hasWarning(s,/ESPN player 910007 has no unambiguous canonical mapping/));
 assert.ok(hasWarning(s,/ESPN player -16012 has no unambiguous canonical mapping/));
 // Names never establish identity: a crosswalk row with the same name but no ESPN id changes nothing.
 const named=snapshotFromEspnFacts(facts(),{crosswalk:[...CROSSWALK,{espn_id:"NA",gsis_id:"00-1234567",name:"Synthetic Unmapped RB"}],now:NOW});
 assert.equal(byEspn(roster(named,1).all_players,"910007").identity.canonical_id,null);
});

test("available players: free agents and waivers are labeled, pool is never claimed complete",()=>{
 const f=facts(),s=snapshotFromEspnFacts(f,{crosswalk:CROSSWALK,now:NOW});
 assert.equal(f.available.complete,false);assert.equal(f.available.players.length,4);
 const fa=byEspn(s.free_agents.RB,"930001");assert.equal(fa.acquisition_state,"free_agent");assert.equal(fa.waiver_clears_at,null);
 const w=byEspn(s.free_agents.WR,"930002");assert.equal(w.acquisition_state,"waivers");assert.equal(w.waiver_clears_at,"2030-09-30T07:00:00.000Z");
 assert.equal(byEspn(s.free_agents.DEF,"-16020").player_id,"unresolved:espn:-16020");
 assert.equal(s.capabilities.completePlayerPool,false);assert.deepEqual(s.coverage.available_players,{complete:false,returned:4,limit:4});
 assert.deepEqual(s.truncation.free_agents.WR,{total:null,returned:1,omitted:null,limit:4});
 assert.ok(Object.values(s.free_agents).flat().every(p=>p.trending_adds_24h===null&&p.search_rank===null));
 assert.ok(hasWarning(s,/provider-capped subset/));
 const provider=new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK});
 assert.equal(provider.getProviderCapabilities().completePlayerPool.status,"unsupported");
 assert.equal(provider.getProviderCapabilities().addInterest.status,"unsupported");
 assert.throws(()=>facts(b=>{b.freeAgents.freeAgents.push({...b.freeAgents.freeAgents[0],playerId:910001,id:"910001"});}),e=>e.code==="MAPPING_INCOMPLETE");
});

test("missing scoring rules are recorded as unavailable, never as empty zero-point scoring",()=>{
 const f=facts(),s=snapshotFromEspnFacts(f,{crosswalk:CROSSWALK,now:NOW});
 assert.deepEqual(f.scoring,{available:false,items:null});
 assert.equal(s.coverage.scoring_available,false);assert.equal(s.capabilities.scoringRules,false);assert.deepEqual(s.league.scoring_settings,{});
 assert.ok(hasWarning(s,/League scoring rules are unavailable/));
 const caps=new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK}).getProviderCapabilities();
 assert.equal(caps.scoringRules.status,"unsupported");assert.equal(caps.publicLeagueAccess.status,"unsupported");
 // Transport-supplied scoring items are not trusted either.
 assert.equal(snapshot(b=>{b.leagueInfo.scoringSettings.scoringItems=[{statId:3,points:0.04}];}).coverage.scoring_available,false);
 // The existing authorized-import path keeps its verified scoring.
 assert.equal(normalizeEspn(espnFixture()).coverage.scoring_available,true);
});

test("regression: ESPN-via-Flaim cannot run decision support or trade scoring with zeros",async()=>{
 // Why the gate matters: an empty rule set scores any stat line as a "complete" zero.
 assert.deepEqual([scoreStats({passing_yards:300,passing_tds:3},{},"QB").points,scoreStats({passing_yards:300,passing_tds:3},{},"QB").status],[0,"complete"]);
 const f=facts(),provider=new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK}),flaimSnapshot=provider.getSnapshot(LEAGUE);
 assert.throws(()=>provider.getDecisionContext(LEAGUE),e=>e.code==="UNSUPPORTED_FEATURE"&&/scoring/.test(e.message));
 let sourceCalls=0;const counted=()=>{sourceCalls++;return {status:"ok",data:[],warnings:[]};};
 const options={...decisionFixtureOptions(),statsSource:counted,snapSource:counted,opportunitySource:counted,loadLeague:async()=>structuredClone(flaimSnapshot)};
 await assert.rejects(buildDecisionContext(LEAGUE,{...options,provider:"espn"}),e=>e.code==="UNSUPPORTED_FEATURE"&&/scoring/.test(e.message));
 await assert.rejects(buildDecisionState(LEAGUE,{...options,provider:"espn"}),e=>e.code==="UNSUPPORTED_FEATURE");
 assert.equal(sourceCalls,0,"no stat source or scoring step runs before refusal");
 const build=(league,o)=>buildDecisionState(league,{...options,...o});
 const trade=await handleTradeRequest(tradeRequest({league:TRADE_LEAGUE,user:ME,proposal:proposal(["12"],["23"])}),{leagueIds:[TRADE_LEAGUE],build});
 assert.equal(trade.status,422);assert.equal((await trade.json()).code,"UNSUPPORTED_FEATURE");assert.match(trade.headers.get("cache-control"),/no-store/);
 const decision=await handleDecisionRequest(new Request(`https://test/api/decision-support?league=${TRADE_LEAGUE}`),{leagueIds:[TRADE_LEAGUE],build:(league,o)=>buildDecisionContext(league,{...options,...o})});
 assert.equal(decision.status,422);assert.equal((await decision.json()).code,"UNSUPPORTED_FEATURE");
});

test("historical roster keeps membership and slots only; current-time fields are stripped",()=>{
 const f=facts(),week=f.roster_history[0];
 assert.equal(week.week,1);assert.equal(week.team_id,1);
 assert.deepEqual(week.entries.map(e=>[e.player.espn_id,e.slot]),[["910001","QB"],["930001","RB"],["910004","IR"]]);
 for(const e of week.entries){assert.equal(e.player.injury_status,null);assert.equal(e.player.team,null);assert.equal(e.acquisition,null);}
 const keys=keysDeep(f);for(const field of DISCARDED_FIELDS)assert.ok(!keys.has(field),`${field} must be discarded`);
 assert.ok(!JSON.stringify(f).includes("Out"),"historical injury status is not carried");
 // Current-roster acquisition metadata is kept where it is supplied.
 assert.deepEqual(f.teams[0].entries[0].acquisition,{type:"draft",date:new Date(1916000000000).toISOString()});
 assert.equal(new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK}).getProviderCapabilities().historicalRosters.status,"available");
});

test("in-progress matchup totals are withheld; decided matchups keep points",()=>{
 const s=snapshot();
 assert.equal(s.current_matchups.length,2);assert.ok(s.current_matchups.every(m=>m.points===null));
 assert.equal(s.current_matchups[0].matchup_id,s.current_matchups[1].matchup_id);
 assert.ok(hasWarning(s,/undecided matchups/));
 const done=snapshot(b=>{b.matchups.matchups[0].winner="HOME";b.matchups.matchups[0].home.totalPoints=101.5;});
 assert.deepEqual(done.current_matchups.map(m=>m.points),[101.5,0]);
 assert.throws(()=>facts(b=>{b.matchups.currentScoringPeriod=4;}),e=>e.code==="INVALID_IMPORT");
});

test("transactions: truncation is disclosed and private pending items are withheld",()=>{
 const f=facts(),s=snapshotFromEspnFacts(f,{crosswalk:CROSSWALK,now:NOW});
 assert.equal(f.transactions.truncated,true);
 assert.deepEqual(f.transactions.items.filter(t=>t.private).map(t=>t.id),["syn-0001","syn-0002"]);
 assert.deepEqual(s.recent_transactions.map(t=>t.transaction_id),["syn-0003","syn-0004","syn-0005","syn-0006"]);
 assert.ok(!JSON.stringify(s).includes("syn-0002"),"pending claim never reaches the snapshot");
 assert.deepEqual(s.coverage.transactions,{complete:false,truncated:true,withheld_private:2});
 assert.ok(s.recent_transactions.every(t=>t.waiver_bid===null),"FAAB bids stay unknown");
 assert.equal(s.recent_transactions.find(t=>t.transaction_id==="syn-0004").status,"failed");
 const tradeTx=s.recent_transactions.find(t=>t.type==="trade");
 assert.deepEqual(tradeTx.adds.map(a=>[a.player.identity.provider_player_id,a.roster_id]),[["910005",1],["930009",2]]);
 assert.deepEqual(tradeTx.drops.map(d=>[d.player.identity.provider_player_id,d.roster_id]),[["930009",1],["910005",2]]);
 const add=s.recent_transactions.find(t=>t.transaction_id==="syn-0005");assert.equal(add.type,"free_agent");assert.equal(add.adds[0].player.player_id,"unresolved:espn:910007");assert.equal(add.adds[0].team_name,"Synthetic Team One");
 assert.ok(hasWarning(s,/may be truncated/));assert.ok(hasWarning(s,/private pending/));
 const provider=new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK});
 assert.deepEqual(provider.getTransactions(LEAGUE).map(t=>t.transaction_id),["syn-0003","syn-0004","syn-0005","syn-0006"]);
});

test("owner information is unavailable; ownership comes only from the session team or an explicit roster",()=>{
 const s=snapshot();
 assert.ok(s.rosters.every(r=>r.owner_id===null));assert.ok(hasWarning(s,/owner information is unavailable/));
 assert.equal(s.identity.mode,"account");assert.equal(s.my_roster.roster_id,1);assert.equal(s.identity.provider_user_id,null);
 const selected=snapshot(undefined,{rosterId:2});assert.equal(selected.identity.mode,"selected_roster");assert.equal(selected.my_roster.roster_id,2);
 const spectator=snapshot(b=>{b.session=null;});assert.equal(spectator.identity.mode,"spectator");assert.equal(spectator.my_roster,null);assert.equal(spectator.coverage.current_season_verified,false);
 const otherSeason=snapshot(b=>{b.session.allLeagues[0].seasonYear=2029;});assert.equal(otherSeason.my_roster,null);
 assert.throws(()=>snapshot(undefined,{rosterId:9}),e=>e.code==="LEAGUE_NOT_FOUND");
});

test("standings keep records and drop projections, ranks and playoff predictions",()=>{
 const s=snapshot(),f=facts();
 assert.deepEqual(s.standings.find(x=>x.roster_id===2),{roster_id:2,team_name:"Synthetic Team Two",wins:2,losses:0,ties:0,points_for:250.5,points_against:200.25});
 assert.equal(f.teams[0].playoff_seed,2);assert.equal(f.teams[0].name,"Synthetic Team One");
 assert.ok(s.rosters.every(r=>r.waiver_position===null&&r.provider_faab.spent===null&&r.provider_faab.budget===null));
 const caps=new ESPNProvider({espnFacts:f,crosswalk:CROSSWALK}).getProviderCapabilities();
 assert.equal(caps.FAAB.status,"unsupported");assert.equal(caps.waiverPriority.status,"unsupported");
});

test("draft results are completed selections without a pick-ownership ledger",()=>{
 const d=new ESPNProvider({espnFacts:facts(),crosswalk:CROSSWALK}).getDraftPicks(LEAGUE);
 assert.equal(d.status,"completed_selections_only");assert.equal(d.draft_status,"complete");assert.equal(d.ownership,null);
 assert.deepEqual(d.picks.map(p=>[p.round,p.pick,p.overall,p.roster_id]),[[1,1,1,2],[1,2,2,1],[2,1,3,1],[2,2,4,2]]);
 assert.equal(d.picks[2].player.canonical_id,null);assert.equal(d.picks[1].player.canonical_id,gsis("910001"));
});

test("payloads fail closed: incomplete rosters, conflicts, bad envelopes and credentials",()=>{
 assert.throws(()=>facts(b=>{b.rosters.pop();}),e=>e.code==="MAPPING_INCOMPLETE");
 assert.throws(()=>facts(b=>{b.rosters[1].roster.push({...b.rosters[0].roster[0]});}),e=>e.code==="MAPPING_INCOMPLETE");
 assert.throws(()=>facts(b=>{b.rosters[0].snapshot={type:"week",week:2};}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>facts(b=>{b.rosters[0].roster[0].playerId="910001";}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>facts(b=>{b.freeAgents.freeAgents[1].acquisitionState="claimed";}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>facts(b=>{b.transactions.transactions[2].team_ids=["7"];}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>unwrapFlaimResult({success:false,error:"boom"}),e=>e.code==="INVALID_IMPORT"&&!e.message.includes("boom"));
 for(const key of ["espn_s2","SWID","access_token","Authorization"])
  assert.throws(()=>facts(b=>{b.leagueInfo[key]="fake-secret-value";}),e=>e.code==="INVALID_IMPORT"&&!e.message.includes("fake-secret-value"));
});

test("ESPN facts from an authorized import and from Flaim share one snapshot builder",()=>{
 const imported=new ESPNProvider({authorizedImport:espnFixture()});
 assert.equal(imported.getProviderCapabilities().authorizedImport.status,"available");
 assert.equal(imported.getSnapshot("12345").coverage.source_transport,"authorized_import");
 assert.throws(()=>new ESPNProvider({authorizedImport:espnFixture(),espnFacts:facts()}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>new ESPNProvider({espnFacts:{...facts(),version:"espn-facts-0"}}),e=>e.code==="INVALID_IMPORT");
 assert.throws(()=>new ESPNProvider({espnFacts:facts()}).getSnapshot("999"),e=>e.code==="LEAGUE_NOT_FOUND");
});
