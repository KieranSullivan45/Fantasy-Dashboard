import {DOMAIN_VERSION} from "./contracts.js";
import {playerReference} from "./espn-normalize.js";
/** Provider-neutral projection; legacy engine/snapshot aliases are deliberately retained elsewhere. */
export function fantasyDomain(snapshot,{crosswalk=[],capabilities={}}={}){
 const provider=snapshot.identity?.provider||"sleeper",league=snapshot.league;
 const ref=p=>({...playerReference(provider,p.identity?.provider_player_id||p.player_id,crosswalk),name:p.name,eligibility:{provider,positions:[...(p.fantasy_positions||[])],football_positions:[...(p.provider_positions||[])],source:"provider"},team:p.team??null,injury_status:p.injury_status??null});
 return {schema_version:DOMAIN_VERSION,provider,account:{provider,provider_user_id:snapshot.identity?.provider_user_id??null},season:{season:Number(league.season),week:snapshot.matchup_week,verified_current:snapshot.coverage?.current_season_verified??snapshot.matchup_week!=null},
 league:{provider,provider_league_id:String(league.league_id),season:Number(league.season),name:league.name,team_count:league.total_rosters,status:league.status??null,scoring:{rules:{...league.scoring_settings},unsupported:snapshot.coverage?.unsupported_scoring||[]},slots:[...league.roster_positions],settings:{...league.settings}},
 rosters:snapshot.rosters.map(r=>({provider_roster_id:String(r.roster_id),owner_id:r.owner_id??null,is_selected:r.is_user,team_name:r.team_name,starters:r.starter_slots.map(s=>({slot:s.slot,player:s.player_id?ref(r.all_players.find(p=>p.player_id===s.player_id)):null})),bench:r.bench.map(ref),ir:r.reserve.map(ref),taxi:r.taxi.map(ref),standings:{...r.record},waivers:{priority:r.waiver_position??null,faab_spent:r.waiver_budget_used??r.provider_faab?.spent??null,faab_budget:r.provider_faab?.budget??league.settings.waiver_budget??null}})),
 available_players:[...new Map(Object.values(snapshot.free_agents).flat().map(p=>[p.player_id,ref(p)])).values()],capabilities,warnings:snapshot.warnings.map(w=>({...w})),generated_at:snapshot.generated_at};
}
