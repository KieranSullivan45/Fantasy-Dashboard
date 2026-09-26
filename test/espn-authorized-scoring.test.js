// V05-ESPN-02: user-authorized ESPN scoring configuration over SYNTHETIC fixtures (no network, no real league data).
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {translateAuthorizedEspnScoring,applyAuthorizedEspnScoring,validateEspnScoringConfig,createEspnScoringResolver,bandPoints,REQUIRED_OFFENSE_RULES} from "../lib/providers/espn-scoring.js";
import {espnFactsFromFlaim} from "../lib/providers/flaim/espn-map.js";
import {unwrapFlaimResult} from "../lib/providers/flaim/schema.js";
import {snapshotFromEspnFacts} from "../lib/providers/espn-normalize.js";
import {ESPNProvider} from "../lib/providers/espn.js";
import {scoreStats} from "../lib/normalize/scoring.js";
import {buildProduction} from "../lib/decision/production.js";
import {buildDecisionContext,buildDecisionState} from "../lib/decision/build-context.js";
import {handleTradeRequest} from "../lib/trade-api.js";
import {decisionFixtureOptions} from "./decision-fixtures.js";
import {TRADE_LEAGUE,ME,proposal,tradeRequest} from "./trade-api-fixtures.js";
import {espnFixture} from "./provider-fixtures.js";

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),"utf8"));
const CONFIG=read("./fixtures/espn-scoring/synthetic-authorized-scoring.json"),FLAIM=read("./fixtures/flaim-espn/synthetic-league.json");
const LEAGUE="424242",NOW="2030-09-26T12:00:00.000Z";
const config=(edit=c=>c)=>{const c=structuredClone(CONFIG);edit(c);return c;};
const CROSSWALK=["910001","910002","910003","910004","910005","910006","920001","920002","930001","930002","930009"].map((id,i)=>({espn_id:id,gsis_id:`00-99${String(i).padStart(5,"0")}`,sleeper_id:"NA"}));
const flaimFacts=()=>{const r=structuredClone(FLAIM),u=unwrapFlaimResult;return espnFactsFromFlaim({session:u(r.session),leagueInfo:u(r.leagueInfo),rosters:r.rosters.map(u),historicalRosters:r.historicalRosters.map(u),standings:u(r.standings),matchups:u(r.matchups),freeAgents:u(r.freeAgents),transactions:u(r.transactions),draft:u(r.draft)});};
const RULES=translateAuthorizedEspnScoring(CONFIG).rules;
// Every statistic the translated rules read, zero unless overridden (missing statistics would make points null, not zero).
const line=(stats={})=>({passing_yards:0,passing_tds:0,passing_interceptions:0,passing_2pt_conversions:0,rushing_yards:0,rushing_tds:0,rushing_2pt_conversions:0,receptions:0,receiving_yards:0,receiving_tds:0,receiving_2pt_conversions:0,
 fumbles_lost_total:0,fumble_recovery_tds:0,special_teams_tds:0,pat_made:0,fg_made_0_19:0,fg_made_20_29:0,fg_made_30_39:0,fg_made_40_49:0,fg_made_50_59:0,fg_made_60_:0,...stats});
const points=(stats,position="WR")=>scoreStats(line(stats),RULES,position).points;
const refused=code=>e=>e.code===code;

