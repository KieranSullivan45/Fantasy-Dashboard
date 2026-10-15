// ESPN-LIVE-01 (ADR 0013): live Flaim transport for local private ESPN mode, against an in-process SYNTHETIC Flaim double.
// No network: every request goes to an injected fetcher. Tokens below are fake test strings, never real credentials.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,rmSync,statSync,symlinkSync,readdirSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {FLAIM_MCP_URL,FLAIM_ORIGIN,pkcePair,stateMatches,loopbackRedirect,discoverFlaim,registerClient,exchangeCode,refreshTokens,authorizationUrl,tokenFields} from "../lib/providers/flaim/oauth.js";
import {readFlaimAuth,writeFlaimAuth} from "../lib/providers/flaim/auth-store.js";
import {createFlaimMcpClient,parseMcpBody,FLAIM_READ_TOOLS} from "../lib/providers/flaim/mcp-client.js";
import {loadFlaimLiveFacts,FREE_AGENT_POSITIONS} from "../lib/providers/flaim/live-source.js";
import {createPrivateEspnProvider,LIVE_TTL_MS,LIVE_MANUAL_COOLDOWN_MS} from "../lib/providers/flaim/private-source.js";
import {validatePrivateConfig} from "../lib/private/config.js";
import {LOOPBACK_HEADER,TOKEN_ENV} from "../lib/private/loopback.js";
import {setPrivateEspnProviderFactory} from "../lib/providers/index.js";
import {handleSnapshotRequest} from "../lib/snapshot-api.js";
import {handleRefreshRequest} from "../lib/refresh-api.js";
import {handleChatRequest} from "../lib/chat-api.js";
import {handlePrivateLeagueRequest} from "../lib/private-league-api.js";

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const BUNDLE=read("./fixtures/flaim-espn/synthetic-league.json"),SCORING=read("./fixtures/espn-scoring/synthetic-authorized-scoring.json");
const LEAGUE="424242",SEASON=2030,TOKEN="ab".repeat(32),BASE="http://127.0.0.1:3000";
const ACCESS="test-access-AAAA",REFRESH="test-refresh-RRRR";
const code=c=>e=>e.code===c;

