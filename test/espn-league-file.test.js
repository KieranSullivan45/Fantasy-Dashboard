// ESPN-FILE-01: sanitized local ESPN league file (`espn-league-file-1`) as a private facts source. SYNTHETIC data only;
// temp files live outside the repository; no network.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {espnFactsFromLeagueFile} from "../lib/providers/espn-file/espn-map.js";
import {checkLeagueFile,MAX_LEAGUE_FILE_BYTES} from "../lib/providers/espn-file/schema.js";
import {readSavedLeagueFile,installLeagueFile} from "../lib/providers/espn-file/file-source.js";
import {crossCheckEspnScoring} from "../lib/providers/espn-file/scoring-check.js";
import {createPrivateEspnProvider} from "../lib/providers/flaim/private-source.js";
import {setPrivateEspnProviderFactory,requestProvider} from "../lib/providers/index.js";
import {loadPrivateConfig,validatePrivateConfig} from "../lib/private/config.js";
import {TOKEN_ENV,LOOPBACK_HEADER} from "../lib/private/loopback.js";
import {snapshotFromEspnFacts,normalizeEspn} from "../lib/providers/espn-normalize.js";
import {espnFactsFromSavedBundle} from "../lib/providers/flaim/bundle-file.js";
import {handleSnapshotRequest} from "../lib/snapshot-api.js";
import {handleDecisionRequest} from "../lib/decision-api.js";
import {handleTradeRequest} from "../lib/trade-api.js";
import {handleChatRequest} from "../lib/chat-api.js";
import {buildDecisionState,buildDecisionContext} from "../lib/decision/build-context.js";
import {captureObservations} from "../lib/history/contracts.js";
import {importLeagueFile} from "../scripts/espn-file-import.js";
import {decisionFixtureOptions} from "./decision-fixtures.js";
import {proposal} from "./trade-api-fixtures.js";

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const FILE=read("./fixtures/espn-league-file/synthetic-league-file.json"),SCORING=read("./fixtures/espn-scoring/synthetic-authorized-scoring.json");
const BUNDLE=read("./fixtures/flaim-espn/synthetic-league.json");
const LEAGUE="424242",BASE="http://127.0.0.1:3000",TOKEN="ab".repeat(32),NOW=Date.parse("2030-09-27T00:00:00Z");
const CROSSWALK=["910001","910002","910003","910004","910005","910006","920001","920002","930001","930002"].map((id,i)=>({espn_id:id,gsis_id:`00-99${String(i).padStart(5,"0")}`,sleeper_id:"NA"}));
const file=(edit=f=>f)=>{const f=structuredClone(FILE);edit(f);return f;};
const map=(f=file())=>espnFactsFromLeagueFile(f,{now:NOW});
const refused=code=>e=>e.code===code;
const team=(f,id)=>f.league.teams.find(t=>t.id===id);
const CONFIG=(edit=c=>c)=>{const c={schema_version:"espn-private-1",provider:"espn",league_id:LEAGUE,season:2030,team_id:1,facts_source:{kind:"espn_league_file",path:"league.json"},scoring:structuredClone(SCORING)};edit(c);return c;};
function privateFolder({config=CONFIG(),league=file()}={}){
 const dir=mkdtempSync(join(tmpdir(),"espn-file-test-")),configPath=join(dir,"espn-private.json");
 writeFileSync(join(dir,"league.json"),JSON.stringify(league));writeFileSync(configPath,JSON.stringify(config));
 return {dir,configPath,leaguePath:join(dir,"league.json"),env:{FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:configPath,[TOKEN_ENV]:TOKEN},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const provider=(env,options={})=>createPrivateEspnProvider({env,loadIds:async()=>({data:CROSSWALK}),now:()=>NOW,...options});
async function withPrivateMode(folder,fn){
 const saved={mode:process.env.FANTASY_PRIVATE_MODE,config:process.env.ESPN_PRIVATE_CONFIG,vercel:process.env.VERCEL,token:process.env[TOKEN_ENV]};
 Object.assign(process.env,folder.env);delete process.env.VERCEL;setPrivateEspnProviderFactory(()=>provider(folder.env));
 try{return await fn();}finally{
  for(const [key,value] of [["FANTASY_PRIVATE_MODE",saved.mode],["ESPN_PRIVATE_CONFIG",saved.config],["VERCEL",saved.vercel],[TOKEN_ENV,saved.token]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  setPrivateEspnProviderFactory();}
}
const local=(path,headers={})=>new Request(`${BASE}${path}`,{headers:{host:"127.0.0.1:3000","accept-encoding":"identity",[LOOPBACK_HEADER]:TOKEN,...headers}});
const tradeRequest=()=>new Request(`${BASE}/api/trade`,{method:"POST",headers:{host:"127.0.0.1:3000","content-type":"application/json",[LOOPBACK_HEADER]:TOKEN},
 body:JSON.stringify({provider:"espn",league:LEAGUE,roster:1,proposal:proposal(["nfl:00-9900000"],["nfl:00-9900006"])})});
const offline=()=>{const {loadLeague,...fixture}=decisionFixtureOptions();return fixture;};
const noValues=(e,...values)=>values.every(v=>!String(e.message).includes(String(v)));

test("a valid minimal league file maps to private ESPN facts with provenance, capture time and no owner",()=>{
 const minimal=file(f=>{delete f.league.schedule;delete f.league.settings.scoringSettings;delete f.league.settings.scheduleSettings;delete f.league.settings.name;
  for(const t of f.league.teams){delete t.record;t.roster.entries=t.roster.entries.map(e=>({playerId:e.playerId,lineupSlotId:e.lineupSlotId}));}});
 const {facts,observedScoring}=map(minimal);
 assert.equal(observedScoring,null);
 assert.deepEqual(facts.provenance,{source:"ESPN saved league file (local)",source_transport:"league_file",access:"saved_league_file",private_live:false,visibility:"private",captured_at:"2030-09-26T12:00:00.000Z"});
 assert.deepEqual([facts.league.id,facts.league.season,facts.league.scoring_period,facts.user_team_id],[LEAGUE,2030,3,null]);
 assert.ok(facts.teams.every(t=>t.owner_id===null&&t.waiver_rank===null&&t.faab.budget===null));
 assert.deepEqual(facts.scoring,{available:false,items:null});assert.equal(facts.available,null);assert.equal(facts.transactions,null);
 const full=map().facts;assert.equal(full.teams[0].name,"Synthetic File Team One");assert.equal(full.teams[1].name,"Synthetic File Two");
 assert.deepEqual(full.teams[0].record,{wins:2,losses:0,ties:0,points_for:240.5,points_against:200.1});
 assert.deepEqual(full.teams[2].record,{wins:null,losses:null,ties:null,points_for:null,points_against:null},"missing records stay null, never zero");
});

test("exact ESPN ids: crosswalk hits become canonical, misses and D/ST stay unresolved, names never establish identity",()=>{
 const named=[...CROSSWALK,{espn_id:"555555",gsis_id:"00-9999999",sleeper_id:"NA",name:"Synthetic Unmapped WR"}];
 const s=snapshotFromEspnFacts(map().facts,{crosswalk:named,rosterId:1}),players=s.my_roster.all_players,by=id=>players.find(p=>p.identity.provider_player_id===id);
 assert.deepEqual([by("910001").player_id,by("910001").identity.mapping_status],["nfl:00-9900000","exact_crosswalk"]);
 assert.deepEqual([by("990001").player_id,by("990001").identity.mapping_status,by("990001").identity.canonical_id],["unresolved:espn:990001","unresolved",null],"same name in the crosswalk is ignored");
 assert.equal(by("-16012").player_id,"unresolved:espn:-16012");
 const ambiguous=[...CROSSWALK,{espn_id:"910001",gsis_id:"00-1111111",sleeper_id:"NA"}];
 assert.equal(snapshotFromEspnFacts(map().facts,{crosswalk:ambiguous,rosterId:1}).my_roster.all_players[0].identity.mapping_status,"ambiguous");
 for(const bad of ["910001",1.5,0,null])assert.throws(()=>map(file(f=>{team(f,1).roster.entries[0].playerId=bad;})),refused("INVALID_IMPORT"),String(bad));
 assert.throws(()=>map(file(f=>{team(f,1).roster.entries[0].playerPoolEntry.player.id=910099;})),refused("INVALID_IMPORT"),"player block id must equal the entry id");
});

test("all roster slots, bench, IR from the slot only, OP as a slot, and dual eligibility",()=>{
 const s=snapshotFromEspnFacts(map().facts,{crosswalk:CROSSWALK,rosterId:1}),mine=s.my_roster;
 assert.deepEqual(s.league.roster_positions,["QB","RB","RB","WR","WR","TE","SUPER_FLEX","DEF","K","BN","BN","BN","BN","BN","BN","IR","FLEX"]);
 assert.deepEqual(mine.reserve.map(p=>p.identity.provider_player_id),["910004"],"IR comes from slot 21 even though injured is false");
 assert.deepEqual(mine.bench.map(p=>p.identity.provider_player_id),["910007","990001"]);
 const dual=mine.all_players.find(p=>p.identity.provider_player_id==="910005");assert.deepEqual(dual.fantasy_positions,["RB","WR"]);
 assert.ok(mine.all_players.every(p=>!p.fantasy_positions.some(x=>["SUPER_FLEX","FLEX","BN","IR"].includes(x))),"flex, OP, bench and IR are slots, not eligibility");
 const other=snapshotFromEspnFacts(map().facts,{rosterId:2}).my_roster;assert.equal(other.starter_slots.find(x=>x.slot==="SUPER_FLEX").player_id,"unresolved:espn:930001");
 assert.equal(s.capabilities.legalLineup,true);assert.deepEqual(s.coverage.unsupported_slots,[]);
});

test("unsupported lineup slots are retained as unsupported and block legal-lineup evaluation; inconsistent slots are refused",()=>{
 const f=file(x=>{x.league.settings.rosterSettings.lineupSlotCounts["24"]=1;team(x,3).roster.entries[1].lineupSlotId=24;});
 const s=snapshotFromEspnFacts(map(f).facts);
 assert.deepEqual(s.coverage.unsupported_slots,["UNSUPPORTED_ESPN_SLOT_24"]);assert.equal(s.capabilities.legalLineup,false);
 assert.ok(s.warnings.some(w=>/Unknown lineup slots/.test(w.message)));
 assert.throws(()=>map(file(x=>{team(x,3).roster.entries[1].lineupSlotId=24;})),refused("MAPPING_INCOMPLETE"),"slot with zero count");
 assert.throws(()=>map(file(x=>{team(x,3).roster.entries[1].lineupSlotId=6;})),refused("MAPPING_INCOMPLETE"),"two players in one TE slot");
 assert.throws(()=>map(file(x=>{team(x,1).roster.entries[7].lineupSlotId=21;})),refused("MAPPING_INCOMPLETE"),"IR over capacity");
 const bench=file(x=>{x.league.settings.rosterSettings.lineupSlotCounts["20"]=1;});
 assert.ok(map(bench).facts.warnings.some(w=>/more bench players/.test(w.message)),"bench overflow is a warning");
 assert.throws(()=>map(file(x=>{x.league.settings.rosterSettings.lineupSlotCounts["2"]=51;})),refused("INVALID_IMPORT"));
 assert.throws(()=>map(file(x=>{x.league.settings.rosterSettings.lineupSlotCounts.QB=1;})),refused("INVALID_IMPORT"));
});

test("strict allow-list: unknown top-level and nested fields are rejected; stats, members and v2 scope are not accepted",()=>{
 const cases={
  top:f=>{f.notes="x";},transactions:f=>{f.transactions=[];},league:f=>{f.league.status={};},members:f=>{f.league.members=[];},settings:f=>{f.league.settings.acquisitionSettings={};},
  team:f=>{team(f,1).abbrev="ONE";},owner:f=>{team(f,1).primaryOwner="owner";},entry:f=>{team(f,1).roster.entries[0].acquisitionType="DRAFT";},
  stats:f=>{team(f,1).roster.entries[0].playerPoolEntry.player.stats=[];},ownership:f=>{team(f,1).roster.entries[0].playerPoolEntry.player.ownership={percentOwned:1};},
  poolEntry:f=>{team(f,1).roster.entries[0].playerPoolEntry.ratings={};},record:f=>{team(f,1).record.overall.percentage=1;},
  scoringItem:f=>{f.league.settings.scoringSettings.scoringItems[0].isReverseItem=false;},matchup:f=>{f.league.schedule[0].playoffTierType="NONE";},
  side:f=>{f.league.schedule[0].home.totalProjectedPoints=1;},binding:f=>{f.binding.team_id=1;},capture:f=>{f.capture.url="x";},
  available:f=>{f.available={coverage:"observed_subset",players:[],complete:true};},
 };
 for(const [name,edit]of Object.entries(cases))assert.throws(()=>map(file(edit)),refused("INVALID_IMPORT"),name);
 for(const [name,edit]of Object.entries({version:f=>{f.schema_version="espn-league-file-2";},provider:f=>{f.provider="sleeper";},array:f=>{f.league.teams={};},missing:f=>{delete f.capture;}}))
  assert.throws(()=>map(file(edit)),refused("INVALID_IMPORT"),name);
 assert.throws(()=>map([]),refused("INVALID_IMPORT"));assert.throws(()=>map(null),refused("INVALID_IMPORT"));
});

test("credentials, headers, cookies, tokens and member identifiers are rejected at any depth without echoing values",()=>{
 const secret="fake-secret-value-123";
 for(const key of ["cookie","Cookie","espn_s2","SWID","swid","authorization","Authorization","token","access_token","secret","password","headers","request","response","url"]){
  for(const edit of [f=>{f[key]=secret;},f=>{f.capture[key]=secret;},f=>{team(f,1).roster.entries[0].playerPoolEntry.player[key]=secret;}])
   assert.throws(()=>map(file(edit)),e=>e.code==="INVALID_IMPORT"&&noValues(e,secret),key);
 }
 for(const value of ["{ABCDEF12-3456-7890-ABCD-EF1234567890}","abcdef12-3456-7890-abcd-ef1234567890","espn_s2=AEB%2Fxyz","SWID={x}","Bearer abc","Cookie: a=b","Set-Cookie a","x".repeat(129)])
  for(const edit of [f=>{f.capture.tool=value;},f=>{team(f,1).name=value;},f=>{team(f,1).roster.entries[0].playerPoolEntry.player.fullName=value;}])
   assert.throws(()=>map(file(edit)),e=>e.code==="INVALID_IMPORT"&&noValues(e,value.slice(0,20)),value.slice(0,20));
 let deep={};const root=deep;for(let i=0;i<14;i++){deep.x={};deep=deep.x;}
 assert.throws(()=>map(file(f=>{f.capture.tool_version=root;})),refused("INVALID_IMPORT"),"nesting");
});

test("binding, league id and season are explicit and must agree; contradictory team and roster data fail closed",()=>{
 for(const [name,edit]of Object.entries({
  badLeagueId:f=>{f.binding.league_id="42x";},numericLeagueId:f=>{f.binding.league_id=424242;},leagueMismatch:f=>{f.league.id=424243;},
  seasonMismatch:f=>{f.league.seasonId=2031;},bindingSeason:f=>{f.binding.season=1999;},noTime:f=>{f.captured_at="yesterday";},future:f=>{f.captured_at="2030-09-28T00:00:00Z";},
  dupScoring:f=>{f.league.settings.scoringSettings.scoringItems.push({statId:3,points:0.05});},badStat:f=>{f.league.settings.scoringSettings.scoringItems[0].statId=-1;},
  size:f=>{f.league.settings.size=4;},oneTeam:f=>{f.league.teams=f.league.teams.slice(0,1);f.league.settings.size=1;delete f.league.schedule;},
  dupOnRoster:f=>{const t=team(f,1);t.roster.entries[8]={playerId:910007,lineupSlotId:20};},
 }))assert.throws(()=>map(file(edit)),refused("INVALID_IMPORT"),name);
 for(const [name,edit]of Object.entries({
  dupTeam:f=>{team(f,3).id=2;},twoRosters:f=>{team(f,3).roster.entries[1]={playerId:910007,lineupSlotId:20};},
  unknownTeam:f=>{f.league.schedule[0].away.teamId=9;},selfMatchup:f=>{f.league.schedule[0].away.teamId=1;},
 }))assert.throws(()=>map(file(edit)),refused("MAPPING_INCOMPLETE"),name);
 assert.throws(()=>map(file(f=>{f.league.schedule[1].id=1;})),refused("INVALID_IMPORT"),"duplicate matchup id");
});

test("matchups: final weeks keep league totals, undecided totals are withheld, unmapped periods are not used",()=>{
 const {facts}=map();
 assert.deepEqual(facts.matchups.map(m=>[m.matchup_period,m.final,m.sides.map(s=>s.points)]),[[1,true,[120.5,101.2]],[1,false,[null]],[2,true,[108.8,110]],[3,false,[null,null]]]);
 const s=snapshotFromEspnFacts(facts);assert.deepEqual(s.current_matchups.map(m=>[m.roster_id,m.points]),[[1,null],[3,null]]);
 assert.equal(snapshotFromEspnFacts(map(file(f=>{delete f.league.settings.scheduleSettings;})).facts).current_matchups.length,0);
});

test("scoring: file items are cross-check evidence only and never become facts scoring or defaults",()=>{
 const {facts,observedScoring}=map();
 assert.deepEqual(facts.scoring,{available:false,items:null},"file scoring never becomes the scoring source");
 assert.equal(observedScoring.length,14);
 const s=snapshotFromEspnFacts(facts);
 assert.deepEqual([s.coverage.scoring_available,s.coverage.scoring_source,s.capabilities.scoringRules],[false,null,false]);assert.deepEqual(s.league.scoring_settings,{});
 assert.deepEqual(crossCheckEspnScoring(observedScoring,SCORING),{status:"consistent",compared:19,mismatched:0,not_comparable:1,unverified:1});
 const changed=structuredClone(observedScoring);changed.find(i=>i.statId===4).points=6;
 assert.equal(crossCheckEspnScoring(changed,SCORING).status,"mismatch");
 assert.equal(crossCheckEspnScoring(observedScoring.filter(i=>i.statId!==25),SCORING).status,"mismatch","absent in the file but non-zero in the configuration");
 assert.equal(crossCheckEspnScoring([...observedScoring,{statId:0,points:-0.5}],SCORING).status,"mismatch","non-zero in the file but absent in the configuration");
 assert.deepEqual(crossCheckEspnScoring([{statId:999,points:3}],SCORING),{status:"mismatch",compared:20,mismatched:13,not_comparable:0,unverified:1},"unverified ids are never mapped");
 assert.equal(crossCheckEspnScoring(null,SCORING).status,"unavailable");
});

test("private config: espn_league_file is additive; Flaim configs are unchanged; team_id validates only",()=>{
 const f=privateFolder();
 try{
  const c=loadPrivateConfig({env:f.env});
  assert.deepEqual([c.facts_kind,c.facts_path,c.bundle_path,c.team_id,c.scoring.league_id],["espn_league_file",f.leaguePath,null,1,LEAGUE]);
  const noScoring=validatePrivateConfig(CONFIG(x=>{delete x.scoring;}),{configPath:f.configPath});assert.equal(noScoring.scoring,null);
  const flaim=CONFIG(x=>{x.facts_source.kind="flaim_bundle_file";});
  assert.equal(validatePrivateConfig(flaim,{configPath:f.configPath}).bundle_path,f.leaguePath);
  assert.throws(()=>validatePrivateConfig({...flaim,scoring:undefined},{configPath:f.configPath}),refused("INVALID_SCORING_CONFIG"),"Flaim still requires scoring");
  for(const edit of [x=>{x.facts_source.kind="league_file";},x=>{x.scoring.league_id="1";},x=>{x.schema_version="espn-private-2";}])
   assert.throws(()=>validatePrivateConfig(CONFIG(edit),{configPath:f.configPath}),e=>["PRIVATE_CONFIG_INVALID","INVALID_SCORING_CONFIG"].includes(e.code));
  assert.throws(()=>loadPrivateConfig({env:f.env,root:f.dir}),refused("PRIVATE_CONFIG_INVALID"),"a league file inside the repository is refused");
 }finally{f.cleanup();}
});

test("private provider: authorized scoring stays the source of record; roster selection is explicit only",async()=>{
 const f=privateFolder();
 try{
  const p=provider(f.env),s=await p.getSnapshot(LEAGUE);
  assert.deepEqual([s.identity.mode,s.identity.selected_roster_id,s.my_roster],["spectator",null,null],"config team_id never selects a roster");
  assert.deepEqual([s.coverage.access,s.coverage.source_transport,s.coverage.visibility,s.coverage.scoring_source,s.coverage.scoring_available,s.coverage.nfl_state_verification],
   ["saved_league_file","league_file","private","user_authorized",true,"required"]);
  assert.equal(s.league.scoring_settings.rec,0.5,"authorized value, not the file's override");
  assert.ok(s.warnings.some(w=>w.code==="PROVENANCE"&&/agree with the authorized scoring configuration on 19/.test(w.message)));
  assert.ok(s.warnings.some(w=>w.code==="STALE_DATA_RISK"));
  const mine=await p.getSnapshot(LEAGUE,{rosterId:1});assert.deepEqual([mine.identity.mode,mine.my_roster.roster_id],["selected_roster",1]);
  await assert.rejects(p.getSnapshot(LEAGUE,{rosterId:9}),refused("LEAGUE_NOT_FOUND"));
  await assert.rejects(p.getSnapshot("999999"),refused("LEAGUE_NOT_FOUND"));
  const caps=p.getProviderCapabilities();
  assert.equal(caps.privateLeagueAccess.status,"available");assert.equal(caps.publicLeagueAccess.status,"unsupported");
  for(const key of ["pickupRating","tradeAnalysis","completePlayerPool"])assert.equal(caps[key].status,"unsupported");
 }finally{f.cleanup();}
 const missing=privateFolder({config:CONFIG(c=>{c.team_id=7;})});
 try{await assert.rejects(provider(missing.env).getSnapshot(LEAGUE),refused("PRIVATE_CONFIG_INVALID"));}finally{missing.cleanup();}
 const other=privateFolder({config:CONFIG(c=>{c.team_id=3;})});
 try{assert.equal((await provider(other.env).getSnapshot(LEAGUE)).identity.mode,"spectator","any configured team validates only");}finally{other.cleanup();}
 const wrong=privateFolder({league:file(x=>{x.binding.league_id="777777";x.league.id=777777;})});
 try{await assert.rejects(provider(wrong.env).getSnapshot(LEAGUE),refused("LEAGUE_NOT_FOUND"));}finally{wrong.cleanup();}
 const season=privateFolder({league:file(x=>{x.binding.season=2031;x.league.seasonId=2031;})});
 try{await assert.rejects(provider(season.env).getSnapshot(LEAGUE),refused("LEAGUE_NOT_FOUND"));}finally{season.cleanup();}
});

test("scoring cross-check mismatch or a missing configuration fails closed; scoring defaults are never invented",async()=>{
 const mismatch=privateFolder({league:file(f=>{f.league.settings.scoringSettings.scoringItems.find(i=>i.statId===53).pointsOverrides=undefined;f.league.settings.scoringSettings.scoringItems.find(i=>i.statId===53).points=1;delete f.league.settings.scoringSettings.scoringItems.find(i=>i.statId===53).pointsOverrides;})});
 try{
  const p=provider(mismatch.env),s=await p.getSnapshot(LEAGUE,{rosterId:1});
  assert.deepEqual([s.coverage.scoring_available,s.coverage.scoring_source],[false,null]);assert.deepEqual(s.league.scoring_settings,{});
  assert.ok(s.warnings.some(w=>/disagree with the authorized scoring configuration/.test(w.message)));assert.equal(s.rosters.length,3,"rosters still load");
  await assert.rejects(p.getDecisionContext(LEAGUE,{rosterId:1}),refused("UNSUPPORTED_FEATURE"));
 }finally{mismatch.cleanup();}
 const none=privateFolder({config:CONFIG(c=>{delete c.scoring;})});
 try{
  const p=provider(none.env),s=await p.getSnapshot(LEAGUE);
  assert.deepEqual([s.coverage.scoring_available,s.capabilities.scoringRules],[false,false]);assert.deepEqual(s.league.scoring_settings,{});
  await assert.rejects(p.getDecisionContext(LEAGUE),refused("UNSUPPORTED_FEATURE"));
 }finally{none.cleanup();}
 const absent=privateFolder({league:file(f=>{delete f.league.settings.scoringSettings;})});
 try{
  const s=await provider(absent.env).getSnapshot(LEAGUE);
  assert.equal(s.coverage.scoring_source,"user_authorized","the transcription stays the authority");assert.equal(s.league.scoring_settings.pass_td,4);
  assert.ok(s.warnings.some(w=>/carries no scoring items/.test(w.message)));
 }finally{absent.cleanup();}
});

test("available players: absent or an observed subset, never complete; pool-dependent features stay gated",async()=>{
 const observed=file(f=>{f.available={coverage:"observed_subset",players:[{id:940001,status:"FREEAGENT",player:{id:940001,fullName:"Synthetic FA",defaultPositionId:3,eligibleSlots:[4,20],proTeamId:9}},
  {id:940002,status:"WAIVERS",waiverClearsAt:"2030-09-28T07:00:00Z"},{id:940003,status:"FREEAGENT",waiverClearsAt:"2030-09-28T07:00:00Z"}]};});
 const {facts}=map(observed);
 assert.equal(facts.available.complete,false);
 assert.deepEqual(facts.available.players.map(a=>[a.acquisition_state,a.waiver_clears_at]),[["free_agent",null],["waivers","2030-09-28T07:00:00.000Z"],["free_agent",null]]);
 const s=snapshotFromEspnFacts(facts);
 assert.deepEqual(s.coverage.available_players,{complete:false,returned:3,limit:null});assert.equal(s.capabilities.completePlayerPool,false);
 assert.ok(s.warnings.some(w=>/provider-capped subset/.test(w.message)));
 for(const [name,edit]of Object.entries({noStatus:f=>{delete f.available.players[0].status;},onWaivers:f=>{f.available.players[0].status="ONTEAM";},coverage:f=>{f.available.coverage="complete";},
  dup:f=>{f.available.players.push({id:940001,status:"FREEAGENT"});}}))assert.throws(()=>map(file(x=>{observed.available&&(x.available=structuredClone(observed.available));edit(x);})),refused("INVALID_IMPORT"),name);
 assert.throws(()=>map(file(x=>{x.available={coverage:"observed_subset",players:[{id:910001,status:"FREEAGENT"}]};})),refused("MAPPING_INCOMPLETE"),"rostered player listed as available");
 for(const league of [file(),observed]){
  const f=privateFolder({league});
  try{
   const p=provider(f.env),snapshot=await p.getSnapshot(LEAGUE);assert.equal(snapshot.coverage.available_players.complete,false);
   const state=await buildDecisionState(LEAGUE,{...offline(),provider:"espn",providerAdapter:p,identity:{rosterId:1}});
   assert.ok(Object.values(state.levels).every(l=>l.replacement_value===null&&l.coverage==="unsupported"));
   assert.ok(Object.values(state.contexts).every(c=>c.model.replacement.value_over_replacement===null));
   assert.equal(state.decision.waivers.status,"unsupported");assert.equal(state.decision.coverage.available_pool_complete,false);
   await withPrivateMode(f,async()=>{
    const trade=await handleTradeRequest(tradeRequest(),{build:async()=>state});
    assert.equal(trade.status,422);assert.equal(trade.headers.get("cache-control"),"private, no-store");assert.equal((await trade.json()).code,"UNSUPPORTED_FEATURE");
   });
  }finally{f.cleanup();}
 }
});

test("routes: private responses are private, no-store; public ESPN access stays disabled; chat and history never see the file",async()=>{
 const f=privateFolder();
 try{await withPrivateMode(f,async()=>{
  const snap=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&roster=1&compact=0`));
  assert.equal(snap.status,200);assert.equal(snap.headers.get("cache-control"),"private, no-store");
  const body=await snap.json();assert.deepEqual([body.identity.mode,body.coverage.source_transport],["selected_roster","league_file"]);
  const spectator=await (await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&compact=0`))).json();assert.equal(spectator.identity.mode,"spectator");
  const bad=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&roster=9`));
  assert.equal(bad.status,422);assert.equal(bad.headers.get("cache-control"),"private, no-store");assert.equal((await bad.json()).code,"LEAGUE_NOT_FOUND");
  const build=(league,o)=>buildDecisionState(league,{...offline(),...o}).then(s=>s.decision);
  const decision=await handleDecisionRequest(local(`/api/decision-support?provider=espn&league=${LEAGUE}&roster=1`),{build});
  assert.equal(decision.status,200);assert.equal(decision.headers.get("cache-control"),"private, no-store");assert.equal((await decision.json()).visibility,"private");
  for(const request of [new Request(`http://192.168.1.20:3000/api/snapshot?provider=espn&league=${LEAGUE}`,{headers:{host:"192.168.1.20:3000"}}),
   new Request(`${BASE}/api/snapshot?provider=espn&league=${LEAGUE}`,{headers:{host:"127.0.0.1:3000"}})]){
   const r=await handleSnapshotRequest(request);assert.equal(r.status,422);assert.equal((await r.json()).code,"UNSUPPORTED_FEATURE");}
  assert.equal(requestProvider(new URLSearchParams("provider=espn"),{live:false}).getProviderCapabilities().privateLeagueAccess.status,"unsupported");
  assert.throws(()=>requestProvider(new URLSearchParams("provider=espn")),refused("UNSUPPORTED_FEATURE"));
  for(const resource of ["waivers","league-summary","player","matchup"]){
   const chat=await handleChatRequest(local(`/api/chat/${resource}?provider=espn&league=${LEAGUE}`),resource);assert.equal(chat.status,422,resource);}
 });
  const d=await buildDecisionContext(LEAGUE,{...offline(),provider:"espn",providerAdapter:provider(f.env),identity:{rosterId:1}});
  assert.equal(d.visibility,"private");assert.throws(()=>captureObservations(d),/never captured/);
 }finally{f.cleanup();}
});

