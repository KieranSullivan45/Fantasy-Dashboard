import {ProviderError,DOMAIN_VERSION} from "./contracts.js";
import {leaguePositions} from "../normalize/positions.js";
import {reconcilePendingTransactions} from "./espn-transactions.js";
// Verified vocabulary from espn-api's public source; unsupported values remain explicit.
export const ESPN_SLOTS={0:"QB",2:"RB",3:"WRRB_FLEX",4:"WR",5:"REC_FLEX",6:"TE",7:"SUPER_FLEX",8:"DT",9:"DE",10:"LB",11:"DL",12:"CB",13:"S",14:"DB",15:"IDP_FLEX",16:"DEF",17:"K",20:"BN",21:"IR",23:"FLEX"};
const POSITIONS={1:"QB",2:"RB",3:"WR",4:"TE",5:"K",16:"DEF"};
const TEAMS={1:"ATL",2:"BUF",3:"CHI",4:"CIN",5:"CLE",6:"DAL",7:"DEN",8:"DET",9:"GB",10:"TEN",11:"IND",12:"KC",13:"LV",14:"LAR",15:"MIA",16:"MIN",17:"NE",18:"NO",19:"NYG",20:"NYJ",21:"PHI",22:"ARI",23:"PIT",24:"LAC",25:"SF",26:"SEA",27:"TB",28:"WAS",29:"CAR",30:"JAX",33:"BAL",34:"HOU"};
const BASIC={0:"pass_att",1:"pass_cmp",2:"pass_inc",3:"pass_yd",4:"pass_td",19:"pass_2pt",20:"pass_int",23:"rush_att",24:"rush_yd",25:"rush_td",26:"rush_2pt",42:"rec_yd",43:"rec_td",44:"rec_2pt",53:"rec",68:"fum",72:"fum_lost",83:"fgm",85:"fgmiss",86:"xpm",88:"xpmiss"};
// 41/53 and 3/22 aliases are not presumed interchangeable: only confirmed scoring IDs above.
const number=v=>typeof v==="number"&&Number.isFinite(v)?v:null;
/** Internal, in-memory ESPN league facts contract (never archived or served). Every ESPN source maps into it. */
export const ESPN_FACTS_VERSION="espn-facts-1";
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
export function slotsFromCounts(counts){
 if(!counts||typeof counts!=="object")throw new ProviderError("INVALID_IMPORT","espn","Lineup slot counts are required.");
 const slots=[];
 for(const [id,n]of Object.entries(counts)){if(!Number.isInteger(n)||n<0||n>50)throw new ProviderError("INVALID_IMPORT","espn","Invalid lineup slot count.");for(let i=0;i<n;i++)slots.push(ESPN_SLOTS[id]||`UNSUPPORTED_ESPN_SLOT_${id}`);}
 return slots;
}
/** Authorized raw ESPN league JSON → ESPN facts. Raw codes are translated here with the verified tables above. */
/** One raw ESPN player object → facts player (verified tables only). Shared by the raw import and league-file mappers. */
export function espnRawPlayer(p){if(!/^-?\d{1,25}$/.test(String(p.id)))throw new ProviderError("INVALID_IMPORT","espn","Player identifiers are required.");
 return {espn_id:String(p.id),name:p.fullName||null,position:POSITIONS[p.defaultPositionId]||null,eligibility:[...new Set((p.eligibleSlots||[]).filter(x=>![3,5,7,20,21,23].includes(x)).map(x=>ESPN_SLOTS[x]).filter(Boolean))],team:TEAMS[p.proTeamId]||null,provider_team_id:p.proTeamId??null,injury_status:p.injuryStatus||null,injured:!!p.injured};}
