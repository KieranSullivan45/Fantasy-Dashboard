// EDGE-02 prospective candidate shadow (Protocol v2, ADR 0014): synthetic data only; no 2026 outcome is read.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { buildH9ShadowCapture, appendH9ShadowCapture } from "../lib/shadow/h9.js";
import { decisionFixtureOptions, source } from "./decision-fixtures.js";
import { classifyScoring, scoringPositionCheck, auditCurrentRows, vipLast2, vipOfGame, nonOffensiveKey } from "../lib/shadow/edge02/inputs.js";
import { EDGE02_CONFIG, EDGE02_CONFIG_SHA256, computedConfigSha256, VIP_COEFFICIENTS, VIP_INPUTS, FROZEN_FORMATS, CANDIDATES, EDGE02_BOUNDARY, SOURCE_MANIFEST, FITTING_CODE_SHA256 } from "../lib/shadow/edge02/config.js";
import { buildEdge02Capture, appendEdge02Capture, approvedContextProblem, assertClassification, prospectiveTiming, candidateValue, trustedWriter, confirmatoryStatus, recordId, h9Evidence } from "../lib/shadow/edge02/capture.js";
import { buildEdge02LineupCapture, appendEdge02LineupCapture, scopedLineup } from "../lib/shadow/edge02/lineup.js";
import { captureEdge02Shadow } from "../lib/shadow/edge02/run.js";
import { VIP_INPUTS as EDGE01_VIP_INPUTS, opportunityFeatures } from "../lib/research/edge01/features.js";
import { digest } from "../lib/history/contracts.js";
import { scoreStats } from "../lib/normalize/scoring.js";
import { MODEL_VERSION, FEATURE_VERSION } from "../lib/decision/model-config.js";

const PPR = { ...FROZEN_FORMATS.ppr }; delete PPR.bonus_rec_te;
const LEAGUE_PPR = { ...PPR, fgm: 3, xpm: 1, def_td: 6, sack: 1, int: 2, pts_allow_0: 10, idp_tkl: 1, bonus_rec_te: 0 };
const KICKOFF = Date.parse("2026-10-11T17:00:00Z"), NOW = KICKOFF - 1200000;
const ENV = { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_WORKFLOW: "Capture prospective history", GITHUB_REF: "refs/heads/main", GITHUB_SHA: "abc123", GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_NAME: "schedule", SECRET_TOKEN: "never" };
const APPROVED = ["A"];
const ZERO_STATS = Object.fromEntries(["passing_yards", "passing_tds", "passing_interceptions", "passing_2pt_conversions", "rushing_yards", "rushing_tds", "rushing_2pt_conversions",
  "receiving_yards", "receiving_tds", "receiving_2pt_conversions", "fumbles_lost_total"].map(k => [k, "0"]));

/** 2026 current rows g1..g65 (weeks 1–2, BUF), 2025/2024 prior rows for H9; full PPR scoring; week-3 kickoff 2026-10-11. */
function options({ scoring = LEAGUE_PPR, current = null, roster = null, eligibility = null } = {}) {
  const base = decisionFixtureOptions();
  const cur = Array.from({ length: 65 }, (_, i) => [1, 2].map(week => ({ player_id: `g${i + 1}`, position: "RB", season: "2026", season_type: "REG", week: String(week), game_id: `game${week}`,
    team: "BUF", opponent_team: "NE", receptions: String(i % 7), passing_tds: "0", targets: String((i + week) % 9), carries: String((i * week) % 13), attempts: "0", receiving_air_yards: "0", ...ZERO_STATS, receiving_yards: String(i % 50), rushing_yards: String((i * week) % 40) }))).flat();
  const prior = season => Array.from({ length: 20 }, (_, i) => [1, 2, 3, 4].map(week => ({ player_id: `g${i + 1}`, position: "RB", season: String(season), season_type: "REG",
    week: String(week), game_id: `g${season}_${week}`, team: "BUF", opponent_team: "NE", receptions: String((i + week + season) % 9), passing_tds: "0", targets: "5", carries: String(week), ...ZERO_STATS, rushing_yards: String(10 * week) }))).flat();
  const load = base.loadLeague;
  return { ...base, now: NOW,
    loadLeague: async (id, o) => { const s = await load(id, o); const out = { ...s, league: { ...s.league, scoring_settings: scoring } };
      if (eligibility) for (const p of [...out.rosters.flatMap(r => r.all_players), ...(out.matchup_players ?? []), ...Object.values(out.free_agents ?? {}).flat()]) if (eligibility[p.player_id]) p.fantasy_positions = eligibility[p.player_id];
      return roster ? roster(out) : out; },
    scheduleSource: async () => source("nflverse_schedule", [1, 2, 3].map(week => ({ game_id: `game${week}`, game_type: "REG", season: "2026", week: String(week), home_team: "BUF", away_team: "NE",
      gameday: week === 3 ? "2026-10-11" : "2026-09-13", gametime: "13:00", home_score: "", away_score: "" }))),
    statsSource: async season => season === 2026 ? source("nflverse_stats", current ? current(cur) : cur) : source("nflverse_stats", prior(season)) };
}
async function build(opts) {
  let internals = null;
  const decision = await buildDecisionContext("A", { ...opts, shadowObserver: i => { internals = i; } });
  return { decision, internals };
}
async function h9For(decision, internals, opts, persisted = true) {
  const capture = await buildH9ShadowCapture({ decision, internals, statsSource: opts.statsSource, classification: "prospective", clock: () => NOW + 60000 });
  return { capture, persisted, path: persisted ? "shadow/h9-ew2_h16/prospective/x.json.gz" : null, error: null };
}
async function full(extra = {}, { h9 = true, clock = () => NOW + 120000, env = ENV } = {}) {
  const opts = options(extra), { decision, internals } = await build(opts);
  const h9Result = h9 === true ? await h9For(decision, internals, opts) : h9;
  const capture = await buildEdge02Capture({ decision, internals, h9: h9Result, classification: "prospective", approvedLeagueIds: APPROVED, clock, env, linkedCaptureId: "c1" });
  return { opts, decision, internals, h9: h9Result, capture, byId: id => capture.records.find(r => r.identity.player_id === id) };
}
const withTemp = async fn => { const dir = await mkdtemp(join(tmpdir(), "fantasy-edge02-")); try { return await fn(dir); } finally { await rm(dir, { recursive: true }); } };

// ---------------- configuration and coefficients ----------------

