import {ProviderError} from "../contracts.js";
import {ESPN_FACTS_VERSION,rejectCredentials} from "../espn-normalize.js";
import {normalizeTeam} from "../../sources/contracts.js";
import {need,checkSession,checkLeagueInfo,checkRoster,checkStandings,checkMatchups,checkFreeAgents,checkTransactions,checkDraft} from "./schema.js";

// Flaim player-entry labels verified live (2026-09-26). Any other label fails closed as an unsupported slot.
export const FLAIM_SLOT_LABELS=Object.freeze({QB:"QB",RB:"RB",WR:"WR",TE:"TE",FLEX:"FLEX",K:"K","D/ST":"DEF",Bench:"BN",IR:"IR"});
const POSITION_LABELS={QB:"QB",RB:"RB",WR:"WR",TE:"TE",K:"K","D/ST":"DEF"};
// Flex groupings carry no single-position eligibility (the raw-import path ignores the same slot codes); "Rookie" is a pseudo-label.
const NON_POSITION_LABELS=new Set(["RB/WR","WR/TE","FLEX","OP","Rookie"]);
const TX_TYPES={add:"free_agent",drop:"drop",waiver:"waiver",failed_bid:"waiver",trade:"trade",trade_proposal:"trade_proposal",trade_decline:"trade_decline",trade_veto:"trade_veto",trade_uphold:"trade_uphold"};
const TX_STATUSES=new Set(["complete","pending","failed","unknown"]);
const FINAL_WINNERS=new Set(["HOME","AWAY","TIE"]);
/**
 * Provider fields that are never copied into ESPN facts (advice, projections, rankings, keeper cost, rates, raw stats).
 * The mapper builds new objects from an allow-list, so this list documents intent and is asserted by tests.
 */
export const DISCARDED_FIELDS=Object.freeze(["projectedSeasonPoints","totalProjectedPoints","draftDayProjectedRank","currentProjectedRank","rank","finalRank","keeperValue","keeperValueFuture","madePlayoffs","percentOwned","percentStarted","seasonPoints","pointsPerGame","pointsByScoringPeriod","stats","winPercentage","placement"]);
const num=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
const token=v=>String(v).toUpperCase().replace(/[^A-Z0-9]/g,"_").slice(0,24)||"EMPTY";
const iso=ms=>typeof ms==="number"&&Number.isFinite(ms)?new Date(ms).toISOString():null;

/**
 * Flaim ESPN tool payloads (the `data` of each successful result) → ESPN facts (`espn-facts-1`).
 * Flaim is transport/provenance only: the facts are ESPN facts with `provenance.source_transport = "flaim"`.
 * Scoring coefficients are not exposed by the transport, so `scoring.available` is always false here.
 * `access`: "flaim_live" (default) or "flaim_saved_bundle" (a locally saved capture; `capturedAt` is required).
 */
