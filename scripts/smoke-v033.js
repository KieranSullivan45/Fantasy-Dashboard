import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getConfiguredLeagueIds, getConfiguredUsername } from "../lib/config.js";
import { publicSleeper, discoverSleeper } from "../lib/accounts/sleeper.js";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { createDecisionService } from "../lib/decision-service.js";
import { handleChatRequest } from "../lib/chat-api.js";
const base = process.env.SMOKE_BASE_URL, aggregateDir = process.env.SMOKE_AGGREGATE_DIR;
const service = createDecisionService((id, options) => buildDecisionContext(id, { ...options, ...(aggregateDir ? { highValueSource: async season => {
  const data = JSON.parse(await readFile(`${aggregateDir}/${season}.json`, "utf8"));
  return { source_id: "nflverse_high_value", status: "available", data, warnings: [], digest: data.provenance.sha256 };
} } : {}) }));
const request = async (resource, params) => {
  const url = `${base || "http://localhost"}/api/chat/${resource}?${new URLSearchParams(params)}`, start = Date.now();
  const r = base ? await fetch(url, { headers: { "User-Agent": "FantasyDashboard-ReadOnly-Smoke/0.3.3" }, signal: AbortSignal.timeout(180000) }) : await handleChatRequest(new Request(url), resource, { build: service });
  assert.match(r.headers.get("content-type"), /application\/json/);
  const text = await r.text(), data = JSON.parse(text);
  if (r.status !== 200) throw new Error(`${resource}: ${r.status} ${text.slice(0, 300)}`);
  assert.equal(data.schema_version, "chat-1"); assert.ok(data.generated_at);
  assert.ok("data_through_week" in data); assert.ok("warnings" in data);
  return { data, bytes: Buffer.byteLength(text), ms: Date.now() - start, cache: r.headers.get("cache-control"), vercel_cache: r.headers.get("x-vercel-cache") };
};
for (const league of getConfiguredLeagueIds()) {
  const identity = { league, user: getConfiguredUsername(), limit: "5" };
  const summary = await request("league-summary", identity), signals = await request("signals", identity), waivers = await request("waivers", identity);
  const d = summary.data;
  assert.ok(d.eligible_pool > 100); assert.ok(d.roster_id != null); assert.ok(d.teams.length >= 8);
  for (const s of signals.data.signals) { assert.ok(s.data_through_week < s.week); assert.ok(s.explanation); assert.notEqual(s.confidence, "high"); }
  for (const w of waivers.data.waivers) assert.ok(w.best_add_drop?.recommended && w.transaction_net > 0);
  const matchup = await request("matchup", identity); assert.equal(matchup.data.matchup.status, "available");
  const history = await request("history", identity);
  if (base) { assert.equal(history.data.archive_status, "available"); assert.ok(history.data.total > 0); }
  const warm = await request("league-summary", identity);
  const spotlightId = signals.data.signals[0]?.player_id;
  const player = spotlightId ? await request("player", { ...identity, player: spotlightId }) : null;
  if (player) assert.ok(player.data.player.high_value, "Live red-zone aggregate must be linked");
  console.log(JSON.stringify({ league, name: d.league.name, teams: d.teams.length, slots: d.league.roster_positions, te_premium: d.league.scoring_settings.bonus_rec_te || 0,
    rec: d.league.scoring_settings.rec, roster: d.roster_id, eligible: d.eligible_pool, signals: signals.data.engine_total, omitted: signals.data.engine_omitted,
    examples: signals.data.signals.slice(0, 3).map(s => ({ player: s.player_name, type: s.type, confidence: s.confidence, evidence: s.evidence })),
    high_value_example: player?.data.player.high_value, archive: history.data.archive_status,
    responses: Object.fromEntries(Object.entries({ summary, warm, signals, waivers, matchup, history, ...(player ? { player } : {}) }).map(([k, { data, ...m }]) => [k, m])) }));
  // Fresh account discovery uses an actual other owner, never a hardcoded friend identity.
  const users = await publicSleeper(`/league/${league}/users`), other = users.find(u => u.user_id !== getConfiguredUsername());
  assert.ok(other);
  const friend = await publicSleeper(`/user/${other.user_id}`); assert.ok(friend.username);
  const discovered = await discoverSleeper({ username: friend.username, season: d.season });
  assert.equal(discovered.account.provider_user_id, friend.user_id);
  assert.ok(discovered.leagues.some(l => l.league_id === league));
  const friendSummary = await request("league-summary", { league, user: friend.user_id, season: String(d.season) });
  assert.equal(friendSummary.data.identity.provider_user_id, friend.user_id); assert.ok(friendSummary.data.roster_id != null);
  assert.notEqual(friendSummary.data.roster_id, d.roster_id);
  const spectator = await request("league-summary", { league, user: "spectator" }); assert.equal(spectator.data.roster_id, null);
  const future = await discoverSleeper({ userId: friend.user_id, season: d.season + 1 }); assert.equal(future.season, d.season + 1);
  console.log(JSON.stringify({ league, friend_discovery: "passed", friend_roster: friendSummary.data.roster_id, spectator_roster: null, future_season: future.season }));
}
await request("model-meta", {});
if (base) {
  for (const q of ["limit=999", "league=bad", "user=bad", "unexpected=1"]) {
    const r = await fetch(`${base}/api/chat/waivers?${q}`); assert.equal(r.status, 400); assert.match(r.headers.get("content-type"), /json/);
  }
}