test("frozen configuration: candidate IDs, fixed w = 0.3, EDGE-01 VIP inputs, registered digest", () => {
  assert.equal(CANDIDATES.a2.id, "edge02-vip-a2-w030-v1"); assert.equal(CANDIDATES.a2.role, "primary");
  assert.equal(CANDIDATES.x2.id, "edge02-vip-x2-w030-v1"); assert.equal(CANDIDATES.x2.role, "secondary");
  for (const c of Object.values(CANDIDATES)) assert.deepEqual(c.weights, { quality: 0.5, recent: 0.2, vip: 0.3 });
  assert.deepEqual(JSON.parse(JSON.stringify(VIP_INPUTS)), JSON.parse(JSON.stringify(EDGE01_VIP_INPUTS)));
  assert.equal(computedConfigSha256(), EDGE02_CONFIG_SHA256);
  assert.match(EDGE02_CONFIG_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(EDGE02_BOUNDARY.effective_at, null);
  assert.ok(Object.isFrozen(VIP_COEFFICIENTS.ppr.QB.coef));
  for (const f of ["ppr", "half", "standard", "te_premium"]) for (const p of ["QB", "RB", "WR", "TE"]) {
    assert.equal(VIP_COEFFICIENTS[f][p].coef.length, VIP_INPUTS[p].length + 1);
    assert.ok(VIP_COEFFICIENTS[f][p].coef.every(Number.isFinite));
  }
});

test("coefficient change changes the configuration identity (deterministic digest)", () => {
  const body = JSON.parse(JSON.stringify(EDGE02_CONFIG));
  assert.equal(digest(body), EDGE02_CONFIG_SHA256);
  assert.equal(digest(JSON.parse(JSON.stringify(EDGE02_CONFIG))), digest(body));
  body.vip.coefficients.ppr.WR.coef[1] += 1e-12;
  assert.notEqual(digest(body), EDGE02_CONFIG_SHA256);
  const w = JSON.parse(JSON.stringify(EDGE02_CONFIG)); w.candidates.a2.weights.vip = 0.2;
  assert.notEqual(digest(w), EDGE02_CONFIG_SHA256);
});

test("frozen coefficients equal the reproduction artifact, which rounds to the published EDGE-01 fit", async () => {
  const freeze = JSON.parse(await readFile("artifacts/research/edge-02-vip-coefficients.json", "utf8"));
  const edge01 = JSON.parse(await readFile("artifacts/research/edge-01-results.json", "utf8"));
  assert.deepEqual(freeze.training_seasons, [2014, 2015, 2016, 2017]);
  for (const [f, byPos] of Object.entries(freeze.coefficients)) for (const [p, m] of Object.entries(byPos)) {
    assert.deepEqual(m.coef, [...VIP_COEFFICIENTS[f][p].coef], `${f} ${p}`);
    assert.deepEqual(m.coef.map(v => +v.toFixed(4)), edge01.vip_models[f][p].coef); assert.equal(m.n, edge01.vip_models[f][p].n);
  }
  assert.ok(freeze.ids_independence.identical_with_empty_crosswalk);
  assert.equal(freeze.source_manifest.length, 9);
  for (const m of freeze.source_manifest) assert.equal(m.matches_edge01, true, m.file);
  assert.deepEqual(JSON.parse(JSON.stringify(SOURCE_MANIFEST)), freeze.source_manifest.map(({ file, sha256, bytes, edge01_sha256, matches_edge01 }) => ({ file, sha256, bytes, edge01_sha256, matches_edge01 })));
});

test("fitting-code identity: the registered digest covers the artifact's code list, which matches the files on disk", async () => {
  const freeze = JSON.parse(await readFile("artifacts/research/edge-02-vip-coefficients.json", "utf8"));
  assert.equal(digest(freeze.fitting_code), FITTING_CODE_SHA256);
  assert.equal(EDGE02_CONFIG.vip.fitting.code_sha256, FITTING_CODE_SHA256);
  for (const { file, sha256 } of freeze.fitting_code) assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), sha256, file);
});

test("reproduction: the existing EDGE-01 fitter regenerates the frozen constants from hash-matched inputs (when present)", async t => {
  const dir = ".data/edge01", freeze = JSON.parse(await readFile("artifacts/research/edge-02-vip-coefficients.json", "utf8"));
  try { for (const m of freeze.source_manifest) if (createHash("sha256").update(await readFile(`${dir}/${m.file}`)).digest("hex") !== m.sha256) return t.skip(`${m.file} differs from the manifest`); }
  catch { return t.skip("hash-matched 2014–2017 inputs are not downloaded (ignored .data/edge01)"); }
  const { parseCsv } = await import("../lib/sources/csv.js");
  const { buildSeasonGames, RESEARCH_FORMATS } = await import("../lib/research/edge01/data.js");
  const { fitVipModel, withFormat } = await import("../lib/research/edge01/cases.js");
  const games = {}, ids = parseCsv(await readFile(`${dir}/ids.csv`, "utf8")).rows;
  for (const s of [2014, 2015, 2016, 2017]) {
    const read = async f => parseCsv(await readFile(`${dir}/${f}-${s}.csv`, "utf8")).rows;
    games[s] = buildSeasonGames({ stats: await read("stats"), snaps: await read("snaps"), opportunity: [], ids }, s);
  }
  for (const format of Object.keys(RESEARCH_FORMATS)) {
    const model = fitVipModel([2014, 2015, 2016, 2017].flatMap(s => withFormat(games[s], format)));
    for (const p of ["QB", "RB", "WR", "TE"]) assert.deepEqual(model[p].coef, [...VIP_COEFFICIENTS[format][p].coef], `${format} ${p}`);
  }
});

// ---------------- scoring classification ----------------

test("exact format classification: PPR, half, standard, TEP; K/DST/IDP keys ignored", () => {
  assert.equal(classifyScoring(LEAGUE_PPR).format, "ppr");
  assert.equal(classifyScoring({ ...PPR }).format, "ppr");
  assert.equal(classifyScoring({ ...LEAGUE_PPR, rec: 0.5 }).format, "half");
  assert.equal(classifyScoring({ ...LEAGUE_PPR, rec: 0 }).format, "standard");
  assert.equal(classifyScoring({ ...LEAGUE_PPR, pass_int: -2, bonus_rec_te: 0.5 }).format, "te_premium");
  assert.equal(classifyScoring({ ...LEAGUE_PPR, fgm_50p: 5, def_st_td: 6, pts_allow_1_6: 7, yds_allow_0_100: 5, blk_kick: 2, safe: 2, ff: 1, fum_rec: 2 }).verdict, "compatible");
  // Every ignored key is one production scoring never applies to an offensive player.
  const raw = { receptions: "3", receiving_yards: "40", passing_interceptions: "1", fumbles_lost_total: "0" };
  for (const key of classifyScoring({ ...LEAGUE_PPR, fgm_50p: 5, def_st_td: 6 }).ignored_non_offensive_keys) for (const pos of ["QB", "RB", "WR", "TE"])
    assert.equal(scoreStats(raw, { [key]: 5 }, pos).points, 0, key);
});

