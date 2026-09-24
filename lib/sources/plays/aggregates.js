import { archiveConfig } from "../../config.js";
const cache = new Map();
export async function loadHighValue(season, { fetcher = fetch } = {}) {
  const { repository, branch } = archiveConfig();
  const url = `https://raw.githubusercontent.com/${repository}/${branch}/data/high-value/${season}.json`;
  const prior = cache.get(url); if (fetcher === fetch && prior?.expires > Date.now()) return prior.promise;
  const promise = (async () => {
    try {
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Precomputed PBP HTTP ${response.status}`);
      const text = await response.text(); if (text.length > 8000000) throw new Error("Aggregate bound exceeded");
      const result = JSON.parse(text);
      if (result.schema_version !== "high-value-1" || Number(result.season) !== Number(season) || !Array.isArray(result.records) || !Array.isArray(result.games)) throw new Error("Invalid season aggregate");
      return { source_id: "nflverse_high_value", status: "available", url, data: result, version: result.schema_version, digest: result.provenance.sha256, fetched_at: new Date().toISOString(), warnings: [] };
    } catch (error) { return { source_id: "nflverse_high_value", status: "unavailable", url, data: null, warnings: [error.message] }; }
  })();
  if (fetcher === fetch) { if (cache.size > 5) cache.clear(); cache.set(url, { expires: Date.now() + 3600000, promise }); }
  return promise;
}
export function playerHighValue(context, aggregate, sourceId, throughWeek) {
  if (!aggregate || !sourceId) return null;
  const covered = new Set(aggregate.games.filter(g => g.week <= throughWeek).map(g => g.game_id));
  const matching = new Map(aggregate.records.filter(r => r.player_id === sourceId && r.week <= throughWeek).map(r => [r.game_id, r]));
  const history = (context.analytics?.history || []).filter(g => g.week <= throughWeek && covered.has(g.game_id)).map(g => matching.get(g.game_id) || {
    player_id: sourceId, game_id: g.game_id, week: g.week, team: g.team, red_zone_carries: 0, red_zone_targets: 0, inside_10_carries: 0, inside_5_carries: 0, inside_10_targets: 0,
    high_value_opportunities: 0, high_value_opportunity_share: null, goal_line_carry_share: null, red_zone_carry_share: null, end_zone_targets: null, evidence: [], basis: "Zero events in fully processed game; not assumed participation or DNP" });
  return { history, data_through_week: Math.min(throughWeek, aggregate.data_through_week), provenance: aggregate.provenance, model_input: false,
    unavailable: ["end_zone_targets"], recent_high_value_opportunity: history.length ? history.slice(-2).reduce((s, g) => s + g.high_value_opportunities, 0) / Math.min(2, history.length) : null };
}