test("authorized rules map exactly onto existing internal scoring rules; unsupported rules are explicit",()=>{
 const t=translateAuthorizedEspnScoring(CONFIG);
 assert.deepEqual(t.rules,{pass_yd:0.04,pass_td:4,pass_int:-2,pass_2pt:2,rush_yd:0.1,rush_td:6,rush_2pt:2,rec_yd:0.1,rec:0.5,rec_td:6,rec_2pt:2,fum_rec_td:6,fum_lost:-2,
  unsupported_espn_interception_return_td:6,unsupported_espn_fumble_return_td:6,unsupported_espn_blocked_kick_return_td:6,unsupported_espn_two_point_return:2,unsupported_espn_one_point_safety:1,
  st_td:6,xpm:1,fgm_0_19:3,fgm_20_29:3,fgm_30_39:3,fgm_40_49:4,fgm_50_59:5,fgm_60p:6});
 assert.equal(t.available,true);assert.equal(t.status,"partial");
 assert.deepEqual(t.unsupported.filter(u=>u.scope==="player").map(u=>u.rule),["interception_return_td","fumble_return_td","blocked_kick_return_td","two_point_return","one_point_safety"]);
 assert.ok(t.unsupported.filter(u=>u.scope==="DEF").length===14&&t.unsupported.every(u=>u.reason));
 assert.deepEqual(t.binding,{provider:"espn",league_id:LEAGUE,season:2030,schema_version:"espn-scoring-1"});
 // No ESPN default is assumed for unlisted rules (e.g. missed FGs, total fumbles, passing attempts).
 for(const absent of ["fgmiss","xpmiss","fum","pass_att","pass_inc","bonus_rec_te"])assert.ok(!(absent in t.rules));
});

test("offensive scoring: 0.5 PPR, yardage, touchdowns, turnovers and two-point conversions",()=>{
 assert.equal(points({receptions:4}),2,"0.5 PPR");
 assert.equal(points({receptions:1}),0.5);
 assert.equal(points({passing_yards:25},"QB"),1);
 assert.equal(points({passing_tds:1},"QB"),4);
 assert.equal(points({passing_interceptions:1},"QB"),-2);
 assert.equal(points({rushing_yards:10},"RB"),1);
 assert.equal(points({rushing_tds:1},"RB"),6);
 assert.equal(points({receiving_yards:10}),1);
 assert.equal(points({receiving_tds:1}),6);
 assert.equal(points({fumbles_lost_total:1},"RB"),-2);
 assert.equal(points({passing_2pt_conversions:1},"QB"),2);assert.equal(points({rushing_2pt_conversions:1},"RB"),2);assert.equal(points({receiving_2pt_conversions:1}),2);
 assert.equal(points({special_teams_tds:1}),6,"kick/punt return TD through the shared special-teams statistic");
 assert.equal(points({fumble_recovery_tds:1}),6);
 assert.equal(points({passing_yards:300,passing_tds:2,passing_interceptions:1,rushing_yards:24},"QB"),12+8-2+2.4);
 const partial=scoreStats(line({receptions:2}),RULES,"WR");
 assert.equal(partial.status,"partial");assert.ok(partial.unsupported_rules.includes("unsupported_espn_interception_return_td"));
});

test("field goals score by distance band with exact 39/40/49/50/59/60 boundaries",()=>{
 const fg=validateEspnScoringConfig(CONFIG).kicking.field_goals_made;
 assert.deepEqual([0,39,40,49,50,59,60,65].map(d=>bandPoints(d,fg)),[3,3,4,4,5,5,6,6]);
 assert.equal(points({fg_made_30_39:1},"K"),3);assert.equal(points({fg_made_40_49:1},"K"),4);assert.equal(points({fg_made_50_59:1},"K"),5);assert.equal(points({fg_made_60_:1},"K"),6);
 assert.equal(points({fg_made_0_19:1,fg_made_20_29:1,pat_made:2},"K"),8);
 // A band boundary inside a statistical band (e.g. 35 yards) cannot be computed from band counts: kicker totals turn partial.
 const split=translateAuthorizedEspnScoring(config(c=>{c.kicking.field_goals_made=[{min:0,max:34,points:3},{min:35,max:49,points:4},{min:50,max:null,points:5}];}));
 assert.ok(!("fgm_30_39" in split.rules));assert.equal(split.rules.fgm_40_49,4);assert.equal(split.rules.fgm_60p,5);
 assert.deepEqual(split.unsupported.find(u=>u.rule==="field_goals_made_30_39").points,[3,4]);
 assert.equal(scoreStats(line({fg_made_30_39:1}),split.rules,"K").status,"partial");
 assert.equal(scoreStats(line({receptions:1}),split.rules,"WR").unsupported_rules.some(r=>r.startsWith("fg_")),false,"kicking gaps never affect other positions");
});

