/** Allowlisted nflverse play fields only; callers can import permitted CSV rows off-request. */
export function highValueOpportunities(rows, { season, beforeWeek }) {
  const games = new Map(), seen = new Set(), totals = new Map();
  for (const r of rows) {
    if (Number(r.season) !== season || r.season_type !== "REG" || Number(r.week) >= beforeWeek || Number(r.week) < 1 ||
      Number(r.no_play) === 1 || Number(r.qb_kneel) === 1 || Number(r.qb_spike) === 1 || Number(r.two_point_attempt) === 1) continue;
    const key = `${r.game_id}:${r.play_id}`, yardline = r.yardline_100 === "" || r.yardline_100 == null ? NaN : Number(r.yardline_100);
    if (!r.game_id || r.play_id == null || seen.has(key) || !Number.isFinite(yardline) || yardline < 0 || yardline > 20) continue;
    seen.add(key);
    const rushing = Number(r.rush_attempt) === 1 && r.rusher_player_id;
    const target = Number(r.pass_attempt) === 1 && r.receiver_player_id;
    if (!rushing && !target) continue;
    const id = rushing ? r.rusher_player_id : r.receiver_player_id, gameKey = `${id}:${r.game_id}`;
    if (!games.has(gameKey)) games.set(gameKey, { player_id: id, game_id: r.game_id, season, week: Number(r.week), team: r.posteam,
      red_zone_carries: 0, inside_10_carries: 0, inside_5_carries: 0, red_zone_targets: 0, end_zone_targets: null, evidence: [] });
    const g = games.get(gameKey);
    if (rushing) { g.red_zone_carries++; if (yardline <= 10) g.inside_10_carries++; if (yardline <= 5) g.inside_5_carries++; }
    else g.red_zone_targets++;
    if (rushing && yardline <= 5) { const teamKey = `${r.posteam}:${r.game_id}`; totals.set(teamKey, (totals.get(teamKey) || 0) + 1); }
    g.evidence.push({ source: "nflverse_pbp", game_id: r.game_id, play_id: String(r.play_id), yardline_100: yardline, event: rushing ? "carry" : "target" });
  }
  return [...games.values()].map(g => ({ ...g, red_zone_opportunities: g.red_zone_carries + g.red_zone_targets,
    goal_line_carry_share: totals.get(`${g.team}:${g.game_id}`) ? g.inside_5_carries / totals.get(`${g.team}:${g.game_id}`) : null,
    basis: "Official rush attempts / identified pass targets at yardline <=20; no-play, kneels, spikes and two-point tries excluded. Goal line = <=5 carries. End-zone targets unsupported." }));
}