// Verified scoring statistic ids (read-only view for cross-checks; never extended by inference).
export const ESPN_SCORING_STATS=Object.freeze({...BASIC});
export function espnFactsFromImport(raw){
 rejectCredentials(raw);
 if(!raw||!Number.isInteger(raw.seasonId)||raw.seasonId<2010||raw.seasonId>2100||!/^\d{1,25}$/.test(String(raw.id))||!Array.isArray(raw.teams)||!raw.settings?.rosterSettings?.lineupSlotCounts)throw new ProviderError("INVALID_IMPORT","espn","Expected league id, seasonId, teams and roster settings.");
 const items=raw.settings.scoringSettings?.scoringItems;translateEspnScoring(items);slotsFromCounts(raw.settings.rosterSettings.lineupSlotCounts);
 const player=espnRawPlayer;
 const scheduleSettings=raw.settings.scheduleSettings;
 return {version:ESPN_FACTS_VERSION,provider:"espn",provenance:{source:"ESPN authorized offline import",source_transport:"authorized_import",access:"authorized_offline",private_live:false},
  league:{id:String(raw.id),season:raw.seasonId,name:raw.settings.name||null,scoring_period:number(raw.scoringPeriodId),current_season_verified:false,slot_counts:raw.settings.rosterSettings.lineupSlotCounts,matchup_periods:scheduleSettings?.matchupPeriods??null,playoff_teams:scheduleSettings?.playoffTeamCount??null},
  scoring:{available:true,source:"league_settings",items},user_team_id:null,
  teams:raw.teams.map(t=>{const record=t.record?.overall;return {id:t.id,name:t.name||[t.location,t.nickname].filter(Boolean).join(' ')||null,owner_id:t.primaryOwner??null,
   record:{wins:number(record?.wins),losses:number(record?.losses),ties:number(record?.ties),points_for:number(t.points),points_against:number(t.pointsAgainst)},playoff_seed:null,waiver_rank:number(t.waiverRank),
   faab:{spent:number(t.transactionCounter?.acquisitionBudgetSpent),budget:number(raw.settings.acquisitionSettings?.acquisitionBudget)},
   entries:(t.roster?.entries||[]).map(e=>({slot:ESPN_SLOTS[e.lineupSlotId]||`UNSUPPORTED_ESPN_SLOT_${e.lineupSlotId}`,player:player(e.playerPoolEntry?.player||{id:e.playerId}),acquisition:null}))};}),
  matchups:(raw.schedule||[]).map(m=>({id:m.id,matchup_period:m.matchupPeriodId,final:null,sides:[m.home,m.away].filter(Boolean).map(s=>({team_id:s.teamId,points:number(s.totalPoints)}))})),
  available:null,transactions:null,draft:null,roster_history:[],warnings:[]};
}
const OFFLINE_NOTICE="Offline import only. Complete free-agent pool, transaction history, add interest and multi-week/unmapped matchup periods are unavailable.";
/**
 * ESPN facts → snapshot 0.2. Source-agnostic: it reads only the facts contract. Missing scoring stays missing
 * (`coverage.scoring_available: false`, empty rules) and scoring-dependent consumers must refuse it.
 */
