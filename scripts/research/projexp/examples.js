// Projection experiment: example backtest projections with 80% ranges for one consumed week (display only, class X).
// Usage: node scripts/research/projexp/examples.js [season=2025] [week=12] > out.json
import { readFile } from "node:fs/promises";
import { numeric } from "../../../lib/decision/features.js";
import { loadCsv } from "../../../lib/research/edge01/data.js";
import { WEEKLY_FEATURES, residualQuantiles, intervalFor } from "../../../lib/research/projexp/models.js";
import { foldPredictions, rowKey } from "../../../lib/research/projexp/run.js";

const S = Number(process.argv[2] || 2025), W = Number(process.argv[3] || 12);
const d = JSON.parse(await readFile(".data/projexp/rows.json", "utf8")), rows = d.weekly.filter(r => r.season <= S);
const GBM = { trees: 200, depth: 5, lr: 0.05, minLeaf: 200 }, y = r => r.y, fb = r => r.base.noX;
const P5ctx = { kind: "linear", target: y, features: ["ew16", "R3", "snap_last2", "opp_factor", "home"], fallback: fb }, G = { kind: "gbm", target: y, features: WEEKLY_FEATURES, params: GBM };
const px = new Map();
for (const Y of [S - 2, S - 1, S]) { const a = foldPredictions(rows, Y, P5ctx).preds, b = foldPredictions(rows, Y, G).preds; for (const [k, v] of a) { const u = b.get(k); px.set(k, numeric(v) && numeric(u) ? (v + u) / 2 : null); } }
const oos = rows.filter(r => (r.season === S - 1 || r.season === S - 2) && numeric(r.y) && numeric(px.get(rowKey(r)))).map(r => ({ position: r.position, pred: px.get(rowKey(r)), y: r.y }));
const rq = residualQuantiles(oos);
const names = new Map((await loadCsv(`.data/edge01/stats-${S}.csv`)).map(r => [r.player_id, r.player_display_name]));
const out = [];
for (const p of ["QB", "RB", "WR", "TE"]) {
  const list = rows.filter(r => r.season === S && r.week === W && r.position === p && r.rosterable && numeric(px.get(rowKey(r))) && numeric(r.y))
    .sort((a, b) => px.get(rowKey(b)) - px.get(rowKey(a))).slice(0, 8);
  for (const r of list) { const q = intervalFor(rq, p, px.get(rowKey(r))); out.push({ name: names.get(r.player_id) || r.player_id, pos: p, team: r.team, opp: r.opponent, px: +px.get(rowKey(r)).toFixed(1), p10: +q[0].toFixed(1), p50: +q[2].toFixed(1), p90: +q[4].toFixed(1), prod: +r.base.prod.toFixed(1), ecr: r.bench.ecr_rank, actual: +r.y.toFixed(1) }); }
}
console.log(JSON.stringify({ season: S, week: W, players: out }));