test("custom, unknown and incomplete scoring is refused with structured reasons, never mapped to a nearest format", () => {
  const refuse = (settings, code) => { const c = classifyScoring(settings); assert.notEqual(c.verdict, "compatible"); assert.equal(c.format, null); assert.ok(c.reasons.some(r => r.code === code), `${code}: ${JSON.stringify(c.reasons)}`); };
  refuse({ ...LEAGUE_PPR, pass_yd: 0.05 }, "registered_rule_differs");
  refuse({ ...LEAGUE_PPR, rec: 0.75 }, "registered_rule_differs");
  refuse({ ...LEAGUE_PPR, pass_int: -2 }, "no_frozen_format_matches"); // TEP interception without the TE bonus
  refuse({ ...LEAGUE_PPR, bonus_rec_te: 0.5 }, "no_frozen_format_matches"); // TE bonus with PPR interceptions
  refuse({ ...LEAGUE_PPR, bonus_rec_te: 1 }, "registered_rule_differs");
  refuse({ ...LEAGUE_PPR, pass_att: 0.1 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, pass_cmp: 0.5 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, pass_inc: -0.5 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, bonus_rush_yd_100: 3 }, "unregistered_bonus");
  refuse({ ...LEAGUE_PPR, rec_0_4: 0.5 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, bonus_rec_rb: 0.5 }, "position_reception_premium");
  refuse({ ...LEAGUE_PPR, fum_rec_td: 6 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, fum: -1 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, mystery_rule: 1 }, "unregistered_offensive_rule");
  refuse({ ...LEAGUE_PPR, pass_2pt: undefined }, "incomplete_scoring");
  const missing = { ...LEAGUE_PPR }; delete missing.fum_lost; refuse(missing, "incomplete_scoring");
  refuse({ ...LEAGUE_PPR, rec: "1" }, "incomplete_scoring");
  refuse({ ...LEAGUE_PPR, rush_2pt: NaN }, "incomplete_scoring");
  refuse({}, "scoring_unavailable"); refuse(null, "scoring_unavailable"); refuse({ rec: 1, pass_td: 4 }, "incomplete_scoring");
  // A zero-valued unregistered key cannot change scoring.
  assert.equal(classifyScoring({ ...LEAGUE_PPR, pass_att: 0, bonus_rec_wr: 0 }).format, "ppr");
  assert.equal(nonOffensiveKey("fum_rec_td"), false); assert.equal(nonOffensiveKey("st_td"), false);
});

test("ambiguous TE-premium scoring position and position mismatches are refused", () => {
  const ok = a => assert.equal(scoringPositionCheck(a).ok, true), bad = (a, code) => assert.equal(scoringPositionCheck(a).code, code);
  ok({ format: "te_premium", modelPosition: "TE", vipPosition: "TE", eligibility: ["TE"] });
  ok({ format: "ppr", modelPosition: "TE", vipPosition: "TE", eligibility: ["TE", "WR"] });
  ok({ format: "te_premium", modelPosition: "RB", vipPosition: "RB", eligibility: ["RB", "WR"] });
  bad({ format: "te_premium", modelPosition: "TE", vipPosition: "TE", eligibility: ["TE", "WR"] }, "ambiguous_tep_scoring_position");
  bad({ format: "te_premium", modelPosition: "WR", vipPosition: "WR", eligibility: ["WR", "TE"] }, "ambiguous_tep_scoring_position");
  bad({ format: "te_premium", modelPosition: "TE", vipPosition: "TE", eligibility: [] }, "ambiguous_tep_scoring_position");
  bad({ format: "ppr", modelPosition: "TE", vipPosition: "WR", eligibility: ["TE"] }, "scoring_position_mismatch");
  bad({ format: "ppr", modelPosition: "K", vipPosition: null, eligibility: ["K"] }, "unsupported_position");
  bad({ format: "ppr", modelPosition: "TE", vipPosition: "TE", eligibility: ["TE", "WR"], productionAmbiguous: true }, "ambiguous_scoring_position");
});

// ---------------- VIP_last2 semantics ----------------

const raw = (week, o = {}) => ({ player_id: "s1", season: "2026", season_type: "REG", week: String(week), game_id: `G${week}`, team: "BUF", position: "WR", targets: "6", receiving_air_yards: "70", carries: "1", attempts: "0", ...o });
const EDGE01_MODEL = format => Object.fromEntries(Object.entries(VIP_COEFFICIENTS[format]).map(([p, m]) => [p, { coef: [...m.coef] }]));

test("VIP_last2 equals EDGE-01 opportunityFeatures vip.last2 exactly, including the historical-team window", () => {
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 300; t++) {
    const n = 1 + Math.floor(rnd() * 8), teams = ["BUF", "MIA", "NYJ"], pos = ["QB", "RB", "WR", "TE", "FB"][Math.floor(rnd() * 5)];
    const rows = Array.from({ length: n }, (_, i) => raw(i + 1, { position: pos, team: teams[Math.floor(rnd() * 3)], targets: rnd() < 0.08 ? "NA" : String(Math.floor(rnd() * 12)),
      receiving_air_yards: String(Math.floor(rnd() * 150 - 10)), carries: String(Math.floor(rnd() * 20)), attempts: String(Math.floor(rnd() * 40)) }));
    const format = ["ppr", "half", "standard", "te_premium"][t % 4], week = n + 1;
    const audit = auditCurrentRows(rows, 2026, week); assert.equal(audit.status, "valid");
    const ours = vipLast2(audit.rows, format);
    const edgeRows = audit.rows.map(g => ({ ...g, player_id: "s1", season: 2026, points: 1 }));
    const theirs = opportunityFeatures(edgeRows, { season: 2026, week, vipModel: EDGE01_MODEL(format) }).metrics.vip.last2;
    assert.ok(ours.value === theirs || (ours.value === null && theirs === null), `case ${t}: ${ours.value} vs ${theirs}`);
  }
});

test("target-week and future statistics never enter VIP; shuffling rows changes nothing", () => {
  const prior = [raw(1), raw(2, { targets: "8" }), raw(3, { targets: "4" })];
  const base = vipLast2(auditCurrentRows(prior, 2026, 4).rows, "ppr");
  const leaked = [...prior, raw(4, { targets: "30" }), raw(5, { targets: "40" }), raw(1, { season: "2027", targets: "50", game_id: "X" })];
  const shuffled = [leaked[4], leaked[0], leaked[5], leaked[2], leaked[3], leaked[1]];
  assert.deepEqual(vipLast2(auditCurrentRows(shuffled, 2026, 4).rows, "ppr"), base);
  assert.equal(base.status, "computed"); assert.deepEqual(base.games.map(g => g.week), [2, 3]);
});

