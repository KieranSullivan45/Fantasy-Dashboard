import {ProviderError} from "../contracts.js";
// Strict structural checks for the Flaim tool payloads verified live (2026-09-26). Messages never echo payload values.
// Unknown extra fields are tolerated (Flaim adds fields); required fields fail closed.
const invalid=message=>new ProviderError("INVALID_IMPORT","espn",`ESPN transport payload rejected: ${message}`);
export const isObject=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const int=v=>Number.isSafeInteger(v);
const finiteOrNull=v=>v==null||(typeof v==="number"&&Number.isFinite(v));
const strOrNull=v=>v==null||typeof v==="string";
export const need=(ok,message)=>{if(!ok)throw invalid(message);};
const idString=v=>typeof v==="string"&&/^-?\d{1,25}$/.test(v);

/** A transport tool result `{success: true, data}` → `data`. */
export function unwrapFlaimResult(envelope){
 need(isObject(envelope)&&envelope.success===true&&isObject(envelope.data),"expected a successful tool result");
 return envelope.data;
}
export function checkSession(s){
 need(isObject(s)&&Array.isArray(s.allLeagues),"session.allLeagues");
 for(const l of s.allLeagues)need(isObject(l)&&typeof l.leagueId==="string"&&strOrNull(l.teamId)&&strOrNull(l.platform),"session league entry");
 return s;
}
export function checkLeagueInfo(d){
 need(isObject(d)&&int(d.id)&&d.id>0,"league id");
 need(int(d.seasonId)&&d.seasonId>=2010&&d.seasonId<=2100,"league season");
 need(d.scoringPeriodId==null||int(d.scoringPeriodId),"scoring period");
 need(Array.isArray(d.teams)&&d.teams.length>0&&d.teams.every(t=>isObject(t)&&int(t.teamId)&&strOrNull(t.teamName)),"league teams");
 need(new Set(d.teams.map(t=>t.teamId)).size===d.teams.length,"duplicate league team ids");
 need(isObject(d.roster)&&isObject(d.roster.lineupSlotCounts),"roster lineupSlotCounts");
 need(d.scoringSettings==null||isObject(d.scoringSettings),"scoring settings");
 return d;
}
function checkRosterEntry(e){
 need(isObject(e)&&int(e.playerId),"roster entry playerId");
 need(typeof e.lineupSlot==="string","roster entry lineupSlot");
 need(Array.isArray(e.eligiblePositions)&&e.eligiblePositions.every(x=>typeof x==="string"),"roster entry eligiblePositions");
 need(strOrNull(e.name)&&strOrNull(e.position)&&strOrNull(e.proTeam)&&strOrNull(e.injuryStatus),"roster entry text fields");
}
export function checkRoster(d,type){
 need(isObject(d)&&int(d.teamId),"roster teamId");
 need(isObject(d.snapshot)&&d.snapshot.type===type,`roster snapshot type ${type}`);
 if(type==="week")need(int(d.snapshot.week)&&d.snapshot.week>0,"historical roster week");
 need(Array.isArray(d.roster),"roster entries");d.roster.forEach(checkRosterEntry);
 need(new Set(d.roster.map(e=>e.playerId)).size===d.roster.length,"duplicate roster playerId");
 return d;
}
export function checkStandings(d){
 need(isObject(d)&&Array.isArray(d.standings),"standings");
 for(const s of d.standings)need(isObject(s)&&int(s.teamId)&&["wins","losses","ties","pointsFor","pointsAgainst","playoffSeed"].every(k=>finiteOrNull(s[k])),"standings entry");
 return d;
}
export function checkMatchups(d){
 need(isObject(d)&&Array.isArray(d.matchups),"matchups");
 for(const m of d.matchups){need(isObject(m)&&int(m.matchupPeriodId)&&isObject(m.home)&&int(m.home.teamId),"matchup");
  for(const side of [m.home,m.away].filter(v=>v!=null))need(isObject(side)&&int(side.teamId)&&finiteOrNull(side.totalPoints),"matchup side");
  need(strOrNull(m.winner),"matchup winner");}
 return d;
}
export function checkFreeAgents(d){
 need(isObject(d)&&Array.isArray(d.freeAgents),"freeAgents");
 need(d.count==null||int(d.count),"freeAgents count");
 for(const p of d.freeAgents){need(isObject(p)&&int(p.playerId),"available player playerId");
  need(p.id==null||p.id===String(p.playerId),"available player id mismatch");
  need(Array.isArray(p.eligiblePositions)&&p.eligiblePositions.every(x=>typeof x==="string"),"available player eligiblePositions");
  need(p.acquisitionState==null||["free_agent","waivers"].includes(p.acquisitionState),"available player acquisitionState");
  need(p.waiverClearsAt==null||(typeof p.waiverClearsAt==="string"&&Number.isFinite(Date.parse(p.waiverClearsAt))),"available player waiverClearsAt");
  need(strOrNull(p.name)&&strOrNull(p.position)&&strOrNull(p.proTeam)&&strOrNull(p.injuryStatus),"available player text fields");}
 return d;
}
const checkTxPlayers=list=>need(Array.isArray(list)&&list.every(p=>isObject(p)&&idString(p.id)&&strOrNull(p.name)&&strOrNull(p.position)&&strOrNull(p.team)),"transaction players");
export function checkTransactions(d){
 need(isObject(d)&&Array.isArray(d.transactions),"transactions");
 for(const t of d.transactions){
  need(isObject(t)&&typeof t.transaction_id==="string"&&typeof t.type==="string"&&typeof t.status==="string","transaction identity");
  need(finiteOrNull(t.timestamp)&&(t.week==null||int(t.week)),"transaction time");
  need(t.team_ids==null||(Array.isArray(t.team_ids)&&t.team_ids.every(idString)),"transaction team ids");
  checkTxPlayers(t.players_added??[]);checkTxPlayers(t.players_dropped??[]);
  need(t.trade_sides==null||(Array.isArray(t.trade_sides)&&t.trade_sides.every(s=>isObject(s)&&idString(s.team_id))),"transaction trade sides");
  for(const s of t.trade_sides||[]){checkTxPlayers(s.acquired??[]);checkTxPlayers(s.gave_up??[]);}
 }
 return d;
}
export function checkDraft(d){
 need(isObject(d)&&isObject(d.draft)&&Array.isArray(d.picks),"draft");
 for(const p of d.picks)need(isObject(p)&&["round","selectionInRound","overallPick","selectionTeamId","playerId"].every(k=>int(p[k])),"draft pick");
 return d;
}