test("D/ST points-allowed bands keep custom values exactly, including an explicit zero for 18-27 and +4 for 35+",()=>{
 const pa=validateEspnScoringConfig(CONFIG).team_defense.points_allowed;
 assert.deepEqual([0,1,6,7,13,14,17,18,27,28,34,35,45,46,70].map(v=>bandPoints(v,pa)),[10,7,7,4,4,1,1,0,0,-1,-1,4,4,4,4]);
 assert.equal(bandPoints(-1,pa),null);
 const t=translateAuthorizedEspnScoring(CONFIG),entry=t.unsupported.find(u=>u.rule==="team_defense_points_allowed");
 assert.deepEqual(entry.points.slice(-2),[{min:35,max:45,points:4},{min:46,max:null,points:4}]);
 assert.equal(entry.scope,"DEF");assert.match(entry.reason,/D\/ST scoring is not implemented/);
 assert.ok(Object.keys(t.rules).every(k=>!/sack|pts_allow|def_|team_defense/.test(k)),"D/ST rules never enter player scoring");
 assert.deepEqual(scoreStats(line(),t.rules,"DEF").status,"unsupported");
});

test("a configuration applies only to its exact provider, league and season",()=>{
 const facts=flaimFacts();
 assert.throws(()=>applyAuthorizedEspnScoring(facts,config(c=>{c.league_id="999999";})),refused("SCORING_CONFIG_MISMATCH"));
 assert.throws(()=>applyAuthorizedEspnScoring(facts,config(c=>{c.season=2029;})),refused("SCORING_CONFIG_MISMATCH"));
 assert.throws(()=>applyAuthorizedEspnScoring({...facts,provider:"sleeper"},CONFIG),refused("SCORING_CONFIG_MISMATCH"));
 assert.throws(()=>applyAuthorizedEspnScoring(facts,config(c=>{c.provider="sleeper";})),refused("SCORING_CONFIG_MISMATCH"));
 assert.throws(()=>new ESPNProvider({espnFacts:facts,scoringConfig:config(c=>{c.league_id="1";}),crosswalk:CROSSWALK}),refused("SCORING_CONFIG_MISMATCH"));
 const resolve=createEspnScoringResolver([CONFIG]);
 assert.equal(resolve({provider:"espn",leagueId:LEAGUE,season:2030}).league_id,LEAGUE);
 assert.equal(resolve({provider:"espn",leagueId:LEAGUE,season:2031}),null);
 assert.equal(resolve({provider:"espn",leagueId:"424243",season:2030}),null);
 assert.equal(resolve({provider:"sleeper",leagueId:LEAGUE,season:2030}),null);
 assert.throws(()=>createEspnScoringResolver([CONFIG,CONFIG]),refused("INVALID_SCORING_CONFIG"));
 // Provider-supplied scoring (authorized raw import) is never overridden.
 assert.throws(()=>new ESPNProvider({authorizedImport:espnFixture(),scoringConfig:config(c=>{c.league_id="12345";c.season=2027;})}),refused("SCORING_CONFIG_CONFLICT"));
});

