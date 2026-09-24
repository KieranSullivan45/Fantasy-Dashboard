import test from "node:test";
import assert from "node:assert/strict";
import {SleeperProvider} from "../lib/providers/sleeper.js";
import {ESPNProvider} from "../lib/providers/espn.js";
import {providerKey} from "../lib/providers/contracts.js";
import {normalizeEspn,translateEspnScoring,playerReference} from "../lib/providers/espn-normalize.js";
import {buildLeagueSnapshot} from "../lib/sleeper.js";
import {fixtureFetch} from "./fixtures.js";
import {scoreStats} from "../lib/normalize/scoring.js";
import {optimizeLineup} from "../lib/decision/optimizer.js";
import {createDecisionService} from "../lib/decision-service.js";
import {handleSnapshotRequest} from "../lib/snapshot-api.js";
import {handleDecisionRequest} from "../lib/decision-api.js";
import {handleChatRequest} from "../lib/chat-api.js";
import {buildDecisionContext} from "../lib/decision/build-context.js";
import {decisionFixtureOptions} from "./decision-fixtures.js";
import {providerHttpError,DisabledCredentialProvider} from "../lib/providers/auth.js";
import {captureObservations} from "../lib/history/contracts.js";
import {espnFixture} from "./provider-fixtures.js";
test('Sleeper provider wrapper preserves complete snapshot shape and values',async()=>{
 const options={fetchData:fixtureFetch()},snapshot=(id,o)=>buildLeagueSnapshot(id,{...options,...o});
 for(const id of ['1401373864818192384','1395493939665989632']){const legacy=await snapshot(id),next=await new SleeperProvider({snapshot}).getSnapshot(id);delete legacy.generated_at;delete next.generated_at;assert.deepEqual(next,legacy);}
});
test('provider and season cache scopes cannot collide',async()=>{
 assert.notEqual(providerKey({provider:'espn',leagueId:'12345',season:2027}),providerKey({provider:'sleeper',leagueId:'12345',season:2027}));
 let calls=0;const service=createDecisionService(async(id,o)=>({provider:o.provider,count:++calls}));assert.notDeepEqual(await service('12345',{provider:'sleeper'}),await service('12345',{provider:'espn'}));assert.equal(calls,2);
});
test('ESPN slots preserve OP, bench, IR, multi-position eligibility and safe spectator selection',()=>{
 const raw=espnFixture(),s=normalizeEspn(raw);assert.equal(s.identity.mode,'spectator');assert.equal(s.my_roster,null);assert.ok(s.league.roster_positions.includes('SUPER_FLEX'));assert.equal(s.rosters[0].bench.length,1);assert.equal(s.rosters[0].reserve.length,1);assert.deepEqual(s.rosters[0].bench[0].fantasy_positions,['WR','DB']);assert.equal(normalizeEspn(raw,{rosterId:1}).my_roster.roster_id,1);
 const lineup=optimizeLineup(s.rosters[0].all_players,['QB','SUPER_FLEX'],{'unresolved:espn:101':20,'unresolved:espn:102':15});assert.equal(new Set(lineup.filter(x=>x.player_id).map(x=>x.player_id)).size,2);
});
test('ESPN scoring translates supported coefficients, preserves negative scoring, flags unknown/TEP/bonus rules',()=>{
 for(const rec of [0,.5,1]){const rules=translateEspnScoring([{statId:53,points:rec}]).rules;assert.equal(scoreStats({receptions:4},rules,'WR').points,rec*4);}
 const s=translateEspnScoring([...espnFixture().settings.scoringSettings.scoringItems,{statId:999,points:3},{statId:17,points:2},{statId:41,points:1,pointsOverrides:{4:1.5}}]);assert.equal(s.rules.pass_int,-2);assert.equal(s.unsupported.length,3);assert.equal(scoreStats({passing_yards:100,passing_tds:1,passing_interceptions:1,receptions:0},s.rules,'QB').points,8);
 assert.throws(()=>translateEspnScoring(null),/required/);
});
test('canonical mapping is exact, provider scoped and never guesses names',()=>{
 const rows=[{espn_id:'101',gsis_id:'00-001',sleeper_id:'999'}];assert.equal(playerReference('espn','101',rows).canonical_id,'nfl:00-001');assert.equal(playerReference('sleeper','101',rows).mapping_status,'unresolved');assert.equal(playerReference('espn','101',[...rows,{espn_id:'101',gsis_id:'00-002'}]).mapping_status,'ambiguous');
});
test('unknown lineup slots and credential-bearing imports fail safely',()=>{
 const raw=espnFixture();raw.settings.rosterSettings.lineupSlotCounts[999]=1;assert.equal(normalizeEspn(raw).capabilities.legalLineup,false);
 for(const field of ['password','espn_s2','SWID','authorization']){assert.throws(()=>normalizeEspn({...espnFixture(),[field]:'fake-test-value'}),e=>!e.message.includes('fake-test-value'));}
 assert.throws(()=>new ESPNProvider().getSnapshot(),e=>e.code==='UNSUPPORTED_FEATURE');
});
test('all live ESPN API access fails closed with normalized errors and no raw payloads',async()=>{
 for(const handler of [r=>handleSnapshotRequest(r),r=>handleDecisionRequest(r),...['leagues','league-summary','waivers','signals','player','matchup','history'].map(x=>r=>handleChatRequest(r,x))]){const response=await handler(new Request('https://test/api?provider=espn&league=12345&season=2027'));assert.equal(response.status,422);assert.equal((await response.json()).code,'UNSUPPORTED_FEATURE');assert.equal(response.headers.get('cache-control'),'no-store');}
});
test('decision output stays exactly equivalent through the Sleeper provider seam',async()=>{
 for(const id of ['1401373864818192384','1395493939665989632']){const o=decisionFixtureOptions(),legacy=await buildDecisionContext(id,o),provider=new SleeperProvider({snapshot:o.loadLeague});const next=await buildDecisionContext(id,{...o,loadLeague:(id,identity)=>provider.getDecisionContext(id,identity)});assert.deepEqual(next,legacy);}
});
test('ESPN authorized import feeds shared engine without inventing historical/waiver availability',async()=>{
 const raw=espnFixture(),provider=new ESPNProvider({authorizedImport:raw}),o=decisionFixtureOptions();
 const d=await buildDecisionContext(String(raw.id),{...o,provider:'espn',loadLeague:(id,identity)=>provider.getDecisionContext(id,identity)});
 assert.equal(d.identity.provider,'espn');assert.equal(d.my_roster_id,null);assert.equal(d.waivers.recommendations.length,0);assert.equal(d.data_through_week,0);assert.ok(Object.values(d.player_context).every(c=>c.market_attention===null));assert.ok(captureObservations(d).every(r=>r.provider==='espn'));
 raw.settings.rosterSettings.lineupSlotCounts[999]=1;await assert.rejects(()=>buildDecisionContext(String(raw.id),{...o,loadLeague:async()=>normalizeEspn(raw)}),/Unsupported lineup/);
});
test('auth boundary never collects material and errors use safe codes',async()=>{
 await assert.rejects(()=>new DisabledCredentialProvider().get(),e=>e.code==='AUTH_REQUIRED');assert.equal(providerHttpError(401,{knownExpired:true}).code,'AUTH_EXPIRED');assert.equal(providerHttpError(403).code,'PRIVATE_LEAGUE');assert.equal(providerHttpError(429).code,'RATE_LIMITED');
});


