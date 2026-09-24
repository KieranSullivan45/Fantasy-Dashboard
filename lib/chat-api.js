import { decisionService } from "./decision-service.js";
import { getConfiguredLeagueIds, getConfiguredUsername } from "./config.js";
import { acceptedLeague, requestIdentity } from "./accounts/query.js";
import { discoverSleeper, publicSleeper, resolveSeason } from "./accounts/sleeper.js";
import { MODEL_VERSION, FEATURE_VERSION, POLICY } from "./decision/model-config.js";
import { CALIBRATION } from "./decision/calibration/weights.js";
import { SIGNAL_POLICY, SIGNAL_VERSION } from "./signals/engine.js";
import { readArchiveJson } from "./history/archive-reader.js";
const headers = { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
const json = (value, status = 200) => Response.json(value, { status, headers: { ...headers, ...(status !== 200 ? { "Cache-Control": "no-store" } : {}) } });
export function compactPlayer(c, signals = []) {
  if (!c) return null;
  const f = c.model?.features;
  return { ...c.player, football_value: c.model?.player_value ?? null, start_value: c.model?.start_value.weekly_start_value ?? null,
    pickup_value: c.model?.pickup_value.central ?? null, pickup_rating: c.pickup?.rating ?? null,
    replacement: c.model?.replacement ?? null, roster_value: c.value_profile?.roster_value?.best_transaction ?? null,
    opportunity: f?.opportunity ?? null, xfp_per_game: f?.xfp_per_game ?? null, fpoe_per_game: f?.fpoe_per_game ?? null,
    confidence: f?.confidence ?? "unknown", sample_size: f?.current_games ?? 0, prior: f?.prior ?? null,
    schedule: c.schedule, matchup: c.adjusted_matchup, production: { season_ppg: c.production?.ppg ?? null, recent_ppg: c.production?.recent_average ?? null, scoring_status: c.production?.scoring_status ?? "unavailable" },
    recent_usage: c.analytics?.history.slice(-4).map(g => ({ week: g.week, snap_share: g.snap_share, target_share: g.target_share, carry_share: g.carry_share, xfp: g.opportunity_model?.expected_points ?? null })) || [],
    high_value: c.high_value ? { recent: c.high_value.recent_high_value_opportunity, through_week: c.high_value.data_through_week, history: c.high_value.history.slice(-4).map(({ evidence, basis, ...g }) => g), source: c.high_value.provenance } : null,
    market_attention: c.market_attention, market_value: null, signals: signals.filter(s => s.player_id === c.player.player_id).map(s => ({ type: s.type, confidence: s.confidence, explanation: s.explanation })),
    warnings: [...(c.production?.unsupported_rules || []), ...(c.production?.missing_stats || [])] };
}
export async function handleChatRequest(request, resource, { build = decisionService, discover = discoverSleeper, state = () => publicSleeper("/state/nfl"), archive = readArchiveJson, configured = getConfiguredLeagueIds() } = {}) {
  const p = new URL(request.url).searchParams;
  const allowed = new Set(["league", "user", "roster", "season", "week", "username", "player", "limit", "offset", "type"]);
  if ([...p.keys()].some(k => !allowed.has(k))) return json({ error: "Unknown query parameter" }, 400);
  if ([...p.keys()].some(k => p.getAll(k).length !== 1)) return json({ error: "Repeated query parameters are not supported" }, 400);
  const limit = p.has("limit") ? Number(p.get("limit")) : 15, offset = p.has("offset") ? Number(p.get("offset")) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30 || !Number.isInteger(offset) || offset < 0 || offset > 1000) return json({ error: "limit must be 1–30; offset must be 0–1000" }, 400);
  const meta = { schema_version: "chat-1", model_version: MODEL_VERSION, feature_version: FEATURE_VERSION, signal_version: SIGNAL_VERSION, generated_at: new Date().toISOString(), season: null, week: null, data_through_week: null, league: null, warnings: [], evidence: { confidence: "unavailable_without_league_context" } };
  try {
    if (resource === "model-meta") return json({ ...meta, season: resolveSeason(p.get("season"), await state()), models: CALIBRATION, policies: POLICY, signal_policy: SIGNAL_POLICY, value_types: ["FootballValue", "RosterValue", "MarketAttention", "BuzzScore", "MarketValue unavailable"], snapshot_schema: "0.2", decision_schema: "0.3", capture_schema: "observation-1", sources: { social: "disabled until permitted access", high_value: "precomputed, informational" } });
    if (resource === "leagues") {
      const data = await discover({ username: p.get("username"), userId: p.get("user") || (!p.has("username") ? getConfiguredUsername() : null), season: p.get("season"), leagueId: p.get("league") });
      return json({ ...meta, season: data.season, account: data.account, leagues: data.leagues, mode: data.mode });
    }
    const league = p.get("league") || configured[0];
    if (!acceptedLeague(league, configured)) return json({ ...meta, error: "Provide a valid league ID" }, 400);
    let identity;
    try { identity = requestIdentity(p, league, configured); }
    catch (error) { return json({ ...meta, error: error.message }, 400); }
    if (resource === "history") {
      const result = await archive("index.json");
      const captures = (result.data?.captures || []).filter(c => c.league_id === league && (!identity.season || c.season === identity.season) && (identity.userId == null || c.provider_user_id === identity.userId) && (!identity.rosterId || c.roster_id === identity.rosterId));
      return json({ ...meta, league: { league_id: league }, season: identity.season ?? captures[0]?.season ?? null, week: captures[0]?.week ?? null, data_through_week: captures[0]?.data_through_week ?? null,
        archive_status: result.status, captures: captures.slice(offset, offset + limit), total: captures.length, warnings: result.status !== "available" ? [result.warning || "Archive unavailable"] : [], retention: result.data?.retention,
        evidence: { confidence: "archival metadata only", note: "Only configured installation scopes are captured. GET never records a new observation." } });
    }
    if (!["league-summary", "waivers", "signals", "player", "matchup"].includes(resource)) return json({ error: "Unknown read-only resource" }, 404);
    if (p.has("week") && (!/^\d+$/.test(p.get("week")) || Number(p.get("week")) < 1 || Number(p.get("week")) > 18)) return json({ error: "Invalid week" }, 400);
    const d = await build(league, { identity });
    if (p.has("week") && Number(p.get("week")) !== d.league.week) return json({ error: "Current-week endpoint; use history for archived observations" }, 409);
    const envelope = { ...meta, model_version: d.model_version, feature_version: d.feature_version, generated_at: d.generated_at, implementation_revision: d.implementation_revision,
      season: d.league.season, week: d.league.week, data_through_week: d.data_through_week, league: d.league, identity: d.identity, roster_id: d.my_roster_id,
      warnings: d.warnings, evidence: { confidence: "per-player/per-signal", through_week: d.data_through_week, sources: d.sources.map(s => ({ source: s.source_id, status: s.status, digest: s.digest, through_week: s.through_week })) } };
    if (resource === "signals") { const records = (d.signals?.records || []).filter(s => !p.get("type") || s.type === p.get("type")); return json({ ...envelope, signals: records.slice(offset, offset + limit).map(s => ({ ...s, player_name: d.player_context[s.player_id]?.player.name })), total: records.length, engine_total: d.signals?.total, engine_omitted: d.signals?.omitted, offset, limit }); }
    if (resource === "player") { const c = d.player_context[p.get("player")]; return c ? json({ ...envelope, player: compactPlayer(c, d.signals?.records) }) : json({ ...envelope, error: "Player not found in returned decision context", context_omitted: d.coverage.context_omitted }, 404); }
    if (resource === "matchup") return json({ ...envelope, matchup: d.matchup });
    if (resource === "league-summary") return json({ ...envelope, teams: d.team_strength_v2.map(t => ({ roster_id: t.roster_id, starter_strength: t.starter_strength, needs: t.needs, surpluses: t.surpluses, unknown_slots: t.unknown_slots })), eligible_pool: d.waivers.evaluated_count, signal_count: d.signals?.total, history: d.history });
    const records = d.waivers.recommendations;
    return json({ ...envelope, evaluated_pool: d.waivers.evaluated_count, total: d.waivers.scored_count, returned_pool_limit: d.waivers.truncation.limit, offset, limit,
      waivers: records.slice(offset, offset + limit).map(p => ({ player: compactPlayer(d.player_context[p.player_id], d.signals?.records),
        best_add_drop: p.roster_value.best, starter_delta: p.roster_value.starter_gain, depth_delta: p.roster_value.depth_gain, transaction_net: p.roster_value.net_roster_improvement,
        pickup_rating: p.pickup_rating, evidence_coverage: p.coverage_percent, category: p.recommendation_types, components: p.components, explanations: p.explanations })) });
  } catch (error) { return json({ ...meta, error: error.message }, /Invalid|valid|Season|Enter/.test(error.message) ? 400 : 502); }
}
