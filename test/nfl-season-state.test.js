// V05-ESPN-03: NFL season-state verification from the nflverse schedule for ESPN facts (SYNTHETIC data, no network).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {verifyNflSeasonState,withNflSeasonState,WEEK_ROLLOVER_MS} from "../lib/decision/season-state.js";
import {kickoffUtc} from "../lib/decision/schedule.js";
import {buildDecisionState} from "../lib/decision/build-context.js";
import {espnFactsFromFlaim} from "../lib/providers/flaim/espn-map.js";
import {unwrapFlaimResult} from "../lib/providers/flaim/schema.js";
import {normalizeEspn,snapshotFromEspnFacts} from "../lib/providers/espn-normalize.js";
import {ESPNProvider} from "../lib/providers/espn.js";
import {decisionFixtureOptions,source} from "./decision-fixtures.js";
import {espnFixture} from "./provider-fixtures.js";

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const FLAIM=read("./fixtures/flaim-espn/synthetic-league.json"),CONFIG=read("./fixtures/espn-scoring/synthetic-authorized-scoring.json");
const LEAGUE="424242";
// Synthetic 2030 regular season: Thursday, Sunday and Monday games (America/New_York local times, as in nflverse).
const WEEKS={1:["2030-09-12","2030-09-15","2030-09-16"],2:["2030-09-19","2030-09-22","2030-09-23"],3:["2030-09-26","2030-09-29","2030-09-30"],4:["2030-10-03","2030-10-06","2030-10-07"]};
const SCHEDULE=[...Object.entries(WEEKS).flatMap(([week,[thu,sun,mon]])=>[[thu,"20:15"],[sun,"13:00"],[mon,"20:15"]].map(([gameday,gametime],i)=>({game_id:`2030_${week}_${i}`,season:"2030",week,game_type:"REG",gameday,gametime,home_team:"KC",away_team:"BUF",home_score:"",away_score:""}))),
 {game_id:"2030_WC",season:"2030",week:"19",game_type:"WC",gameday:"2031-01-11",gametime:"13:00",home_team:"KC",away_team:"BUF",home_score:"",away_score:""},
 {game_id:"2029_1",season:"2029",week:"1",game_type:"REG",gameday:"2029-09-09",gametime:"13:00",home_team:"KC",away_team:"BUF",home_score:"",away_score:""}];
const lastKickoff=week=>Date.parse(kickoffUtc(WEEKS[week][2],"20:15"));
const WEEK3=Date.parse("2030-09-27T12:00:00Z");
const verify=(now,providerWeek=3,rows=SCHEDULE,season=2030)=>verifyNflSeasonState(rows,{season,providerWeek,now});
const CROSSWALK=["910001","910002","910003","910004","910005","910006","920001","920002","930001","930002","930009"].map((id,i)=>({espn_id:id,gsis_id:`00-99${String(i).padStart(5,"0")}`,sleeper_id:"NA"}));
const flaimBundle=(edit=b=>b)=>{const r=structuredClone(FLAIM),u=unwrapFlaimResult;const b={session:u(r.session),leagueInfo:u(r.leagueInfo),rosters:r.rosters.map(u),standings:u(r.standings),matchups:u(r.matchups),freeAgents:u(r.freeAgents),transactions:u(r.transactions)};edit(b);return b;};
const statLine=(week,stats)=>({player_id:CROSSWALK[0].gsis_id,position:"QB",season:"2030",season_type:"REG",week:String(week),game_id:`2030_${week}_1`,team:"KC",opponent_team:"BUF",
 passing_yards:0,passing_tds:0,passing_interceptions:0,passing_2pt_conversions:0,rushing_yards:0,rushing_tds:0,rushing_2pt_conversions:0,receptions:0,receiving_yards:0,receiving_tds:0,receiving_2pt_conversions:0,
 fumbles_lost_total:0,fumble_recovery_tds:0,special_teams_tds:0,pat_made:0,fg_made_0_19:0,fg_made_20_29:0,fg_made_30_39:0,fg_made_40_49:0,fg_made_50_59:0,fg_made_60_:0,attempts:30,completions:20,carries:2,targets:0,...stats});