test("missing VIP: fewer than two games, or one required predictor missing, is ordinary missingness", () => {
  const one = vipLast2(auditCurrentRows([raw(1)], 2026, 2).rows, "ppr");
  assert.deepEqual([one.status, one.reason, one.value], ["missing", "fewer_than_two_games_on_historical_team", null]);
  const gap = vipLast2(auditCurrentRows([raw(1), raw(2, { receiving_air_yards: "" })], 2026, 3).rows, "ppr");
  assert.deepEqual([gap.status, gap.reason, gap.value], ["missing", "required_predictor_missing", null]); assert.deepEqual(gap.missing_predictors, ["G2:air_yards"]);
  // An unused predictor (carries for TE) does not matter; no zero filling or partial averaging.
  assert.equal(vipLast2(auditCurrentRows([raw(1, { position: "TE", carries: "NA" }), raw(2, { position: "TE", carries: "NA" })], 2026, 3).rows, "ppr").status, "computed");
  assert.equal(vipOfGame({ position: "WR", targets: 5, air_yards: null, carries: 0 }, "ppr"), null);
});

test("snap-only and non-skill rows do not alter the VIP window; historical team semantics are kept", () => {
  const rows = [raw(1, { team: "MIA" }), raw(2, { team: "BUF" }), raw(3, { team: "BUF" })];
  const base = vipLast2(auditCurrentRows(rows, 2026, 4).rows, "ppr", { platformTeam: "NYJ" });
  // A row with no statistical skill position (snap-only/special teams) is not a VIP row.
  const withOther = vipLast2(auditCurrentRows([...rows.slice(0, 2), raw(3, { team: "BUF" }), raw(4, { position: "", team: "NYJ" })], 2026, 5).rows, "ppr", { platformTeam: "NYJ" });
  assert.equal(withOther.value, base.value); assert.equal(withOther.historical_team, "BUF");
  assert.equal(base.historical_team, "BUF"); assert.equal(base.platform_team, "NYJ"); assert.equal(base.team_discrepancy, true);
  // Latest team MIA after a trade: only MIA games count, so one game → missing.
  const traded = vipLast2(auditCurrentRows([raw(1), raw(2), raw(3, { team: "MIA" })], 2026, 4).rows, "ppr");
  assert.deepEqual([traded.status, traded.historical_team, traded.recorded_games_on_team], ["missing", "MIA", 1]);
});

test("source integrity is checked before lossy normalization: duplicates, season type, game ID, week", () => {
  const ok = [raw(1), raw(2)];
  const problem = rows => auditCurrentRows(rows, 2026, 5);
  assert.equal(problem([...ok, raw(2)]).problems[0].code, "duplicate_player_game");
  assert.equal(problem([...ok, raw(2, { game_id: "G2b" })]).problems[0].code, "multiple_games_in_week");
  for (const t of ["", "PRE", "reg", " REG", undefined, "UNK"]) assert.equal(problem([...ok, raw(3, { season_type: t })]).problems[0].code, "invalid_season_type", String(t));
  assert.equal(problem([...ok, raw(3, { game_id: "" })]).problems[0].code, "missing_game_id");
  assert.equal(problem([...ok, { ...raw(3), game_id: undefined }]).problems[0].code, "missing_game_id");
  for (const w of ["", "0", "-1", "2.5", "x"]) assert.equal(problem([...ok, raw(3, { week: w })]).problems[0].code, "invalid_week", w);
  assert.equal(problem(ok).status, "valid");
  assert.equal(problem([...ok, raw(19, { season_type: "POST", game_id: "P" })]).status, "valid"); // POST is a known exclusion
});

// ---------------- fallback / withhold contract ----------------

test("candidate value: formula, whole-candidate noX fallback, and withholding", () => {
  const N = 11;
  assert.deepEqual(candidateValue({ blocked: null, quality: 10, recent: 20, vip: 30, fallback: N }), { status: "computed", value: 0.5 * 10 + 0.2 * 20 + 0.3 * 30, reasons: [], fallback: null });
  assert.equal(candidateValue({ blocked: null, quality: 10, recent: 20, vip: null, fallback: N }).value, N);
  assert.deepEqual(candidateValue({ blocked: null, quality: 10, recent: null, vip: 30, fallback: N }).reasons, [{ code: "r3_missing" }]);
  assert.deepEqual(candidateValue({ blocked: null, quality: null, recent: 20, vip: 30, fallback: null }).reasons, [{ code: "quality_missing" }]);
  assert.equal(candidateValue({ blocked: { code: "scoring_incompatible" }, quality: 10, recent: 20, vip: 30, fallback: N }).status, "withheld");
});

test("A2/X2 integration: computed, fallback and withheld records; X2 missing VIP falls to production noX, not H9", async () => {
  const { decision, capture, byId } = await full({ current: rows => rows.map(r => r.player_id === "g2" && r.week === "2" ? { ...r, targets: "NA" } : r) });
  assert.ok(capture.records.length === Object.keys(decision.player_context).length);
  const r1 = byId("1"), f1 = decision.player_context["1"].model.features;
  assert.equal(r1.candidates.a2.status, "computed");
  assert.ok(Math.abs(r1.candidates.a2.value - (0.5 * f1.quality_points + 0.2 * f1.recent_ppg + 0.3 * r1.inputs.vip.value)) < 1e-12);
  assert.equal(r1.candidates.x2.status, "computed");
  assert.ok(Math.abs(r1.candidates.x2.value - (0.5 * r1.predictions.h9_quality_points + 0.2 * f1.recent_ppg + 0.3 * r1.inputs.vip.value)) < 1e-12);
  assert.notEqual(r1.predictions.h9_quality_points, r1.predictions.production_quality_points);
  assert.equal(r1.predictions.h9_start_frame_comparator !== r1.predictions.h9_quality_points, true);
  // g2: one VIP predictor missing → both candidates fall back to production N (0.8Q + 0.2R3), not to H9 Q.
  const r2 = byId("2"), f2 = decision.player_context["2"].model.features, N = 0.8 * f2.quality_points + 0.2 * f2.recent_ppg;
  assert.equal(r2.inputs.vip.reason, "required_predictor_missing");
  for (const k of ["a2", "x2"]) { assert.equal(r2.candidates[k].status, "fallback"); assert.ok(Math.abs(r2.candidates[k].value - N) < 1e-12); assert.equal(r2.candidates[k].fallback.id, "production_noX"); }
  assert.notEqual(r2.candidates.x2.value, 0.8 * r2.predictions.h9_quality_points + 0.2 * f2.recent_ppg);
  assert.equal(r2.predictions.production_noX, r2.candidates.a2.value);
  // Versions, linkage, identity.
  assert.equal(r1.versions.config_sha256, EDGE02_CONFIG_SHA256); assert.equal(r1.versions.model_version, MODEL_VERSION); assert.equal(r1.versions.feature_version, FEATURE_VERSION);
  assert.match(r1.versions.protocol.sha256, /^[a-f0-9]{64}$/); assert.match(r1.linkage.observation_id, /^[a-f0-9]{64}$/); assert.equal(r1.linkage.capture_id, "c1");
  assert.match(r1.linkage.h9.h9_record_id, /^[a-f0-9]{64}$/); assert.equal(r1.identity.stat_player_id, "g1"); assert.equal(r1.identity.identity_status, "exact_crosswalk");
  assert.equal(r1.scoring.format, "ppr"); assert.equal(r1.target.game_id, "game3"); assert.equal(r1.target.kickoff, "2026-10-11T17:00:00.000Z");
});

