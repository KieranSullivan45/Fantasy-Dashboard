import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { weeklyFeatures } from "../lib/decision/features.js";
import { decisionFixtureOptions, source } from "./decision-fixtures.js";
import { h9Prior, h9Quality, basisCheck, assertClassification, buildH9ShadowCapture, appendH9ShadowCapture, prospectiveEligibility, H9_CANDIDATE } from "../lib/shadow/h9.js";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const row = (season, week, points, extra = {}) => ({ season, week, points, game_id: `${season}_${week}`, team: "BUF", season_type: "REG", ...extra });
// Literal port of the retrospective ew2_h16 (research/m4-tier-a/scripts/tier-a.mjs `ew(16)`), used as a cross-check only.
const retrospective = (prev2, prev) => { const isNum = v => typeof v === "number" && Number.isFinite(v);
  const all = [...prev2, ...prev].filter(r => isNum(r.points)); if (!prev.some(r => isNum(r.points))) return null;
  let s = 0, ws = 0; all.forEach((r, i) => { const wt = 0.5 ** ((all.length - 1 - i) / 16); s += wt * r.points; ws += wt; }); return s / ws; };

/** Fixture where 2026 is current and 2025/2024 carry prior rows; Y−2 load can be made to fail. */
function shadowOptions({ y2 = "ok", y1 = "ok", now = NOW, kickoffDay = null, noCurrent = null, priorMutate = null } = {}) {
  const base = decisionFixtureOptions(), calls = [];
  const prior = season => Array.from({ length: 20 }, (_, i) => [1, 2, 3, 4].map(week => ({ player_id: `g${i + 1}`, position: "RB", season: String(season), season_type: "REG",
    week: String(week), game_id: `g${season}_${week}`, team: "BUF", opponent_team: "NE", receptions: String((i + week + season) % 9), passing_tds: "0", targets: "5", carries: String(week) }))).flat();
  const current = base.statsSource;
  const scheduleSource = kickoffDay ? async () => source("nflverse_schedule", [1, 2, 3].map(week => ({ game_id: `game${week}`, game_type: "REG", season: "2026", week: String(week), home_team: "BUF", away_team: "NE",
    gameday: week === 3 ? kickoffDay : "2026-09-13", gametime: "13:00", home_score: week === 3 ? "" : "10", away_score: week === 3 ? "" : "20" }))) : base.scheduleSource;
  return { calls, options: { ...base, now, scheduleSource, statsSource: async season => { calls.push(season);
    if (season === 2026) { const cur = await current(); return noCurrent ? { ...cur, data: cur.data.filter(r => !noCurrent.includes(r.player_id)) } : cur; }
    if (season === 2025) { if (y1 === "throw") throw new Error("Y-1 outage"); const rows = priorMutate ? priorMutate(prior(2025)) : prior(2025);
      return y1 === "ok" ? source("nflverse_stats", rows) : { ...source("nflverse_stats", rows), status: y1 }; }
    if (y2 === "throw") throw new Error("Y-2 outage"); return source("nflverse_stats", prior(2024)); } } };
}
async function build(opts) {
  let internals = null;
  const decision = await buildDecisionContext("A", { ...opts, shadowObserver: i => { internals = i; } });
  return { decision, internals };
}

