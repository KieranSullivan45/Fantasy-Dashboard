import { scoreStats } from "../normalize/scoring.js";
import { scoreOpportunity } from "../normalize/opportunity.js";
import { finiteNumber as n, normalizeTeam } from "../sources/contracts.js";
export const FORMATS = {
  ppr: { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2 },
  te_premium: { pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, bonus_rec_te: 0.5, fum_lost: -2 },
};
export function historicalGames(stats, snaps, opportunity, ids, settings) {
  const pfrToGsis = new Map();
  for (const row of ids) if (row.pfr_id && row.pfr_id !== "NA" && row.gsis_id && row.gsis_id !== "NA") {
    if (pfrToGsis.has(row.pfr_id) && pfrToGsis.get(row.pfr_id) !== row.gsis_id) pfrToGsis.set(row.pfr_id, null); else if (!pfrToGsis.has(row.pfr_id)) pfrToGsis.set(row.pfr_id, row.gsis_id);
  }
  const snapMap = new Map(snaps.filter(r => r.game_type === "REG").map(r => [`${pfrToGsis.get(r.pfr_player_id)}:${r.game_id}`, r]));
  const oppMap = new Map(opportunity.map(r => [`${r.player_id}:${r.game_id}`, r]));
  const rows = stats.filter(r => r.season_type === "REG" && ["QB", "RB", "WR", "TE", "FB"].includes(r.position));
  const teamCarries = new Map();
  for (const r of rows) { const key = `${r.team}:${r.game_id}`; teamCarries.set(key, (teamCarries.get(key) || 0) + (n(r.carries) || 0)); }
  return [...new Map(rows.map(r => {
    const position = r.position === "FB" ? "RB" : r.position, key = `${r.player_id}:${r.game_id}`, snap = snapMap.get(key), opp = oppMap.get(key);
    const points = scoreStats(r, settings, position).points, model = opp ? scoreOpportunity(opp, settings, position) : null;
    return [key, { player_id: r.player_id, position, season: Number(r.season), week: Number(r.week), game_id: r.game_id, team: normalizeTeam(r.team), opponent: normalizeTeam(r.opponent_team), points,
      snap_count: n(snap?.offense_snaps), snap_share: n(snap?.offense_pct), targets: n(r.targets), target_share: n(r.target_share), carries: n(r.carries),
      carry_share: n(r.carries) !== null && teamCarries.get(`${r.team}:${r.game_id}`) > 0 ? n(r.carries) / teamCarries.get(`${r.team}:${r.game_id}`) : null,
      air_yards: n(r.receiving_air_yards), air_yard_share: n(r.air_yards_share), wopr: n(r.wopr), racr: n(r.racr), passing_attempts: n(r.attempts), sacks: n(r.sacks_suffered),
      passing_epa_per_attempt_or_sack: n(r.passing_epa) !== null && Number(r.attempts) + Number(r.sacks_suffered) > 0 ? n(r.passing_epa) / (Number(r.attempts) + Number(r.sacks_suffered)) : null,
      xfp: model?.expected_points ?? null, fpoe: model?.points_over_expected ?? null, model_actual: model?.actual_matching_rules ?? null,
    }];
  })).values()];
}