test("input revision follows file bytes; invalid replacements are refused, never served from cache",async()=>{
 const f=privateFolder();
 try{
  const p=provider(f.env),first=await p.getInputRevision();assert.match(first,/^config:[0-9a-f]{64};league_file:[0-9a-f]{64}$/);
  assert.equal(await p.getInputRevision(),first);
  writeFileSync(f.leaguePath,JSON.stringify(file(x=>{x.league.settings.name="Renamed Synthetic File League";})));
  const second=await p.getInputRevision();assert.notEqual(second,first);assert.equal((await p.getSnapshot(LEAGUE)).league.name,"Renamed Synthetic File League");
  writeFileSync(f.leaguePath,JSON.stringify(file(x=>{x.cookie="fake-cookie-value";})));
  await assert.rejects(p.getInputRevision(),e=>e.code==="INVALID_IMPORT"&&noValues(e,"fake-cookie-value"));
  await assert.rejects(p.getSnapshot(LEAGUE),refused("INVALID_IMPORT"));
  writeFileSync(f.leaguePath,"x".repeat(MAX_LEAGUE_FILE_BYTES+1));await assert.rejects(p.getSnapshot(LEAGUE),refused("PRIVATE_CONFIG_INVALID"),"oversized");
  writeFileSync(f.leaguePath,"{not json");await assert.rejects(p.getSnapshot(LEAGUE),e=>e.code==="PRIVATE_CONFIG_INVALID"&&noValues(e,"not json",f.dir));
  assert.throws(()=>readSavedLeagueFile("relative.json"),refused("PRIVATE_CONFIG_INVALID"));
 }finally{f.cleanup();}
});

