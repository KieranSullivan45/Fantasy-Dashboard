import {capability,unavailable,ProviderError} from "./contracts.js";
import {normalizeEspn} from "./espn-normalize.js";
import {interestContext} from "../decision/interest.js";
export const espnCapabilities=Object.fromEntries(["publicLeagueAccess","privateLeagueAccess","accountLeagueDiscovery","currentRosters","historicalRosters","transactions","FAAB","waiverPriority","matchupData","draftPickTrading","taxiSquads","IR","multiPositionEligibility","rosteredPercentage","addInterest","historicalTransactions","leagueSettings","scoringRules"].map(k=>[k,capability("unsupported","Live ESPN transport is disabled; authorized offline import is separate") ]));
export class ESPNProvider {
 providerId="espn";
 constructor({authorizedImport=null,crosswalk=[]}={}){this.imported=authorizedImport?structuredClone(authorizedImport):null;this.crosswalk=crosswalk;if(this.imported)normalizeEspn(this.imported,{crosswalk});}
 getIdentityRows(rows){return {rows:rows.map(r=>({...r,canonical_id:r.gsis_id&&!['NA','null'].includes(r.gsis_id)?`nfl:${r.gsis_id}`:null})),idColumn:"canonical_id"};}
 getInterest(players){return interestContext(players,true);}
 getMarketAttention(){return null;}
 getProviderCapabilities(){return {...espnCapabilities,authorizedImport:capability("available","Browser-local preview / injected offline loader; no live sync")};}
 normalize(raw,options){return normalizeEspn(raw,options);}
 getSnapshot(id,options={}){if(!this.imported)return unavailable("espn","Live league access");if(String(id)!==String(this.imported.id)||options.season!=null&&Number(options.season)!==this.imported.seasonId)throw new ProviderError("LEAGUE_NOT_FOUND","espn","League/season does not match this authorized import.");return normalizeEspn(this.imported,{crosswalk:this.crosswalk,rosterId:options.rosterId});}
 getDecisionContext(id,options){return this.getSnapshot(id,options);}
 resolveUser(){return unavailable("espn","Account resolution");}
 discoverLeagues(){return unavailable("espn","Account discovery");}
 getSeasonState(){return unavailable("espn","Live season resolution");}
}
for(const [method,field]of Object.entries({getLeague:"league",getRosters:"rosters",getMatchups:"current_matchups",getUserRoster:"my_roster",getStandings:"standings"}))ESPNProvider.prototype[method]=function(id,o){return this.getSnapshot(id,o)[field]};
ESPNProvider.prototype.getLeagueSettings=function(id,o){const l=this.getSnapshot(id,o).league;return {settings:l.settings,scoring:l.scoring_settings,slots:l.roster_positions}};
ESPNProvider.prototype.getPlayers=function(id,o){return this.getSnapshot(id,o).rosters.flatMap(r=>r.all_players)};
ESPNProvider.prototype.getWaiverState=function(id,o){return this.getSnapshot(id,o).rosters.map(r=>({roster_id:r.roster_id,waiver_position:r.waiver_position,faab:r.provider_faab}))};
for(const method of ["getTransactions","getDraftPicks"])ESPNProvider.prototype[method]=function(){return unavailable("espn",method)};