test('ESPN season/matchup mapping is explicit and rejects malformed scoring identifiers',()=>{
 for(const season of [2025,2026,2027]){const raw=espnFixture();raw.seasonId=season;raw.schedule=[{id:1,matchupPeriodId:2,home:{teamId:1,totalPoints:20}}];assert.equal(normalizeEspn(raw).current_matchups.length,0);raw.settings.scheduleSettings={matchupPeriods:{2:[3]}};assert.equal(normalizeEspn(raw).current_matchups[0].points,20);assert.equal(normalizeEspn(raw).league.season,season);raw.settings.scheduleSettings.matchupPeriods[2]=[3,4];assert.equal(normalizeEspn(raw).current_matchups.length,0);}
 assert.throws(()=>translateEspnScoring([{statId:'toString',points:1}]),/identifiers/);
});

test('canonical domain keeps fantasy eligibility and nullable waiver state',async()=>{
 const {fantasyDomain}=await import('../lib/providers/domain.js');const d=fantasyDomain(normalizeEspn(espnFixture()));assert.equal(d.provider,'espn');assert.equal(d.rosters[0].is_selected,false);assert.deepEqual(d.rosters[0].bench[0].eligibility.positions,['WR','DB']);assert.equal(d.rosters[0].bench[0].canonical_id,null);assert.equal(d.season.verified_current,false);
});

test('provider archives preserve legacy paths and isolate equal league IDs',async()=>{
 const {appendCapture}=await import('../lib/history/git-store.js'),{mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'fantasy-provider-test-'));
 try{const d=await buildDecisionContext('1401373864818192384',decisionFixtureOptions());const a=await appendCapture(directory,d);const other=structuredClone(d);other.identity.provider='espn';const b=await appendCapture(directory,other);assert.ok(a.path.startsWith('observations/'+d.league.season+'/'));assert.ok(b.path.startsWith('observations/espn/'));assert.notEqual(a.capture_id,b.capture_id);assert.equal((await appendCapture(directory,other)).created,false);const index=JSON.parse(await readFile(join(directory,'index.json'),'utf8'));assert.equal(index.captures.length,2);assert.equal(index.captures.find(c=>c.capture_id===b.capture_id).provider,'espn');}finally{await rm(directory,{recursive:true,force:true});}
});