test("ew2_h16 matches ADR 0009 by hand and the retrospective computation", () => {
  const prev2 = [row(2024, 1, 10), row(2024, 2, 20)], prev = [row(2025, 1, 30), row(2025, 2, null), row(2025, 3, 6)];
  const w = g => 0.5 ** (g / 16), expected = (10 * w(3) + 20 * w(2) + 30 * w(1) + 6 * w(0)) / (w(3) + w(2) + w(1) + w(0));
  const p = h9Prior([...prev, ...prev2].reverse(), 2026);
  assert.equal(p.status, "present"); assert.ok(Math.abs(p.ppg - expected) < 1e-12);
  assert.ok(Math.abs(p.ppg - retrospective(prev2, prev)) < 1e-12);
  assert.deepEqual(p.included_games, { y_minus_2: 2, y_minus_1: 2 }); assert.deepEqual(p.excluded_non_numeric, { y_minus_2: 0, y_minus_1: 1 });
  // Seeded cross-check against the retrospective formula over many varied histories.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 200; t++) {
    const mk = (season, n) => Array.from({ length: n }, (_, i) => row(season, i + 1, rnd() < 0.15 ? (rnd() < 0.5 ? null : "n/a") : Math.round(rnd() * 300) / 10));
    const a = mk(2024, Math.floor(rnd() * 18)), b = mk(2025, Math.floor(rnd() * 18)), got = h9Prior([...a, ...b], 2026).ppg, want = retrospective(a, b);
    assert.ok(got === want || Math.abs(got - want) < 1e-9, `case ${t}`);
  }
  // Q replaces only P; S, n and k are production's.
  const f = { season_ppg: 12, current_games: 3, prior: { effective_games: 4, ppg: 9 } };
  assert.equal(h9Quality(f, { ppg: 15 }), (12 * 3 + 15 * 4) / 7);
  assert.equal(h9Quality({ ...f, season_ppg: null, current_games: 0 }, { ppg: 15 }), 15);
  assert.equal(h9Quality(f, { ppg: null }), 12);
});

test("missing prior points stay missing: excluded before g, never zero, no Y−2-only fallback", () => {
  const base = [row(2024, 1, 8), row(2025, 1, 12), row(2025, 2, 4)];
  const withGaps = [...base, row(2025, 3, null), row(2025, 4, undefined), row(2025, 5, "DNP"), row(2025, 6, NaN)];
  assert.equal(h9Prior(withGaps, 2026).ppg, h9Prior(base, 2026).ppg);
  const asZero = h9Prior([...base, row(2025, 3, 0)], 2026).ppg;
  assert.notEqual(h9Prior(withGaps, 2026).ppg, asZero);
  const onlyOld = h9Prior([row(2024, 1, 20), row(2025, 1, null), row(2025, 2, "x")], 2026);
  assert.equal(onlyOld.status, "absent"); assert.equal(onlyOld.ppg, null); assert.equal(onlyOld.excluded_non_numeric.y_minus_1, 2);
  assert.equal(h9Prior([], 2026).ppg, null);
  // Postseason rows are excluded.
  assert.equal(h9Prior([...base, row(2025, 19, 50, { season_type: "POST" })], 2026).ppg, h9Prior(base, 2026).ppg);
});

test("target-season and future rows cannot enter H9 inputs", () => {
  const prior = [row(2024, 3, 7), row(2025, 2, 11), row(2025, 9, 14)];
  const leaked = [...prior, row(2026, 1, 99), row(2026, 4, 80), row(2027, 1, 70), row(2023, 5, 60)];
  assert.equal(h9Prior(leaked, 2026).ppg, h9Prior(prior, 2026).ppg);
  assert.equal(h9Prior(leaked, 2026).input_sha256, h9Prior(prior, 2026).input_sha256);
});

test("basis check reproduces production's last-8 prior from the same Y−1 rows", () => {
  const prior = Array.from({ length: 12 }, (_, i) => row(2025, i + 1, i === 10 ? null : i + 1));
  const f = weeklyFeatures([row(2026, 1, 10), row(2026, 2, 14)], prior, "RB", { season: 2026, week: 3, currentTeam: "BUF" });
  assert.equal(basisCheck(f, prior, 2026).status, "consistent");
  assert.equal(basisCheck(f, prior.slice(0, -1), 2026).status, "mismatch");
});

