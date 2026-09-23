import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CALIBRATION } from "../lib/decision/calibration/weights.js";
import { buildCases } from "../lib/backtest/evaluate.js";
test("calibration artifacts retain independent test seasons and validation-only selected weights", async () => {
  const report = JSON.parse(await readFile(new URL("../artifacts/backtests/v032-results.json", import.meta.url)));
  assert.deepEqual(report.protocol.validation, [2023]); assert.deepEqual(report.protocol.test, [2024, 2025]);
  for (const [position, models] of Object.entries(CALIBRATION)) {
    const validation = report.selected[position].validation_candidates;
    assert.equal(models.start.name, [...validation].sort((a, b) => a.start.mae - b.start.mae)[0].name);
    assert.equal(models.pickup.name, [...validation].sort((a, b) => b.pickup.spearman - a.pickup.spearman)[0].name);
  }
  assert.ok(report.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256)));
  for (const year of report.protocol.test) assert.ok(report.formats.ppr[year].start.n > 3000);
});
test("outcome-only players never enter pre-week historical candidate membership", () => {
  const rows = [1, 2, 3].map(week => ({ player_id: "a", season: 2024, week, team: "BUF", position: "WR", points: 10, targets: 5, carries: 0, snap_share: 0.5 }));
  const cases = buildCases([...rows, { ...rows[2], player_id: "future_star", points: 100 }], 2024).cases.filter(c => c.week === 3);
  assert.deepEqual(cases.map(c => c.player_id), ["a"]); assert.equal(cases[0].features.data_through_week, 2);
});
