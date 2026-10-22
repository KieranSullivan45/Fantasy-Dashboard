// Projection experiment research harness tests: sealed season, point-in-time context, consensus timing, identity,
// missingness and determinism (synthetic data only).
import test from "node:test";
import assert from "node:assert/strict";
import { scheduleContext, allowedByDefense, opponentFactor, fantasyProsToGsis, consensusSnapshots, snapshotBefore } from "../lib/research/projexp/context.js";
import { fitGbm, predictGbm } from "../lib/research/projexp/gbm.js";
import { residualQuantiles, intervalFor, intervalMetrics } from "../lib/research/projexp/models.js";

const game = (season, week, home, away, extra = {}) => ({ game_id: `${season}_${week}_${away}_${home}`, season: String(season), game_type: "REG", week: String(week),
  gameday: extra.gameday ?? `${season}-09-${String(7 + week * 7).padStart(2, "0")}`, home_team: home, away_team: away, home_rest: "7", away_rest: "7", roof: "outdoors",
  spread_line: extra.spread ?? "3", total_line: extra.total ?? "44" });

test("schedule loader refuses the sealed 2026 season", () => {
  assert.throws(() => scheduleContext([game(2026, 1, "KC", "BAL")]), /sealed/);
});

test("implied team totals follow the home-margin spread convention and are labelled per side", () => {
  const { teamWeek } = scheduleContext([game(2024, 1, "KC", "BAL", { spread: "3", total: "47" })]);
  assert.equal(teamWeek.get("2024:1:KC").implied_total, 25);
  assert.equal(teamWeek.get("2024:1:BAL").implied_total, 22);
  assert.equal(teamWeek.get("2024:1:BAL").spread_for, -3);
  // Old team codes are normalized (LA -> LAR) like player rows.
  assert.ok(scheduleContext([game(2017, 1, "LA", "SD")]).teamWeek.has("2017:1:LAR"));
});

test("missing lines stay missing, never zero", () => {
  const { teamWeek } = scheduleContext([game(2024, 1, "KC", "BAL", { spread: "NA" })]);
  assert.equal(teamWeek.get("2024:1:KC").implied_total, null);
  assert.equal(teamWeek.get("2024:1:KC").spread_for, null);
});

test("opponent factor ignores the evaluated week and every later week", () => {
  const rows = [];
  for (let w = 1; w <= 6; w++) for (const def of ["A", "B", "C"]) rows.push({ position: "RB", opponent: def, week: w, points: def === "A" && w >= 4 ? 99 : 10 });
  const allowed = allowedByDefense({ 2024: rows, 2023: rows.map(r => ({ ...r, points: 10 })) });
  const before = opponentFactor(allowed, 2024, 4, "A", "RB");
  const allowed2 = allowedByDefense({ 2024: rows.map(r => (r.week >= 4 ? { ...r, points: 0 } : r)), 2023: rows.map(r => ({ ...r, points: 10 })) });
  assert.equal(opponentFactor(allowed2, 2024, 4, "A", "RB"), before);
  assert.ok(Math.abs(before - 1) < 1e-9);
});

test("consensus crosswalk never guesses: a fantasypros id with two gsis targets is unknown", () => {
  const m = fantasyProsToGsis([{ fantasypros_id: "1", gsis_id: "00-1" }, { fantasypros_id: "1", gsis_id: "00-2" }, { fantasypros_id: "2", gsis_id: "00-3" }, { fantasypros_id: "3", gsis_id: "NA" }]);
  assert.equal(m.get("1"), null); assert.equal(m.get("2"), "00-3"); assert.equal(m.has("3"), false);
});

test("a consensus snapshot is used only for games on a later date than the scrape", () => {
  const { weekDates } = scheduleContext([game(2024, 4, "KC", "BAL", { gameday: "2024-09-26" }), game(2024, 4, "NE", "NYJ", { gameday: "2024-09-29" })]);
  const snaps = consensusSnapshots([{ kind: "week", position: "RB", fantasypros_id: "2", ecr: "1.5", scrape_date: "2024-09-27" }], weekDates, new Map([["2", "00-3"]]));
  const list = snaps.week.get("2024:4");
  assert.equal(list.length, 1);
  assert.equal(snapshotBefore(list, "2024-09-26"), null, "Thursday game precedes the Friday scrape");
  assert.equal(snapshotBefore(list, "2024-09-27"), null, "same-day scrape is not before kickoff");
  assert.equal(snapshotBefore(list, "2024-09-29").byGsis.get("00-3").rank, 1);
});

test("GBM is deterministic, learns a step and routes missing inputs without treating them as zero", () => {
  const X = [], y = [];
  for (let i = 0; i < 2000; i++) { const x = (i % 100) / 10; const miss = i % 7 === 0; X.push([miss ? NaN : x]); y.push(miss ? 20 : x > 5 ? 10 : 0); }
  const a = fitGbm(X, y, { trees: 50, depth: 3, minLeaf: 20, seed: 4 }), b = fitGbm(X, y, { trees: 50, depth: 3, minLeaf: 20, seed: 4 });
  assert.equal(predictGbm(a, [7]), predictGbm(b, [7]));
  assert.ok(predictGbm(a, [8]) > 8 && predictGbm(a, [1]) < 2);
  assert.ok(predictGbm(a, [NaN]) > 15, "missing has its own learned value");
  assert.ok(Math.abs(predictGbm(a, [0]) - predictGbm(a, [NaN])) > 10, "missing is not the same as zero");
});

test("walk-forward conformal intervals cover about 80% on exchangeable data", () => {
  let s = 1; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const mk = () => Array.from({ length: 4000 }, () => { const pred = 5 + 10 * r(); return { position: "WR", pred, y: pred + (r() - 0.5) * 2 * (1 + pred / 5) }; });
  const rq = residualQuantiles(mk());
  const m = intervalMetrics(mk().map(x => ({ y: x.y, q: intervalFor(rq, "WR", x.pred) })));
  assert.ok(m.coverage80 > 0.77 && m.coverage80 < 0.83, String(m.coverage80));
  assert.equal(intervalFor(rq, "QB", 10), null, "no interval without position history");
});
