export type ProviderId = 'sleeper' | 'espn';
export interface ProviderAccount { provider: ProviderId; provider_user_id: string | null; username?: string; }
export interface SeasonContext { season:number; week:number|null; verified_current:boolean; }
export interface PlayerEligibility { provider:ProviderId; positions:string[]; football_positions:string[]; source:string; }
export interface FantasyPlayerRef { provider:ProviderId; provider_player_id:string; canonical_id:string|null; statistical_id:string|null; mapping_status:'exact_crosswalk'|'ambiguous'|'unresolved'; mapping_confidence:'exact'|'none'; eligibility:PlayerEligibility; }
export interface RosterSlot { slot:string; player:FantasyPlayerRef|null; }
export interface ScoringSettings { rules:Record<string,number>; unsupported:unknown[]; }
export interface LeagueSettings { reserve_slots?:number|null; taxi_slots?:number|null; playoff_teams?:number|null; [name:string]:unknown; }
export interface FantasyLeague { provider:ProviderId; provider_league_id:string; season:number; name:string; team_count:number; scoring:ScoringSettings; slots:string[]; settings:LeagueSettings; }
export interface FAABState { faab_spent:number|null; faab_budget:number|null; priority:number|null; }
export interface StandingsEntry { wins:number|null; losses:number|null; ties:number|null; points_for:number|null; points_against:number|null; }
export interface Roster { provider_roster_id:string; owner_id:string|null; is_selected:boolean; starters:RosterSlot[]; bench:FantasyPlayerRef[]; ir:FantasyPlayerRef[]; taxi:FantasyPlayerRef[]; standings:StandingsEntry; waivers:FAABState; }
export interface LeagueMember { provider:ProviderId; provider_user_id:string|null; display_name:string|null; }
export interface Matchup { provider_matchup_id:string; week:number; teams:Array<{provider_roster_id:string; actual_points:number|null; starters:RosterSlot[]}>; }
export interface DraftPickAsset { season:number; round:number; original_roster_id:string; current_roster_id:string|null; }
export interface Transaction { provider:ProviderId; provider_transaction_id:string; type:'add'|'drop'|'add_drop'|'trade'|'waiver'|'free_agent'|'unknown'; timestamp:string|null; status:string|null; adds:FantasyPlayerRef[]; drops:FantasyPlayerRef[]; picks:DraftPickAsset[]; }
export interface WaiverTransaction extends Transaction { faab:number|null; }
export type ProviderCapabilities = Record<string,{status:'available'|'unsupported'|'unavailable';reason:string|null}>;
// Unavailable capabilities throw a safe ProviderError; null never implies zero.
export interface FantasyProvider { providerId:ProviderId; getProviderCapabilities():ProviderCapabilities; getSnapshot(id:string,options?:unknown):unknown; getDecisionContext(id:string,options?:unknown):unknown; resolveUser(input:string):unknown; discoverLeagues(options:unknown):unknown; getLeague(id:string,options?:unknown):unknown; getLeagueSettings(id:string,options?:unknown):unknown; getRosters(id:string,options?:unknown):unknown; getMatchups(id:string,options?:unknown):unknown; getTransactions(id:string,options?:unknown):unknown; getWaiverState(id:string,options?:unknown):unknown; getPlayers(id:string,options?:unknown):unknown; getUserRoster(id:string,options?:unknown):unknown; getSeasonState():unknown; getStandings(id:string,options?:unknown):unknown; getDraftPicks(id:string,options?:unknown):unknown; }
// Internal ESPN facts contract (espn-facts-1): every ESPN source (authorized import, Flaim transport, saved league file) maps into it and
// snapshotFromEspnFacts builds snapshot 0.2 from it. In-memory only; never archived or returned by public routes.
export interface EspnFactsPlayer { espn_id:string; name:string|null; position:string|null; eligibility:string[]; team:string|null; provider_team_id:number|null; injury_status:string|null; injured:boolean|null; }
export interface EspnFacts {
 version:'espn-facts-1'; provider:'espn';
 provenance:{ source:string; source_transport:'authorized_import'|'flaim'|'league_file'; access:'authorized_offline'|'flaim_live'|'flaim_saved_bundle'|'saved_league_file'; private_live:boolean; visibility?:'private'; captured_at?:string };
 league:{ id:string; season:number; name:string|null; scoring_period:number|null; current_season_verified:boolean; slot_counts:Record<string,number>; matchup_periods:Record<string,number[]>|null; playoff_teams:number|null };
 scoring:{ available:boolean; items:unknown[]|null }; user_team_id:number|null;
 teams:Array<{ id:number; name:string|null; owner_id:string|null; record:StandingsEntry; playoff_seed?:number|null; waiver_rank:number|null; faab:{spent:number|null; budget:number|null};
  entries:Array<{ slot:string; player:EspnFactsPlayer; acquisition:{type:string|null; date:string|null}|null }> }>;
 matchups:Array<{ id:string|number; matchup_period:number; final:boolean|null; sides:Array<{team_id:number; points:number|null}> }>;
 available:{ players:Array<{player:EspnFactsPlayer; acquisition_state:'free_agent'|'waivers'|null; waiver_clears_at:string|null}>; complete:false; limit:number|null }|null;
 transactions:{ items:Array<{ id:string; type:string; status:string; timestamp:number|null; week:number|null; team_ids:number[]; adds:unknown[]; drops:unknown[]; private:boolean; faab_bid:null }>; truncated:boolean|null }|null;
 draft:{ status:string|null; picks:Array<{round:number; pick:number; overall:number; team_id:number; espn_id:string; keeper:boolean}>; ownership:null }|null;
 roster_history:Array<{ week:number; team_id:number; entries:unknown[] }>;
 warnings:Array<{code:string; resource:string; message:string}>;
}
// User-authorized ESPN scoring configuration (espn-scoring-1, lib/providers/espn-scoring.js). Server-side runtime input only.
export interface ScoringBand { min:number; max:number|null; points:number; }
export interface EspnScoringConfig {
 schema_version:'espn-scoring-1'; provider:'espn'; league_id:string; season:number; scoring_source:'user_authorized'; unlisted_rules_score_zero:true;
 source?:Record<string,string>|null;
 offense:Record<string,number>; kicking:Record<string,number|ScoringBand[]>; team_defense:Record<string,number|ScoringBand[]>;
}
// Authorized facts scoring: { available, source:'user_authorized', rules, unsupported, status:'complete'|'partial', binding }.
