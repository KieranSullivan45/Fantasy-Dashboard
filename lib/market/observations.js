import { digest } from "../history/contracts.js";
/** Attention is never ownership, football quality, sentiment, or trade value. */
export function sleeperAttention(context, { season, week, generatedAt, previous = [] }) {
  const interest = context.interest, count = interest?.sleeper_adds_24h ?? null;
  const comparable = previous.filter(p => p.source === "sleeper" && p.player_id === context.player.player_id && p.season === season && p.window_hours === 24 &&
    Number.isFinite(p.raw_count) && Date.parse(p.timestamp) <= Date.parse(generatedAt) - 18 * 3600000 && Date.parse(p.timestamp) >= Date.parse(generatedAt) - 30 * 3600000).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  const change = count != null && comparable ? count - comparable.raw_count : null;
  const observation = { schema_version: "market-1", source: "sleeper", source_type: "platform_add_interest", player_id: context.player.player_id,
    timestamp: generatedAt, season, week, window_hours: 24, raw_count: count, attention_percentile: interest?.available_percentile ?? null,
    rank: interest?.available_rank ?? null, change, relative_change: change != null && comparable.raw_count > 0 ? change / comparable.raw_count : null,
    comparison_timestamp: comparable?.timestamp ?? null, comparison_count: comparable?.raw_count ?? null,
    sentiment: null, confidence: count == null ? "unavailable" : "observed_censored_feed", raw_vs_derived: "raw_count_with_derived_comparison",
    provenance: { url: "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=100", limit: 100 },
    warning: "Top-100 censored feed; absent players are unknown, never zero. League-relative percentile is not ownership or exchange value." };
  return { observation_id: digest(observation), ...observation };
}
export function importMarketAggregates(rows, { now = Date.now(), approvedSources = [] } = {}) {
  return rows.filter(r => approvedSources.includes(r.source) && r.player_id && Number.isFinite(r.mention_count) && r.mention_count >= 0 &&
    Number.isFinite(Date.parse(r.timestamp)) && Date.parse(r.timestamp) <= now && r.window_hours > 0 && r.provenance?.permission_reference)
    .map(r => ({ schema_version: "market-1", source: r.source, source_type: "social_aggregate", player_id: String(r.player_id), timestamp: r.timestamp,
      mention_count: r.mention_count, source_count: r.source_count ?? null, window_hours: r.window_hours, attention_percentile: r.attention_percentile ?? null,
      change: r.change ?? null, relative_change: r.relative_change ?? null, sentiment: null, confidence: "imported_aggregate",
      provenance: { permission_reference: r.provenance.permission_reference, source_url: r.provenance.source_url }, raw_vs_derived: "derived_aggregate" }));
}
export const SOCIAL_SOURCE_STATUS = [
  { source: "reddit", status: "disabled", reason: "Approved official API access and use-case permission required; no scraping or raw social-user retention" },
  { source: "x", status: "disabled", reason: "Official reads require paid credits; paid access is outside this release" },
];