test("missing Q withholds; missing R3 and missing VIP fall back; no current rows means no VIP", async () => {
  const { byId } = await full({ current: rows => rows.filter(r => !["g21", "g22", "g3"].includes(r.player_id)) });
  // g21/g22: no current rows and no prior → Q null → withheld.
  for (const id of ["21", "22"]) for (const k of ["a2", "x2"]) { assert.equal(byId(id).candidates[k].status, "withheld"); assert.deepEqual(byId(id).candidates[k].reasons, [{ code: "quality_missing" }]); assert.equal(byId(id).candidates[k].value, null); }
  // g3: prior exists, no current rows → Q = prior, R3 and VIP missing → fallback N.
  const r3 = byId("3");
  for (const k of ["a2", "x2"]) { assert.equal(r3.candidates[k].status, "fallback"); assert.deepEqual(r3.candidates[k].reasons.map(r => r.code).sort(), ["r3_missing", "vip_missing"]); }
});

test("X2: legitimate no-prior H9 Q is used; unavailable, unpersisted, withheld or mismatched H9 withholds X2 only", async () => {
  // g21+: no 2025 prior rows → H9 computed_without_prior with Q = S: a valid finite H9 Q.
  const { byId, decision, internals, opts } = await full();
  const r = byId("22");
  assert.equal(r.candidates.x2.status, "computed"); assert.equal(r.predictions.h9_quality_points, decision.player_context["22"].model.features.season_ppg);
  const h9 = await h9For(decision, internals, opts);
  const cases = [[null, "h9_unavailable"], [{ ...h9, persisted: false }, "h9_not_persisted"], [{ capture: null, error: "boom" }, "h9_unavailable"],
    [{ ...h9, capture: { ...h9.capture, generated_at: "2026-10-11T10:00:00.000Z" } }, "h9_basis_mismatch"],
    [{ ...h9, capture: { ...h9.capture, records: h9.capture.records.map(x => ({ ...x, decision_basis_sha256: "0".repeat(64) })) } }, "h9_basis_mismatch"],
    [{ ...h9, capture: { ...h9.capture, records: h9.capture.records.map(x => ({ ...x, h9: { ...x.h9, status: "withheld", withheld_reason: "Y-2" } })) } }, "h9_withheld"],
    [{ ...h9, capture: { ...h9.capture, records: h9.capture.records.map(x => ({ ...x, h9: { ...x.h9, quality_points: NaN } })) } }, "h9_invalid"],
    [{ ...h9, capture: { ...h9.capture, records: h9.capture.records.map(x => ({ ...x, basis_check: { status: "mismatch" } })) } }, "h9_invalid"]];
  for (const [h, code] of cases) {
    const c = await buildEdge02Capture({ decision, internals, h9: h, classification: "prospective", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: ENV });
    const x = c.records.find(r => r.identity.player_id === "1");
    assert.equal(x.candidates.x2.status, "withheld", code); assert.equal(x.candidates.x2.reasons[0].code, code);
    assert.equal(x.candidates.a2.status, "computed", "A2 is unaffected by H9");
  }
  assert.equal(h9Evidence(h9, decision, "1", decision.player_context["1"].model.features.quality_points + 1).code, "h9_basis_mismatch");
});

test("unsupported scoring withholds both candidates with the structured reason; never a generic PPR value", async () => {
  const { capture } = await full({ scoring: { ...LEAGUE_PPR, fum_rec_td: 6 } });
  for (const r of capture.records) for (const k of ["a2", "x2"]) {
    assert.equal(r.candidates[k].status, "withheld"); assert.equal(r.candidates[k].reasons[0].code, "scoring_incompatible"); assert.equal(r.candidates[k].value, null);
  }
  assert.equal(capture.records[0].scoring.verdict, "incompatible");
  const incomplete = await full({ scoring: { rec: 1, pass_td: 4 } });
  assert.ok(incomplete.capture.records.every(r => r.candidates.a2.reasons[0].code === "scoring_incomplete"));
});

test("TEP league: a TE/WR dual-eligible player is withheld; a TE-only player is computed", async () => {
  const { byId } = await full({ scoring: { ...LEAGUE_PPR, pass_int: -2, bonus_rec_te: 0.5 }, eligibility: { "1": ["TE", "WR"] },
    current: rows => rows.map(r => ["g1", "g4"].includes(r.player_id) ? { ...r, position: "TE" } : r) });
  assert.equal(byId("1").candidates.a2.status, "withheld");
  assert.ok(["ambiguous_scoring_position", "ambiguous_tep_scoring_position"].includes(byId("1").candidates.a2.reasons[0].code));
  assert.equal(byId("5").scoring.format, "te_premium");
});

