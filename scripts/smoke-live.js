import assert from "node:assert/strict";
import { getConfiguredLeagueIds } from "../lib/config.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { handleSnapshotRequest } from "../lib/snapshot-api.js";

// Optional live check, never part of deterministic CI. Does not write files or mutate leagues.
const baseUrl = process.env.SMOKE_BASE_URL;
for (const id of getConfiguredLeagueIds()) {
  const started = Date.now();
  const data = baseUrl ? await fetch(`${baseUrl}/api/decision-support?league=${id}`).then(async response => {
    assert.equal(response.status, 200); return response.json();
  }) : await buildDecisionContext(id);
  const snapshotResponse = baseUrl ? await fetch(`${baseUrl}/api/snapshot?league=${id}&compact=1`) : await handleSnapshotRequest(new Request(`http://localhost/api/snapshot?league=${id}&compact=1`));
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.equal(snapshot.schema_version, "0.2");
  assert.equal(data.schema_version, "0.3");
  assert.equal(data.league.league_id, id);
  assert.equal(data.my_roster_id, snapshot.my_roster_id);
  assert.ok(data.waivers.evaluated_count > data.waivers.recommendations.length);
  assert.ok(data.sources.filter(s => ["nflverse_stats", "nflverse_schedule", "ffverse_ids"].includes(s.source_id)).every(s => s.status === "available"));
  assert.equal(data.matchup.status, "available");
  assert.equal(data.matchup.teams.length, 2);
  assert.ok(Object.values(data.player_context).some(p => p.production?.ppg != null));
  assert.ok(Object.values(data.matchup_difficulty.WR).some(r => r.rank_most !== null));
  const contexts = Object.values(data.player_context);
  assert.ok(data.sources.some(s => s.source_id === "nflverse_snaps" && s.status === "available"));
  assert.ok(data.sources.some(s => s.source_id === "ffopportunity" && s.status === "available"));
  assert.equal(data.waivers.model_version, "roster-value-v2");
  assert.equal(new Set(Object.keys(data.waivers.candidate_details)).size, Object.keys(data.waivers.candidate_details).length);
  for (const c of contexts) {
    assert.ok(Array.isArray(c.player.fantasy_positions));
    if (c.analytics?.recorded_games < 4) assert.equal(c.analytics.signals.length, 0);
  }
  const expectedSize = id === "1401373864818192384" ? 10 : id === "1395493939665989632" ? 12 : null;
  if (expectedSize) assert.equal(data.team_strength.length, expectedSize);
  if (expectedSize === 10) { assert.ok(data.league.roster_positions.includes("SUPER_FLEX")); assert.equal(data.league.scoring_settings.bonus_rec_te, 0.5); }
  if (expectedSize === 12) assert.equal(data.league.scoring_settings.rec, 1);
  console.log(JSON.stringify({ league_id: id, league: data.league.name, week: data.league.week, ms: Date.now() - started,
    matchup: data.matchup.status, evaluated: data.waivers.evaluated_count, scored: data.waivers.scored_count,
    statistics_through_week: data.coverage.statistics_through_week, source_status: data.sources.map(s => `${s.source_id}:${s.status}`),
    unsupported_rules: data.scoring.unsupported_rules, unmatched_ids: data.coverage.unmatched_statistical_ids,
    teams: data.team_strength.length, snaps: contexts.filter(c => c.analytics?.history.some(h => h.snap_count != null)).length,
    expected_opportunity: contexts.filter(c => c.analytics?.xfp != null).length,
    categories: Object.fromEntries(Object.entries(data.waivers.categories).map(([k, c]) => [k, c.total])),
    bytes: Buffer.byteLength(JSON.stringify(data)), snapshot_schema: snapshot.schema_version }));
}
