import {ESPN_FACTS_VERSION,ESPN_SLOTS,espnRawPlayer} from "../espn-normalize.js";
import {checkLeagueFile} from "./schema.js";

const num=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const FINAL=new Set(["HOME","AWAY","TIE"]);
const STATES={FREEAGENT:"free_agent",WAIVERS:"waivers"};

/**
 * Sanitized ESPN league file (`espn-league-file-1`) → ESPN facts (`espn-facts-1`), plus the file's observed scoring items.
 *
 * The file is a local private capture: `source_transport: "league_file"`, `access: "saved_league_file"`, `visibility:
 * "private"`. Its scoring items are cross-check evidence only (lib/providers/espn-file/scoring-check.js) and never become
 * facts scoring, so `scoring.available` is always false here; the user-authorized configuration stays the scoring source
 * (ADR 0003). No owner data exists, so `user_team_id` is null and a roster is selected only by an explicit `roster=`.
 * Available players are an observed subset and never complete. Raw codes are translated with the verified tables only.
 */
export function espnFactsFromLeagueFile(file,{now=Date.now()}={}){
 checkLeagueFile(file,{now});
 const league=file.league,settings=league.settings,counts=settings.rosterSettings.lineupSlotCounts;
 const warnings=[],warn=(code,message)=>{if(!warnings.some(w=>w.message===message))warnings.push({code,resource:"provider",message});};
 const player=(id,p)=>espnRawPlayer(p??{id});
 warn("MAPPING_INCOMPLETE","Team owner information is not part of a league file; a roster is treated as yours only through an explicit roster selection.");
 const teams=league.teams.map(t=>{const record=t.record?.overall,entries=t.roster.entries;
  if(entries.filter(e=>e.lineupSlotId===20).length>(counts[20]??0))warn("UNSUPPORTED_FEATURE","A roster holds more bench players than the league's bench slots.");
  return {id:t.id,name:t.name?.trim()||[t.location,t.nickname].filter(Boolean).join(" ").trim()||null,owner_id:null,
   record:{wins:num(record?.wins),losses:num(record?.losses),ties:num(record?.ties),points_for:num(record?.pointsFor),points_against:num(record?.pointsAgainst)},
   playoff_seed:null,waiver_rank:null,faab:{spent:null,budget:null},
   entries:entries.map(e=>({slot:ESPN_SLOTS[e.lineupSlotId]||`UNSUPPORTED_ESPN_SLOT_${e.lineupSlotId}`,player:player(e.playerId,e.playerPoolEntry?.player),acquisition:null}))};});
 const periods=settings.scheduleSettings?.matchupPeriods??null;
 const matchups=(league.schedule??[]).map(m=>{const final=FINAL.has(m.winner);
  return {id:m.id,matchup_period:m.matchupPeriodId,final,sides:[m.home,m.away].filter(v=>v!=null).map(s=>({team_id:s.teamId,points:final?num(s.totalPoints):null}))};});
 const available=file.available?{players:file.available.players.map(a=>({player:player(a.id,a.player),acquisition_state:STATES[a.status],waiver_clears_at:a.status==="WAIVERS"&&a.waiverClearsAt?new Date(Date.parse(a.waiverClearsAt)).toISOString():null})),
  complete:false,limit:null}:null;
 const facts={version:ESPN_FACTS_VERSION,provider:"espn",
  provenance:{source:"ESPN saved league file (local)",source_transport:"league_file",access:"saved_league_file",private_live:false,visibility:"private",captured_at:new Date(Date.parse(file.captured_at)).toISOString()},
  league:{id:String(league.id),season:league.seasonId,name:settings.name||null,scoring_period:league.scoringPeriodId,current_season_verified:false,slot_counts:{...counts},matchup_periods:periods?structuredClone(periods):null,playoff_teams:null},
  scoring:{available:false,items:null},user_team_id:null,teams,matchups,available,transactions:null,draft:null,roster_history:[],warnings};
 return {facts,observedScoring:settings.scoringSettings?settings.scoringSettings.scoringItems.map(i=>({statId:i.statId,points:i.points,...(i.pointsOverrides?{pointsOverrides:{...i.pointsOverrides}}:{})})):null};
}