test("production decision is unchanged with shadow capture enabled, failing or absent", async () => {
  const { options } = shadowOptions();
  const plain = JSON.stringify(await buildDecisionContext("A", options));
  const { decision, internals } = await build(options);
  assert.equal(JSON.stringify(decision), plain);
  assert.equal(JSON.stringify(await buildDecisionContext("A", { ...options, shadowObserver: () => { throw new Error("shadow bug"); } })), plain);
  await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => NOW });
  assert.equal(JSON.stringify(decision), plain, "shadow build never mutates the decision");
  await assert.rejects(buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "bogus", clock: () => NOW }));
  assert.equal(JSON.stringify(decision), plain);
});

test("shadow records hold both frozen predictions, identity, basis and missingness", async () => {
  const { options, calls } = shadowOptions();
  const { decision, internals } = await build(options);
  const capture = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => NOW, linkedCaptureId: "c1" });
  assert.ok(calls.includes(2024)); assert.ok(calls.every(s => s <= 2026));
  assert.equal(capture.records.length, Object.keys(decision.player_context).length);
  const withPrior = capture.records.filter(r => r.h9.prior?.status === "present"), without = capture.records.filter(r => r.h9.prior?.status === "absent");
  assert.ok(withPrior.length && without.length);
  for (const r of capture.records) {
    const c = decision.player_context[r.player.player_id];
    assert.equal(r.schema_version, "h9-shadow-1"); assert.equal(r.classification, "prospective"); assert.equal(r.candidate.id, "ew2_h16");
    assert.equal(r.production.start_value, c.model.start_value.central); assert.equal(r.production.quality_points, c.model.features.quality_points);
    assert.equal(r.basis_check.status, "consistent"); assert.equal(r.h9.status === "withheld", false);
    assert.equal(r.model_version, "decision-0.3.2"); assert.equal(r.feature_version, "weekly-features-2");
    assert.match(r.decision_basis_sha256, /^[a-f0-9]{64}$/); assert.match(r.linked_observation_id, /^[a-f0-9]{64}$/);
    assert.equal(r.generated_at, decision.generated_at); assert.equal(r.data_through_week, decision.data_through_week);
  }
  for (const r of without) { assert.equal(r.h9.prior.ppg, null); assert.equal(r.h9.quality_points, r.production.season_ppg); }
  for (const r of withPrior) {
    const rows = [...internals.priorGames.filter(g => g.player_id === r.player.player_id).map(g => ({ ...g, season: 2025 }))];
    assert.equal(r.h9.prior.included_games.y_minus_1, rows.filter(g => typeof g.points === "number").length);
    assert.equal(typeof r.h9.quality_points, "number");
  }
});

test("Y−2 outage withholds H9 instead of computing from Y−1 alone", async () => {
  const { options } = shadowOptions({ y2: "throw" });
  const { decision, internals } = await build(options);
  const capture = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => NOW });
  assert.ok(capture.records.every(r => r.h9.status === "withheld" && r.h9.quality_points === null && r.h9.prior === null));
  assert.ok(capture.records.every(r => r.production.start_value === decision.player_context[r.player.player_id].model.start_value.central));
  assert.equal(capture.records[0].source_versions.prior_y2.status, "unavailable");
});