test("existing private paths are unchanged: Flaim bundles, the raw authorized import and the facts builder",async()=>{
 // Builder generalizations apply only to private facts and saved league files: Flaim facts are private already.
 const flaim=snapshotFromEspnFacts(espnFactsFromSavedBundle(structuredClone(BUNDLE)));
 assert.deepEqual(flaim.coverage.available_players,{complete:false,returned:4,limit:4});assert.equal(flaim.coverage.nfl_state_verification,"required");
 const noFa=structuredClone(BUNDLE);delete noFa.freeAgents;
 assert.deepEqual(snapshotFromEspnFacts(espnFactsFromSavedBundle(noFa)).coverage.available_players,{complete:false,returned:0,limit:null});
 const raw={id:7,seasonId:2030,scoringPeriodId:1,settings:{name:"Raw",rosterSettings:{lineupSlotCounts:{0:1,20:1}},scoringSettings:{scoringItems:[{statId:53,points:1}]}},teams:[{id:1,roster:{entries:[{playerId:5,lineupSlotId:0,playerPoolEntry:{player:{id:5,fullName:"Raw QB",defaultPositionId:1,eligibleSlots:[0,20]}}}]}}]};
 const preview=normalizeEspn(raw);
 assert.equal(preview.coverage.available_players,undefined,"the offline preview reports no pool record, as before");
 assert.equal(preview.coverage.nfl_state_verification,undefined);assert.equal(preview.coverage.scoring_source,"league_settings");
 assert.deepEqual(preview.my_roster,null);assert.equal(preview.rosters[0].all_players[0].name,"Raw QB");
 const dir=mkdtempSync(join(tmpdir(),"espn-flaim-compat-"));
 try{
  writeFileSync(join(dir,"bundle.json"),JSON.stringify(BUNDLE));
  const configPath=join(dir,"espn-private.json");writeFileSync(configPath,JSON.stringify(CONFIG(c=>{c.facts_source={kind:"flaim_bundle_file",path:"bundle.json"};})));
  const env={FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:configPath,[TOKEN_ENV]:TOKEN},p=createPrivateEspnProvider({env,loadIds:async()=>({data:CROSSWALK})});
  const s=await p.getSnapshot(LEAGUE);
  assert.deepEqual([s.identity.mode,s.my_roster.roster_id,s.coverage.source_transport],["account",1,"flaim"],"Flaim keeps its session-resolved owner");
  assert.match(await p.getInputRevision(),/^config:[0-9a-f]{64};bundle:[0-9a-f]{64}$/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("no network: the league-file modules contain no network code and import without fetch",async()=>{
 for(const path of ["../lib/providers/espn-file/schema.js","../lib/providers/espn-file/espn-map.js","../lib/providers/espn-file/scoring-check.js","../lib/providers/espn-file/file-source.js","../scripts/espn-file-import.js"]){
  const source=readFileSync(new URL(path,import.meta.url),"utf8");
  assert.doesNotMatch(source,/\bfetch\s*\(|node:https?|node:net|node:dgram|XMLHttpRequest|WebSocket/,path);
 }
 const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error("network used");};
 const f=privateFolder();
 try{await provider(f.env,{loadIds:async()=>({data:[]})}).getSnapshot(LEAGUE);map();}finally{globalThis.fetch=original;f.cleanup();}
});

test("espn:import validates before installing, keeps the previous file and prints only a redacted summary",()=>{
 const f=privateFolder({league:file()}),incoming=join(f.dir,"incoming.json");
 const past=file(x=>{x.captured_at="2026-09-26T12:00:00Z";});
 try{
  writeFileSync(f.leaguePath,JSON.stringify(past));writeFileSync(incoming,JSON.stringify(file(x=>{x.captured_at="2026-09-27T12:00:00Z";})));
  const ok=importLeagueFile([incoming],{env:f.env,now:NOW});
  assert.equal(ok.exit,0,ok.lines.join("\n"));
  const text=ok.lines.join("\n");
  assert.match(text,/Teams: 3; roster entries: 15/);assert.match(text,/cross-check consistent \(compared 19, mismatched 0, not compared 2\)/);assert.match(text,/Available players: not included/);
  for(const leak of ["Synthetic",LEAGUE,"910001",f.dir])assert.ok(!text.includes(leak),`summary leaks ${leak}`);
  assert.equal(JSON.parse(readFileSync(f.leaguePath,"utf8")).captured_at,"2026-09-27T12:00:00Z");assert.equal(JSON.parse(readFileSync(`${f.leaguePath}.prev`,"utf8")).captured_at,"2026-09-26T12:00:00Z");
  for(const bad of [file(x=>{x.espn_s2="fake-cookie-secret";}),file(x=>{x.binding.league_id="777777";x.league.id=777777;}),file(x=>{team(x,1).name="Synthetic Leak Name";team(x,3).id=1;})]){
   writeFileSync(incoming,JSON.stringify(bad));const r=importLeagueFile([incoming],{env:f.env,now:NOW}),msg=r.lines.join("\n");
   assert.equal(r.exit,1,msg);for(const leak of ["fake-cookie-secret","777777","Synthetic Leak Name",f.dir])assert.ok(!msg.includes(leak),msg);
   assert.equal(JSON.parse(readFileSync(f.leaguePath,"utf8")).captured_at,"2026-09-27T12:00:00Z","an invalid file never replaces the installed one");
  }
  writeFileSync(incoming,"{broken");const broken=importLeagueFile([incoming],{env:f.env,now:NOW});assert.equal(broken.exit,1);assert.ok(!broken.lines.join().includes("broken"));
  assert.equal(importLeagueFile([],{env:f.env}).exit,2);assert.equal(importLeagueFile([incoming],{env:{}}).exit,2);
  assert.equal(importLeagueFile([incoming],{env:f.env,root:f.dir,now:NOW}).exit,1,"destination inside the repository is refused");
  const flaimConfig=join(f.dir,"flaim.json");writeFileSync(flaimConfig,JSON.stringify(CONFIG(c=>{c.facts_source.kind="flaim_bundle_file";})));
  assert.equal(importLeagueFile([incoming,"--config",flaimConfig],{env:{},now:NOW}).exit,1);
  assert.throws(()=>installLeagueFile(incoming,"relative/league.json"),refused("PRIVATE_CONFIG_INVALID"));
  // The real command, end to end, with a capture time in the past.
  writeFileSync(incoming,JSON.stringify(file(x=>{x.captured_at="2026-01-02T00:00:00Z";})));
  const run=spawnSync(process.execPath,["scripts/espn-file-import.js",incoming],{env:{...process.env,ESPN_PRIVATE_CONFIG:f.configPath},encoding:"utf8"});
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/accepted and installed/);assert.ok(!run.stdout.includes("Synthetic")&&!run.stdout.includes(f.dir));
  const refusedRun=spawnSync(process.execPath,["scripts/espn-file-import.js",join(f.dir,"missing.json")],{env:{...process.env,ESPN_PRIVATE_CONFIG:f.configPath},encoding:"utf8"});
  assert.equal(refusedRun.status,1);assert.ok(!refusedRun.stderr.includes(f.dir),refusedRun.stderr);
  assert.ok(!existsSync(join(process.cwd(),"league.json")));
 }finally{f.cleanup();}
});