export function espnFactsFromFlaim(bundle={},{access="flaim_live",capturedAt=null}={}){
 need(["flaim_live","flaim_saved_bundle"].includes(access),"unknown access mode");
 need(access!=="flaim_saved_bundle"||(typeof capturedAt==="string"&&Number.isFinite(Date.parse(capturedAt))),"saved bundles need a capture time");
 const {session=null,leagueInfo,rosters,historicalRosters=[],standings=null,matchups=null,freeAgents=null,transactions=null,draft=null}=bundle;
 rejectCredentials(bundle);
 const info=checkLeagueInfo(leagueInfo);
 const warnings=[],warned=new Set(),warn=(code,message)=>{if(!warned.has(message)){warned.add(message);warnings.push({code,resource:"provider",message});}};
 const teamIds=new Set(info.teams.map(t=>t.teamId)),knownTeam=(id,what)=>{need(teamIds.has(Number(id)),`${what} references a team outside the league`);return Number(id);};
 const team=abbr=>{if(abbr==null||abbr==="FA")return null;if(!/^[A-Z]{2,4}$/.test(abbr)){warn("MAPPING_INCOMPLETE","An unrecognized NFL team code was left unknown.");return null;}return normalizeTeam(abbr);};
 const slot=label=>{if(FLAIM_SLOT_LABELS[label])return FLAIM_SLOT_LABELS[label];warn("UNSUPPORTED_FEATURE","An unverified lineup-slot label was retained as unsupported.");return `UNSUPPORTED_ESPN_LABEL_${token(label)}`;};
 const eligibility=labels=>{const out=[];for(const label of labels){if(POSITION_LABELS[label])out.push(POSITION_LABELS[label]);else if(!NON_POSITION_LABELS.has(label))warn("MAPPING_INCOMPLETE","Unverified eligibility labels (for example IDP labels) were ignored; no eligibility was inferred.");}return [...new Set(out)];};
 const player=(e,{historical=false,proTeamAvailable=false}={})=>({espn_id:String(e.playerId),name:e.name||null,position:POSITION_LABELS[e.position]??null,eligibility:eligibility(e.eligiblePositions),
  team:historical&&!proTeamAvailable?null:team(e.proTeam??null),provider_team_id:null,injury_status:historical?null:(e.injuryStatus||null),injured:null});
 const acquisition=e=>{const type={DRAFT:"draft",ADD:"add",TRADE:"trade"}[e.acquisitionType]??(e.acquisitionType==null?null:"unknown"),date=iso(e.acquisitionDate);return type||date?{type,date}:null;};

 need(Array.isArray(rosters),"current rosters");
 const current=new Map(),holder=new Map();
 for(const r of rosters){checkRoster(r,"current");knownTeam(r.teamId,"roster");need(!current.has(r.teamId),"duplicate team roster");current.set(r.teamId,r);
  for(const e of r.roster){if(holder.has(e.playerId))throw new ProviderError("MAPPING_INCOMPLETE","espn","A player appears on more than one roster; league state is inconsistent.");holder.set(e.playerId,r.teamId);}}
 if(current.size!==teamIds.size)throw new ProviderError("MAPPING_INCOMPLETE","espn","Every league team roster is required; availability cannot be derived from partial rosters.");

 const records=new Map();
 if(standings){checkStandings(standings);for(const s of standings.standings)records.set(knownTeam(s.teamId,"standings"),s);}
 warn("MAPPING_INCOMPLETE","Team owner information is unavailable from this ESPN source; a roster is treated as the user's only through the authenticated session or an explicit selection.");

 let userTeamId=null,seasonVerified=false;
 if(session){checkSession(session);
  const entry=session.allLeagues.find(l=>l.platform==="espn"&&(l.sport==null||l.sport==="football")&&l.leagueId===String(info.id)&&Number(l.seasonYear)===info.seasonId);
  if(entry?.teamId!=null&&/^\d{1,9}$/.test(entry.teamId))userTeamId=Number(entry.teamId);
  seasonVerified=session.currentSeasons?.football?.year===info.seasonId;}

 const periods=info.scoringSettings?.matchupPeriods;
 const matchupPeriods=periods&&typeof periods==="object"&&Object.values(periods).every(p=>Array.isArray(p)&&p.every(Number.isSafeInteger))?periods:null;
 if(info.scoringSettings?.scoringItems!==undefined)warn("UNSUPPORTED_FEATURE","Scoring items from this transport are unverified and were not used.");

 let matchupFacts=[];
 if(matchups){checkMatchups(matchups);
  need(matchups.currentScoringPeriod==null||info.scoringPeriodId==null||matchups.currentScoringPeriod===info.scoringPeriodId,"matchups and league info disagree on the current scoring period");
  matchupFacts=matchups.matchups.map(m=>{const final=FINAL_WINNERS.has(m.winner);const sides=[m.home,m.away].filter(v=>v!=null).map(s=>({team_id:knownTeam(s.teamId,"matchup"),points:final?num(s.totalPoints):null}));
   return {id:`${m.matchupPeriodId}:${sides.map(s=>s.team_id).join("-")}`,matchup_period:m.matchupPeriodId,final,sides};});}

 let available=null;
 if(freeAgents){checkFreeAgents(freeAgents);const seen=new Set(),players=[];
  for(const p of freeAgents.freeAgents){if(holder.has(p.playerId))throw new ProviderError("MAPPING_INCOMPLETE","espn","An available player is also rostered; league state is inconsistent.");
   if(seen.has(p.playerId))continue;seen.add(p.playerId);
   const state=p.acquisitionState??null;if(state==null)warn("MAPPING_INCOMPLETE","Some available players have no free-agent/waiver subtype; they are not labeled either.");
   players.push({player:player(p),acquisition_state:state,waiver_clears_at:state==="waivers"&&p.waiverClearsAt?new Date(Date.parse(p.waiverClearsAt)).toISOString():null});}
  // No pagination or total count is exposed: the returned list can never be proven complete.
  available={players,complete:false,limit:num(freeAgents.count)??players.length};}

 let txFacts=null;
 if(transactions){checkTransactions(transactions);let bids=false;
  const ref=(p,teamId)=>({espn_id:p.id,name:p.name||null,position:POSITION_LABELS[p.position]??null,team:team(p.team??null),team_id:teamId});
  const items=transactions.transactions.map(t=>{const type=TX_TYPES[t.type]??"unknown",status=t.type==="failed_bid"?"failed":TX_STATUSES.has(t.status)?t.status:"unknown";
   const ids=(t.team_ids||[]).map(id=>knownTeam(id,"transaction")),single=ids.length===1?ids[0]:null;if(typeof t.faab_bid==="number")bids=true;
   const sides=type==="trade"&&t.trade_sides?.length?t.trade_sides:null;
   return {id:t.transaction_id,type,status,timestamp:num(t.timestamp),week:t.week??null,team_ids:ids,
    adds:sides?sides.flatMap(s=>(s.acquired||[]).map(p=>ref(p,knownTeam(s.team_id,"trade side")))):(t.players_added||[]).map(p=>ref(p,single)),
    drops:sides?sides.flatMap(s=>(s.gave_up||[]).map(p=>ref(p,knownTeam(s.team_id,"trade side")))):(t.players_dropped||[]).map(p=>ref(p,single)),
    // Pending claims and trade proposals are visible only to the authenticated manager: never public.
    private:status==="pending"||type==="trade_proposal",faab_bid:null};});
  if(bids)warn("UNSUPPORTED_FEATURE","FAAB bid amounts are unknown without a verified league acquisition budget.");
  if(transactions.limitations?.structured_details_incomplete)warn("MAPPING_INCOMPLETE","Some transactions lack structured player detail.");
  txFacts={items,truncated:transactions.truncated===true||transactions.limitations?.possibly_truncated===true?true:transactions.truncated===false?false:null};}

 let draftFacts=null;
 if(draft){checkDraft(draft);draftFacts={status:typeof draft.draft.status==="string"?token(draft.draft.status).toLowerCase():null,
  picks:draft.picks.map(p=>({round:p.round,pick:p.selectionInRound,overall:p.overallPick,team_id:knownTeam(p.selectionTeamId,"draft pick"),espn_id:String(p.playerId),keeper:p.isKeeper===true})),ownership:null};}

 const rosterHistory=historicalRosters.map(r=>{checkRoster(r,"week");const limits=r.limitations||{};
  // Historical snapshots carry current-time stats/rates; only membership, slot and eligibility are kept.
  return {week:r.snapshot.week,team_id:knownTeam(r.teamId,"historical roster"),entries:r.roster.map(e=>({slot:slot(e.lineupSlot),player:player(e,{historical:true,proTeamAvailable:limits.playerProTeamAvailable===true}),acquisition:limits.acquisitionMetadataAvailable===true?acquisition(e):null}))};});

 return {version:ESPN_FACTS_VERSION,provider:"espn",provenance:{source:access==="flaim_saved_bundle"?"ESPN via Flaim (saved local bundle)":"ESPN via Flaim (read-only)",source_transport:"flaim",access,private_live:access==="flaim_live",visibility:"private",
  ...(access==="flaim_saved_bundle"?{captured_at:new Date(Date.parse(capturedAt)).toISOString()}:{})},
  league:{id:String(info.id),season:info.seasonId,name:info.name||null,scoring_period:info.scoringPeriodId??null,current_season_verified:seasonVerified,slot_counts:{...info.roster.lineupSlotCounts},matchup_periods:matchupPeriods,playoff_teams:null},
  scoring:{available:false,items:null},user_team_id:userTeamId,
  teams:info.teams.map(t=>{const s=records.get(t.teamId);return {id:t.teamId,name:t.teamName?.trim()||null,owner_id:null,
   record:{wins:num(s?.wins),losses:num(s?.losses),ties:num(s?.ties),points_for:num(s?.pointsFor),points_against:num(s?.pointsAgainst)},playoff_seed:num(s?.playoffSeed),waiver_rank:null,faab:{spent:null,budget:null},
   entries:current.get(t.teamId).roster.map(e=>({slot:slot(e.lineupSlot),player:player(e,{proTeamAvailable:true}),acquisition:acquisition(e)}))};}),
  matchups:matchupFacts,available,transactions:txFacts,draft:draftFacts,roster_history:rosterHistory,warnings};
}