export function snapshotFromEspnFacts(facts,{crosswalk=[],rosterId=null,now=new Date().toISOString(),includeOwnPending=false}={}){
 if(facts?.version!==ESPN_FACTS_VERSION||facts.provider!=="espn")throw new ProviderError("INVALID_IMPORT","espn","Unsupported ESPN facts contract.");
 const warnings=[],warn=(code,message)=>warnings.push({code,resource:"provider",message});
 const scoringAvailable=facts.scoring?.available===true,authorized=scoringAvailable&&facts.scoring.source==="user_authorized";
 // Authorized configurations arrive already translated (lib/providers/espn-scoring.js); provider settings carry raw ESPN items.
 const scoring=!scoringAvailable?{rules:{},unsupported:[]}:authorized?{rules:{...facts.scoring.rules},unsupported:facts.scoring.unsupported.map(u=>({...u}))}:translateEspnScoring(facts.scoring.items);
 if(!scoringAvailable)warn("UNSUPPORTED_FEATURE","League scoring rules are unavailable from this ESPN source; league-scored values and scoring-dependent analysis are disabled.");
 if(authorized)warn("PROVENANCE","League scoring comes from a user-authorized configuration bound to this league and season, not from the provider.");
 if(authorized&&scoring.unsupported.length)warn("UNSUPPORTED_FEATURE","Some authorized scoring rules cannot be computed from available statistics and are listed as unsupported; affected totals are supported-rule partial. Team D/ST scoring is not modeled.");
 else if(scoring.unsupported.length)warn("UNSUPPORTED_FEATURE","Unverified ESPN scoring rules retained as unsupported; totals cannot be treated as complete.");
 const league=facts.league,counts=league.slot_counts,slots=slotsFromCounts(counts);
 const entrySlots=facts.teams.flatMap(t=>t.entries.map(e=>e.slot)).filter(s=>s.startsWith('UNSUPPORTED')&&!slots.includes(s));
 const unsupportedSlots=[...slots.filter(s=>s.startsWith('UNSUPPORTED')),...new Set(entrySlots)];
 if(unsupportedSlots.length)warn("UNSUPPORTED_FEATURE","Unknown lineup slots prevent complete legal-lineup evaluation.");
 const player=(p,reserve)=>{const ref=playerReference("espn",p.espn_id,crosswalk);
  if(!p.eligibility.length)warn("MAPPING_INCOMPLETE",`ESPN player ${p.espn_id} has no mapped fantasy eligibility; retained without guessing.`);
  if(ref.mapping_status!=="exact_crosswalk")warn("MAPPING_INCOMPLETE",`ESPN player ${p.espn_id} has no unambiguous canonical mapping.`);
  return {player_id:ref.canonical_id||`unresolved:espn:${p.espn_id}`,identity:ref,name:p.name||`ESPN player ${p.espn_id}`,position:p.position,fantasy_positions:[...p.eligibility],provider_positions:[p.position].filter(Boolean),team:p.team,provider_team_id:p.provider_team_id,injury_status:p.injury_status,status:p.injured?"Injured":null,reserve,taxi:false,search_rank:null,trending_adds:null};};
 const active=slots.filter(s=>!["BN","IR"].includes(s));
 const rosterViews=facts.teams.map(t=>{const entries=t.entries,all=entries.map(e=>player(e.player,e.slot==="IR"));const used=new Set();
  const starterSlots=active.map(slot=>{const i=entries.findIndex((e,i)=>!used.has(i)&&e.slot===slot);if(i>=0)used.add(i);return {slot,player_id:i>=0?all[i].player_id:null};});
  return {roster_id:t.id,provider_roster_id:String(t.id),owner_id:t.owner_id,team_name:t.name||`Team ${t.id}`,is_user:false,all_players:all,starter_slots:starterSlots,starters:all.filter((p,i)=>used.has(i)),bench:all.filter((p,i)=>entries[i].slot==="BN"),reserve:all.filter(p=>p.reserve),taxi:[],record:{...t.record},waiver_position:t.waiver_rank,waiver_budget_used:null,provider_faab:{...t.faab}};});
 // A roster is "mine" only through an explicit selection or a provider-resolved owner; never inferred.
 const selected=rosterId??facts.user_team_id??null;
 for(const r of rosterViews)r.is_user=selected!=null&&String(selected)===String(r.roster_id);
 if(selected!=null&&!rosterViews.some(r=>r.is_user))throw new ProviderError("LEAGUE_NOT_FOUND","espn","Selected roster is not present in the league data.");
 const week=league.scoring_period,matchups=[];
 for(const m of facts.matchups||[]){const periods=league.matchup_periods?.[m.matchup_period];if(!Array.isArray(periods)||periods.length!==1||periods[0]!==week)continue;for(const side of m.sides){const roster=rosterViews.find(r=>r.roster_id===side.team_id);matchups.push({roster_id:side.team_id,matchup_id:m.id,points:side.points,custom_points:null,starters:roster?.starter_slots.map(s=>s.player_id)||[],starters_points:[],players_points:{}});}}
 if((facts.matchups||[]).some(m=>m.final===false))warn("UNSUPPORTED_FEATURE","Points for undecided matchups are not final and are withheld.");
 const freeAgents={},faTruncation={};
 if(facts.available){const positions=leaguePositions(slots);for(const pos of positions){freeAgents[pos]=[];}
  for(const a of facts.available.players){const p={...player(a.player,false),trending_adds_24h:null,acquisition_state:a.acquisition_state,waiver_clears_at:a.waiver_clears_at};for(const pos of positions)if(p.fantasy_positions.includes(pos))freeAgents[pos].push(p);}
  for(const pos of positions)faTruncation[pos]={total:null,returned:freeAgents[pos].length,omitted:null,limit:facts.available.limit??null};
  if(!facts.available.complete)warn("UNSUPPORTED_FEATURE","Available players are a provider-capped subset, not the complete league pool; acquisition recommendations are disabled.");}
 const teamName=id=>rosterViews.find(r=>String(r.roster_id)===String(id))?.team_name||`Team ${id}`;
 // Transaction players are display references only: identity via the same crosswalk, eligibility left unknown.
 const txPlayer=x=>{const ref=playerReference("espn",x.espn_id,crosswalk);return {player:{player_id:ref.canonical_id||`unresolved:espn:${x.espn_id}`,identity:ref,name:x.name||`ESPN player ${x.espn_id}`,position:x.position,fantasy_positions:[],team:x.team,injury_status:null,status:null,search_rank:null},roster_id:x.team_id,team_name:x.team_id==null?null:teamName(x.team_id)};};
 // Private pending items are withheld, except (private mode only) the session owner's own actions: exactly one team, theirs.
 // A pending item is surfaced only when no later record resolves it or may resolve it (ADR 0006); unprovable items fail closed.
 const stale=reconcilePendingTransactions(facts.transactions?.items);
 const isOwn=t=>facts.user_team_id!=null&&t.team_ids.length===1&&t.team_ids[0]===facts.user_team_id;
 const ownPending=t=>includeOwnPending&&isOwn(t)&&!stale.has(t);
 const publicTx=(facts.transactions?.items||[]).filter(t=>!stale.has(t)&&(!t.private||ownPending(t))),ownCount=publicTx.filter(t=>t.private).length;
 // Only the owner's own stale items are counted apart (private mode); other managers' stay inside the withheld count.
 const ownStale=includeOwnPending?[...stale.keys()].filter(isOwn).length:0;
 const recent=publicTx.map(t=>({...(t.private?{visibility:"owner_private"}:{}),transaction_id:t.id,type:t.type,status:t.status,created:t.timestamp,status_updated:null,leg:t.week,settings:{},metadata:{},draft_picks:[],waiver_budget:[],roster_ids:[...t.team_ids],teams:t.team_ids.map(teamName),waiver_bid:t.faab_bid,adds:t.adds.map(txPlayer),drops:t.drops.map(txPlayer)}));
 if(facts.transactions){const withheld=facts.transactions.items.length-publicTx.length-ownStale;if(withheld)warn("PRIVATE_DATA_WITHHELD",`${withheld} private pending transaction item(s) withheld.`);if(ownStale)warn("STALE_DATA_RISK",`${ownStale} of your own transaction item(s) marked pending by ESPN were hidden: a later record resolves or may resolve them, so they cannot be shown as pending.`);if(ownCount)warn("PRIVATE_DATA",`${ownCount} of your own pending transaction item(s) included; visible in local private mode only.`);if(facts.transactions.truncated!==false)warn("UNSUPPORTED_FEATURE","Recent transactions are a bounded window and may be truncated; history is incomplete.");}
 if(!facts.available&&facts.provenance.visibility==="private")warn("UNSUPPORTED_FEATURE","No available-player list was supplied; the pool is unknown and acquisition, replacement and trade analysis are disabled.");
 for(const w of facts.warnings||[])warn(w.code,w.message);
 if(facts.provenance.captured_at)warn("STALE_DATA_RISK",`Saved snapshot captured ${facts.provenance.captured_at}; rosters, matchups and transactions may have changed since.`);
 if(facts.provenance.access==="authorized_offline")warn("UNSUPPORTED_FEATURE",OFFLINE_NOTICE);
 else warn("UNSUPPORTED_FEATURE","Read-only ESPN facts. Add interest, rostered-rate inputs, waiver priority and FAAB are unavailable; missing values stay unknown.");
 const mine=rosterViews.find(r=>r.is_user)||null;
 const coverage={provider:"espn",access:facts.provenance.access,source_transport:facts.provenance.source_transport,current_season_verified:league.current_season_verified===true,scoring_available:scoringAvailable,scoring_source:scoringAvailable?facts.scoring.source??"league_settings":null,...(authorized?{scoring_status:facts.scoring.status,scoring_binding:{...facts.scoring.binding}}:{}),unsupported_scoring:scoring.unsupported,unsupported_slots:unsupportedSlots};
 // Live current-season facts carry a provider scoring period, not an NFL season type: the engine must verify it (lib/decision/season-state.js).
 // A saved league file has no session to prove the season, so its scoring period is always checked against the schedule.
 if(league.current_season_verified===true||facts.provenance.access==="saved_league_file")coverage.nfl_state_verification="required";
 if(facts.provenance.visibility)coverage.visibility=facts.provenance.visibility;
 if(facts.provenance.captured_at)coverage.captured_at=facts.provenance.captured_at;
 if(facts.available)coverage.available_players={complete:facts.available.complete===true,returned:facts.available.players.length,limit:facts.available.limit??null};
 // Private facts (transport or saved file) without an available-player list report an incomplete (empty) pool explicitly; never implied complete.
 else if(facts.provenance.visibility==="private")coverage.available_players={complete:false,returned:0,limit:null};
 if(facts.transactions)coverage.transactions={complete:false,truncated:facts.transactions.truncated!==false,withheld_private:facts.transactions.items.length-publicTx.length,...(includeOwnPending?{owner_pending_included:ownCount,...(ownStale?{owner_pending_reconciled_out:ownStale}:{})}:{})};
 return {schema_version:"0.2",domain_version:DOMAIN_VERSION,view:"full",generated_at:now,source:facts.provenance.source,identity:{provider:"espn",provider_user_id:null,selected_roster_id:mine?.roster_id??null,mode:!mine?"spectator":rosterId!=null?"selected_roster":"account"},
 league:{provider:"espn",provider_league_id:league.id,league_id:league.id,name:league.name||`ESPN ${league.id}`,season:league.season,status:null,sport:"nfl",total_rosters:facts.teams.length,roster_positions:slots,scoring_settings:scoring.rules,settings:{reserve_slots:counts[21]??0,taxi_slots:0,playoff_teams:league.playoff_teams??null}},
 nfl_state:{season:league.season,season_type:null,week,leg:week},my_roster:mine,rosters:rosterViews,standings:rosterViews.map(r=>({roster_id:r.roster_id,team_name:r.team_name,...r.record})),free_agents:freeAgents,trending_available:[],recent_transactions:recent,matchup_week:week,matchup_players:rosterViews.flatMap(r=>r.starters),current_matchups:matchups,
 capabilities:{completePlayerPool:facts.available?.complete===true,legalLineup:unsupportedSlots.length===0,transactions:!!facts.transactions,addInterest:false,privateLiveAccess:facts.provenance.private_live===true,scoringRules:scoringAvailable},coverage,truncation:{free_agents:faTruncation,recent_transactions:{total:null,returned:recent.length,omitted:null,limit:facts.transactions?null:0},trending_available:{total:null,returned:0,omitted:null,limit:0}},partial:true,warnings};
}
export function normalizeEspn(raw,options={}){return snapshotFromEspnFacts(espnFactsFromImport(raw),options);}
