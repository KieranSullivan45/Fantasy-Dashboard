import {ProviderError} from "../contracts.js";
import {rejectCredentials} from "../espn-normalize.js";

/**
 * Sanitized ESPN league file (`espn-league-file-1`, ESPN-FILE-01, ADR 0012): a strict allow-list of ESPN's own raw field
 * names inside a versioned envelope. Every key not listed here is rejected, so a file carrying headers, cookies, member
 * data, stats, projections or other unlisted fields fails closed. Messages never echo file values or paths.
 */
export const LEAGUE_FILE_VERSION="espn-league-file-1";
export const MAX_LEAGUE_FILE_BYTES=2*1024*1024;
export const LEAGUE_FILE_LIMITS=Object.freeze({depth:12,teams:32,entries:60,schedule:1000,scoringItems:300,available:2000,eligibleSlots:40,string:128,label:64});
const FUTURE_SKEW_MS=5*60*1000;
const L=LEAGUE_FILE_LIMITS;

const invalid=message=>new ProviderError("INVALID_IMPORT","espn",`ESPN league file rejected: ${message}`);
const need=(ok,message)=>{if(!ok)throw invalid(message);};
const inconsistent=message=>new ProviderError("MAPPING_INCOMPLETE","espn",`ESPN league file rejected: ${message}`);
const isObject=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const int=v=>Number.isSafeInteger(v);
const finite=v=>typeof v==="number"&&Number.isFinite(v);
const finiteOrNull=v=>v==null||finite(v);
const strOrNull=v=>v==null||typeof v==="string";
const isoTime=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const codeKeys=o=>Object.keys(o).every(k=>/^\d{1,3}$/.test(k));
/** Object with only allowed keys (and every required key). */
function shape(value,{required=[],optional=[]},label){
 need(isObject(value),label);
 const allowed=new Set([...required,...optional]);
 need(Object.keys(value).every(k=>allowed.has(k)),`${label} has unrecognized fields`);
 need(required.every(k=>k in value),`${label} is missing required fields`);
 return value;
}
const list=(value,max,label)=>{need(Array.isArray(value)&&value.length<=max,`${label} must be a list within the size limit`);return value;};

