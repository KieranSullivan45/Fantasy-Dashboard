import { createHash } from "node:crypto";
export const OBSERVATION_SCHEMA = "observation-1";
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const evidenceOnly = value => Array.isArray(value) ? value.map(evidenceOnly) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([k]) => !["observation_id", "signal_id", "timestamp", "generated_at", "fetched_at", "retrieved_at", "capture_id"].includes(k)).map(([k, v]) => [k, evidenceOnly(v)])) : value;
/** Identical evidence in the same six-hour interval has one ID; the first writer retains its exact capture time. */
export function observationId(record) {
  return digest({ ...evidenceOnly(record), capture_bucket: Math.floor(Date.parse(record.generated_at) / 21600000) });
}
export function captureObservations(decision) {
  const recommendations = new Map([...Object.values(decision.waivers.candidate_details || {}), ...decision.waivers.recommendations, ...decision.waivers.limited_candidates].map(p => [p.player_id, p]));
  return Object.values(decision.player_context).map(c => {
    const p = recommendations.get(c.player.player_id), f = c.model?.features;
    const record = JSON.parse(JSON.stringify({ schema_version: OBSERVATION_SCHEMA, generated_at: decision.generated_at, provider: decision.identity?.provider || "sleeper",
      provider_user_id: decision.identity?.provider_user_id ?? null, roster_id: decision.my_roster_id, league_id: decision.league.league_id,
      season: decision.league.season, week: decision.league.week, data_through_week: decision.data_through_week,
      model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision,
      source_versions: decision.sources.map(s => ({ source: s.source_id, status: s.status, version: s.version ?? null, digest: s.digest ?? null, published_at: s.published_at, fetched_at: s.fetched_at, through_week: s.through_week, url: s.url })),
      player_id: c.player.player_id, positions: c.player.fantasy_positions, player_status: { injury_status: c.player.injury_status, team: c.player.team },
      start_value: c.model?.start_value, pickup_value: c.model?.pickup_value, football_value: c.model?.player_value,
      roster_value: c.value_profile?.roster_value, replacement: c.model?.replacement, best_add_drop: p?.roster_value.best ?? null,
      pickup_rating: p?.pickup_rating ?? c.pickup?.rating ?? null, recommendation_types: p?.recommendation_types ?? c.pickup?.types ?? [],
      component_scores: p?.components ?? null, opportunity: f?.opportunity, xfp: f?.xfp_per_game, fpoe: f?.fpoe_per_game,
      usage_history: c.analytics?.history.slice(-4).map(({ opportunity_model, ...g }) => ({ ...g, xfp: opportunity_model?.expected_points ?? null, fpoe: opportunity_model?.points_over_expected ?? null })) ?? [],
      high_value: c.high_value ?? null, matchup: c.adjusted_matchup, schedule: c.schedule,
      market_attention: c.market_attention ?? null, signals: (decision.signals?.records || []).filter(s => s.player_id === c.player.player_id),
      confidence: f?.confidence ?? "unknown", evidence_coverage: p?.coverage_percent ?? null, sample_size: f?.current_games ?? 0, prior: f?.prior,
      explanations: p?.explanations || [], warnings: decision.warnings, scoring: decision.scoring, league_scoring: decision.league.scoring_settings,
      capture_scope: "Rostered and returned decision contexts; omitted contexts are not claimed archived", context_omitted: decision.coverage.context_omitted,
    }));
    return { observation_id: observationId(record), ...record };
  });
}
