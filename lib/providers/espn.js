import {capability,unavailable,ProviderError} from "./contracts.js";
import {normalizeEspn,espnFactsFromImport,snapshotFromEspnFacts,playerReference,ESPN_FACTS_VERSION} from "./espn-normalize.js";
import {interestContext} from "../decision/interest.js";
export const espnCapabilities=Object.fromEntries(["publicLeagueAccess","privateLeagueAccess","accountLeagueDiscovery","currentRosters","historicalRosters","transactions","FAAB","waiverPriority","matchupData","draftPickTrading","taxiSquads","IR","multiPositionEligibility","rosteredPercentage","addInterest","historicalTransactions","leagueSettings","scoringRules"].map(k=>[k,capability("unsupported","Live ESPN transport is disabled; authorized offline import is separate") ]));
const SCORING_REQUIRED="League scoring rules are unavailable from this ESPN source; scoring-dependent analysis (decision support, Pickup Rating, trades) is disabled.";
/** Capabilities of injected ESPN facts, derived from what the facts actually contain (never from the transport name). */
function factCapabilities(f){
 const has=(ok,reason,missing)=>ok?capability("available",reason):capability("unsupported",missing);
 return {currentRosters:capability("available","Injected ESPN facts; no live connection in this provider"),IR:capability("available","Reserve placement from the lineup slot only"),multiPositionEligibility:capability("available","Verified single-position eligibility; flex groupings are slot rules"),
  leagueSettings:capability("available","Lineup slots, matchup periods; playoff size, waiver type and FAAB budget not supplied"),
  scoringRules:has(f.scoring?.available===true,null,SCORING_REQUIRED),
  matchupData:has(f.matchups?.length>0,"Single-week periods only; undecided matchups have no points","No matchup facts supplied"),
  transactions:has(!!f.transactions,"Recent bounded window; may be truncated; private pending items withheld","No transaction facts supplied"),
  historicalRosters:has(f.roster_history?.length>0,"Weekly membership and slots only","No historical roster facts supplied"),
  draftResults:has(!!f.draft,"Completed selections; no pick-ownership ledger","No draft facts supplied"),
  completePlayerPool:capability("unsupported","Available players are a provider-capped subset; completeness cannot be proven"),
  FAAB:has(f.teams.some(t=>t.faab.budget!=null),null,"FAAB budget/balance not supplied"),waiverPriority:has(f.teams.some(t=>t.waiver_rank!=null),null,"Waiver priority not supplied"),
  addInterest:capability("unsupported","No add-interest source for ESPN"),rosteredPercentage:capability("unsupported","Platform-wide rates are discarded; they are not league or market value")};
}
export class ESPNProvider {
 providerId="espn";
 /** `authorizedImport`: raw authorized ESPN league JSON. `espnFacts`: an `espn-facts-1` object from any mapped ESPN source. */
 constructor({authorizedImport=null,espnFacts=null,crosswalk=[]}={}){
  if(authorizedImport&&espnFacts)throw new ProviderError("INVALID_IMPORT","espn","Supply one ESPN data source.");
  this.imported=authorizedImport?structuredClone(authorizedImport):null;this.crosswalk=crosswalk;
  this.facts=espnFacts?structuredClone(espnFacts):this.imported?espnFactsFromImport(this.imported):null;
  if(this.facts&&this.facts.version!==ESPN_FACTS_VERSION)throw new ProviderError("INVALID_IMPORT","espn","Unsupported ESPN facts contract.");
  if(this.facts)snapshotFromEspnFacts(this.facts,{crosswalk});
 }
 getIdentityRows(rows){return {rows:rows.map(r=>({...r,canonical_id:r.gsis_id&&!['NA','null'].includes(r.gsis_id)?`nfl:${r.gsis_id}`:null})),idColumn:"canonical_id"};}
 getInterest(players){return interestContext(players,true);}
 getMarketAttention(){return null;}
 getProviderCapabilities(){
  if(this.facts&&!this.imported)return {...espnCapabilities,...factCapabilities(this.facts)};
  return {...espnCapabilities,authorizedImport:capability("available","Browser-local preview / injected offline loader; no live sync")};
 }
 normalize(raw,options){return normalizeEspn(raw,options);}
 getSnapshot(id,options={}){if(!this.facts)return unavailable("espn","Live league access");if(String(id)!==this.facts.league.id||options.season!=null&&Number(options.season)!==this.facts.league.season)throw new ProviderError("LEAGUE_NOT_FOUND","espn","League/season does not match the loaded ESPN data.");return snapshotFromEspnFacts(this.facts,{crosswalk:this.crosswalk,rosterId:options.rosterId});}
 getDecisionContext(id,options){const snapshot=this.getSnapshot(id,options);if(snapshot.coverage.scoring_available===false)throw new ProviderError("UNSUPPORTED_FEATURE","espn",SCORING_REQUIRED);return snapshot;}
 getTransactions(id,o){if(!this.facts?.transactions)return unavailable("espn","getTransactions");return this.getSnapshot(id,o).recent_transactions;}
 getDraftPicks(id,o){const draft=this.facts?.draft;if(!draft)return unavailable("espn","getDraftPicks");this.getSnapshot(id,o);
  return {status:"completed_selections_only",draft_status:draft.status,ownership:null,picks:draft.picks.map(p=>({round:p.round,pick:p.pick,overall:p.overall,roster_id:p.team_id,keeper:p.keeper,player:playerReference("espn",p.espn_id,this.crosswalk)}))};}
 resolveUser(){return unavailable("espn","Account resolution");}
 discoverLeagues(){return unavailable("espn","Account discovery");}
 getSeasonState(){return unavailable("espn","Live season resolution");}
}
for(const [method,field]of Object.entries({getLeague:"league",getRosters:"rosters",getMatchups:"current_matchups",getUserRoster:"my_roster",getStandings:"standings"}))ESPNProvider.prototype[method]=function(id,o){return this.getSnapshot(id,o)[field]};
ESPNProvider.prototype.getLeagueSettings=function(id,o){const l=this.getSnapshot(id,o).league;return {settings:l.settings,scoring:l.scoring_settings,slots:l.roster_positions}};
ESPNProvider.prototype.getPlayers=function(id,o){const s=this.getSnapshot(id,o);return [...new Map([...s.rosters.flatMap(r=>r.all_players),...Object.values(s.free_agents).flat()].map(p=>[p.player_id,p])).values()]};
ESPNProvider.prototype.getWaiverState=function(id,o){return this.getSnapshot(id,o).rosters.map(r=>({roster_id:r.roster_id,waiver_position:r.waiver_position,faab:r.provider_faab}))};
