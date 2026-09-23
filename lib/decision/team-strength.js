import { SLOT_POSITIONS, fitsSlot, fantasyPositions, uniquePlayers } from "../normalize/positions.js";
export { SLOT_POSITIONS, fitsSlot };
export const unavailableThisWeek = player => /^(ir|out|pup|sus|suspended|nfi)$/i.test(player.injury_status || "") || /injured|reserve|pup|suspended/i.test(player.status || "");

// Maximize a historical PPG proxy, not a weekly projection. Each player is used once.
export function assignHistoricalLineup(players, slots, production) {
  return lineupEvaluator(players, slots, production)?.before ?? null;
}

// Reuse baseline DP states across the entire waiver pool; adding one candidate is one transition.
export function lineupEvaluator(players, slots, production) {
  if (slots.length > 16 || slots.some(slot => !SLOT_POSITIONS[slot])) return null;
  let states = new Map([[0, { value: 0, picks: [] }]]);
  const add = (base, player) => {
    const value = production[player.player_id]?.ppg;
    if (value == null || unavailableThisWeek(player)) return base;
    const next = new Map(base);
    for (const [mask, state] of base) slots.forEach((slot, index) => {
      if ((mask & (1 << index)) || !fitsSlot(player, slot)) return;
      const key = mask | (1 << index), total = state.value + value;
      if (!next.has(key) || total > next.get(key).value) next.set(key, { value: total, picks: [...state.picks, { slot, index, player_id: player.player_id, ppg: value }] });
    });
    return next;
  };
  for (const player of uniquePlayers(players)) states = add(states, player);
  // Fill as many known slots as possible, including legitimate negative scorers.
  const bestLineup = source => {
    let best = { value: 0, picks: [] };
    for (const state of source.values()) if (state.picks.length > best.picks.length || state.picks.length === best.picks.length && state.value > best.value) best = state;
    return slots.map((slot, index) => best.picks.find(p => p.index === index) || { slot, index, player_id: null, ppg: null });
  };
  return { before: bestLineup(states), after: candidate => bestLineup(add(states, candidate)) };
}

/** TeamStrengthProfile v1: historical slot assignment, usable depth and free-agent baseline.
 * PlayerValueProfile v1: historical production separate from null weekly/ROS/dynasty market value.
 * These contracts support future trade evaluation; no trade search is implemented.
 */
export function teamStrength(roster, slots, production, freeAgents, { leagueSize = 12, benchSlots = 6, allPlayers = [] } = {}) {
  const usable = roster.all_players.filter(p => !p.reserve && !p.taxi && !unavailableThisWeek(p));
  const lineup = assignHistoricalLineup(usable, slots, production);
  const assigned = new Set((lineup || []).map(p => p.player_id).filter(Boolean));
  const positions = Object.fromEntries(["QB", "RB", "WR", "TE", "K", "DEF"].map(position => {
    const pool = usable.filter(p => (p.fantasy_positions || [p.position]).includes(position));
    const available = freeAgents.filter(p => fantasyPositions(p).includes(position)).map(p => production[p.player_id]?.ppg).filter(p => p != null);
    const demand = slots.reduce((sum, slot) => sum + ((SLOT_POSITIONS[slot] || []).includes(position) ? 1 / SLOT_POSITIONS[slot].length : 0), 0);
    const offensiveSlots = slots.filter(s => (SLOT_POSITIONS[s] || []).some(p => ["QB", "RB", "WR", "TE"].includes(p))).length;
    const replacementRank = Math.max(1, Math.ceil(leagueSize * demand * (1 + benchSlots / Math.max(1, offensiveSlots))));
    const population = uniquePlayers(allPlayers).filter(p => fantasyPositions(p).includes(position)).map(p => production[p.player_id]?.ppg).filter(v => v != null).sort((a, b) => b - a);
    return [position, { usable_count: pool.length, known_production_count: pool.filter(p => production[p.player_id]?.ppg != null).length,
      assigned_player_ids: pool.filter(p => assigned.has(p.player_id)).map(p => p.player_id),
      bench_player_ids: pool.filter(p => !assigned.has(p.player_id)).map(p => p.player_id),
      best_available_ppg: available.length ? Math.max(...available) : null,
      replacement_rank: replacementRank, replacement_ppg: population[replacementRank - 1] ?? null,
      fractional_starter_demand: demand, known_population: population.length,
      depth_balance: pool.length - Math.ceil(demand),
      need_or_surplus: pool.length < Math.ceil(demand) ? "eligible_depth_need" : pool.length > Math.ceil(demand) ? "eligible_depth_surplus" : "balanced_count",
      replacement_basis: "League size × eligible slot demand, flex split equally, scaled by bench capacity; historical population cutoff, not a projection",
      required_dedicated_slots: slots.filter(slot => slot === position).length }];
  }));
  return { contract_version: "1", roster_id: roster.roster_id, basis: "historical PPG; not a projection or market valuation",
    historical_lineup: lineup, positions, market_value: null, league_size: leagueSize, starter_slots: slots,
    usable_players: usable, historical_starter_strength: lineup?.reduce((sum, p) => sum + (p.ppg ?? 0), 0) ?? null,
    known_starter_slots: lineup?.filter(p => p.ppg != null).length ?? 0, starter_strength_complete: !!lineup && lineup.every(p => p.ppg != null),
    unknown_player_ids: usable.filter(p => production[p.player_id]?.ppg == null).map(p => p.player_id),
    bench_depth: usable.filter(p => !assigned.has(p.player_id)).map(p => ({ player_id: p.player_id, fantasy_positions: fantasyPositions(p), ppg: production[p.player_id]?.ppg ?? null })) };
}

export function playerValue(player, production) {
  return { contract_version: "1", player_id: player.player_id, position: player.position, fantasy_positions: fantasyPositions(player),
    football_value_basis: "league-scored historical production; ROS strength unavailable", roster_value: null,
    historical_ppg: production?.ppg ?? null, scoring_status: production?.scoring_status ?? "unavailable",
    weekly_projection: null, rest_of_season_value: null, dynasty_value: null, market_value: null };
}
