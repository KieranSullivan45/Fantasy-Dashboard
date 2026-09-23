import { importObservations } from "../import.js";
export const importRankings = (rows, scope) => importObservations(rows, "rankings", scope);

export function consensusRank(observations, playerId, position) {
  // One latest observation per source family prevents counting mirrors twice.
  const families = new Map();
  for (const row of observations.filter(r => r.player_id === playerId && r.position === position)) {
    const prior = families.get(row.source_family);
    if (!prior || Date.parse(row.published_at) > Date.parse(prior.published_at)) families.set(row.source_family, row);
  }
  const rows = [...families.values()];
  const ranks = rows.map(r => r.value);
  return { average_rank: ranks.length ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null,
    source_count: ranks.length, best: ranks.length ? Math.min(...ranks) : null,
    worst: ranks.length ? Math.max(...ranks) : null, sources: rows };
}
