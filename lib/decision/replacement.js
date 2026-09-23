import { fantasyPositions, SLOT_POSITIONS, uniquePlayers } from "../normalize/positions.js";
import { mean, numeric } from "./features.js";
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"];
/** Actual available talent plus explicit league-demand context; units are model points, not market value. */
export function replacementLevels(allPlayers, freeAgents, values, { teams, slots, benchSlots = 0 }) {
  return Object.fromEntries(SKILL_POSITIONS.map(position => {
    const pool = list => uniquePlayers(list).filter(p => fantasyPositions(p).includes(position)).map(p => values[p.player_id]).filter(numeric).sort((a, b) => b - a);
    const available = pool(freeAgents), population = pool(allPlayers);
    const demand = slots.reduce((sum, slot) => sum + (slot === "SUPER_FLEX" ? position === "QB" ? 1 : 0 : (SLOT_POSITIONS[slot] || []).includes(position) ? 1 / SLOT_POSITIONS[slot].length : 0), 0);
    const skillSlots = slots.filter(s => (SLOT_POSITIONS[s] || []).some(p => SKILL_POSITIONS.includes(p))).length;
    const rank = Math.max(1, Math.ceil(teams * demand * (1 + benchSlots / Math.max(1, skillSlots))));
    const observed = mean(available.slice(0, 3));
    const structural = population.length ? population[Math.min(rank - 1, population.length - 1)] : null;
    return [position, { replacement_value: observed == null ? structural : structural == null ? observed : 0.7 * observed + 0.3 * structural,
      available_baseline: observed, demand_baseline: structural, demand_rank: rank, eligible_starter_demand: demand,
      league_teams: teams, available_sample: available.length, known_population: population.length,
      coverage: observed != null && structural != null ? "pool_and_demand" : "partial",
      basis: "70% best-three available mean + 30% league-demand cutoff; Superflex reserves QB demand. League-scored inputs include TE premium. No market inference." }];
  }));
}
export function valueOverReplacement(player, value, levels) {
  const eligible = fantasyPositions(player).filter(p => levels[p]?.replacement_value != null);
  if (!numeric(value) || !eligible.length) return { player_value: value ?? null, replacement_value: null, value_over_replacement: null, position: null };
  const position = eligible.sort((a, b) => levels[a].replacement_value - levels[b].replacement_value)[0];
  return { player_value: value, replacement_value: levels[position].replacement_value, value_over_replacement: value - levels[position].replacement_value, position,
    basis: "Best eligible replacement advantage; dual eligibility is never summed" };
}
