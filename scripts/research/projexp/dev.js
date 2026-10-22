// Projection experiment, development phase: hyperparameter/feature choices on folds 2019–2021 only (never 2022–2025).
// Usage: node scripts/research/projexp/dev.js [rows=.data/projexp/rows.json]
import { readFile, writeFile } from "node:fs/promises";
import { numeric } from "../../../lib/decision/features.js";
import { WEEKLY_FEATURES, BETTING_FEATURES } from "../../../lib/research/projexp/models.js";
import { foldPredictions, frame, pointMetrics, pairedDelta, lineup } from "../../../lib/research/projexp/run.js";

const DEV = [2019, 2020, 2021];
const d = JSON.parse(await readFile(process.argv[2] || ".data/projexp/rows.json", "utf8"));
const rows = d.weekly.filter(r => r.season <= 2021);
if (rows.some(r => r.season > 2021)) throw new Error("dev phase must not see consumed seasons");
const t0 = Date.now(), log = (...x) => console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", ...x);
const y = r => r.y;
const fixed = name => ({ kind: "fixed", predict: r => r.base[name] });
const GRID = {
  g1: { trees: 300, depth: 3, lr: 0.05, minLeaf: 50 }, g2: { trees: 300, depth: 4, lr: 0.05, minLeaf: 100 },
  g3: { trees: 600, depth: 3, lr: 0.03, minLeaf: 100 }, g4: { trees: 200, depth: 5, lr: 0.05, minLeaf: 200 },
};
const specs = { prod: fixed("prod"), noX: fixed("noX"), Q: fixed("Q"), vipA2: { ...fixed("vipA2"), fallback: r => r.base.noX },
  P5: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2"], fallback: r => r.base.noX } };
for (const [g, params] of Object.entries(GRID)) specs[`gbm_${g}`] = { kind: "gbm", target: y, features: WEEKLY_FEATURES, params };
const out = {};
for (const Y of DEV) {
  const preds = {};
  for (const [n, s] of Object.entries(specs)) preds[n] = foldPredictions(rows, Y, s).preds;
  log("fold", Y);
  const test = rows.filter(r => r.season === Y);
  out[Y] = {};
  for (const n of Object.keys(specs)) {
    const m = pointMetrics(frame(test, preds[n]));
    const dm = n === "prod" ? null : pairedDelta(frame(test, preds[n]), frame(test, preds.prod));
    out[Y][n] = { mae: m.mae, sp_rost: m.spearman_rosterable, pair_rost: m.pair_accuracy_rosterable, d_vs_prod: dm?.delta_mae, ci: dm?.ci95 };
  }
  const lu = lineup(test, preds, "prod");
  for (const n of Object.keys(lu)) out[Y][n].lineup = lu[n]?.delta_vs_control;
  console.table(out[Y]);
}
await writeFile(".data/projexp/dev1.json", JSON.stringify(out, null, 1));