/** An ESPN-via-Flaim league with authorized scoring, run through the real decision pipeline with counted sources. */
async function espnDecision({now=WEEK3,schedule=async()=>source("nflverse_schedule",SCHEDULE),edit}={}){
 const calls={schedule:0,stats:[]},provider=new ESPNProvider({espnFacts:espnFactsFromFlaim(flaimBundle(edit)),crosswalk:CROSSWALK,scoringConfig:CONFIG});
 const state=await buildDecisionState(LEAGUE,{...decisionFixtureOptions(),now,provider:"espn",loadLeague:async(id,o)=>provider.getDecisionContext(id,o),
  scheduleSource:async()=>{calls.schedule++;return schedule();},
  statsSource:async season=>{calls.stats.push(season);return source("nflverse_stats",season===2030?[statLine(1,{passing_yards:250,passing_tds:2}),statLine(2,{passing_yards:300,passing_tds:1,passing_interceptions:1})]:[]);},
  idsSource:async()=>source("ffverse_ids",CROSSWALK)});
 return {state,calls};
}

test("verified regular-season week comes from schedule kickoffs and matches the provider week",()=>{
 const v=verify(WEEK3);
 assert.deepEqual([v.status,v.season_type,v.week,v.derived_week,v.provider_week],["verified","regular",3,3,3]);
 // Rollover boundary: week 3 begins 8 hours after week 2's last kickoff.
 assert.equal(verify(lastKickoff(2)+WEEK_ROLLOVER_MS-1,2).week,2);
 assert.equal(verify(lastKickoff(2)+WEEK_ROLLOVER_MS,3).week,3);
 assert.equal(verify(Date.parse("2030-09-10T12:00:00Z"),1).status,"verified","week 1 opens three days before its first kickoff");
 assert.equal(verify(Date.parse("2030-10-05T12:00:00Z"),4).week,4);
});

test("a schedule-derived week that disagrees with the provider week fails closed",()=>{
 for(const [now,providerWeek] of [[WEEK3,2],[WEEK3,4],[lastKickoff(2)+WEEK_ROLLOVER_MS-1,3],[WEEK3,null],[WEEK3,"3"]]){
  const v=verify(now,providerWeek);assert.equal(v.status,"mismatch");assert.equal(v.season_type,null);assert.equal(v.week,null);
 }
 assert.match(verify(WEEK3,2).reason,/week 3 does not match the provider week 2/);
});

test("missing or unknown season state stays null",()=>{
 const cases=[[verify(WEEK3,3,[]),"unavailable"],[verify(WEEK3,3,null),"unavailable"],[verify(WEEK3,3,SCHEDULE,2031),"unavailable"],
  [verify(WEEK3,3,SCHEDULE.map(r=>r.game_id==="2030_2_1"?{...r,gametime:"TBD"}:r)),"unavailable"],
  [verify(WEEK3,3,SCHEDULE.filter(r=>r.week!=="2")),"unavailable"],
  [verify(Date.parse("2030-08-15T12:00:00Z"),1),"outside_regular_season"],[verify(Date.parse("2031-01-12T12:00:00Z"),17),"outside_regular_season"]];
 for(const [v,status] of cases){assert.equal(v.status,status);assert.equal(v.season_type,null);assert.equal(v.week,null);assert.ok(v.reason);}
 const snapshot={nfl_state:{season:2030,season_type:null,week:3,leg:3},coverage:{nfl_state_verification:"required"},warnings:[]};
 const applied=withNflSeasonState(snapshot,cases[0][0]);
 assert.equal(applied.nfl_state.season_type,null);assert.equal(applied.coverage.nfl_state_verification.status,"unavailable");assert.equal(applied.warnings[0].code,"UNVERIFIED_SEASON_STATE");
 assert.equal(snapshot.warnings.length,0,"the input snapshot is not mutated");
});