test("corrupt identity or source evidence withholds, never disguised as ordinary missingness", async () => {
  const dup = await full({ current: rows => [...rows, { ...rows.find(r => r.player_id === "g1" && r.week === "2") }] });
  assert.equal(dup.byId("1").candidates.a2.status, "withheld"); assert.equal(dup.byId("1").candidates.a2.reasons[0].code, "source_integrity");
  assert.equal(dup.byId("1").inputs.source_audit.problems[0].code, "duplicate_player_game");
  assert.equal(dup.byId("2").candidates.a2.status, "computed", "other players are unaffected");
  const season = await full({ current: rows => rows.map(r => r.player_id === "g1" && r.week === "1" ? { ...r, season_type: "" } : r) });
  assert.equal(season.byId("1").candidates.a2.reasons[0].code, "source_integrity");
  const gid = await full({ current: rows => rows.map(r => r.player_id === "g1" && r.week === "1" ? { ...r, game_id: "" } : r) });
  assert.equal(gid.byId("1").candidates.x2.reasons[0].code, "source_integrity");
  // Two statistical IDs crosswalked to one platform player: identity is ambiguous.
  const opts = options(), ids = opts.idsSource;
  const amb = { ...opts, idsSource: async () => { const s = await ids(); return { ...s, data: [...s.data, { gsis_id: "gX", sleeper_id: "1" }] }; } };
  const { decision, internals } = await build(amb);
  const c = await buildEdge02Capture({ decision, internals, h9: null, classification: "test", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: {} });
  const r = c.records.find(x => x.identity.player_id === "1");
  if (internals.idMap.get("g1") === "1" && internals.idMap.get("gX") === "1") assert.equal(r.candidates.a2.reasons[0].code, "identity_ambiguous_crosswalk");
  else assert.notEqual(r.candidates.a2.status, "computed");
});

test("corrected source data produces a new evidence identity without touching the stored record", async () => withTemp(async dir => {
  const a = await full();
  const first = await appendEdge02Capture(dir, a.capture, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 });
  const bytes = await readFile(join(dir, first.path));
  const b = await full({ current: rows => rows.map(r => r.player_id === "g1" && r.week === "1" ? { ...r, targets: "7" } : r) });
  assert.notEqual(b.byId("1").record_id, a.byId("1").record_id);
  // Another player's own evidence is unchanged; its ID still moves only because it links the (changed) same-run H9 capture.
  const strip = r => { const { record_id, run, linkage, ...rest } = r; return { ...rest, linkage: { ...linkage, h9: { ...linkage.h9, h9_capture_id: null } } }; };
  assert.deepEqual(strip(b.byId("10")), strip(a.byId("10")));
  const second = await appendEdge02Capture(dir, b.capture, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 });
  assert.equal(second.created, true); assert.notEqual(second.path, first.path);
  assert.deepEqual(await readFile(join(dir, first.path)), bytes);
}));

// ---------------- prospective integrity ----------------

test("timing chain: effective_at <= generated_at <= frozen_at < kickoff, all finite", () => {
  const t = o => prospectiveTiming({ classification: "prospective", generatedAt: "2026-10-11T16:00:00Z", frozenAt: "2026-10-11T16:01:00Z", kickoff: "2026-10-11T17:00:00Z", ...o });
  assert.deepEqual([t({}).technical_eligible, t({}).boundary_status], [true, "pending_registration_record"]);
  assert.equal(t({ frozenAt: "2026-10-11T17:00:00Z" }).reason, "kickoff_not_after_freeze");
  assert.equal(t({ frozenAt: "2026-10-11T17:05:00Z" }).reason, "kickoff_not_after_freeze");
  assert.equal(t({ frozenAt: "2026-10-11T15:59:00Z" }).reason, "frozen_before_generated");
  assert.equal(t({ kickoff: null }).reason, "no_target_kickoff");
  assert.equal(t({ generatedAt: "garbage" }).reason, "non_finite_timestamps");
  assert.equal(t({ effectiveAt: "2026-10-11T16:30:00Z" }).reason, "generated_before_effective_boundary");
  assert.equal(t({ effectiveAt: "2026-10-11T15:00:00Z" }).boundary_status, "satisfied");
  assert.equal(t({ classification: "replay" }).reason, "not_prospective_classification");
});

test("post-kickoff freeze is retained but ineligible; reconstruction cannot be labelled prospective", async () => withTemp(async dir => {
  const late = await full({}, { clock: (() => { let n = 0; return () => (n++ < 2 ? NOW + 120000 : NOW + 2 * 3600000); })() }).catch(e => e);
  assert.ok(late instanceof Error && /decision time/.test(late.message), "freeze long after generation is refused for prospective");
  const { capture } = await full({}, { clock: (() => { let n = 0; return () => (n++ < 2 ? KICKOFF - 60000 : KICKOFF + 1000); })() }).catch(() => ({}));
  if (capture) for (const r of capture.records) assert.equal(r.run.prospective.technical_eligible, false);
  // Reconstruction: a decision generated earlier and built now cannot be prospective.
  assert.throws(() => assertClassification("prospective", new Date(NOW).toISOString(), NOW + 2 * 3600000), /decision time/);
  assert.equal(assertClassification("replay", new Date(NOW).toISOString(), NOW + 86400000), "replay");
  const ok = await full();
  await assert.rejects(appendEdge02Capture(dir, ok.capture, { approvedLeagueIds: APPROVED, wallClock: NOW + 3 * 3600000 }), /decision time|promptly/);
  const replay = await buildEdge02Capture({ decision: ok.decision, internals: ok.internals, h9: ok.h9, classification: "replay", approvedLeagueIds: APPROVED, clock: () => NOW + 86400000, env: ENV });
  assert.ok(replay.records.every(r => r.run.prospective.technical_eligible === false && r.run.prospective.confirmatory.status === "non_confirmatory"));
  assert.notEqual(replay.records[0].record_id, ok.capture.records[0].record_id);
  const w = await appendEdge02Capture(dir, replay, { approvedLeagueIds: APPROVED, wallClock: NOW + 86400000 });
  assert.match(w.path, /^shadow\/edge02-vip\/replay\//);
  const mixed = { ...ok.capture, records: [...ok.capture.records, replay.records[0]] };
  await assert.rejects(appendEdge02Capture(dir, mixed, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 }), /Capture ID|Mixed/);
  // Forged eligibility is refused at write time.
  const forged = { ...ok.capture, records: ok.capture.records.map(r => ({ ...r, run: { ...r.run, prospective: { ...r.run.prospective, candidates: { ...r.run.prospective.candidates, a2: { eligible: !r.run.prospective.candidates.a2.eligible, reason: null } } } } })) };
  await assert.rejects(appendEdge02Capture(dir, forged, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 }), /eligibility/);
}));