// Authentication material, member GUIDs (SWID shape), e-mail addresses and over-long values are refused wherever they appear.
const SECRET_VALUE=/espn_s2=|swid=|bearer\s|cookie:|set-cookie|authorization:/i;
const EMAIL=/[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const GUID=/^\{?[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}\}?$/i;
function screen(value,depth=0){
 need(depth<=L.depth,"nesting exceeds the safe limit");
 if(typeof value==="string"){need(value.length<=L.string,"a text value exceeds the length limit");need(!GUID.test(value.trim())&&!SECRET_VALUE.test(value)&&!EMAIL.test(value),"authentication, member identifiers or contact details are not accepted");return;}
 if(Array.isArray(value)){for(const v of value)screen(v,depth+1);return;}
 if(isObject(value))for(const v of Object.values(value))screen(v,depth+1);
}

const PLAYER={optional:["id","fullName","defaultPositionId","eligibleSlots","proTeamId","injuryStatus","injured"]};
function checkPlayer(p,id,label){
 shape(p,PLAYER,label);
 need(p.id===id,`${label} id must equal its entry id`);
 need(strOrNull(p.fullName)&&strOrNull(p.injuryStatus),`${label} text fields`);
 need(p.defaultPositionId==null||int(p.defaultPositionId),`${label} position`);
 need(p.proTeamId==null||int(p.proTeamId),`${label} pro team`);
 need(p.injured==null||typeof p.injured==="boolean",`${label} injured flag`);
 need(p.eligibleSlots==null||(Array.isArray(p.eligibleSlots)&&p.eligibleSlots.length<=L.eligibleSlots&&p.eligibleSlots.every(x=>int(x)&&x>=0)),`${label} eligible slots`);
}
const playerId=(v,label)=>{need(int(v)&&v!==0,`${label} must be a nonzero integer ESPN id`);return v;};

/**
 * Structural and consistency validation of a parsed league file. Returns the same object (never mutated).
 * `now` bounds `captured_at` (a capture from the future is refused).
 */
export function checkLeagueFile(file,{now=Date.now()}={}){
 need(isObject(file),"expected a league file object");
 rejectCredentials(file);
 screen(file);
 shape(file,{required:["schema_version","provider","binding","captured_at","capture","league"],optional:["available"]},"league file");
 need(file.schema_version===LEAGUE_FILE_VERSION,"unsupported schema version");
 need(file.provider==="espn","provider must be espn");
 const binding=shape(file.binding,{required:["league_id","season"]},"binding");
 need(typeof binding.league_id==="string"&&/^\d{1,25}$/.test(binding.league_id),"binding league_id must be a numeric string");
 need(int(binding.season)&&binding.season>=2010&&binding.season<=2100,"binding season must be a year");
 need(isoTime(file.captured_at),"captured_at must be an ISO-8601 time");
 need(Date.parse(file.captured_at)<=now+FUTURE_SKEW_MS,"captured_at is in the future");
 const capture=shape(file.capture,{required:["method","tool","tool_version"]},"capture");
 need(Object.values(capture).every(v=>typeof v==="string"&&v.length<=L.label),"capture fields must be short descriptive text");

 const league=shape(file.league,{required:["id","seasonId","scoringPeriodId","settings","teams"],optional:["schedule"]},"league");
 need(int(league.id)&&league.id>0&&String(league.id)===binding.league_id,"league id must match the binding");
 need(league.seasonId===binding.season,"league season must match the binding");
 need(league.scoringPeriodId===null||(int(league.scoringPeriodId)&&league.scoringPeriodId>=0),"scoring period");
 const settings=shape(league.settings,{required:["size","rosterSettings"],optional:["name","scoringSettings","scheduleSettings"]},"settings");
 need(strOrNull(settings.name),"league name");
 const counts=shape(settings.rosterSettings,{required:["lineupSlotCounts"]},"roster settings").lineupSlotCounts;
 need(isObject(counts)&&codeKeys(counts)&&Object.values(counts).every(n=>int(n)&&n>=0&&n<=50),"lineup slot counts");
 if(settings.scoringSettings!=null){
  const items=list(shape(settings.scoringSettings,{required:["scoringItems"]},"scoring settings").scoringItems,L.scoringItems,"scoring items"),seen=new Set();
  for(const item of items){shape(item,{required:["statId","points"],optional:["pointsOverrides"]},"scoring item");
   need(int(item.statId)&&item.statId>=0,"scoring identifiers must be nonnegative integers");need(finite(item.points),"scoring points must be finite numbers");
   need(item.pointsOverrides==null||(isObject(item.pointsOverrides)&&codeKeys(item.pointsOverrides)&&Object.values(item.pointsOverrides).every(finite)),"scoring overrides");
   need(!seen.has(item.statId),"duplicate scoring identifiers");seen.add(item.statId);}
 }
 if(settings.scheduleSettings!=null){
  const periods=shape(settings.scheduleSettings,{required:["matchupPeriods"]},"schedule settings").matchupPeriods;
  need(isObject(periods)&&codeKeys(periods)&&Object.values(periods).every(p=>Array.isArray(p)&&p.length<=L.eligibleSlots&&p.every(x=>int(x)&&x>=0)),"matchup periods");
 }

 const teams=list(league.teams,L.teams,"teams");need(teams.length>=2,"a league needs at least two teams");
 need(settings.size===teams.length,"league size must equal the number of teams");
 const teamIds=new Set(),holder=new Map();
 for(const t of teams){
  shape(t,{required:["id","roster"],optional:["name","location","nickname","record"]},"team");
  need(int(t.id)&&t.id>0,"team id");if(teamIds.has(t.id))throw inconsistent("duplicate team ids");teamIds.add(t.id);
  need(strOrNull(t.name)&&strOrNull(t.location)&&strOrNull(t.nickname),"team text fields");
  if(t.record!=null){const overall=shape(t.record,{required:["overall"]},"team record").overall;
   shape(overall,{optional:["wins","losses","ties","pointsFor","pointsAgainst"]},"team record");need(Object.values(overall).every(finiteOrNull),"team record values");}
  const entries=list(shape(t.roster,{required:["entries"]},"roster").entries,L.entries,"roster entries"),onTeam=new Set(),used=new Map();
  for(const e of entries){
   shape(e,{required:["playerId","lineupSlotId"],optional:["playerPoolEntry"]},"roster entry");
   playerId(e.playerId,"roster entry playerId");need(int(e.lineupSlotId)&&e.lineupSlotId>=0,"roster entry lineup slot");
   if(e.playerPoolEntry!=null)checkPlayer(shape(e.playerPoolEntry,{required:["player"]},"player pool entry").player,e.playerId,"roster player");
   need(!onTeam.has(e.playerId),"a player appears twice on one roster");onTeam.add(e.playerId);
   if(holder.has(e.playerId))throw inconsistent("a player appears on more than one roster; league state is inconsistent");holder.set(e.playerId,t.id);
   if(!((counts[e.lineupSlotId]??0)>0))throw inconsistent("a roster entry occupies a lineup slot the league does not have");
   used.set(e.lineupSlotId,(used.get(e.lineupSlotId)??0)+1);
  }
  // Starting and IR slots are hard capacities; bench overflow is tolerated with a warning by the mapper.
  for(const [slot,n]of used)if(slot!==20&&n>counts[slot])throw inconsistent("a lineup slot holds more players than its capacity");
 }

 if(league.schedule!=null){const ids=new Set();
  for(const m of list(league.schedule,L.schedule,"schedule")){
   shape(m,{required:["id","matchupPeriodId","winner","home"],optional:["away"]},"matchup");
   need(int(m.id)&&!ids.has(m.id),"matchup ids must be unique integers");ids.add(m.id);
   need(int(m.matchupPeriodId)&&m.matchupPeriodId>=1,"matchup period");
   need(["HOME","AWAY","TIE","UNDECIDED"].includes(m.winner),"matchup winner");
   const sides=[m.home,m.away].filter(v=>v!=null);
   for(const s of sides){shape(s,{required:["teamId"],optional:["totalPoints"]},"matchup side");need(finiteOrNull(s.totalPoints),"matchup points");
    if(!teamIds.has(s.teamId))throw inconsistent("a matchup references a team outside the league");}
   if(sides.length===2&&m.home.teamId===m.away.teamId)throw inconsistent("a matchup pairs a team with itself");
  }}

 if(file.available!=null){
  const available=shape(file.available,{required:["coverage","players"]},"available players");
  need(available.coverage==="observed_subset","available-player coverage must be observed_subset; completeness is never claimed");
  const seen=new Set();
  for(const a of list(available.players,L.available,"available players")){
   shape(a,{required:["id","status"],optional:["waiverClearsAt","player"]},"available player");
   playerId(a.id,"available player id");
   // A league-scoped status is required: a broad player list without it is not evidence of availability.
   need(["FREEAGENT","WAIVERS"].includes(a.status),"available players need a league free-agent or waiver status");
   need(a.waiverClearsAt==null||isoTime(a.waiverClearsAt),"waiver clear time");
   if(a.player!=null)checkPlayer(a.player,a.id,"available player");
   if(holder.has(a.id))throw inconsistent("an available player is also rostered; league state is inconsistent");
   need(!seen.has(a.id),"an available player is listed twice");seen.add(a.id);
  }
 }
 return file;
}
