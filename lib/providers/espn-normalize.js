import {ProviderError,DOMAIN_VERSION} from "./contracts.js";
// Verified vocabulary from espn-api's public source; unsupported values remain explicit.
export const ESPN_SLOTS={0:"QB",2:"RB",3:"WRRB_FLEX",4:"WR",5:"REC_FLEX",6:"TE",7:"SUPER_FLEX",8:"DT",9:"DE",10:"LB",11:"DL",12:"CB",13:"S",14:"DB",15:"IDP_FLEX",16:"DEF",17:"K",20:"BN",21:"IR",23:"FLEX"};
const POSITIONS={1:"QB",2:"RB",3:"WR",4:"TE",5:"K",16:"DEF"};
const TEAMS={1:"ATL",2:"BUF",3:"CHI",4:"CIN",5:"CLE",6:"DAL",7:"DEN",8:"DET",9:"GB",10:"TEN",11:"IND",12:"KC",13:"LV",14:"LAR",15:"MIA",16:"MIN",17:"NE",18:"NO",19:"NYG",20:"NYJ",21:"PHI",22:"ARI",23:"PIT",24:"LAC",25:"SF",26:"SEA",27:"TB",28:"WAS",29:"CAR",30:"JAX",33:"BAL",34:"HOU"};
const BASIC={0:"pass_att",1:"pass_cmp",2:"pass_inc",3:"pass_yd",4:"pass_td",19:"pass_2pt",20:"pass_int",23:"rush_att",24:"rush_yd",25:"rush_td",26:"rush_2pt",42:"rec_yd",43:"rec_td",44:"rec_2pt",53:"rec",68:"fum",72:"fum_lost",83:"fgm",85:"fgmiss",86:"xpm",88:"xpmiss"};
// 41/53 and 3/22 aliases are not presumed interchangeable: only confirmed scoring IDs above.
const number=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
export function rejectCredentials(value,depth=0){
 if(depth>30)throw new ProviderError("INVALID_IMPORT","espn","Import nesting exceeds the safe limit.");
 if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){
  if(/password|cookie|espn_s2|swid|authorization|token|secret/i.test(k))throw new ProviderError("INVALID_IMPORT","espn","Authentication material is not accepted in imports.");
  rejectCredentials(v,depth+1);
 }
}
export function translateEspnScoring(items){
 if(!Array.isArray(items))throw new ProviderError("MAPPING_INCOMPLETE","espn","Scoring settings are required; no default scoring is assumed.");
 const rules={},unsupported=[];
 for(const item of items){if(!item||!Number.isInteger(item.statId)||item.statId<0)throw new ProviderError("INVALID_IMPORT","espn","Scoring identifiers must be nonnegative integers.");const key=BASIC[item.statId],points=number(item.points);
  if(points===0)continue;
  if(!key||points==null||item.pointsOverrides||item.scoringCategoryId!=null){unsupported.push({stat_id:item.statId,points,reason:"Unverified rule or positional/banded override"});rules[`unsupported_espn_${item.statId}`]=points??1;continue;}
  if(key in rules)throw new ProviderError("MAPPING_INCOMPLETE","espn","Duplicate scoring rules require manual resolution.");rules[key]=points;
 }
 return {rules,unsupported};
}
export function playerReference(provider,id,crosswalk=[]){
 const matches=crosswalk.filter(r=>String(r[`${provider}_id`])===String(id)&&r.gsis_id&&!['NA','null'].includes(r.gsis_id));
 const ids=[...new Set(matches.map(r=>r.gsis_id))],reverse=ids.length===1?new Set(crosswalk.filter(r=>r.gsis_id===ids[0]&&r[`${provider}_id`]).map(r=>String(r[`${provider}_id`]))):new Set();
 const gsis=ids.length===1&&reverse.size===1?ids[0]:null;
 return {provider,provider_player_id:String(id),canonical_id:gsis?`nfl:${gsis}`:null,statistical_id:gsis,mapping_status:gsis?"exact_crosswalk":ids.length?"ambiguous":"unresolved",mapping_confidence:gsis?"exact":"none"};
}
export function normalizeEspn(raw,{crosswalk=[],rosterId=null,now=new Date().toISOString()}={}){
 rejectCredentials(raw);
 if(!raw||!Number.isInteger(raw.seasonId)||raw.seasonId<2010||raw.seasonId>2100||!/^\d{1,25}$/.test(String(raw.id))||!Array.isArray(raw.teams)||!raw.settings?.rosterSettings?.lineupSlotCounts)throw new ProviderError("INVALID_IMPORT","espn","Expected league id, seasonId, teams and roster settings.");
 const warnings=[],warn=(code,message)=>warnings.push({code,resource:"provider",message});
 const scoring=translateEspnScoring(raw.settings.scoringSettings?.scoringItems);
 if(scoring.unsupported.length)warn("UNSUPPORTED_FEATURE","Unverified ESPN scoring rules retained as unsupported; totals cannot be treated as complete.");
 const counts=raw.settings.rosterSettings.lineupSlotCounts,slots=[];
 for(const [id,n]of Object.entries(counts)){if(!Number.isInteger(n)||n<0||n>50)throw new ProviderError("INVALID_IMPORT","espn","Invalid lineup slot count.");for(let i=0;i<n;i++)slots.push(ESPN_SLOTS[id]||`UNSUPPORTED_ESPN_SLOT_${id}`);}
 const unsupportedSlots=slots.filter(s=>s.startsWith('UNSUPPORTED'));
 if(unsupportedSlots.length)warn("UNSUPPORTED_FEATURE","Unknown lineup slots prevent complete legal-lineup evaluation.");
 const player=(p,slot)=>{if(!/^-?\d{1,25}$/.test(String(p.id)))throw new ProviderError("INVALID_IMPORT","espn","Player identifiers are required.");const ref=playerReference("espn",p.id,crosswalk),eligible=(p.eligibleSlots||[]).filter(x=>![3,5,7,20,21,23].includes(x)).map(x=>ESPN_SLOTS[x]).filter(Boolean);
  if(!eligible.length)warn("MAPPING_INCOMPLETE",`ESPN player ${p.id} has no mapped fantasy eligibility; retained without guessing.`);
  if(ref.mapping_status!=="exact_crosswalk")warn("MAPPING_INCOMPLETE",`ESPN player ${p.id} has no unambiguous canonical mapping.`);
  return {player_id:ref.canonical_id||`unresolved:espn:${p.id}`,identity:ref,name:p.fullName||`ESPN player ${p.id}`,position:POSITIONS[p.defaultPositionId]||null,fantasy_positions:[...new Set(eligible)],provider_positions:[POSITIONS[p.defaultPositionId]].filter(Boolean),team:TEAMS[p.proTeamId]||null,provider_team_id:p.proTeamId??null,injury_status:p.injuryStatus||null,status:p.injured?"Injured":null,reserve:slot===21,taxi:false,search_rank:null,trending_adds:null};};
 const rosterViews=raw.teams.map(t=>{const entries=t.roster?.entries||[],all=entries.map(e=>player(e.playerPoolEntry?.player||{id:e.playerId},e.lineupSlotId));const active=slots.filter(s=>!["BN","IR"].includes(s));const used=new Set();
  const starterSlots=active.map(slot=>{const i=entries.findIndex((e,i)=>!used.has(i)&&(ESPN_SLOTS[e.lineupSlotId]||`UNSUPPORTED_ESPN_SLOT_${e.lineupSlotId}`)===slot);if(i>=0)used.add(i);return {slot,player_id:i>=0?all[i].player_id:null};});
  const record=t.record?.overall;
  return {roster_id:t.id,provider_roster_id:String(t.id),owner_id:t.primaryOwner??null,team_name:t.name||[t.location,t.nickname].filter(Boolean).join(' ')||`Team ${t.id}`,is_user:rosterId!=null&&String(rosterId)===String(t.id),all_players:all,starter_slots:starterSlots,starters:all.filter((p,i)=>used.has(i)),bench:all.filter((p,i)=>entries[i].lineupSlotId===20),reserve:all.filter(p=>p.reserve),taxi:[],record:{wins:number(record?.wins),losses:number(record?.losses),ties:number(record?.ties),points_for:number(t.points),points_against:number(t.pointsAgainst)},waiver_position:number(t.waiverRank),waiver_budget_used:null,provider_faab:{spent:number(t.transactionCounter?.acquisitionBudgetSpent),budget:number(raw.settings.acquisitionSettings?.acquisitionBudget)}};});
 if(rosterId!=null&&!rosterViews.some(r=>r.is_user))throw new ProviderError("LEAGUE_NOT_FOUND","espn","Selected roster is not present in the import.");
 const week=number(raw.scoringPeriodId),matchups=[];
 for(const m of raw.schedule||[]){const periods=raw.settings.scheduleSettings?.matchupPeriods?.[m.matchupPeriodId];if(!Array.isArray(periods)||periods.length!==1||periods[0]!==week)continue;for(const side of [m.home,m.away].filter(Boolean)){const roster=rosterViews.find(r=>r.roster_id===side.teamId);matchups.push({roster_id:side.teamId,matchup_id:m.id,points:number(side.totalPoints),custom_points:null,starters:roster?.starter_slots.map(s=>s.player_id)||[],starters_points:[],players_points:{}});}}
 warn("UNSUPPORTED_FEATURE","Offline import only. Complete free-agent pool, transaction history, add interest and multi-week/unmapped matchup periods are unavailable.");
 const mine=rosterViews.find(r=>r.is_user)||null;
 return {schema_version:"0.2",domain_version:DOMAIN_VERSION,view:"full",generated_at:now,source:"ESPN authorized offline import",identity:{provider:"espn",provider_user_id:null,selected_roster_id:mine?.roster_id??null,mode:mine?"selected_roster":"spectator"},
 league:{provider:"espn",provider_league_id:String(raw.id),league_id:String(raw.id),name:raw.settings.name||`ESPN ${raw.id}`,season:raw.seasonId,status:null,sport:"nfl",total_rosters:raw.teams.length,roster_positions:slots,scoring_settings:scoring.rules,settings:{reserve_slots:counts[21]??0,taxi_slots:0,playoff_teams:raw.settings.scheduleSettings?.playoffTeamCount??null}},
 nfl_state:{season:raw.seasonId,season_type:null,week,leg:week},my_roster:mine,rosters:rosterViews,standings:rosterViews.map(r=>({roster_id:r.roster_id,team_name:r.team_name,...r.record})),free_agents:{},trending_available:[],recent_transactions:[],matchup_week:week,matchup_players:rosterViews.flatMap(r=>r.starters),current_matchups:matchups,
 capabilities:{completePlayerPool:false,legalLineup:unsupportedSlots.length===0,transactions:false,addInterest:false,privateLiveAccess:false},coverage:{provider:"espn",access:"authorized_offline",current_season_verified:false,unsupported_scoring:scoring.unsupported,unsupported_slots:unsupportedSlots},truncation:{free_agents:{},recent_transactions:{total:null,returned:0,omitted:null,limit:0},trending_available:{total:null,returned:0,omitted:null,limit:0}},partial:true,warnings};
}