/** Synthetic Flaim: OAuth endpoints + MCP over SSE. Records every request URL; `opts` injects failures. */
function fakeFlaim(opts={}){
 const state={urls:[],calls:[],access:new Set([opts.access??ACCESS]),refresh:new Set([REFRESH]),issued:0,methods:[],tokenBodies:[]};
 const bundle=structuredClone(opts.bundle??BUNDLE);
 const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
 const sse=(id,result)=>new Response(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0",id,result})}\n\n`,{status:200,headers:{"content-type":"text/event-stream"}});
 const tool=(name,args)=>{
  if(opts.fail?.[name])return opts.fail[name]==="isError"?{isError:true,content:[{type:"text",text:"boom"}]}:null;
  const envelope=v=>({content:[{type:"text",text:JSON.stringify(v)}]});
  if(name==="get_user_session")return envelope(bundle.session);
  if(name==="get_league_info")return envelope(bundle.leagueInfo);
  if(name==="get_roster"){const r=bundle.rosters.find(r=>String(r.data.teamId)===args.team_id);return envelope(opts.rosterFor?opts.rosterFor(args.team_id,r):r);}
  if(name==="get_standings")return envelope(bundle.standings);
  if(name==="get_matchups")return envelope(bundle.matchups);
  if(name==="get_free_agents")return envelope({success:true,data:{...bundle.freeAgents.data,position:args.position,freeAgents:args.position==="QB"?bundle.freeAgents.data.freeAgents:[]}});
  if(name==="get_transactions")return envelope(bundle.transactions);
  return {isError:true,content:[]};
 };
 const fetcher=async(url,init={})=>{
  state.urls.push(String(url));
  const u=new URL(url);
  if(u.origin!==FLAIM_ORIGIN)throw new Error("non-Flaim request");
  if(u.pathname==="/.well-known/oauth-authorization-server")return json(opts.metadata??{issuer:FLAIM_ORIGIN,authorization_endpoint:`${FLAIM_ORIGIN}/auth/authorize`,token_endpoint:`${FLAIM_ORIGIN}/auth/token`,registration_endpoint:`${FLAIM_ORIGIN}/auth/register`,revocation_endpoint:`${FLAIM_ORIGIN}/auth/revoke`,code_challenge_methods_supported:["S256"],scopes_supported:["mcp:read","mcp:write"]});
  if(u.pathname==="/auth/register"){const body=JSON.parse(init.body);state.registration=body;return json({client_id:"test-client",redirect_uris:body.redirect_uris,token_endpoint_auth_method:"none",...(opts.secret?{client_secret:"s"}:{})},201);}
  if(u.pathname==="/auth/token"){
   const p=new URLSearchParams(init.body);state.tokenBodies.push(Object.fromEntries(p));
   if(opts.tokenStatus)return json({error:"server_error"},opts.tokenStatus);
   if(opts.malformedToken)return json({token_type:"Bearer"});
   const issue=()=>{const n=++state.issued,access=`test-access-${n}`,refresh=`test-refresh-${n}`;state.access.add(access);state.refresh.add(refresh);return json({access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:refresh});};
   if(p.get("grant_type")==="authorization_code")return p.get("code")==="test-code"&&p.get("code_verifier")?issue():json({error:"invalid_grant"},400);
   if(p.get("grant_type")==="refresh_token"){if(!state.refresh.has(p.get("refresh_token")))return json({error:"invalid_grant"},400);state.refresh.delete(p.get("refresh_token"));return issue();}
   return json({error:"unsupported_grant_type"},400);
  }
  if(u.toString()===FLAIM_MCP_URL){
   if(opts.mcpStatus)return json({},opts.mcpStatus);
   const bearer=(init.headers?.authorization||"").replace(/^Bearer /,"");
   if(!state.access.has(bearer))return json({error:"invalid_token"},401,{"www-authenticate":"Bearer"});
   const m=JSON.parse(init.body);state.methods.push(m.method);
   if(!("id" in m))return new Response(null,{status:202});
   if(m.method==="initialize")return sse(m.id,{protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"flaim-double"}});
   if(m.method==="tools/call"){state.calls.push(m.params);if(opts.rpcError?.[m.params.name])return new Response(JSON.stringify({jsonrpc:"2.0",id:m.id,error:{code:-32000,message:`secret ${bearer}`}}),{headers:{"content-type":"application/json"}});const r=tool(m.params.name,m.params.arguments);if(!r)throw new Error("network down");return sse(m.id,r);}
   return sse(m.id,{});
  }
  return json({},404);
 };
 return {fetcher,state};
}
function authFolder(auth={}){
 const dir=mkdtempSync(join(tmpdir(),"flaim-live-test-")),authPath=join(dir,"flaim-auth.json");
 writeFlaimAuth(authPath,{client_id:"test-client",token_endpoint:`${FLAIM_ORIGIN}/auth/token`,access_token:ACCESS,refresh_token:REFRESH,access_expires_at:new Date(Date.now()+3600e3).toISOString(),scope:"mcp:read",...auth});
 return {dir,authPath,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test("PKCE S256 pair and state are random, well-formed, and compared in constant time",()=>{
 const a=pkcePair(),b=pkcePair();
 assert.match(a.verifier,/^[A-Za-z0-9_-]{43}$/);assert.match(a.state,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(a.challenge,createHash("sha256").update(a.verifier).digest("base64url"));
 assert.notEqual(a.verifier,b.verifier);assert.notEqual(a.state,b.state);
 assert.equal(stateMatches(a.state,a.state),true);assert.equal(stateMatches(b.state,a.state),false);assert.equal(stateMatches(null,a.state),false);assert.equal(stateMatches("",""),false);
 assert.equal(loopbackRedirect("http://127.0.0.1:7778/oauth/callback"),true);
 for(const bad of ["http://localhost:7778/oauth/callback","https://127.0.0.1:7778/oauth/callback","http://127.0.0.1:7778/other","http://10.0.0.1:7778/oauth/callback","http://127.0.0.1:7778/oauth/callback?x=1"])assert.equal(loopbackRedirect(bad),false,bad);
});

test("discovery, public-client registration, authorization URL and code exchange follow Flaim's contract without a secret",async()=>{
 const {fetcher,state}=fakeFlaim(),meta=await discoverFlaim({fetcher});
 assert.equal(meta.scope,"mcp:read");
 const redirectUri="http://127.0.0.1:51234/oauth/callback",{client_id}=await registerClient(meta,redirectUri,{fetcher});
 assert.equal(state.registration.token_endpoint_auth_method,"none");assert.deepEqual(state.registration.redirect_uris,[redirectUri]);
 const pair=pkcePair(),url=new URL(authorizationUrl(meta,{clientId:client_id,redirectUri,challenge:pair.challenge,state:pair.state}));
 assert.deepEqual(["response_type","code_challenge_method","resource","state"].map(k=>url.searchParams.get(k)),["code","S256",FLAIM_MCP_URL,pair.state]);
 const tokens=await exchangeCode(meta,{clientId:client_id,code:"test-code",redirectUri,verifier:pair.verifier},{fetcher,now:()=>0});
 assert.equal(tokens.access_expires_at,new Date(3600e3).toISOString());
 assert.equal(state.tokenBodies[0].code_verifier,pair.verifier);assert.equal("client_secret" in state.tokenBodies[0],false);
 // Refusals: off-origin endpoints, no S256, a client secret, a non-loopback redirect.
 await assert.rejects(discoverFlaim({fetcher:fakeFlaim({metadata:{authorization_endpoint:"https://evil.example/a",token_endpoint:`${FLAIM_ORIGIN}/t`,registration_endpoint:`${FLAIM_ORIGIN}/r`,code_challenge_methods_supported:["S256"]}}).fetcher}),code("AUTH_FAILED"));
 await assert.rejects(discoverFlaim({fetcher:fakeFlaim({metadata:{authorization_endpoint:`${FLAIM_ORIGIN}/a`,token_endpoint:`${FLAIM_ORIGIN}/t`,registration_endpoint:`${FLAIM_ORIGIN}/r`,code_challenge_methods_supported:["plain"]}}).fetcher}),code("AUTH_FAILED"));
 await assert.rejects(registerClient(meta,redirectUri,{fetcher:fakeFlaim({secret:true}).fetcher}),code("AUTH_FAILED"));
 await assert.rejects(registerClient(meta,"http://localhost:1/oauth/callback",{fetcher}),code("AUTH_FAILED"));
});

test("malformed and rejected token responses are normalized without echoing tokens or codes",async()=>{
 const meta={token_endpoint:`${FLAIM_ORIGIN}/auth/token`};
 await assert.rejects(exchangeCode(meta,{clientId:"c",code:"test-code",redirectUri:"x",verifier:"v"},{fetcher:fakeFlaim({malformedToken:true}).fetcher}),e=>e.code==="AUTH_FAILED"&&!/test-code/.test(e.message));
 await assert.rejects(refreshTokens(meta,{clientId:"c",refreshToken:"test-refresh-unknown"},{fetcher:fakeFlaim().fetcher}),e=>e.code==="AUTH_REQUIRED"&&!/test-refresh/.test(e.message)&&/flaim:connect/.test(e.message));
 await assert.rejects(refreshTokens(meta,{clientId:"c",refreshToken:REFRESH},{fetcher:fakeFlaim({tokenStatus:503}).fetcher}),code("PROVIDER_UNAVAILABLE"));
 await assert.rejects(refreshTokens(meta,{clientId:"c",refreshToken:REFRESH},{fetcher:fakeFlaim({tokenStatus:429}).fetcher}),code("RATE_LIMITED"));
 assert.throws(()=>tokenFields({access_token:"a",token_type:"mac",refresh_token:"r"}),code("AUTH_FAILED"));
 assert.equal(tokenFields({access_token:"a"},{previousRefresh:"r",now:0}).refresh_token,"r","a refresh without rotation keeps the previous refresh token");
});

test("auth file: absolute, outside the repository, no links, owner-only, atomic; missing means reconnect",()=>{
 const f=authFolder();
 try{
  const saved=readFlaimAuth(f.authPath);assert.equal(saved.refresh_token,REFRESH);
  if(process.platform!=="win32")assert.equal(statSync(f.authPath).mode&0o777,0o600);
  assert.deepEqual(readdirSync(f.dir),["flaim-auth.json"],"no temp file is left behind");
  assert.throws(()=>readFlaimAuth("relative/flaim-auth.json"),code("PRIVATE_CONFIG_INVALID"));
  assert.throws(()=>writeFlaimAuth(join(process.cwd(),"flaim-auth.json"),saved),code("PRIVATE_CONFIG_INVALID"));
  assert.equal(existsSync(join(process.cwd(),"flaim-auth.json")),false);
  assert.throws(()=>readFlaimAuth(join(f.dir,"missing.json")),code("AUTH_REQUIRED"));
  if(process.platform!=="win32"){const link=join(f.dir,"link.json");symlinkSync(f.authPath,link);assert.throws(()=>readFlaimAuth(link),code("PRIVATE_CONFIG_INVALID"));assert.throws(()=>writeFlaimAuth(link,saved),code("PRIVATE_CONFIG_INVALID"));}
  writeFileSync(f.authPath,JSON.stringify({...saved,token_endpoint:"https://evil.example/token"}));
  assert.throws(()=>readFlaimAuth(f.authPath),e=>e.code==="PRIVATE_CONFIG_INVALID"&&!e.message.includes(ACCESS)&&!e.message.includes(f.dir));
 }finally{f.cleanup();}
});

test("MCP client: initialize then notify, SSE results, expiry refresh with rotation persisted before use, 401 retried once",async()=>{
 const f=authFolder({access_expires_at:new Date(Date.now()-1000).toISOString()}),{fetcher,state}=fakeFlaim();
 try{
  const client=createFlaimMcpClient({authPath:f.authPath,fetcher});
  const session=await client.callTool("get_user_session",{});
  assert.equal(session.success,true);
  assert.deepEqual(state.methods.slice(0,3),["initialize","notifications/initialized","tools/call"]);
  const rotated=readFlaimAuth(f.authPath);
  assert.equal(rotated.refresh_token,"test-refresh-1");assert.equal(rotated.access_token,"test-access-1");assert.equal(state.refresh.has(REFRESH),false,"the old refresh token was consumed");
  // Flaim revokes the current access token: one refresh + retry, then success with the next rotation persisted.
  state.access.delete("test-access-1");
  await client.callTool("get_league_info",{});
  assert.equal(readFlaimAuth(f.authPath).refresh_token,"test-refresh-2");
  // A token that keeps failing after refresh asks for reconnect, once.
  state.access.clear();const before=state.issued;
  const fresh=createFlaimMcpClient({authPath:f.authPath,fetcher:async(url,init)=>String(url)===FLAIM_MCP_URL?new Response("{}",{status:401}):fetcher(url,init)});
  await assert.rejects(fresh.callTool("get_user_session"),e=>e.code==="AUTH_REQUIRED"&&!/test-access|test-refresh/.test(e.message));
  assert.equal(state.issued-before,1,"exactly one refresh attempt");
 }finally{f.cleanup();}
});

test("MCP client: only allowed read-only tools; tool, JSON-RPC, rate-limit and transport errors are normalized",async()=>{
 const f=authFolder();
 try{
  const {fetcher,state}=fakeFlaim();const client=createFlaimMcpClient({authPath:f.authPath,fetcher});
  for(const name of ["refresh_leagues","get_ancient_history","anything"])await assert.rejects(client.callTool(name),code("UNSUPPORTED_FEATURE"));
  assert.equal(state.urls.length,0,"a refused tool makes no request");
  assert.equal(FLAIM_READ_TOOLS.includes("refresh_leagues"),false);
  const errs=fakeFlaim({fail:{get_standings:"isError"},rpcError:{get_matchups:true}});const c2=createFlaimMcpClient({authPath:f.authPath,fetcher:errs.fetcher});
  await assert.rejects(c2.callTool("get_standings"),code("PROVIDER_UNAVAILABLE"));
  await assert.rejects(c2.callTool("get_matchups"),e=>e.code==="PROVIDER_UNAVAILABLE"&&!e.message.includes(ACCESS));
  await assert.rejects(createFlaimMcpClient({authPath:f.authPath,fetcher:fakeFlaim({mcpStatus:429}).fetcher}).callTool("get_user_session"),code("RATE_LIMITED"));
  await assert.rejects(createFlaimMcpClient({authPath:f.authPath,fetcher:async()=>{throw new Error(`ECONNRESET ${ACCESS}`);}}).callTool("get_user_session"),e=>e.code==="PROVIDER_UNAVAILABLE"&&!e.message.includes(ACCESS));
  assert.deepEqual(parseMcpBody('event: message\ndata: {"jsonrpc":"2.0",\ndata: "id":3,"result":{"a":1}}\n\n',"text/event-stream",3).result,{a:1});
  assert.equal(parseMcpBody('{"jsonrpc":"2.0","id":4,"result":{}}',"application/json",5),null);
 }finally{f.cleanup();}
});

const liveClient=opts=>{const f=authFolder(),fl=fakeFlaim(opts);return {...fl,f,client:createFlaimMcpClient({authPath:f.authPath,fetcher:fl.fetcher})};};
test("live assembly: exact league/season, authenticated team, every roster, optional resources, incomplete pool",async()=>{
 const {client,state,f}=liveClient();
 try{
  const {facts,digest,fetchedAt}=await loadFlaimLiveFacts(client,{leagueId:LEAGUE,season:SEASON,teamId:1,now:()=>Date.parse("2030-09-26T12:00:00Z")});
  assert.equal(facts.provenance.access,"flaim_live");assert.equal(facts.provenance.private_live,true);assert.equal(facts.provenance.fetched_at,fetchedAt);
  assert.equal(facts.user_team_id,1);assert.equal(facts.teams.length,2);assert.equal(facts.available.complete,false);assert.equal(facts.scoring.available,false);
  assert.ok(facts.matchups.length>0);assert.ok(facts.transactions);assert.match(digest,/^[0-9a-f]{64}$/);
  const rosterCalls=state.calls.filter(c=>c.name==="get_roster").map(c=>c.arguments.team_id).sort();assert.deepEqual(rosterCalls,["1","2"]);
  assert.deepEqual(state.calls.filter(c=>c.name==="get_free_agents").map(c=>c.arguments.position),FREE_AGENT_POSITIONS);
  for(const c of state.calls)assert.equal(c.arguments.league_id??LEAGUE,LEAGUE);
 }finally{f.cleanup();}
 // Optional failures leave the core league loaded with explicit warnings.
 const opt=liveClient({fail:{get_standings:"isError",get_transactions:"down",get_free_agents:"isError"}});
 try{const {facts}=await loadFlaimLiveFacts(opt.client,{leagueId:LEAGUE,season:SEASON});
  assert.equal(facts.teams.length,2);assert.equal(facts.transactions,null);assert.equal(facts.available,null);
  assert.equal(facts.warnings.filter(w=>w.code==="PROVIDER_UNAVAILABLE").length,3);}finally{opt.f.cleanup();}
});

test("live assembly fails closed on absent league, season mismatch, missing or contradictory core data and team mismatch",async()=>{
 const cases=[
  [{},{leagueId:"999999",season:SEASON},"LEAGUE_NOT_FOUND"],
  [{},{leagueId:LEAGUE,season:2031},"LEAGUE_NOT_FOUND"],
  [{fail:{get_roster:"isError"}},{leagueId:LEAGUE,season:SEASON},"PROVIDER_UNAVAILABLE"],
  [{rosterFor:(id,r)=>id==="2"?{success:true,data:{...r.data,teamId:1}}:r},{leagueId:LEAGUE,season:SEASON},"MAPPING_INCOMPLETE"],
  [{bundle:(()=>{const b=structuredClone(BUNDLE);b.freeAgents.data.freeAgents[0].playerId=b.rosters[0].data.roster[0].playerId;b.freeAgents.data.freeAgents[0].id=String(b.rosters[0].data.roster[0].playerId);return b;})()},{leagueId:LEAGUE,season:SEASON},"MAPPING_INCOMPLETE"],
  [{},{leagueId:LEAGUE,season:SEASON,teamId:2},"PRIVATE_CONFIG_INVALID"],
  [{bundle:(()=>{const b=structuredClone(BUNDLE);b.leagueInfo.data.seasonId=2031;return b;})()},{leagueId:LEAGUE,season:SEASON},"LEAGUE_NOT_FOUND"],
 ];
 for(const [opts,args,expected] of cases){const {client,f}=liveClient(opts);try{await assert.rejects(loadFlaimLiveFacts(client,args),code(expected),expected);}finally{f.cleanup();}}
 // No authenticated team in the session: spectator (never inferred from names or rosters).
 const b=structuredClone(BUNDLE);b.session.data.allLeagues[0].teamId=null;const {client,f}=liveClient({bundle:b});
 try{const {facts}=await loadFlaimLiveFacts(client,{leagueId:LEAGUE,season:SEASON});assert.equal(facts.user_team_id,null);}finally{f.cleanup();}
});

/** A private folder with a flaim_live config (+ auth file) and the provider factory wired to the Flaim double. */
function livePrivate({scoring=true,opts={},clock}={}){
 const f=authFolder(),configPath=join(f.dir,"espn-private.json"),fl=fakeFlaim(opts);
 const config={schema_version:"espn-private-1",provider:"espn",league_id:LEAGUE,season:SEASON,team_id:1,facts_source:{kind:"flaim_live",auth_path:"flaim-auth.json"},...(scoring?{scoring:structuredClone(SCORING)}:{})};
 writeFileSync(configPath,JSON.stringify(config));
 const env={FANTASY_PRIVATE_MODE:"local",ESPN_PRIVATE_CONFIG:configPath,[TOKEN_ENV]:TOKEN};
 const make=()=>createPrivateEspnProvider({env,loadIds:async()=>({data:[]}),createClient:authPath=>createFlaimMcpClient({authPath,fetcher:fl.fetcher}),...(clock?{now:clock}:{})});
 return {...f,...fl,configPath,env,config,make};
}
async function withPrivate(p,fn){
 const saved={mode:process.env.FANTASY_PRIVATE_MODE,config:process.env.ESPN_PRIVATE_CONFIG,vercel:process.env.VERCEL,token:process.env[TOKEN_ENV]};
 Object.assign(process.env,p.env);delete process.env.VERCEL;const provider=p.make();setPrivateEspnProviderFactory(()=>provider);
 try{return await fn(provider);}finally{
  for(const [key,value] of [["FANTASY_PRIVATE_MODE",saved.mode],["ESPN_PRIVATE_CONFIG",saved.config],["VERCEL",saved.vercel],[TOKEN_ENV,saved.token]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  setPrivateEspnProviderFactory();}
}
const local=(path,init={})=>new Request(`${BASE}${path}`,{...init,headers:{host:"127.0.0.1:3000","accept-encoding":"identity",[LOOPBACK_HEADER]:TOKEN,...init.headers}});
const remote=(path,init={})=>new Request(`${BASE}${path}`,{...init,headers:{host:"127.0.0.1:3000",...init.headers}});

test("private config: flaim_live needs only an auth_path outside the repository; existing sources stay valid",()=>{
 const p=livePrivate();
 try{
  const c=validatePrivateConfig(p.config,{configPath:p.configPath});
  assert.deepEqual([c.facts_kind,c.auth_path,c.facts_path],["flaim_live",p.authPath,null]);
  assert.equal(validatePrivateConfig({...p.config,scoring:undefined},{configPath:p.configPath}).scoring,null,"scoring stays optional (unavailable) for live Flaim");
  for(const source of [{kind:"flaim_live"},{kind:"flaim_live",auth_path:"x.json",path:"y.json"},{kind:"flaim_live",auth_path:join(process.cwd(),"flaim-auth.json")}])
   assert.throws(()=>validatePrivateConfig({...p.config,facts_source:source},{configPath:p.configPath}),code("PRIVATE_CONFIG_INVALID"));
  assert.equal(validatePrivateConfig({...p.config,facts_source:{kind:"flaim_bundle_file",path:"b.json"}},{configPath:p.configPath}).facts_kind,"flaim_bundle_file");
  assert.equal(validatePrivateConfig({...p.config,facts_source:{kind:"espn_league_file",path:"l.json"}},{configPath:p.configPath}).facts_kind,"espn_league_file");
 }finally{p.cleanup();}
});

test("private live snapshot: Flaim facts + authorized scoring, exact team, private no-store, bounded cache, no token leakage",async()=>{
 let t=Date.parse("2030-09-26T12:00:00Z");const p=livePrivate({clock:()=>t});
 try{await withPrivate(p,async()=>{
  const res=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}&compact=0`));
  assert.equal(res.status,200);assert.equal(res.headers.get("cache-control"),"private, no-store");
  const text=await res.text(),snap=JSON.parse(text);
  assert.equal(snap.coverage.access,"flaim_live");assert.equal(snap.coverage.scoring_available,true);assert.equal(snap.coverage.scoring_source,"user_authorized");
  assert.equal(snap.coverage.fetched_at,new Date(t).toISOString());assert.equal(snap.identity.mode,"account");assert.equal(snap.my_roster.roster_id,1);
  assert.equal(snap.coverage.available_players.complete,false);
  for(const secret of [ACCESS,REFRESH,"test-client",p.authPath])assert.equal(text.includes(secret),false);
  const calls=p.state.calls.length;
  await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}`));assert.equal(p.state.calls.length,calls,"within the TTL the facts are reused");
  t+=LIVE_TTL_MS+1;await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}`));assert.ok(p.state.calls.length>calls,"after the TTL Flaim is asked again");
  // Every request went to Flaim's MCP endpoint (zero ESPN or other hosts).
  assert.ok(p.state.urls.length>0);for(const url of p.state.urls)assert.equal(url,FLAIM_MCP_URL);
 });}finally{p.cleanup();}
});

test("private refresh reloads through Flaim after the cooldown; public requests, chat and discovery stay closed",async()=>{
 let t=Date.parse("2030-09-26T12:00:00Z");const p=livePrivate({clock:()=>t});
 try{await withPrivate(p,async()=>{
  const post=(req,body)=>handleRefreshRequest(req("/api/refresh",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
  let res=await post(local,{provider:"espn",league:LEAGUE});
  assert.equal(res.status,200);assert.equal(res.headers.get("cache-control"),"private, no-store");
  let body=await res.json();assert.equal(body.schema_version,"refresh-1");assert.equal(body.snapshot.league.league_id,LEAGUE);
  const loads=()=>p.state.calls.filter(c=>c.name==="get_user_session").length,first=loads();
  await post(local,{provider:"espn",league:LEAGUE});assert.equal(loads(),first,"a second manual refresh inside the cooldown does not hit Flaim");
  t+=LIVE_MANUAL_COOLDOWN_MS+1;await post(local,{provider:"espn",league:LEAGUE,mode:"manual"});assert.equal(loads(),first+1);
  res=await post(local,{provider:"espn",league:LEAGUE,user:"someone"});assert.equal(res.status,400);
  // Without the loopback proof: public behavior, private provider unused.
  const before=p.state.urls.length;
  res=await post(remote,{provider:"espn",league:LEAGUE});assert.equal(res.status,422);assert.equal((await res.json()).code,"UNSUPPORTED_FEATURE");
  res=await handleSnapshotRequest(remote(`/api/snapshot?provider=espn&league=${LEAGUE}`));assert.equal((await res.json()).code,"UNSUPPORTED_FEATURE");
  res=await handleChatRequest(local(`/api/chat/league-summary?provider=espn&league=${LEAGUE}`),"league-summary");assert.notEqual(res.status,200);
  assert.equal(p.state.urls.length,before,"public and chat paths never reached Flaim");
  // League discovery for the dashboard: only on the guarded loopback path, with no facts, paths or tokens.
  assert.deepEqual(await handlePrivateLeagueRequest(remote("/api/private-league")).json(),{schema_version:"private-league-1",available:false});
  const found=handlePrivateLeagueRequest(local("/api/private-league"));assert.equal(found.headers.get("cache-control"),"private, no-store");
  const text=await found.text();assert.deepEqual(JSON.parse(text),{schema_version:"private-league-1",available:true,provider:"espn",league_id:LEAGUE,season:SEASON,source:"live_flaim"});
  for(const secret of [ACCESS,REFRESH,p.authPath,p.configPath])assert.equal(text.includes(secret),false);
 });}finally{p.cleanup();}
 // Vercel never activates private mode.
 const v=livePrivate();try{await withPrivate(v,async()=>{process.env.VERCEL="1";assert.equal((await handlePrivateLeagueRequest(local("/api/private-league")).json()).available,false);
  assert.equal((await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}`))).status,422);assert.equal(v.state.urls.length,0);});}finally{v.cleanup();}
});

