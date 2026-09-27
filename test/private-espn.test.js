// V05-ESPN-04: local private ESPN mode over a SYNTHETIC saved Flaim bundle (temp files outside the repo; no network).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {privateModeEnabled,loadPrivateConfig,outsideRepository,validatePrivateConfig} from "../lib/private/config.js";
import {privateRequest,privateIdentity} from "../lib/private/guard.js";
import {LOOPBACK_HEADER,TOKEN_ENV,tagLoopbackRequest,isLoopbackAddress,loopbackProofMatches} from "../lib/private/loopback.js";
import {createDecisionService} from "../lib/decision-service.js";
import {readSavedFlaimBundle,espnFactsFromSavedBundle} from "../lib/providers/flaim/bundle-file.js";
import {createPrivateEspnProvider} from "../lib/providers/flaim/private-source.js";
import {setPrivateEspnProviderFactory,requestProvider} from "../lib/providers/index.js";
import {snapshotFromEspnFacts} from "../lib/providers/espn-normalize.js";
import {handleSnapshotRequest} from "../lib/snapshot-api.js";
import {handleDecisionRequest} from "../lib/decision-api.js";
import {handleTradeRequest} from "../lib/trade-api.js";
import {handleChatRequest} from "../lib/chat-api.js";
import {buildDecisionState,buildDecisionContext} from "../lib/decision/build-context.js";
import {captureObservations} from "../lib/history/contracts.js";
import {appendCapture} from "../lib/history/git-store.js";
import {decisionFixtureOptions} from "./decision-fixtures.js";
import {proposal} from "./trade-api-fixtures.js";

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const BUNDLE=read("./fixtures/flaim-espn/synthetic-league.json"),SCORING=read("./fixtures/espn-scoring/synthetic-authorized-scoring.json");
const LEAGUE="424242",BASE="http://127.0.0.1:3000",TOKEN="ab".repeat(32);
const CROSSWALK=["910001","910002","910003","910004","910005","910006","920001","920002","930001","930002","930009"].map((id,i)=>({espn_id:id,gsis_id:`00-99${String(i).padStart(5,"0")}`,sleeper_id:"NA"}));
const CONFIG=(edit=c=>c)=>{const c={schema_version:"espn-private-1",provider:"espn",league_id:LEAGUE,season:2030,team_id:1,facts_source:{kind:"flaim_bundle_file",path:"bundle.json"},scoring:structuredClone(SCORING)};edit(c);return c;};
const refused=code=>e=>e.code===code;
/** A private folder in the OS temp directory (outside the repository) holding a config and a saved bundle. */
function privateFolder({config=CONFIG(),bundle=structuredClone(BUNDLE)}={}){
 const dir=mkdtempSync(join(tmpdir(),"espn-private-test-")),configPath=join(dir,"espn-private.json");
 writeFileSync(join(dir,"bundle.json"),JSON.stringify(bundle));writeFileSync(configPath,JSON.stringify(config));
 return {dir,configPath,env:{FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:configPath,[TOKEN_ENV]:TOKEN},cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
const provider=env=>createPrivateEspnProvider({env,loadIds:async()=>({data:CROSSWALK})});
/** Runs `fn` with process-level private mode on (routes read process.env), then restores everything. */
async function withPrivateMode(folder,fn){
 const saved={mode:process.env.FANTASY_PRIVATE_MODE,config:process.env.ESPN_PRIVATE_CONFIG,vercel:process.env.VERCEL,token:process.env[TOKEN_ENV]};
 Object.assign(process.env,folder.env);delete process.env.VERCEL;setPrivateEspnProviderFactory(()=>provider(folder.env));
 try{return await fn();}finally{
  for(const [key,value] of [["FANTASY_PRIVATE_MODE",saved.mode],["ESPN_PRIVATE_CONFIG",saved.config],["VERCEL",saved.vercel],[TOKEN_ENV,saved.token]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  setPrivateEspnProviderFactory();}
}
// A request as the private dev server forwards it from a genuine loopback connection (it carries the loopback proof).
const local=(path,headers={})=>new Request(`${BASE}${path}`,{headers:{host:"127.0.0.1:3000","accept-encoding":"identity",[LOOPBACK_HEADER]:TOKEN,...headers}});
const offlineBuild=(league,options)=>{const {loadLeague,...fixture}=decisionFixtureOptions();return buildDecisionState(league,{...fixture,...options});};

test("private mode is off unless explicitly enabled, configured, not on Vercel and launched by the private dev server",()=>{
 const on={FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:"/x.json",[TOKEN_ENV]:TOKEN};
 assert.equal(privateModeEnabled({}),false);
 assert.equal(privateModeEnabled({FANTASY_PRIVATE_MODE:"local"}),false);
 assert.equal(privateModeEnabled({...on,FANTASY_PRIVATE_MODE:"on"}),false);
 assert.equal(privateModeEnabled(on),true);
 assert.equal(privateModeEnabled({...on,VERCEL:"1"}),false);
 assert.equal(privateModeEnabled({...on,[TOKEN_ENV]:undefined}),false,"plain next dev/next start never enable private mode");
 assert.equal(privateModeEnabled({...on,[TOKEN_ENV]:"short"}),false);
 assert.throws(()=>loadPrivateConfig({env:{}}),refused("UNSUPPORTED_FEATURE"));
});

test("private configuration is validated, league/season bound and must live outside the repository",()=>{
 const f=privateFolder();
 try{
  const c=loadPrivateConfig({env:f.env});
  assert.deepEqual([c.league_id,c.season,c.team_id,c.bundle_path],[LEAGUE,2030,1,join(f.dir,"bundle.json")]);assert.equal(c.scoring.league_id,LEAGUE);
  assert.equal(outsideRepository(f.configPath),true);assert.equal(outsideRepository(join(process.cwd(),"lib","x.json")),false);
  // Treat the temp folder as "the repository": both the config and the bundle are then refused.
  assert.throws(()=>loadPrivateConfig({env:f.env,root:f.dir}),e=>e.code==="PRIVATE_CONFIG_INVALID"&&!e.message.includes(f.dir));
  for(const edit of [c=>{c.scoring.league_id="999999";},c=>{c.scoring.season=2031;},c=>{c.league_id="42x";},c=>{c.extra=1;},c=>{c.facts_source.kind="live";},c=>{c.team_id=0;},c=>{c.api_token="fake-secret-value";},c=>{delete c.scoring.offense.reception;}])
   assert.throws(()=>validatePrivateConfig(CONFIG(edit),{configPath:f.configPath}),e=>["PRIVATE_CONFIG_INVALID","INVALID_SCORING_CONFIG","INVALID_IMPORT"].includes(e.code)&&!e.message.includes("fake-secret-value"));
  writeFileSync(f.configPath,"{not json");assert.throws(()=>loadPrivateConfig({env:f.env}),e=>e.code==="PRIVATE_CONFIG_INVALID"&&!e.message.includes("not json"));
  writeFileSync(f.configPath,"x".repeat(1024*1024+1));assert.throws(()=>loadPrivateConfig({env:f.env}),refused("PRIVATE_CONFIG_INVALID"));
  assert.throws(()=>loadPrivateConfig({env:{...f.env,ESPN_PRIVATE_CONFIG:"relative/espn.json"}}),refused("PRIVATE_CONFIG_INVALID"));
 }finally{f.cleanup();}
});

test("local guard admits only loopback, same-site requests with private mode on",()=>{
 const env={FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:"/x.json",[TOKEN_ENV]:TOKEN};
 for(const [url,host] of [[`${BASE}/api/snapshot`,"127.0.0.1:3000"],["http://localhost:3000/api/snapshot","localhost:3000"],["http://[::1]:3000/api/snapshot","[::1]:3000"]])
  assert.deepEqual(privateRequest(new Request(url,{headers:{host,[LOOPBACK_HEADER]:TOKEN}}),{env}),{principal:"local-owner",mode:"local"});
 assert.equal(privateRequest(local("/x",{origin:"https://evil.example"}),{env}),null,"foreign Origin");
 assert.equal(privateRequest(local("/x",{origin:"null"}),{env}),null,"opaque Origin");
 assert.ok(privateRequest(local("/x",{origin:"http://localhost:3000"}),{env}),"loopback Origin");
 assert.equal(privateRequest(new Request("http://192.168.1.20:3000/x",{headers:{host:"192.168.1.20:3000"}}),{env}),null,"LAN access");
 assert.equal(privateRequest(new Request("http://evil.example/x",{headers:{host:"127.0.0.1:3000"}}),{env}),null,"URL host must be loopback too");
 assert.equal(privateRequest(new Request(`${BASE}/x`,{headers:{host:"attacker.example"}}),{env}),null,"DNS rebinding Host");
 assert.equal(privateRequest(local("/x",{"sec-fetch-site":"cross-site"}),{env}),null);
 assert.ok(privateRequest(local("/x",{"sec-fetch-site":"same-origin"}),{env}));
 assert.equal(privateRequest(local("/x"),{env:{...env,VERCEL:"1"}}),null);assert.equal(privateRequest(local("/x"),{env:{}}),null);
 assert.throws(()=>privateIdentity(new URLSearchParams("user=123456"),{principal:"local-owner"}),/user is not used/);
 assert.deepEqual(privateIdentity(new URLSearchParams("roster=2&season=2030"),{principal:"local-owner"}),{userId:null,principal:"local-owner",rosterId:2,season:2030});
});

test("saved bundles map to private ESPN facts with capture time; malformed bundles are refused",()=>{
 const facts=espnFactsFromSavedBundle(structuredClone(BUNDLE));
 assert.deepEqual([facts.provider,facts.provenance.source_transport,facts.provenance.access,facts.provenance.visibility,facts.provenance.private_live,facts.provenance.captured_at],
  ["espn","flaim","flaim_saved_bundle","private",false,"2030-09-26T12:00:00.000Z"]);
 assert.equal(espnFactsFromSavedBundle({...structuredClone(BUNDLE),captured_at:"2030-09-27T08:00:00Z"}).provenance.captured_at,"2030-09-27T08:00:00.000Z");
 const noTime=structuredClone(BUNDLE);delete noTime.session.data.currentDate;
 assert.throws(()=>espnFactsFromSavedBundle(noTime),refused("INVALID_IMPORT"));
 assert.throws(()=>espnFactsFromSavedBundle({...structuredClone(BUNDLE),notes:"x"}),refused("INVALID_IMPORT"));
 assert.throws(()=>espnFactsFromSavedBundle({...structuredClone(BUNDLE),session:{success:true,data:{...BUNDLE.session.data,espn_s2:"fake-cookie"}}}),e=>e.code==="INVALID_IMPORT"&&!e.message.includes("fake-cookie"));
 const f=privateFolder();
 try{
  const first=readSavedFlaimBundle(join(f.dir,"bundle.json"));assert.equal(first.facts.league.name,"Synthetic League");
  assert.equal(readSavedFlaimBundle(join(f.dir,"bundle.json")),first,"unchanged files reuse facts");
  const changed=structuredClone(BUNDLE);changed.leagueInfo.data.name="Renamed Synthetic League";writeFileSync(join(f.dir,"bundle.json"),JSON.stringify(changed));
  assert.equal(readSavedFlaimBundle(join(f.dir,"bundle.json")).facts.league.name,"Renamed Synthetic League","changes are reloaded");
  writeFileSync(join(f.dir,"big.json"),"x".repeat(5*1024*1024+1));assert.throws(()=>readSavedFlaimBundle(join(f.dir,"big.json")),refused("PRIVATE_CONFIG_INVALID"));
 }finally{f.cleanup();}
});

test("private provider serves ESPN facts with authorized scoring, private provenance and staleness disclosure",async()=>{
 const f=privateFolder();
 try{
  const p=provider(f.env),s=await p.getSnapshot(LEAGUE);
  assert.equal(s.identity.provider,"espn");assert.equal(s.identity.mode,"account");assert.equal(s.my_roster.roster_id,1);
  assert.deepEqual([s.coverage.visibility,s.coverage.access,s.coverage.source_transport,s.coverage.captured_at,s.coverage.scoring_source],["private","flaim_saved_bundle","flaim","2030-09-26T12:00:00.000Z","user_authorized"]);
  assert.ok(s.warnings.some(w=>w.code==="STALE_DATA_RISK"));assert.equal(s.capabilities.privateLiveAccess,false);
  const caps=p.getProviderCapabilities();
  assert.equal(caps.privateLeagueAccess.status,"available");assert.equal(caps.publicLeagueAccess.status,"unsupported");
  for(const key of ["pickupRating","tradeAnalysis","completePlayerPool"])assert.equal(caps[key].status,"unsupported");
  assert.equal((await p.getDecisionContext(LEAGUE)).coverage.scoring_available,true);
  await assert.rejects(p.getSnapshot("999999"),refused("LEAGUE_NOT_FOUND"));
  const offline=await createPrivateEspnProvider({env:f.env,loadIds:async()=>{throw new Error("offline");}}).getSnapshot(LEAGUE);
  assert.ok(offline.rosters[0].all_players.every(x=>x.identity.canonical_id===null),"no crosswalk: identities stay unresolved, never guessed");
 }finally{f.cleanup();}
 const other=privateFolder({config:CONFIG(c=>{c.league_id="777777";c.scoring.league_id="777777";})});
 try{await assert.rejects(provider(other.env).getSnapshot("777777"),refused("LEAGUE_NOT_FOUND"));}finally{other.cleanup();}
 const team=privateFolder({config:CONFIG(c=>{c.team_id=2;})});
 try{await assert.rejects(provider(team.env).getSnapshot(LEAGUE),refused("PRIVATE_CONFIG_INVALID"));}finally{team.cleanup();}
});

test("only the owner's own pending transactions appear, and only in private mode",async()=>{
 const bundle=structuredClone(BUNDLE),rows=bundle.transactions.data.transactions;
 rows.push({transaction_id:"syn-0007",type:"waiver",status:"pending",timestamp:1917280000000,week:3,team_ids:["2"],players_added:[{id:"930003",name:"Synthetic Unmapped K",position:"K",team:"GB"}],players_dropped:[],faab_bid:0},
  {transaction_id:"syn-0008",type:"trade_proposal",status:"pending",timestamp:1917270000000,week:3,team_ids:["1","2"],players_added:[],players_dropped:[],faab_bid:0});
 const f=privateFolder({bundle});
 try{
  const s=await provider(f.env).getSnapshot(LEAGUE),ids=s.recent_transactions.map(t=>t.transaction_id);
  assert.ok(ids.includes("syn-0001")&&ids.includes("syn-0002"),"own proposal and own waiver claim");
  for(const id of ["syn-0007","syn-0008"])assert.ok(!ids.includes(id),`${id} belongs to another manager or is ambiguous`);
  assert.deepEqual(s.recent_transactions.filter(t=>t.visibility==="owner_private").map(t=>t.transaction_id).sort(),["syn-0001","syn-0002"]);
  assert.deepEqual([s.coverage.transactions.owner_pending_included,s.coverage.transactions.withheld_private],[2,2]);
  const selected=await provider(f.env).getSnapshot(LEAGUE,{rosterId:2});
  assert.ok(!selected.recent_transactions.some(t=>["syn-0007","syn-0008"].includes(t.transaction_id)),"selecting another roster never unlocks its pending items");
  const facts=espnFactsFromSavedBundle(bundle);
  assert.ok(!snapshotFromEspnFacts(facts).recent_transactions.some(t=>t.visibility),"without private mode no pending item appears");
  const noSession=structuredClone(bundle);noSession.session=null;noSession.captured_at="2030-09-26T12:00:00Z";
  assert.equal(snapshotFromEspnFacts(espnFactsFromSavedBundle(noSession),{includeOwnPending:true}).coverage.transactions.owner_pending_included,0,"no session owner, no pending items");
 }finally{f.cleanup();}
});

test("routes: private snapshot and decision are no-store; trade stays gated; chat and non-local requests are refused",async()=>{
 const f=privateFolder();
 try{await withPrivateMode(f,async()=>{
  const snap=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&compact=0`));
  assert.equal(snap.status,200);assert.equal(snap.headers.get("cache-control"),"private, no-store");
  const body=await snap.json();assert.equal(body.identity.provider,"espn");assert.equal(body.coverage.visibility,"private");
  assert.ok(body.recent_transactions.some(t=>t.visibility==="owner_private"));
  assert.equal((await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}`))).headers.get("cache-control"),"private, no-store","compact view too");
  const lan=await handleSnapshotRequest(new Request(`http://192.168.1.20:3000/api/snapshot?provider=espn&league=${LEAGUE}`,{headers:{host:"192.168.1.20:3000"}}));
  assert.equal(lan.status,422);assert.equal((await lan.json()).code,"UNSUPPORTED_FEATURE");
  const withUser=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&user=123456`));
  assert.equal(withUser.status,400);assert.equal(withUser.headers.get("cache-control"),"private, no-store");
  const wrong=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=999999`));
  assert.equal(wrong.status,422);assert.equal((await wrong.json()).code,"LEAGUE_NOT_FOUND");
  const missing=await handleSnapshotRequest(local(`/api/snapshot?provider=espn`));assert.equal(missing.status,400);
  let builds=0;const build=(league,o)=>{builds++;assert.ok(o.providerAdapter,"private builds use the request-scoped provider");assert.equal(o.identity.principal,"local-owner");return offlineBuild(league,o);};
  const decision=await handleDecisionRequest(local(`/api/decision-support?provider=espn&league=${LEAGUE}`),{build:(l,o)=>build(l,o).then(s=>s.decision)});
  assert.equal(decision.status,200);assert.equal(decision.headers.get("cache-control"),"private, no-store");
  const d=await decision.json();assert.equal(d.visibility,"private");assert.equal(d.identity.provider,"espn");assert.equal(d.waivers.status,"unsupported");
  assert.ok(!JSON.stringify(d).includes("syn-0002"),"pending items never reach decision output");
  const trade=await handleTradeRequest(new Request(`${BASE}/api/trade`,{method:"POST",headers:{host:"127.0.0.1:3000","content-type":"application/json",[LOOPBACK_HEADER]:TOKEN},
   body:JSON.stringify({provider:"espn",league:LEAGUE,proposal:proposal(["nfl:00-9900000"],["nfl:00-9900006"])})}),{build});
  assert.equal(trade.status,422);assert.equal((await trade.json()).code,"UNSUPPORTED_FEATURE");assert.equal(builds,2);
  for(const resource of ["waivers","league-summary","player","matchup","signals"]){
   const chat=await handleChatRequest(local(`/api/chat/${resource}?provider=espn&league=${LEAGUE}`),resource);
   assert.equal(chat.status,422,resource);assert.equal((await chat.json()).code,"UNSUPPORTED_FEATURE");}
  const meta=await handleChatRequest(local(`/api/chat/model-meta?provider=espn`),"model-meta",{state:async()=>({season:"2030"})});
  const metaBody=await meta.json();assert.equal(metaBody.provider_capabilities.privateLeagueAccess.status,"unsupported","chat never sees the private provider");
  assert.equal(requestProvider(new URLSearchParams("provider=espn"),{live:false}).getProviderCapabilities().privateLeagueAccess.status,"unsupported");
  const leaked=await handleChatRequest(local(`/api/chat/waivers?league=1401373864818192384`),"waivers",{build:async()=>({visibility:"private",league:{week:3}})});
  assert.equal(leaked.status,422,"defense in depth: a private decision is never served on chat");
 });}finally{f.cleanup();}
});