test("trusted writer metadata is additive, secret-free, and gates confirmatory candidacy", async () => {
  const w = trustedWriter(ENV);
  assert.equal(w.witness_available, true); assert.equal(w.run_id, "123"); assert.equal(JSON.stringify(w).includes("never"), false);
  assert.equal(trustedWriter({}).witness_available, false); assert.equal(trustedWriter({ ...ENV, GITHUB_REF: "refs/heads/feature" }).witness_available, false);
  const timing = { technical_eligible: true, reason: null };
  assert.equal(confirmatoryStatus({ classification: "prospective", timing, writer: w }).status, "requires_publication_witness");
  assert.equal(confirmatoryStatus({ classification: "prospective", timing, writer: trustedWriter({}) }).reason, "no_trusted_writer_witness");
  const local = await full({}, { env: {} });
  assert.ok(local.capture.records.every(r => r.run.prospective.confirmatory.status === "non_confirmatory"));
  const ci = await full();
  const eligible = ci.capture.records.filter(r => r.run.prospective.candidates.a2.eligible);
  assert.ok(eligible.length);
  for (const r of eligible) { assert.equal(r.run.prospective.confirmatory.status, "requires_publication_witness"); assert.equal(r.run.publication_witness.in_record, false); assert.equal(r.run.acquisition.completion_at, "unknown"); }
  assert.equal(JSON.stringify(ci.capture).includes("SECRET_TOKEN"), false);
});

test("retry preserves the original immutable bytes and timestamps; a conflicting same-ID payload is refused", async () => withTemp(async dir => {
  const a = await full();
  const first = await appendEdge02Capture(dir, a.capture, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 });
  assert.equal(first.created, true); assert.match(first.path, /^shadow\/edge02-vip\/prospective\/2026\/A\//);
  const bytes = await readFile(join(dir, first.path));
  // Same evidence, later freeze and a different run: same IDs, file untouched, original timestamps reported.
  const b = await full({}, { clock: () => NOW + 240000, env: { ...ENV, GITHUB_RUN_ID: "999" } });
  assert.equal(b.capture.capture_id, a.capture.capture_id);
  const retry = await appendEdge02Capture(dir, b.capture, { approvedLeagueIds: APPROVED, wallClock: NOW + 250000 });
  assert.deepEqual([retry.created, retry.frozen_at], [false, a.capture.frozen_at]);
  assert.deepEqual(await readFile(join(dir, first.path)), bytes);
  // Tampered record content under the same ID is refused before any write.
  const tampered = { ...a.capture, records: a.capture.records.map((r, i) => i ? r : { ...r, predictions: { ...r.predictions, a2: 999 } }) };
  await assert.rejects(appendEdge02Capture(dir, tampered, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 }), /Record ID/);
  // A stored file whose records differ from the claimed capture ID is a conflict; the stored file is kept.
  const other = await full({ current: rows => rows.map(r => r.player_id === "g9" ? { ...r, targets: "11" } : r) });
  const { writeImmutable } = await import("../lib/shadow/edge02/capture.js");
  await assert.rejects(writeImmutable(dir, "edge02-vip", { ...other.capture, capture_id: a.capture.capture_id }, { checkRecords: false }), /Conflicting/);
  assert.deepEqual(await readFile(join(dir, first.path)), bytes);
}));

// ---------------- privacy ----------------

test("private ESPN decisions are refused at the builder and the writer; malformed or missing visibility cannot bypass", async () => withTemp(async dir => {
  const { decision, internals, h9, capture } = await full();
  const refuse = d => assert.rejects(buildEdge02Capture({ decision: d, internals, h9, classification: "test", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: {} }), /refused/);
  await refuse({ ...decision, visibility: "private" });
  for (const v of ["Private", "PRIVATE", "public", "", null, undefined, 0, false, {}]) await refuse({ ...decision, visibility: v });
  await refuse({ ...decision, provider: "espn" });
  await refuse({ ...decision, identity: { ...decision.identity, provider: "espn" } });
  await refuse({ ...decision, identity: undefined });
  await refuse({ ...decision, league: { ...decision.league, league_id: "B" } });
  await assert.rejects(buildEdge02Capture({ decision, internals, h9, classification: "test", approvedLeagueIds: [], clock: () => NOW + 120000, env: {} }), /refused/);
  await assert.rejects(buildEdge02Capture({ decision, internals, h9, classification: "test", approvedLeagueIds: undefined, clock: () => NOW + 120000, env: {} }), /refused/);
  assert.equal(approvedContextProblem(decision, APPROVED), null);
  // Writer: independent of the builder.
  await assert.rejects(appendEdge02Capture(dir, capture, { approvedLeagueIds: ["B"], wallClock: NOW + 130000 }), /refused/);
  await assert.rejects(appendEdge02Capture(dir, capture, { wallClock: NOW + 130000 }), /refused/);
  const espn = { ...capture, records: capture.records.map(r => ({ ...r, identity: { ...r.identity, provider: "espn" } })) };
  await assert.rejects(appendEdge02Capture(dir, espn, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 }), /refused/);
  const vis = { ...capture, records: capture.records.map(r => ({ ...r, visibility: "private" })) };
  await assert.rejects(appendEdge02Capture(dir, vis, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 }), /refused/);
  // The worker entry skips (never writes) a private or unapproved context.
  const skipped = await captureEdge02Shadow({ directory: dir, decision: { ...decision, visibility: "private" }, internals, h9, linkedCaptureId: "c", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: {} });
  assert.equal(skipped.status, "skipped");
  assert.deepEqual(await readdir(dir), []);
  // No credentials or owner identifiers enter records.
  const text = JSON.stringify(capture);
  for (const s of ["owner_id", "espn_s2", "SWID", "auth_path", "token"]) assert.equal(text.includes(s), false, s);
}));

// ---------------- production isolation ----------------

test("shadow disabled, enabled or throwing leaves the public decision and production capture unchanged", async () => withTemp(async dir => {
  const opts = options();
  const plain = JSON.stringify(await buildDecisionContext("A", opts));
  const { decision, internals } = await build(opts);
  assert.equal(JSON.stringify(decision), plain);
  assert.equal(JSON.stringify(await buildDecisionContext("A", { ...opts, shadowObserver: () => { throw new Error("shadow bug"); } })), plain);
  const h9 = await h9For(decision, internals, opts);
  const before = JSON.stringify(decision), h9Before = JSON.stringify(h9.capture);
  const ok = await captureEdge02Shadow({ directory: dir, decision, internals, h9, linkedCaptureId: "c", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: ENV });
  assert.equal(ok.status, "ok"); assert.equal(ok.candidates.created, true); assert.equal(ok.lineup.created, true);
  assert.equal(JSON.stringify(decision), before, "never mutates the decision"); assert.equal(JSON.stringify(h9.capture), h9Before, "never mutates H9");
  // Throwing inside the shadow is contained and reported.
  const broken = await captureEdge02Shadow({ directory: dir, decision, internals: { ...internals, get idMap() { throw new Error("boom"); } }, h9, linkedCaptureId: "c", approvedLeagueIds: APPROVED, clock: () => NOW + 120000, env: ENV });
  assert.deepEqual([broken.status, broken.error], ["failed", "boom"]);
  assert.equal(JSON.stringify(decision), before);
  // Production code never imports the shadow.
  const grep = async d => (await readdir(d, { recursive: true })).filter(f => /\.(js|mjs|jsx)$/.test(f));
  for (const d of ["app", "lib"]) for (const f of await grep(d)) {
    if (f.startsWith("shadow")) continue;
    assert.equal((await readFile(join(d, f), "utf8")).includes("shadow/edge02"), false, `${d}/${f}`);
  }
}));