test("an invalid stored authorization surfaces a reconnect error without exposing token material",async()=>{
 const p=livePrivate();
 try{p.state.access.clear();p.state.refresh.clear();await withPrivate(p,async()=>{
  const res=await handleSnapshotRequest(local(`/api/snapshot?provider=espn&league=${LEAGUE}`)),text=await res.text();
  assert.equal(res.headers.get("cache-control"),"private, no-store");assert.equal(JSON.parse(text).code,"AUTH_REQUIRED");assert.match(text,/flaim:connect/);
  for(const secret of [ACCESS,REFRESH,p.authPath])assert.equal(text.includes(secret),false);
 });}finally{p.cleanup();}
});

test("the live transport source contacts Flaim only (no ESPN hosts or credentials anywhere in it)",()=>{
 for(const file of ["oauth.js","auth-store.js","mcp-client.js","live-source.js","private-source.js"]){
  const src=readFileSync(new URL(`../lib/providers/flaim/${file}`,import.meta.url),"utf8");
  assert.doesNotMatch(src,/espn\.com|espncdn|fantasy\.espn|lm-api|espn_s2|SWID/i,file);
  for(const url of src.match(/https?:\/\/[^\s"'`)]+/g)||[])assert.ok(url.startsWith("https://api.flaim.app")||url.startsWith("http://127.0.0.1"),`${file}: ${url}`);
 }
 const cli=readFileSync(new URL("../scripts/flaim-connect.js",import.meta.url),"utf8");
 assert.doesNotMatch(cli,/espn\.com|espn_s2|SWID/i);assert.doesNotMatch(cli,/console\.log|say\([^)]*(access_token|refresh_token|result\.code|auth_path)/);
});

test("dashboard loaders address private ESPN by provider (never user=) and keep Sleeper requests unchanged",async()=>{
 const {createSnapshotLoader,selectionKey}=await import("../lib/snapshot-loader.js");
 const {createDecisionLoader}=await import("../lib/decision-loader.js");
 const {tradeRequestBody}=await import("../lib/trade-loader.js");
 const urls=[],fetcher=async(url,init={})=>{urls.push([String(url),init.body??null]);return new Response(JSON.stringify({error:"x"}),{status:500});};
 const loader=createSnapshotLoader(()=>{},fetcher);
 await loader.load(LEAGUE,{provider:"espn",userId:null,season:SEASON,rosterId:null});
 await loader.load("123456",{userId:null,season:SEASON});
 await loader.refresh(LEAGUE,{provider:"espn",userId:null,season:SEASON});
 const q=new URL(urls[0][0],BASE).searchParams;assert.equal(q.get("provider"),"espn");assert.equal(q.has("user"),false);
 assert.equal(new URL(urls[1][0],BASE).searchParams.get("user"),"spectator");
 assert.deepEqual(JSON.parse(urls[2][1]),{league:LEAGUE,provider:"espn",season:String(SEASON),mode:"manual"});
 assert.notEqual(selectionKey(LEAGUE,{provider:"espn"}),selectionKey(LEAGUE,{}));
 assert.equal(selectionKey("1",{userId:"u"}),JSON.stringify(["1","u",null,null]),"Sleeper selection keys are unchanged");
 const snapshot={league:{league_id:LEAGUE,season:SEASON,scoring_settings:{}},matchup_week:3,identity:{provider:"espn",provider_user_id:null,mode:"account"},my_roster:{roster_id:1},rosters:[]};
 await createDecisionLoader(()=>{},fetcher).load(snapshot);
 const d=new URL(urls[3][0],BASE).searchParams;assert.equal(d.get("provider"),"espn");assert.equal(d.has("user"),false);
 const body=tradeRequestBody(snapshot,[]);assert.equal(body.provider,"espn");assert.equal("user" in body,false);
});