test("private decisions are never captured into shared history",async()=>{
 const f=privateFolder();
 try{
  const p=provider(f.env),{loadLeague,...fixture}=decisionFixtureOptions();
  const d=await buildDecisionContext(LEAGUE,{...fixture,provider:"espn",providerAdapter:p});
  assert.equal(d.visibility,"private");
  assert.throws(()=>captureObservations(d),/never captured/);
  const dir=mkdtempSync(join(tmpdir(),"espn-capture-test-"));
  try{await assert.rejects(appendCapture(dir,d),/never captured/);}finally{rmSync(dir,{recursive:true,force:true});}
 }finally{f.cleanup();}
});

test("Sleeper routes are unchanged with private mode enabled",async()=>{
 const f=privateFolder(),options=decisionFixtureOptions(),buildSnapshot=(id,o)=>options.loadLeague(id,o);
 const request=()=>local("/api/snapshot?league=1401373864818192384&compact=0");
 const before=await handleSnapshotRequest(request(),{buildSnapshot});
 const during=await withPrivateMode(f,()=>handleSnapshotRequest(request(),{buildSnapshot}));
 try{
  assert.equal(during.status,200);assert.equal(during.headers.get("cache-control"),before.headers.get("cache-control"));
  assert.match(during.headers.get("cache-control"),/public, s-maxage=30/);
  const a=await before.json(),b=await during.json();delete a.generated_at;delete b.generated_at;assert.deepEqual(b,a);
  const decision=await withPrivateMode(f,()=>handleDecisionRequest(local("/api/decision-support?league=1401373864818192384"),{build:(l,o)=>{assert.equal(o.providerAdapter,undefined);assert.equal(o.identity.principal,undefined);return buildDecisionContext(l,{...options,...o});}}));
  assert.equal(decision.status,200);assert.match(decision.headers.get("cache-control"),/public, s-maxage=60/);
  assert.equal((await decision.json()).visibility,undefined);
 }finally{f.cleanup();}
});