test("no 2026 outcome access: shadow code reads no score or result field, and target-week rows cannot change records", async () => {
  for (const f of ["capture.js", "inputs.js", "lineup.js", "run.js", "config.js"]) {
    const text = await readFile(`lib/shadow/edge02/${f}`, "utf8");
    for (const field of ["home_score", "away_score", "players_points", "starters_points", "custom_points", "outcome", "actual"]) assert.equal(text.includes(field), false, `${f}: ${field}`);
  }
  const freeze = await readFile("scripts/research/edge-02-freeze-vip.js", "utf8");
  assert.match(freeze, /for \(const season of VIP_TRAINING_SEASONS\)/); assert.equal(/(stats|snaps|xfp)-20\d\d/.test(freeze), false, "freeze script reads only the training seasons");
  assert.match(freeze, />= 2018\)\) throw/, "freeze script refuses any row after 2017");
  const a = await full(), b = await full({ current: rows => [...rows, ...rows.filter(r => r.week === "2").map(r => ({ ...r, week: "3", game_id: "game3", targets: "40", receptions: "15" }))] });
  for (const r of a.capture.records) {
    const s = b.byId(r.identity.player_id);
    assert.deepEqual(s.candidates, r.candidates); assert.deepEqual(s.inputs.vip, r.inputs.vip);
  }
});

// ---------------- lineup evidence ----------------

test("lineup evidence: one player per slot, FLEX/Superflex/dual eligibility, IR/taxi excluded, unsupported slots disclosed", () => {
  const players = [
    { player_id: "q1", fantasy_positions: ["QB"] }, { player_id: "q2", fantasy_positions: ["QB"] }, { player_id: "r1", fantasy_positions: ["RB"] },
    { player_id: "d1", fantasy_positions: ["RB", "WR"] }, { player_id: "w1", fantasy_positions: ["WR"] }, { player_id: "t1", fantasy_positions: ["TE"] },
    { player_id: "ir", fantasy_positions: ["RB"], reserve: true }, { player_id: "tx", fantasy_positions: ["WR"], taxi: true }, { player_id: "k1", fantasy_positions: ["K"] },
  ];
  const values = { q1: 20, q2: 18, r1: 12, d1: 15, w1: 9, t1: 7, ir: 99, tx: 98, k1: null };
  const l = scopedLineup(players, ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "K", "DEF", "BN", "BN", "IR", "TAXI"], values);
  const used = l.assignment.map(a => a.player_id).filter(Boolean);
  assert.equal(new Set(used).size, used.length, "one player fills at most one slot");
  assert.ok(!used.includes("ir") && !used.includes("tx"), "IR/taxi are not active capacity");
  assert.equal(l.assignment.find(a => a.slot === "SUPER_FLEX").player_id, "q2");
  assert.ok(["d1", "r1"].includes(l.assignment.find(a => a.slot === "RB").player_id)); assert.equal(l.filled, 6);
  assert.deepEqual(l.scope.excluded_slots, ["K", "DEF"]); assert.equal(l.scope.complete_lineup, false); assert.match(l.scope.note, /not a full lineup/);
  assert.equal(l.total, 20 + 18 + 15 + 12 + 9 + 7);
  // Null values are unassigned, never zero.
  const sparse = scopedLineup(players, ["QB", "TE"], { q1: 20 });
  assert.equal(sparse.assignment.find(a => a.slot === "TE").player_id, null); assert.equal(sparse.unfilled_slots.length, 1);
});

test("lineup sidecar freezes complete roster membership and candidate values, linked to the candidate capture", async () => withTemp(async dir => {
  const { decision, internals, capture } = await full();
  const lineup = await buildEdge02LineupCapture({ decision, internals, candidateCapture: capture, classification: "prospective", approvedLeagueIds: APPROVED, clock: () => NOW + 125000 });
  assert.equal(lineup.records.length, internals.rosters.length);
  const mine = lineup.records.find(r => r.identity.roster_id === 1);
  assert.deepEqual([...mine.membership.all].sort(), ["1", "2", "3", "4"]);
  assert.deepEqual(mine.membership.ir, ["3"]); assert.deepEqual(mine.membership.taxi, ["4"]);
  assert.deepEqual(mine.membership.starters.map(s => s.player_id), ["2", null]);
  assert.equal(mine.league.reserve_slots, 2); assert.equal(mine.league.taxi_slots, 3); assert.deepEqual(mine.league.slot_counts, { RB: 1, FLEX: 1, BN: 1 });
  for (const p of mine.players) { assert.ok("a2" in p.values && "x2" in p.values && "production" in p.values); assert.equal(p.active_capacity, !p.reserve && !p.taxi); }
  for (const v of ["production", "a2", "x2", "h9"]) { const used = mine.lineups[v].assignment.map(a => a.player_id).filter(Boolean); assert.ok(!used.includes("3") && !used.includes("4")); }
  assert.equal(mine.semantics.transaction_locks, "unknown"); assert.equal(mine.linkage.candidate_capture_id, capture.capture_id);
  assert.match(mine.versions.file_sha256["lib/decision/optimizer.js"], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(lineup).includes("owner_id"), false);
  const w = await appendEdge02LineupCapture(dir, lineup, { approvedLeagueIds: APPROVED, wallClock: NOW + 130000 });
  assert.match(w.path, /^shadow\/edge02-lineup\/prospective\/2026\/A\//);
  await assert.rejects(appendEdge02LineupCapture(dir, lineup, { approvedLeagueIds: ["Z"], wallClock: NOW + 130000 }), /refused/);
  await assert.rejects(buildEdge02LineupCapture({ decision: { ...decision, visibility: "private" }, internals, candidateCapture: capture, classification: "test", approvedLeagueIds: APPROVED }), /refused/);
}));

test("deterministic reruns on the same basis give identical candidate records", async () => {
  const a = await full(), b = await full({}, { clock: () => NOW + 180000 });
  assert.equal(a.capture.capture_id, b.capture.capture_id);
  const strip = rs => rs.map(({ run, ...r }) => r);
  assert.deepEqual(strip(a.capture.records), strip(b.capture.records));
  assert.ok(a.capture.records.every(r => r.record_id === recordId(r)));
});
