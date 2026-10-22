// Projection experiment walk-forward runners and comparison helpers (research only).
// Fold Y trains on seasons 2016..Y−1 only and scores Y once; hyperparameters are frozen before consumed folds run.
import { numeric, mean, quantile } from "../../decision/features.js";
import { spearman } from "../../backtest/evaluate.js";
import { rng, pointMetrics, pairedDelta } from "../edge01/metrics.js";
import { simulate, summarize } from "../edge01/lineup.js";
import { fitGbmByPosition, fitLinearByPosition, residualQuantiles, intervalFor, intervalMetrics } from "./models.js";

export const FIRST_TRAIN = 2016;
const key = r => `${r.season}:${r.week}:${r.player_id}`;
const groupBy = (rows, k) => { const m = new Map(); for (const r of rows) { const x = k(r); (m.get(x) ?? m.set(x, []).get(x)).push(r); } return m; };

/** Fit `spec` for test season Y on seasons < Y and return Map(key -> prediction) for every row of Y. */
export function foldPredictions(rows, Y, spec) {
  const train = rows.filter(r => r.season >= FIRST_TRAIN && r.season < Y), test = rows.filter(r => r.season === Y);
  const model = spec.kind === "gbm" ? fitGbmByPosition(train, spec.target, spec.features, spec.params)
    : spec.kind === "linear" ? fitLinearByPosition(train, spec.target, spec.features, spec.lambda ?? 0) : null;
  const out = new Map();
  for (const r of test) {
    let p = spec.kind === "fixed" ? spec.predict(r) : model.predict(r);
    if (!numeric(p) && spec.fallback) p = spec.fallback(r);
    out.set(key(r), numeric(p) ? p : null);
  }
  return { preds: out, model };
}

/** Scored frame for one predictor map: played rows with a prediction. */
export const frame = (rows, preds, y = r => r.y) => rows.filter(r => numeric(y(r)) && numeric(preds.get(key(r)))).map(r => ({ c: r, pred: preds.get(key(r)), y: y(r) }));
export { key as rowKey };

/** Lineup simulation (EDGE-01 synthetic leagues, class X) for several predictor maps over the same played rows. */
export function lineup(rows, predMaps, control) {
  const played = rows.filter(r => numeric(r.y)).map(r => ({ ...r, inputs: { Q: r.f.Q }, outcome: { actual: r.y } }));
  const bySw = groupBy(played, r => `${r.season}:${r.week}`);
  const predictors = Object.fromEntries(Object.entries(predMaps).map(([n, m]) => [n, c => m.get(key(c))]));
  const per = simulate(bySw, predictors);
  return Object.fromEntries(Object.keys(predMaps).filter(n => n !== control).map(n => [n, summarize(per, n, control)]));
}

/** Within-group ranking quality: mean Spearman and pairwise ordering accuracy, plus a season-week cluster bootstrap of a − b. */
export function rankCompare(rows, predA, predB, y, groupKey, { draws = 1000, seed = 3 } = {}) {
  const groups = [...groupBy(rows.filter(r => numeric(y(r)) && numeric(predA(r)) && numeric(predB(r))), groupKey).values()].filter(g => g.length >= 4);
  const stat = g => {
    const ys = g.map(y), a = g.map(predA), b = g.map(predB);
    let n = 0, ca = 0, cb = 0, dis = 0, disA = 0;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if (ys[i] === ys[j]) continue; n++;
      const s = Math.sign(ys[i] - ys[j]), sa = Math.sign(a[i] - a[j]), sb = Math.sign(b[i] - b[j]);
      ca += sa === 0 ? 0.5 : sa === s ? 1 : 0; cb += sb === 0 ? 0.5 : sb === s ? 1 : 0;
      // Disagreements: the two predictors order the pair in opposite strict directions; who was right?
      if (sa !== 0 && sb !== 0 && sa !== sb) { dis++; disA += sa === s ? 1 : 0; }
    }
    return { sa: spearman(a, ys), sb: spearman(b, ys), n, ca, cb, dis, disA, sw: `${g[0].season}:${g[0].week}` };
  };
  const st = groups.map(stat);
  const sum = (list, k) => list.reduce((s, x) => s + x[k], 0);
  const agg = list => { const n = sum(list, "n"); return { spearman_a: mean(list.map(x => x.sa)), spearman_b: mean(list.map(x => x.sb)),
    pair_a: sum(list, "ca") / n, pair_b: sum(list, "cb") / n, disagreements: sum(list, "dis"), a_right_when_disagree: sum(list, "disA") / sum(list, "dis") }; };
  const est = agg(st);
  const clusters = [...groupBy(st, x => x.sw).values()], rand = rng(seed), dS = [], dP = [], dD = [];
  for (let b = 0; b < draws; b++) { const pick = []; for (let i = 0; i < clusters.length; i++) pick.push(...clusters[Math.floor(rand() * clusters.length)]); const a = agg(pick); dS.push(a.spearman_a - a.spearman_b); dP.push(a.pair_a - a.pair_b); dD.push(a.a_right_when_disagree); }
  return { groups: st.length, pairs: sum(st, "n"), ...est, d_spearman: est.spearman_a - est.spearman_b, d_spearman_ci95: [quantile(dS, 0.025), quantile(dS, 0.975)],
    d_pair: est.pair_a - est.pair_b, d_pair_ci95: [quantile(dP, 0.025), quantile(dP, 0.975)], a_right_when_disagree_ci95: [quantile(dD, 0.025), quantile(dD, 0.975)] };
}

/** Attach walk-forward conformal intervals for test season Y from OOS predictions of earlier seasons (Y−2, Y−1). */
export function intervals(rows, oosBySeason, Y, preds, y = r => r.y) {
  const prior = [Y - 2, Y - 1].flatMap(s => (oosBySeason[s] || []));
  if (!prior.length) return null;
  const rq = residualQuantiles(prior);
  const scored = rows.filter(r => r.season === Y && numeric(y(r)) && numeric(preds.get(key(r)))).map(r => ({ c: r, position: r.position, y: y(r), q: intervalFor(rq, r.position, preds.get(key(r))) }));
  return { rq, scored, metrics: intervalMetrics(scored) };
}

export { pointMetrics, pairedDelta };
