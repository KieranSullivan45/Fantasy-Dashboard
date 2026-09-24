import {buildLeagueSnapshot} from "../sleeper.js";
import {discoverSleeper,publicSleeper} from "../accounts/sleeper.js";
import {capability} from "./contracts.js";
import {interestContext} from "../decision/interest.js";
import {sleeperAttention} from "../market/observations.js";
const supported=["publicLeagueAccess","accountLeagueDiscovery","currentRosters","transactions","FAAB","waiverPriority","matchupData","draftPickTrading","taxiSquads","IR","multiPositionEligibility","addInterest","leagueSettings","scoringRules"];
export const sleeperCapabilities=Object.fromEntries([...supported.map(k=>[k,capability("available")]),...["privateLeagueAccess","rosteredPercentage","historicalRosters","historicalTransactions"].map(k=>[k,capability("unsupported","No authenticated or historical adapter in this release")])]);
export class SleeperProvider {
 providerId="sleeper";
 constructor({snapshot=buildLeagueSnapshot,discover=discoverSleeper,fetchData=publicSleeper}={}){this.snapshot=snapshot;this.discovery=discover;this.fetchData=fetchData;}
 getProviderCapabilities(){return sleeperCapabilities;}
 getIdentityRows(rows){return {rows,idColumn:"sleeper_id"};}
 getInterest(players,warnings){return interestContext(players,warnings.some(w=>w.resource==="trending"));}
 getMarketAttention(context,scope){return sleeperAttention(context,scope);}
 resolveUser(input){return this.fetchData(`/user/${encodeURIComponent(input)}`);}
 discoverLeagues(options){return this.discovery(options);}
 getSnapshot(id,options){return this.snapshot(id,options);}
 getDecisionContext(id,options){return this.snapshot(id,{...options,freeAgentLimit:Number.MAX_SAFE_INTEGER});}
 getSeasonState(){return this.fetchData('/state/nfl');}
 async getLeague(id,o){return (await this.getSnapshot(id,o)).league;}
 async getLeagueSettings(id,o){const l=await this.getLeague(id,o);return {settings:l.settings,scoring:l.scoring_settings,slots:l.roster_positions};}
 async getRosters(id,o){return (await this.getSnapshot(id,o)).rosters;}
 async getMatchups(id,o){return (await this.getSnapshot(id,o)).current_matchups;}
 async getTransactions(id,o){return (await this.getSnapshot(id,o)).recent_transactions;}
 async getStandings(id,o){return (await this.getSnapshot(id,o)).standings;}
 async getUserRoster(id,o){return (await this.getSnapshot(id,o)).my_roster;}
 async getPlayers(id,o){const s=await this.getDecisionContext(id,o);return [...new Map([...s.rosters.flatMap(r=>r.all_players),...Object.values(s.free_agents).flat()].map(p=>[p.player_id,p])).values()];}
 async getWaiverState(id,o){const s=await this.getSnapshot(id,o);return s.rosters.map(r=>({roster_id:r.roster_id,waiver_position:r.waiver_position??null,faab_spent:r.waiver_budget_used??null,faab_budget:s.league.settings?.waiver_budget??null}));}
 async getDraftPicks(id,o){return {status:"transaction_history_only",transactions:(await this.getTransactions(id,o)).filter(t=>t.draft_picks?.length)};}
}