test("prospective and replay cannot be confused", async () => {
  const after = "2026-10-05T12:00:00.000Z";
  assert.throws(() => assertClassification("prospective", "2026-10-03T03:15:39Z", Date.parse("2026-10-03T03:15:39Z")), /effective boundary/);
  assert.throws(() => assertClassification("prospective", after, Date.parse(after) + 2 * 3600000), /decision time/);
  assert.throws(() => assertClassification("live", after, Date.parse(after)), /Unknown/);
  assert.throws(() => assertClassification(undefined, after, Date.parse(after)), /Unknown/);
  assert.equal(assertClassification("replay", "2026-09-20T00:00:00Z", Date.parse(after)), "replay");
  assert.equal(H9_CANDIDATE.effective_at, "2026-10-03T03:15:40Z");

  const { options } = shadowOptions();
  const { decision, internals } = await build(options);
  const directory = await mkdtemp(join(tmpdir(), "fantasy-h9-"));
  try {
    const prospective = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => NOW });
    const replay = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "replay", clock: () => NOW + 86400000 });
    assert.notEqual(prospective.records[0].record_id, replay.records[0].record_id);
    const a = await appendH9ShadowCapture(directory, prospective, { wallClock: NOW }), b = await appendH9ShadowCapture(directory, replay, { wallClock: NOW });
    assert.match(a.path, /^shadow\/h9-ew2_h16\/prospective\//); assert.match(b.path, /^shadow\/h9-ew2_h16\/replay\//);
    // A backfill relabelled prospective after the fact is refused at write time.
    await assert.rejects(appendH9ShadowCapture(directory, prospective, { wallClock: NOW + 86400000 }), /decision time/);
    const mixed = { ...prospective, records: [...prospective.records, replay.records[0]] };
    await assert.rejects(appendH9ShadowCapture(directory, mixed, { wallClock: NOW }), /Mixed/);
    // Immutable: a retry never overwrites the stored bytes.
    const bytes = await readFile(join(directory, a.path));
    assert.equal((await appendH9ShadowCapture(directory, { ...prospective, shadow_computed_at: "changed" }, { wallClock: NOW })).created, false);
    assert.deepEqual(await readFile(join(directory, a.path)), bytes);
    assert.equal(JSON.parse(gunzipSync(bytes)).classification, "prospective");
    assert.equal((await appendH9ShadowCapture(directory, null)).created, false);
  } finally { await rm(directory, { recursive: true }); }
});

test("private decisions are never shadow-captured", async () => {
  const { options } = shadowOptions();
  const { decision, internals } = await build(options);
  await assert.rejects(buildH9ShadowCapture({ decision: { ...decision, visibility: "private" }, internals, statsSource: options.statsSource, classification: "test", clock: () => NOW }), /Private/);
});

test("deterministic reruns on the same basis give identical H9 predictions", async () => {
  const one = shadowOptions(), two = shadowOptions();
  const x = await build(one.options), y = await build(two.options);
  const a = await buildH9ShadowCapture({ decision: x.decision, internals: x.internals, statsSource: one.options.statsSource, classification: "prospective", clock: () => NOW });
  const b = await buildH9ShadowCapture({ decision: y.decision, internals: y.internals, statsSource: two.options.statsSource, classification: "prospective", clock: () => NOW + 60000 });
  assert.equal(a.capture_id, b.capture_id);
  const strip = rs => rs.map(({ frozen_at, ...r }) => r);
  assert.deepEqual(strip(a.records), strip(b.records));
  assert.ok(a.records.every(r => r.frozen_at === a.frozen_at));
});

