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