test("regression: a remote client claiming localhost headers never reaches private data",async()=>{
 const env={FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:"/x.json",[TOKEN_ENV]:TOKEN};
 const forged={host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","sec-fetch-site":"same-origin"};
 assert.equal(privateRequest(new Request(`${BASE}/api/snapshot`,{headers:forged}),{env}),null,"no connection proof");
 assert.equal(privateRequest(new Request(`${BASE}/api/snapshot`,{headers:{...forged,[LOOPBACK_HEADER]:"cd".repeat(32)}}),{env}),null,"guessed proof");
 assert.equal(loopbackProofMatches(TOKEN,TOKEN),true);assert.equal(loopbackProofMatches(TOKEN.slice(1),TOKEN),false);
 // What the private dev server does per connection: forged proofs are stripped, only loopback sockets are tagged.
 const incoming=(remoteAddress,headers)=>({socket:{remoteAddress},headers:{...headers},rawHeaders:Object.entries(headers).flat()});
 const remote=incoming("203.0.113.9",{...forged,[LOOPBACK_HEADER]:TOKEN});
 assert.equal(tagLoopbackRequest(remote,TOKEN),false);
 assert.equal(remote.headers[LOOPBACK_HEADER],undefined);assert.ok(!remote.rawHeaders.map(h=>h.toLowerCase()).includes(LOOPBACK_HEADER));
 const lan=incoming("::ffff:192.168.1.20",{...forged});assert.equal(tagLoopbackRequest(lan,TOKEN),false);assert.equal(lan.headers[LOOPBACK_HEADER],undefined);
 for(const address of ["127.0.0.1","::1","::ffff:127.0.0.1"]){const r=incoming(address,{...forged,[LOOPBACK_HEADER]:"forged"});assert.equal(tagLoopbackRequest(r,TOKEN),true);assert.equal(r.headers[LOOPBACK_HEADER],TOKEN);
  assert.deepEqual(r.rawHeaders.filter((h,i)=>i%2===0&&h.toLowerCase()===LOOPBACK_HEADER),[LOOPBACK_HEADER]);}
 assert.equal(isLoopbackAddress("10.0.0.1"),false);assert.equal(isLoopbackAddress(undefined),false);
 const f=privateFolder();
 try{await withPrivateMode(f,async()=>{
  const response=await handleSnapshotRequest(new Request(`${BASE}/api/snapshot?provider=espn&league=${LEAGUE}`,{headers:forged}));
  assert.equal(response.status,422);assert.equal((await response.json()).code,"UNSUPPORTED_FEATURE");
 });}finally{f.cleanup();}
 assert.match(readFileSync(new URL("../package.json",import.meta.url),"utf8"),/"dev:private": "node scripts\/dev-private.js"/);
 const launcher=readFileSync(new URL("../scripts/dev-private.js",import.meta.url),"utf8");
 assert.match(launcher,/hostname = "127\.0\.0\.1"/);assert.match(launcher,/tagLoopbackRequest\(req/);assert.match(launcher,/newLoopbackToken\(\)/);
});

test("regression: missing available players fail closed; no replacement values are produced",async()=>{
 const bundle=structuredClone(BUNDLE);delete bundle.freeAgents;
 const f=privateFolder({bundle});
 try{
  const p=provider(f.env),s=await p.getSnapshot(LEAGUE);
  assert.deepEqual(s.coverage.available_players,{complete:false,returned:0,limit:null});assert.equal(s.capabilities.completePlayerPool,false);
  assert.ok(s.warnings.some(w=>/No available-player list was supplied/.test(w.message)));
  const {loadLeague,...fixture}=decisionFixtureOptions(),state=await buildDecisionState(LEAGUE,{...fixture,provider:"espn",providerAdapter:p});
  assert.ok(Object.values(state.levels).every(l=>l.replacement_value===null&&l.coverage==="unsupported"));
  assert.ok(Object.values(state.contexts).every(c=>c.model.replacement.value_over_replacement===null));
  assert.ok(state.decision.team_strength_v2.every(t=>Object.values(t.positions).every(x=>x.need_or_surplus===null)));
  assert.equal(state.decision.waivers.status,"unsupported");assert.equal(state.decision.coverage.available_pool_complete,false);
  const trade=await handleTradeRequest(new Request(`${BASE}/api/trade`,{method:"POST",headers:{host:"127.0.0.1:3000","content-type":"application/json",[LOOPBACK_HEADER]:TOKEN},
   body:JSON.stringify({provider:"espn",league:LEAGUE,proposal:proposal(["nfl:00-9900000"],["nfl:00-9900006"])})}),{build:async()=>state});
  assert.equal(trade.status,422);assert.equal((await trade.json()).code,"UNSUPPORTED_FEATURE");
  // Unproven completeness is incomplete for any non-Sleeper snapshot, even without an available_players record.
  const {coverage,...rest}=s,bare={...rest,coverage:{...coverage,available_players:undefined}};
  const bareState=await buildDecisionState(LEAGUE,{...fixture,provider:"espn",loadLeague:async()=>bare,providerAdapter:p});
  assert.ok(Object.values(bareState.levels).every(l=>l.replacement_value===null));
 }finally{f.cleanup();}
});

test("regression: a changed scoring configuration rescores cached facts",async()=>{
 const f=privateFolder();
 try{
  const p=provider(f.env);
  assert.equal((await p.getSnapshot(LEAGUE)).league.scoring_settings.rec,0.5);
  writeFileSync(f.configPath,JSON.stringify(CONFIG(c=>{c.scoring.offense.reception=1;})));
  assert.equal((await p.getSnapshot(LEAGUE)).league.scoring_settings.rec,1,"new reception value is applied without a bundle change");
  writeFileSync(f.configPath,JSON.stringify(CONFIG()));
  assert.equal((await p.getSnapshot(LEAGUE)).league.scoring_settings.rec,0.5);
 }finally{f.cleanup();}
});

test("regression: outside-repository checks compare path segments, not prefixes",()=>{
 const root=mkdtempSync(join(tmpdir(),"espn-root-test-"));
 try{
  for(const name of ["..private",".private","...","..x"]){mkdirSync(join(root,name));assert.equal(outsideRepository(join(root,name,"espn-private.json"),root),false,name);}
  assert.equal(outsideRepository(join(root,"sub","..","x.json"),root),false,"normalized back inside");
  assert.equal(outsideRepository(join(root,"..","sibling","x.json"),root),true,"true parent directory");
  assert.equal(outsideRepository(root,root),false);
  const f=privateFolder({config:CONFIG(c=>{c.facts_source.path="..private/bundle.json";})});
  try{mkdirSync(join(f.dir,"..private"));assert.throws(()=>loadPrivateConfig({env:f.env,root:f.dir}),refused("PRIVATE_CONFIG_INVALID"));}finally{f.cleanup();}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("private decision responses are private, no-store in every outcome, through the production decision cache",async()=>{
 const f=privateFolder();
 try{await withPrivateMode(f,async()=>{
  let builds=0;const service=createDecisionService(async(league,o)=>{builds++;return offlineBuild(league,o);});
  const build=(league,o)=>service(league,o).then(state=>state.decision);
  for(const path of [`/api/decision-support?provider=espn&league=${LEAGUE}`,`/api/decision-support?provider=espn&league=${LEAGUE}`]){
   const r=await handleDecisionRequest(local(path),{build});assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"private, no-store");}
  assert.equal(builds,1,"the shared cache serves the second private request");
  for(const [path,status] of [[`/api/decision-support?provider=espn`,400],[`/api/decision-support?provider=espn&league=${LEAGUE}&week=abc`,400],
   [`/api/decision-support?provider=espn&league=${LEAGUE}&user=123456`,400],[`/api/decision-support?provider=espn&league=${LEAGUE}&week=9`,409],[`/api/decision-support?provider=espn&league=999999`,422]]){
   const r=await handleDecisionRequest(local(path),{build});assert.equal(r.status,status,path);assert.equal(r.headers.get("cache-control"),"private, no-store",path);}
  const large=await handleDecisionRequest(local(`/api/decision-support?provider=espn&league=${LEAGUE}`,{"accept-encoding":"gzip"}),{build});
  assert.equal(large.headers.get("cache-control"),"private, no-store","compressed responses too");
  const tradeError=await handleTradeRequest(new Request(`${BASE}/api/trade`,{method:"POST",headers:{host:"127.0.0.1:3000","content-type":"application/json",[LOOPBACK_HEADER]:TOKEN},body:JSON.stringify({provider:"espn",proposal:{}})}),{build:service});
  assert.equal(tradeError.status,400);assert.equal(tradeError.headers.get("cache-control"),"private, no-store");
  // The same league id through the public Sleeper path is a different cache entry (provider and principal in the key).
  const before=builds;await service(LEAGUE,{provider:"sleeper",identity:{userId:null,rosterId:null,season:null}}).catch(()=>null);assert.equal(builds,before+1);
 });}finally{f.cleanup();}
});