test("prospective eligibility needs a freeze before the player's kickoff and a kickoff after the H9 boundary", async () => {
  const base = { classification: "prospective", h9Status: "computed", h9Quality: 10, frozenAt: "2026-10-11T16:00:00.000Z" };
  assert.deepEqual([prospectiveEligibility({ ...base, kickoff: "2026-10-11T17:00:00.000Z" }).eligible, prospectiveEligibility({ ...base, kickoff: "2026-10-11T16:00:00.000Z" }).reason], [true, "kickoff_not_after_freeze"]);
  assert.equal(prospectiveEligibility({ ...base, kickoff: H9_CANDIDATE.effective_at, frozenAt: "2026-10-03T03:00:00.000Z" }).reason, "kickoff_not_after_candidate_boundary");
  assert.equal(prospectiveEligibility({ ...base, kickoff: null }).reason, "no_target_kickoff");
  assert.equal(prospectiveEligibility({ ...base, h9Status: "withheld", kickoff: "2026-10-11T17:00:00.000Z" }).reason, "h9_withheld");
  assert.equal(prospectiveEligibility({ ...base, classification: "replay", kickoff: "2026-10-11T17:00:00.000Z" }).reason, "not_prospective_classification");

  // Week-3 kickoff 2026-10-11 13:00 ET (17:00Z). Freeze before it: eligible. Freeze after it: kept but ineligible.
  const kickoff = Date.parse("2026-10-11T17:00:00Z");
  for (const [freeze, eligible] of [[kickoff - 600000, true], [kickoff + 300000, false]]) {
    const { options } = shadowOptions({ now: kickoff - 1200000, kickoffDay: "2026-10-11" });
    const { decision, internals } = await build(options);
    const capture = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => freeze });
    assert.equal(capture.frozen_at, new Date(freeze).toISOString());
    const scheduled = capture.records.filter(r => r.schedule.kickoff === "2026-10-11T17:00:00.000Z" && r.h9.status !== "withheld");
    assert.ok(scheduled.length);
    for (const r of scheduled) assert.deepEqual([r.prospective_eligibility.eligible, r.prospective_eligibility.reason], eligible ? [true, null] : [false, "kickoff_not_after_freeze"]);
  }
  // The default fixture's kickoff (2026-09-27) precedes the ADR 0009 boundary: retained, never eligible.
  const { options } = shadowOptions();
  const { decision, internals } = await build(options);
  const old = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => NOW });
  assert.ok(old.records.length && old.records.every(r => !r.prospective_eligibility.eligible));
  // A capture written long after its freeze cannot be stored as prospective.
  const directory = await mkdtemp(join(tmpdir(), "fantasy-h9-"));
  try { await assert.rejects(appendH9ShadowCapture(directory, { ...old, generated_at: new Date(NOW + 3600000).toISOString() }, { wallClock: NOW + 3600000 }), /precede/); }
  finally { await rm(directory, { recursive: true }); }
});

test("prior rows need an explicit REG season type and one row per player-game", () => {
  const ok = [row(2024, 1, 8), row(2025, 1, 12)];
  const untyped = h9Prior([...ok, { season: 2025, week: 2, points: 9, game_id: "x" }], 2026);
  assert.equal(untyped.status, "invalid_input"); assert.equal(untyped.ppg, null);
  // Production rows carry the type on their raw source row (buildProduction keeps REG only).
  assert.equal(h9Prior([...ok, { season: 2025, week: 2, points: 9, game_id: "x", raw_stats: { season_type: "REG" } }], 2026).status, "present");
  const dup = h9Prior([...ok, row(2025, 1, 30)], 2026);
  assert.equal(dup.status, "invalid_input"); assert.match(dup.reason, /Duplicate/);
});

test("fixture Q: H9 keeps production's numeric k, so k = 0 when the last-8 prior is absent (frozen M4 semantics)", () => {
  const prior = [row(2025, 1, 15), ...Array.from({ length: 8 }, (_, i) => row(2025, i + 2, i % 2 ? null : "n/a"))];
  const current = [row(2026, 1, 10), row(2026, 2, 14)];
  const f = weeklyFeatures(current, prior, "RB", { season: 2026, week: 3, currentTeam: "BUF" });
  assert.equal(f.prior.ppg, null); assert.equal(f.prior.effective_games, 0);
  const p = h9Prior(prior, 2026);
  assert.equal(p.status, "present"); assert.equal(p.ppg, 15); assert.deepEqual(p.excluded_non_numeric, { y_minus_2: 0, y_minus_1: 8 });
  assert.equal(basisCheck(f, prior, 2026).status, "consistent");
  // Retrospective qOf(c, Pew16, c.k): only P changes; k stays 0, so Q equals S.
  assert.equal(h9Quality(f, p), f.season_ppg); assert.equal(h9Quality(f, p), 12);
  // Without current-season games, Q is the H9 prior itself.
  const f0 = weeklyFeatures([], prior, "RB", { season: 2026, week: 1, currentTeam: "BUF" });
  assert.equal(f0.prior.effective_games, 0); assert.equal(h9Quality(f0, p), 15);
});

