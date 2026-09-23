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

/** Future permitted feeds: robust median, source independence, freshness and explicit horizon. */
export function robustConsensus(observations, playerId, position, { season, week, horizon = "weekly", scoring_profile, now = Date.now(), halfLifeDays = 3 }) {
  const families = new Map();
  for (const row of observations) {
    const age = (now - Date.parse(row.published_at)) / 86400000;
    if (row.player_id !== playerId || row.position !== position || row.horizon !== horizon || Number(row.season) !== Number(season) ||
      (horizon === "weekly" && Number(row.week) !== Number(week)) || row.scoring_profile !== scoring_profile ||
      !row.source_family || !Number.isFinite(age) || age < 0 || age > 14 || !Number.isFinite(row.value) || row.value < 1) continue;
    const prior = families.get(row.source_family);
    if (!prior || Date.parse(row.published_at) > Date.parse(prior.published_at)) families.set(row.source_family, row);
  }
  const sources = [...families.values()].map(row => {
    const accuracy = row.accuracy;
    const validated = accuracy?.games >= 100 && Date.parse(accuracy.through_date) < Date.parse(row.published_at) && Number.isFinite(accuracy.relative_weight);
    const weight = Math.pow(0.5, (now - Date.parse(row.published_at)) / (86400000 * halfLifeDays)) * (validated ? Math.max(0.75, Math.min(1.25, accuracy.relative_weight)) : 1);
    return { ...row, weight, accuracy_used: !!validated };
  }).sort((a, b) => a.value - b.value);
  const total = sources.reduce((s, r) => s + r.weight, 0); let cumulative = 0, rank = null;
  for (const row of sources) { cumulative += row.weight; if (cumulative >= total / 2) { rank = row.value; break; } }
  return { robust_rank: rank, source_count: sources.length, horizon, sources,
    method: "Freshness-weighted median; one latest observation per independent family; bounded validated historical accuracy. Missing players omitted, never assigned last place.",
    public_redistribution_allowed: sources.length > 0 && sources.every(r => r.redistribution_permitted === true) };
}
