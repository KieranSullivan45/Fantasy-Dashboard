export const SLOT_POSITIONS = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["WR", "RB"],
};
export const fitsSlot = (player, slot) => (SLOT_POSITIONS[slot] || []).some(pos => (player.fantasy_positions || [player.position]).includes(pos));
export const unavailableThisWeek = player => /^(ir|out|pup|sus|suspended|nfi)$/i.test(player.injury_status || "");

// Maximize a historical PPG proxy, not a weekly projection. Each player is used once.
export function assignHistoricalLineup(players, slots, production) {
  if (slots.length > 16 || slots.some(slot => !SLOT_POSITIONS[slot])) return null;
  let states = new Map([[0, { value: 0, picks: [] }]]);
  for (const player of players) {
    const value = production[player.player_id]?.ppg;
    if (value == null || unavailableThisWeek(player)) continue;
    const next = new Map(states);
    for (const [mask, state] of states) slots.forEach((slot, index) => {
      if ((mask & (1 << index)) || !fitsSlot(player, slot)) return;
      const key = mask | (1 << index), total = state.value + value;
      if (!next.has(key) || total > next.get(key).value) next.set(key, { value: total, picks: [...state.picks, { slot, index, player_id: player.player_id, ppg: value }] });
    });
    states = next;
  }
  // Fill as many known slots as possible, including legitimate negative scorers.
  const best = [...states.values()].sort((a, b) => b.picks.length - a.picks.length || b.value - a.value)[0];
  return slots.map((slot, index) => best.picks.find(p => p.index === index) || { slot, index, player_id: null, ppg: null });
}

/** TeamStrengthProfile v1: historical slot assignment, usable depth and free-agent baseline.
 * PlayerValueProfile v1: historical production separate from null weekly/ROS/dynasty market value.
 * These contracts support future trade evaluation; no trade search is implemented.
 */
export function teamStrength(roster, slots, production, freeAgents) {
  const usable = roster.all_players.filter(p => !p.reserve && !p.taxi && !unavailableThisWeek(p));
  const lineup = assignHistoricalLineup(usable, slots, production);
  const assigned = new Set((lineup || []).map(p => p.player_id).filter(Boolean));
  const positions = Object.fromEntries(["QB", "RB", "WR", "TE", "K", "DEF"].map(position => {
    const pool = usable.filter(p => (p.fantasy_positions || [p.position]).includes(position));
    const available = freeAgents.filter(p => p.position === position).map(p => production[p.player_id]?.ppg).filter(p => p != null);
    return [position, { usable_count: pool.length, known_production_count: pool.filter(p => production[p.player_id]?.ppg != null).length,
      assigned_player_ids: pool.filter(p => assigned.has(p.player_id)).map(p => p.player_id),
      bench_player_ids: pool.filter(p => !assigned.has(p.player_id)).map(p => p.player_id),
      best_available_ppg: available.length ? Math.max(...available) : null,
      required_dedicated_slots: slots.filter(slot => slot === position).length }];
  }));
  return { contract_version: "1", roster_id: roster.roster_id, basis: "historical PPG; not a projection or market valuation",
    historical_lineup: lineup, positions, market_value: null };
}

export function playerValue(player, production) {
  return { contract_version: "1", player_id: player.player_id, position: player.position,
    historical_ppg: production?.ppg ?? null, scoring_status: production?.scoring_status ?? "unavailable",
    weekly_projection: null, rest_of_season_value: null, dynasty_value: null, market_value: null };
}