test("changed-team branch: H9 keeps production's k = 1", () => {
  const prior = Array.from({ length: 6 }, (_, i) => row(2025, i + 1, 6 + i, { team: "MIA" }));
  const current = [row(2026, 1, 10), row(2026, 2, 14)];
  const f = weeklyFeatures(current, [row(2024, 1, 20), ...prior], "RB", { season: 2026, week: 3, currentTeam: "BUF" });
  assert.equal(f.changed_team, true); assert.equal(f.prior.effective_games, 1);
  const p = h9Prior([row(2024, 1, 20), ...prior], 2026);
  assert.equal(h9Quality(f, p), (f.season_ppg * 2 + p.ppg * 1) / 3);
});

const KICKOFF = Date.parse("2026-10-11T17:00:00Z");
const futureOptions = extra => shadowOptions({ now: KICKOFF - 1200000, kickoffDay: "2026-10-11", ...extra });
async function futureCapture(extra = {}) {
  const { options } = futureOptions(extra);
  const plain = JSON.stringify(await buildDecisionContext("A", options));
  const { decision, internals } = await build(options);
  assert.equal(JSON.stringify(decision), plain, "production output unchanged");
  const capture = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => KICKOFF - 600000 });
  return { decision, capture };
}

test("blocker 1: Y−1 statistics must be exactly available, or H9 is withheld and ineligible", async () => {
  for (const y1 of ["throw", "partial", "unsupported", "unknown"]) {
    const { decision, capture } = await futureCapture({ y1 });
    const src = decision.sources.find(s => s.source_id === "nflverse_prior_stats");
    assert.notEqual(src.status, "available");
    assert.ok(capture.records.length);
    for (const r of capture.records) {
      assert.equal(r.h9.status, "withheld"); assert.match(r.h9.withheld_reason, /Y−1 statistics not available/);
      assert.equal(r.h9.quality_points, null); assert.equal(r.source_versions.prior_y1.status, src.status);
      assert.deepEqual([r.prospective_eligibility.eligible, r.prospective_eligibility.reason], [false, "h9_withheld"]);
    }
  }
});

test("blocker 2: eligibility needs a finite H9 Q; a current-only Q with no H9 prior stays eligible", async () => {
  // g21–g25: no 2026 rows and no prior → Q null. g46+: 2026 rows, no prior → current-only Q.
  const { capture } = await futureCapture({ noCurrent: ["g21", "g22", "g23", "g24", "g25"] });
  const none = capture.records.filter(r => ["21", "22", "23", "24", "25"].includes(r.player.player_id));
  const currentOnly = capture.records.filter(r => r.h9.status === "computed_without_prior" && typeof r.h9.quality_points === "number" && r.schedule.kickoff);
  assert.ok(none.length && currentOnly.length);
  for (const r of none) {
    assert.equal(r.h9.quality_points, null); assert.notEqual(r.h9.status, "withheld");
    assert.deepEqual([r.prospective_eligibility.eligible, r.prospective_eligibility.reason], [false, "no_h9_prediction"]);
  }
  for (const r of currentOnly) { assert.equal(r.h9.prior.status, "absent"); assert.equal(r.prospective_eligibility.eligible, true); }
  assert.equal(prospectiveEligibility({ classification: "prospective", h9Status: "computed", h9Quality: NaN, kickoff: "2026-10-11T17:00:00Z", frozenAt: "2026-10-11T16:00:00Z" }).reason, "no_h9_prediction");
});