test("incomplete or invalid configurations refuse scoring",()=>{
 const bad=[c=>{delete c.offense.reception;},c=>{c.unlisted_rules_score_zero=false;},c=>{delete c.unlisted_rules_score_zero;},c=>{c.offense.receptions_bonus=1;},c=>{c.offense.passing_yards="0.04";},
  c=>{c.offense.rushing_td=Infinity;},c=>{delete c.kicking;},c=>{delete c.team_defense;},c=>{c.kicking.field_goals_made=[{min:0,max:45,points:3},{min:40,max:null,points:4}];},
  c=>{c.team_defense.points_allowed=[{min:0,max:null,points:10},{min:1,max:6,points:7}];},c=>{c.schema_version="espn-scoring-0";},c=>{c.scoring_source="provider";},c=>{c.league_id=424242;},c=>{c.season=1999;},c=>{c.extra=true;},c=>{c.source={note:"x",token:"fake-secret-value"};}];
 for(const edit of bad)assert.throws(()=>translateAuthorizedEspnScoring(config(edit)),e=>["INVALID_SCORING_CONFIG","INVALID_IMPORT"].includes(e.code)&&!e.message.includes("fake-secret-value"));
 assert.throws(()=>new ESPNProvider({espnFacts:flaimFacts(),scoringConfig:config(c=>{delete c.offense.passing_td;})}),refused("INVALID_SCORING_CONFIG"));
 assert.deepEqual(REQUIRED_OFFENSE_RULES,["passing_yards","passing_td","interception_thrown","rushing_yards","rushing_td","receiving_yards","reception","receiving_td","fumble_lost"]);
 // A declared zero is allowed and stays a declared zero (no default substituted).
 assert.equal(translateAuthorizedEspnScoring(config(c=>{c.offense.reception=0;})).rules.rec,undefined);
});

test("scoring provenance is separate from the Flaim transport provenance",()=>{
 const facts=flaimFacts();assert.deepEqual(facts.scoring,{available:false,items:null},"the Flaim mapper stays scoring-agnostic");
 const s=snapshotFromEspnFacts(applyAuthorizedEspnScoring(facts,CONFIG),{crosswalk:CROSSWALK,now:NOW});
 assert.equal(s.identity.provider,"espn");assert.equal(s.coverage.source_transport,"flaim");assert.equal(s.coverage.access,"flaim_live");
 assert.equal(s.coverage.scoring_available,true);assert.equal(s.coverage.scoring_source,"user_authorized");assert.equal(s.coverage.scoring_status,"partial");
 assert.deepEqual(s.coverage.scoring_binding,{provider:"espn",league_id:LEAGUE,season:2030,schema_version:"espn-scoring-1"});
 assert.equal(s.capabilities.scoringRules,true);assert.deepEqual(s.league.scoring_settings,RULES);
 assert.ok(s.warnings.some(w=>w.code==="PROVENANCE"));assert.ok(!s.warnings.some(w=>/scoring rules are unavailable/.test(w.message)));
 // A transport-supplied scoringItems field is still ignored; only the authorized configuration scores.
 const r=structuredClone(FLAIM);r.leagueInfo.data.scoringSettings.scoringItems=[{statId:53,points:1}];
 const withItems=espnFactsFromFlaim({leagueInfo:r.leagueInfo.data,rosters:r.rosters.map(unwrapFlaimResult)});
 assert.equal(withItems.scoring.available,false);
 assert.equal(snapshotFromEspnFacts(applyAuthorizedEspnScoring(withItems,CONFIG),{crosswalk:CROSSWALK,now:NOW}).league.scoring_settings.rec,0.5);
});

test("missing configuration keeps UNSUPPORTED_FEATURE; a valid one enables only decision support",()=>{
 const none=new ESPNProvider({espnFacts:flaimFacts(),crosswalk:CROSSWALK,resolveScoringConfig:createEspnScoringResolver([])});
 assert.throws(()=>none.getDecisionContext(LEAGUE),e=>e.code==="UNSUPPORTED_FEATURE"&&/scoring/.test(e.message));
 assert.equal(none.getProviderCapabilities().decisionSupport.status,"unsupported");
 const scored=new ESPNProvider({espnFacts:flaimFacts(),crosswalk:CROSSWALK,resolveScoringConfig:createEspnScoringResolver([CONFIG])});
 assert.equal(scored.getDecisionContext(LEAGUE).coverage.scoring_available,true);
 const caps=scored.getProviderCapabilities();
 assert.equal(caps.scoringRules.status,"available");assert.equal(caps.decisionSupport.status,"available");
 for(const key of ["pickupRating","tradeAnalysis","completePlayerPool","addInterest","FAAB","waiverPriority"])assert.equal(caps[key].status,"unsupported",key);
 assert.equal(caps.publicLeagueAccess.status,"unsupported","routes stay closed without a live transport");
});

