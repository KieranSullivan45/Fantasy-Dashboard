import { createHash } from "node:crypto";
/** Append-only storage port; no ephemeral Vercel filesystem masquerades as durable storage. */
export function recommendationObservations(decision) {
  const items = new Map([...Object.values(decision.waivers.candidate_details || {}), ...decision.waivers.recommendations, ...decision.waivers.limited_candidates].map(p => [p.player_id, p]));
  return [...items.values()].map(p => {
    const row = { generated_at: decision.generated_at, season: decision.league.season, week: decision.league.week, league_id: decision.league.league_id,
      player_id: p.player_id, model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision ?? null, data_through_week: decision.data_through_week,
      types: p.recommendation_types, pickup_rating: p.pickup_rating, components: p.components, coverage_percent: p.coverage_percent,
      transaction: p.roster_value.best || null, scope: "Returned candidates; consult truncation for omitted observations" };
    return { observation_id: createHash("sha256").update(JSON.stringify(row)).digest("hex"), ...row };
  });
}
export async function saveObservations(store, observations) {
  if (typeof store?.appendIfAbsent !== "function") throw new Error("Store must implement appendIfAbsent(observation_id, observation)");
  for (const row of observations) await store.appendIfAbsent(row.observation_id, row);
}
