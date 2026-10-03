import {capability,unavailable,ProviderError} from "./contracts.js";
import {normalizeEspn,espnFactsFromImport,snapshotFromEspnFacts,playerReference,ESPN_FACTS_VERSION} from "./espn-normalize.js";
import {interestContext} from "../decision/interest.js";
import {applyAuthorizedEspnScoring} from "./espn-scoring.js";
export const espnCapabilities=Object.fromEntries(["publicLeagueAccess","privateLeagueAccess","accountLeagueDiscovery","currentRosters","historicalRosters","transactions","FAAB","waiverPriority","matchupData","draftPickTrading","taxiSquads","IR","multiPositionEligibility","rosteredPercentage","addInterest","historicalTransactions","leagueSettings","scoringRules"].map(k=>[k,capability("unsupported","Live ESPN transport is disabled; authorized offline import is separate") ]));
const SCORING_REQUIRED="League scoring rules are unavailable from this ESPN source; scoring-dependent analysis (decision support, Pickup Rating, trades) is disabled.";
const POOL_REQUIRED="Requires a complete available-player pool; this ESPN source returns a capped subset";
/** Capabilities of injected ESPN facts, derived from what the facts actually contain (never from the transport name). */
function factCapabilities(f){
 const has=(ok,reason,missing)=>ok?capability("available",reason):capability("unsupported",missing);
 return {currentRosters:capability("available","Injected ESPN facts; no live connection in this provider"),IR:capability("available","Reserve placement from the lineup slot only"),multiPositionEligibility:capability("available","Verified single-position eligibility; flex groupings are slot rules"),
  leagueSettings:capability("available","Lineup slots, matchup periods; playoff size, waiver type and FAAB budget not supplied"),
  scoringRules:has(f.scoring?.available===true,f.scoring?.source==="user_authorized"?"User-authorized configuration bound to this league and season; unsupported rules listed in coverage":null,SCORING_REQUIRED),
  // Each engine is gated on its own prerequisites; scoring alone does not enable pool-dependent analysis.
  decisionSupport:has(f.scoring?.available===true,"Start values and legal lineups; replacement levels, VOR, add/drop and Pickup Rating withheld without a complete pool",SCORING_REQUIRED),
  pickupRating:capability("unsupported",`${POOL_REQUIRED}; add interest is also unavailable and missing weights are never redistributed`),
  tradeAnalysis:capability("unsupported",`${POOL_REQUIRED} for replacement levels`),
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
 /**
  * `authorizedImport`: raw authorized ESPN league JSON. `espnFacts`: an `espn-facts-1` object from any mapped ESPN source.
  * `loadFacts` / `loadCrosswalk`: async loaders (local private mode, ADR 0005); snapshot methods then return promises.
  * `scoringConfig` / `resolveScoringConfig({provider, leagueId, season, facts})`: a user-authorized scoring configuration for the
  * facts' exact league and season (lib/providers/espn-scoring.js). Mismatches fail closed; no config keeps scoring unavailable.
  * `includeOwnPending`: show the session owner's own pending transactions (private mode only).
  * `inputRevision`: async identity of the current loader inputs (validates them); cache keys include it.
  */
 constructor({authorizedImport=null,espnFacts=null,crosswalk=[],scoringConfig=null,resolveScoringConfig=null,loadFacts=null,loadCrosswalk=null,includeOwnPending=false,inputRevision=null}={}){
  if([authorizedImport,espnFacts,loadFacts].filter(Boolean).length>1)throw new ProviderError("INVALID_IMPORT","espn","Supply one ESPN data source.");
  this.imported=authorizedImport?structuredClone(authorizedImport):null;this.crosswalk=crosswalk;
  this.scoringConfig=scoringConfig;this.resolveScoringConfig=resolveScoringConfig;this.loadFacts=loadFacts;this.loadCrosswalk=loadCrosswalk;this.includeOwnPending=includeOwnPending===true;this.inputRevision=inputRevision;
  this.scored=new WeakMap();this.lastFacts=null;
  this.facts=espnFacts?structuredClone(espnFacts):this.imported?espnFactsFromImport(this.imported):null;
  if(this.facts){this.facts=this.withScoring(this.facts);snapshotFromEspnFacts(this.facts,{crosswalk});}
  else if(scoringConfig&&!loadFacts)throw new ProviderError("SCORING_CONFIG_MISMATCH","espn","A scoring configuration needs ESPN league facts.");
 }
 /**
  * Validates the facts contract and applies the bound authorized scoring configuration. The configuration is resolved on
  * every call and results are cached per (facts object, configuration content), so a changed configuration rescores.
  */
 withScoring(facts){
  if(facts?.version!==ESPN_FACTS_VERSION)throw new ProviderError("INVALID_IMPORT","espn","Unsupported ESPN facts contract.");
  const config=this.scoringConfig??(this.resolveScoringConfig?this.resolveScoringConfig({provider:"espn",leagueId:facts.league.id,season:facts.league.season,facts}):null);
  const key=config?JSON.stringify(config):"none";
  let byConfig=this.scored.get(facts);if(!byConfig){byConfig=new Map();this.scored.set(facts,byConfig);}
  if(!byConfig.has(key)){if(byConfig.size>=4)byConfig.clear();byConfig.set(key,config?applyAuthorizedEspnScoring(facts,config):facts);}
  return byConfig.get(key);
 }
 /** Runs `fn({facts, crosswalk})` synchronously for injected facts, or after loading for loader-backed providers. */
 current(fn){
  if(!this.loadFacts){if(!this.facts)return unavailable("espn","Live league access");return fn({facts:this.facts,crosswalk:this.crosswalk});}
  return (async()=>{const [raw,crosswalk]=await Promise.all([this.loadFacts(),this.loadCrosswalk?this.loadCrosswalk():this.crosswalk]);
   const facts=this.withScoring(raw);this.lastFacts=facts;return fn({facts,crosswalk});})();
 }
 /** Current input revision for loader-backed providers (throws when current inputs are invalid); null otherwise. */
 async getInputRevision(){return this.inputRevision?await this.inputRevision():null;}
 getIdentityRows(rows){return {rows:rows.map(r=>({...r,canonical_id:r.gsis_id&&!['NA','null'].includes(r.gsis_id)?`nfl:${r.gsis_id}`:null})),idColumn:"canonical_id"};}
 getInterest(players){return interestContext(players,true);}
 getMarketAttention(){return null;}
 getProviderCapabilities(){
  const facts=this.facts??this.lastFacts,local=this.loadFacts?{privateLeagueAccess:capability("available","Local private mode: saved ESPN facts on this machine; no live connection")}:{};
  if(facts&&!this.imported)return {...espnCapabilities,...factCapabilities(facts),...local};
  if(this.loadFacts)return {...espnCapabilities,...local};
  return {...espnCapabilities,authorizedImport:capability("available","Browser-local preview / injected offline loader; no live sync")};
 }
 normalize(raw,options){return normalizeEspn(raw,options);}
 snapshotFrom({facts,crosswalk},id,options={}){
  if(String(id)!==facts.league.id||options.season!=null&&Number(options.season)!==facts.league.season)throw new ProviderError("LEAGUE_NOT_FOUND","espn","League/season does not match the loaded ESPN data.");
  return snapshotFromEspnFacts(facts,{crosswalk,rosterId:options.rosterId,includeOwnPending:this.includeOwnPending});
 }
 getSnapshot(id,options={}){return this.current(state=>this.snapshotFrom(state,id,options));}
 getDecisionContext(id,options){return this.current(state=>{const snapshot=this.snapshotFrom(state,id,options);if(snapshot.coverage.scoring_available===false)throw new ProviderError("UNSUPPORTED_FEATURE","espn",SCORING_REQUIRED);return snapshot;});}
 getTransactions(id,o){return this.current(state=>{if(!state.facts.transactions)return unavailable("espn","getTransactions");return this.snapshotFrom(state,id,o).recent_transactions;});}
 getDraftPicks(id,o){return this.current(state=>{const draft=state.facts.draft;if(!draft)return unavailable("espn","getDraftPicks");this.snapshotFrom(state,id,o);
  return {status:"completed_selections_only",draft_status:draft.status,ownership:null,picks:draft.picks.map(p=>({round:p.round,pick:p.pick,overall:p.overall,roster_id:p.team_id,keeper:p.keeper,player:playerReference("espn",p.espn_id,state.crosswalk)}))};});}
 resolveUser(){return unavailable("espn","Account resolution");}
 discoverLeagues(){return unavailable("espn","Account discovery");}
 getSeasonState(){return unavailable("espn","Live season resolution");}
}
const then=(value,fn)=>value instanceof Promise?value.then(fn):fn(value);
for(const [method,field]of Object.entries({getLeague:"league",getRosters:"rosters",getMatchups:"current_matchups",getUserRoster:"my_roster",getStandings:"standings"}))ESPNProvider.prototype[method]=function(id,o){return then(this.getSnapshot(id,o),s=>s[field]);};
ESPNProvider.prototype.getLeagueSettings=function(id,o){return then(this.getSnapshot(id,o),s=>({settings:s.league.settings,scoring:s.league.scoring_settings,slots:s.league.roster_positions}));};
ESPNProvider.prototype.getPlayers=function(id,o){return then(this.getSnapshot(id,o),s=>[...new Map([...s.rosters.flatMap(r=>r.all_players),...Object.values(s.free_agents).flat()].map(p=>[p.player_id,p])).values()]);};
ESPNProvider.prototype.getWaiverState=function(id,o){return then(this.getSnapshot(id,o),s=>s.rosters.map(r=>({roster_id:r.roster_id,waiver_position:r.waiver_position,faab:r.provider_faab})));};