test("authorized rules drive league-scored production for rostered players",()=>{
 const ids=new Map([["00-A","nfl:00-A"],["00-B","nfl:00-B"]]);
 const row=(player_id,position,stats)=>({...line(stats),player_id,position,season:"2030",season_type:"REG",week:"1",game_id:`g-${player_id}`,team:"KC",opponent_team:"BUF"});
 const p=buildProduction([row("00-A","WR",{receptions:6,receiving_yards:80,receiving_tds:1}),row("00-B","K",{fg_made_50_59:1,fg_made_30_39:1,pat_made:3})],ids,{season:2030,week:2,settings:RULES,
  platformPlayers:new Map([["nfl:00-A",{fantasy_positions:["WR"]}],["nfl:00-B",{fantasy_positions:["K"]}]])});
 assert.equal(p.players["nfl:00-A"].ppg,3+8+6);assert.equal(p.players["nfl:00-B"].ppg,5+3+3);
 assert.equal(p.players["nfl:00-A"].scoring_status,"partial","unsupported rare rules are disclosed, not approximated");
});

test("regression: incomplete pool keeps Pickup Rating, add/drop, replacement levels and trades disabled",async()=>{
 const provider=new ESPNProvider({espnFacts:flaimFacts(),crosswalk:CROSSWALK,scoringConfig:CONFIG});
 const options={...decisionFixtureOptions(),loadLeague:async(id,o)=>provider.getDecisionContext(id,o)};
 const state=await buildDecisionState(LEAGUE,{...options,provider:"espn"}),d=state.decision;
 assert.equal(d.identity.provider,"espn");assert.deepEqual(d.league.scoring_settings,RULES);
 assert.equal(d.waivers.status,"unsupported");assert.match(d.waivers.unsupported_reason,/not redistributed/);
 assert.deepEqual([d.waivers.recommendations.length,d.waivers.limited_candidates.length,d.waivers.scored_count],[0,0,0]);
 assert.ok(Object.values(d.waivers.categories).every(c=>c.total===0));
 assert.ok(Object.values(d.player_context).every(c=>c.pickup===undefined),"no Pickup Rating is computed for any player");
 assert.ok(Object.values(state.levels).every(l=>l.replacement_value===null&&l.coverage==="unsupported"&&l.available_sample===0));
 assert.ok(Object.values(state.contexts).every(c=>c.model.replacement.value_over_replacement===null));
 assert.ok(d.team_strength_v2.every(t=>t.needs.length===0&&t.surpluses.length===0&&Object.values(t.positions).every(p=>p.need_or_surplus===null)));
 assert.ok(d.team_strength_v2.every(t=>Array.isArray(t.best_legal_lineup)),"legal lineups are still built from start values");
 assert.deepEqual(d.coverage.withheld,["replacement_levels","value_over_replacement","need_or_surplus","add_drop","pickup_rating"]);assert.equal(d.coverage.available_pool_complete,false);
 const trade=await handleTradeRequest(tradeRequest({league:TRADE_LEAGUE,user:ME,proposal:proposal(["12"],["23"])}),{leagueIds:[TRADE_LEAGUE],build:async()=>state});
 assert.equal(trade.status,422);const body=await trade.json();assert.equal(body.code,"UNSUPPORTED_FEATURE");assert.match(body.error,/complete available-player pool/);
});

test("Sleeper decisions are unaffected by authorized ESPN scoring",async()=>{
 const before=await buildDecisionContext("1401373864818192384",decisionFixtureOptions());
 createEspnScoringResolver([CONFIG]);new ESPNProvider({espnFacts:flaimFacts(),scoringConfig:CONFIG});
 const after=await buildDecisionContext("1401373864818192384",decisionFixtureOptions());
 delete before.generated_at;delete after.generated_at;assert.deepEqual(after,before);
 assert.equal(after.waivers.status,undefined);assert.equal(after.coverage.withheld,undefined);assert.equal(after.coverage.available_pool_complete,undefined);
 assert.ok(Object.values(after.waivers.replacement_levels).some(l=>l.replacement_value!==null));
});
