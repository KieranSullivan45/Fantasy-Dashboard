// Projection experiment, development round 2 (folds 2019–2021 only): betting lines, compact features, deeper trees, blends.
import { readFile, writeFile } from "node:fs/promises";
import { numeric } from "../../../lib/decision/features.js";
import { WEEKLY_FEATURES, BETTING_FEATURES } from "../../../lib/research/projexp/models.js";
import { foldPredictions, frame, pointMetrics, pairedDelta, lineup, rowKey } from "../../../lib/research/projexp/run.js";

const DEV = [2019, 2020, 2021];
const d = JSON.parse(await readFile(process.argv[2] || ".data/projexp/rows.json", "utf8"));
const rows = d.weekly.filter(r => r.season <= 2021);
const t0 = Date.now(), log = (...x) => console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", ...x);
const y = r => r.y, fb = r => r.base.noX;
const COMPACT = ["Q", "S", "P_ew16", "ew16", "R3", "n", "snap_last2", "snap_season", "tgtsh_season", "carsh_season", "vip_last3", "vip_season", "opp_factor", "home", "played_rate"];
const g4 = { trees: 200, depth: 5, lr: 0.05, minLeaf: 200 };
const specs = {
  prod: { kind: "fixed", predict: r => r.base.prod },
  P5: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2"], fallback: fb },
  P5ctx: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2", "opp_factor", "home"], fallback: fb },
  P5bet: { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2", "implied_total"], fallback: fb, betting: true },
  gbm_g4: { kind: "gbm", target: y, features: WEEKLY_FEATURES, params: g4 },
  gbm_g5: { kind: "gbm", target: y, features: WEEKLY_FEATURES, params: { trees: 400, depth: 5, lr: 0.03, minLeaf: 300 } },
  gbm_g6: { kind: "gbm", target: y, features: WEEKLY_FEATURES, params: { trees: 300, depth: 6, lr: 0.03, minLeaf: 300 } },
  gbm_compact: { kind: "gbm", target: y, features: COMPACT, params: g4 },
  gbm_bet: { kind: "gbm", target: y, features: [...WEEKLY_FEATURES, ...BETTING_FEATURES], params: g4, betting: true },
};
const out = {};
for (const Y of DEV) {
  const preds = {};
  for (const [n, s] of Object.entries(specs)) preds[n] = foldPredictions(rows, Y, s).preds;
  const blend = (a, b, w = 0.5) => new Map([...preds[a]].map(([k, v]) => [k, numeric(v) && numeric(preds[b].get(k)) ? w * v + (1 - w) * preds[b].get(k) : null]));
  preds.blend_P5_g4 = blend("P5", "gbm_g4"); preds.blend_P5ctx_g4 = blend("P5ctx", "gbm_g4"); preds.blend_bet = blend("P5bet", "gbm_bet");
  log("fold", Y);
  const test = rows.filter(r => r.season === Y);
  out[Y] = {};
  for (const n of Object.keys(preds)) {
    const m = pointMetrics(frame(test, preds[n]));
    const dm = n === "prod" ? null : pairedDelta(frame(test, preds[n]), frame(test, preds.prod));
    out[Y][n] = { mae: +m.mae.toFixed(3), sp_rost: +m.spearman_rosterable.toFixed(3), pair_rost: +m.pair_accuracy_rosterable.toFixed(4), d_vs_prod: dm ? +dm.delta_mae.toFixed(3) : null };
  }
  const lu = lineup(test, preds, "prod");
  for (const n of Object.keys(lu)) out[Y][n].lineup = +lu[n].delta_vs_control.toFixed(2);
  console.table(out[Y]);
}
const avg = {}; for (const n of Object.keys(out[2019])) avg[n] = Object.fromEntries(["d_vs_prod", "lineup", "pair_rost"].map(k => [k, +(DEV.reduce((s, Y) => s + (out[Y][n][k] ?? 0), 0) / 3).toFixed(4)]));
console.table(avg);
await writeFile(".data/projexp/dev2.json", JSON.stringify({ out, avg }, null, 1));