test("only live current-season ESPN facts request verification; the fantasy season phase is never used",()=>{
 const live=snapshotFromEspnFacts(espnFactsFromFlaim(flaimBundle()),{crosswalk:CROSSWALK});
 assert.equal(live.coverage.nfl_state_verification,"required");assert.equal(live.nfl_state.season_type,null);
 assert.equal(snapshotFromEspnFacts(espnFactsFromFlaim(flaimBundle(b=>{b.session=null;})),{crosswalk:CROSSWALK}).coverage.nfl_state_verification,undefined);
 assert.equal(normalizeEspn(espnFixture()).coverage.nfl_state_verification,undefined,"offline imports are not current-season claims");
 const regularPhase=snapshotFromEspnFacts(espnFactsFromFlaim(flaimBundle(b=>{b.standings.seasonPhase="regular_season";})),{crosswalk:CROSSWALK});
 assert.equal(regularPhase.nfl_state.season_type,null,"seasonPhase is a fantasy phase, not the NFL season type");
});

test("verified ESPN state loads current-season statistics under authorized scoring",async()=>{
 const {state,calls}=await espnDecision();
 assert.deepEqual([state.snapshot.nfl_state.season_type,state.snapshot.nfl_state.week],["regular",3]);
 assert.equal(state.snapshot.coverage.nfl_state_verification.status,"verified");
 assert.equal(calls.schedule,1,"the schedule is loaded once and reused");assert.deepEqual(calls.stats.sort(),[2029,2030]);
 const qb=state.contexts[`nfl:${CROSSWALK[0].gsis_id}`];
 assert.equal(qb.production.recorded_games,2);assert.equal(qb.production.ppg,((10+8)+(12+4-2))/2);
 assert.equal(state.decision.data_through_week,2);assert.equal(state.decision.league.week,3);
 assert.equal(qb.model.supported,true);assert.ok(Number.isFinite(qb.model.start_value.central),"a calibrated start value is produced");assert.equal(qb.model.features.data_through_week,2);
 assert.ok(!state.decision.warnings.some(w=>/not verified/.test(w)));
 assert.equal(state.decision.waivers.status,"unsupported","pool-dependent sections stay withheld (V05-ESPN-02)");
});

test("mismatched or unavailable ESPN state keeps statistics unloaded",async()=>{
 const mismatch=await espnDecision({now:Date.parse("2030-10-04T12:00:00Z")});
 assert.equal(mismatch.state.snapshot.coverage.nfl_state_verification.status,"mismatch");assert.equal(mismatch.state.snapshot.nfl_state.season_type,null);
 assert.deepEqual(mismatch.calls.stats,[]);assert.equal(mismatch.state.decision.data_through_week,0);
 assert.ok(mismatch.state.decision.warnings.some(w=>/NFL season state is not verified \(mismatch\)/.test(w)));
 const down=await espnDecision({schedule:async()=>{throw new Error("schedule offline");}});
 assert.equal(down.state.snapshot.coverage.nfl_state_verification.status,"unavailable");assert.deepEqual(down.calls.stats,[]);assert.equal(down.calls.schedule,1);
});

test("Sleeper and ESPN offline-import decisions skip verification unchanged",async()=>{
 const options=decisionFixtureOptions();let scheduleCalls=0;
 const original=await options.loadLeague("1401373864818192384");
 const state=await buildDecisionState("1401373864818192384",{...options,scheduleSource:async()=>{scheduleCalls++;return options.scheduleSource();}});
 assert.equal(scheduleCalls,1);assert.deepEqual(state.snapshot.nfl_state,original.nfl_state);
 assert.equal(state.snapshot.coverage?.nfl_state_verification,undefined);
 assert.ok(!state.decision.warnings.some(w=>/NFL season state/.test(w)));
 const imported=new ESPNProvider({authorizedImport:espnFixture()});
 const importState=await buildDecisionState("12345",{...decisionFixtureOptions(),provider:"espn",loadLeague:(id,o)=>imported.getDecisionContext(id,o)});
 assert.equal(importState.snapshot.nfl_state.season_type,null);assert.equal(importState.snapshot.coverage.nfl_state_verification,undefined);
});