test("blocker 3: prospective frozen_at must follow the boundary and generated_at, at build and at write", async () => {
  const boundary = Date.parse(H9_CANDIDATE.effective_at);
  // Build time: generated_at after the boundary but the freeze clock before it.
  { const { options } = shadowOptions({ now: boundary + 60000 });
    const { decision, internals } = await build(options);
    await assert.rejects(buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: (() => { let n = 0; return () => n++ ? boundary - 1000 : boundary + 60000; })() }), /boundary/);
    await assert.rejects(buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: (() => { let n = 0; return () => n++ ? boundary + 30000 : boundary + 60000; })() }), /precede generated_at/); }
  // Exact boundary: generated_at = frozen_at = boundary is allowed.
  { const { options } = shadowOptions({ now: boundary });
    const { decision, internals } = await build(options);
    const c = await buildH9ShadowCapture({ decision, internals, statsSource: options.statsSource, classification: "prospective", clock: () => boundary });
    assert.equal(Date.parse(c.frozen_at), boundary);
    const directory = await mkdtemp(join(tmpdir(), "fantasy-h9-"));
    try {
      assert.equal((await appendH9ShadowCapture(directory, c, { wallClock: boundary + 1000 })).created, true);
      // Write time refuses tampered chronology or eligibility independently of the builder.
      const before = new Date(boundary - 1000).toISOString();
      await assert.rejects(appendH9ShadowCapture(directory, { ...c, frozen_at: before, records: c.records.map(r => ({ ...r, frozen_at: before })) }, { wallClock: boundary + 1000 }), /boundary/);
      const late = new Date(boundary + 500).toISOString(), early = new Date(boundary + 100).toISOString();
      await assert.rejects(appendH9ShadowCapture(directory, { ...c, generated_at: late, frozen_at: early, records: c.records.map(r => ({ ...r, generated_at: late, frozen_at: early })) }, { wallClock: boundary + 1000 }), /precede generated_at/);
      const forged = { ...c, records: c.records.map(r => ({ ...r, prospective_eligibility: { ...r.prospective_eligibility, eligible: true, reason: null } })) };
      await assert.rejects(appendH9ShadowCapture(directory, forged, { wallClock: boundary + 1000 }), /eligibility/);
    } finally { await rm(directory, { recursive: true }); }
  }
  // Normal chronology still passes and is written.
  const { capture } = await futureCapture();
  const directory = await mkdtemp(join(tmpdir(), "fantasy-h9-"));
  try { assert.equal((await appendH9ShadowCapture(directory, capture, { wallClock: KICKOFF - 590000 })).created, true); assert.ok(capture.records.some(r => r.prospective_eligibility.eligible)); }
  finally { await rm(directory, { recursive: true }); }
});

test("blocker 4: prior rows without verified chronology withhold H9", async () => {
  const ok = [row(2024, 1, 8), row(2025, 1, 12), row(2025, 2, 4)];
  for (const bad of [row(2025, 0, 9), row(2025, -1, 9), row(2025, 2.5, 9), row(2025, NaN, 9), row(2025, Infinity, 9), row(2025, "3", 9), row(2025, 3, 9, { game_id: "" }), row(2025, 3, 9, { game_id: null }), row(2025, 2, 9, { game_id: "other" })]) {
    const p = h9Prior([...ok, bad], 2026);
    assert.equal(p.status, "invalid_input", JSON.stringify(bad)); assert.equal(p.ppg, null);
  }
  assert.equal(h9Prior(ok, 2026).status, "present");
  // Integration: a blank raw week (normalized to 0 upstream) withholds H9 for that player only; production is unchanged.
  const { capture } = await futureCapture({ priorMutate: rows => rows.map(r => r.player_id === "g1" && r.week === "2" ? { ...r, week: "" } : r) });
  const g1 = capture.records.find(r => r.player.player_id === "1"), g2 = capture.records.find(r => r.player.player_id === "2");
  assert.equal(g1.h9.status, "withheld"); assert.match(g1.h9.withheld_reason, /week/); assert.equal(g1.prospective_eligibility.eligible, false);
  assert.equal(g2.h9.status, "computed");
});
