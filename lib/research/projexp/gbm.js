// Projection experiment: small dependency-free gradient-boosted regression trees (research only, class X).
// Histogram splits on training-set quantile bins; a missing value (NaN) is its own bin and the split learns which side it
// goes to, so missing inputs are never coerced to zero. Squared-error loss; seeded row subsampling for determinism.
import { rng } from "../edge01/metrics.js";

const MISSING = -1;

/** Quantile bin edges per feature from training rows only. */
function binEdges(X, nFeatures, maxBins) {
  const edges = [];
  for (let j = 0; j < nFeatures; j++) {
    const v = []; for (const row of X) if (Number.isFinite(row[j])) v.push(row[j]);
    v.sort((a, b) => a - b);
    const e = [];
    for (let b = 1; b < maxBins; b++) { const x = v[Math.floor((b / maxBins) * (v.length - 1))]; if (x !== undefined && (e.length === 0 || x > e.at(-1))) e.push(x); }
    edges.push(e);
  }
  return edges;
}
const binOf = (edges, x) => { if (!Number.isFinite(x)) return MISSING; let lo = 0, hi = edges.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x <= edges[m]) hi = m; else lo = m + 1; } return lo; };

/**
 * Fit. X: number[][] (NaN = missing), y: number[]. Returns a model usable by predictGbm.
 * params: { trees, depth, lr, minLeaf, lambda, subsample, maxBins, seed }
 */
export function fitGbm(X, y, { trees = 300, depth = 4, lr = 0.05, minLeaf = 40, lambda = 1, subsample = 0.8, maxBins = 32, seed = 1 } = {}) {
  const n = X.length, p = X[0]?.length ?? 0;
  if (n < minLeaf * 2) return null;
  const edges = binEdges(X, p, maxBins), nb = edges.map(e => e.length + 1);
  const B = X.map(row => Int16Array.from(row, (x, j) => binOf(edges[j], x)));
  const base = y.reduce((s, v) => s + v, 0) / n, pred = new Float64Array(n).fill(base), rand = rng(seed), forest = [];
  for (let t = 0; t < trees; t++) {
    const idx = []; for (let i = 0; i < n; i++) if (rand() < subsample) idx.push(i);
    const g = new Float64Array(n); for (const i of idx) g[i] = y[i] - pred[i];
    const tree = grow(idx, 0);
    forest.push(tree);
    for (let i = 0; i < n; i++) pred[i] += lr * leafValue(tree, B[i]);
    function grow(rows, d) {
      let sum = 0; for (const i of rows) sum += g[i];
      const value = sum / (rows.length + lambda);
      if (d >= depth || rows.length < 2 * minLeaf) return { value };
      let best = null; const parentScore = (sum * sum) / (rows.length + lambda);
      for (let j = 0; j < p; j++) {
        const hs = new Float64Array(nb[j]), hc = new Int32Array(nb[j]); let ms = 0, mc = 0;
        for (const i of rows) { const b = B[i][j]; if (b === MISSING) { ms += g[i]; mc++; } else { hs[b] += g[i]; hc[b]++; } }
        let ls = 0, lc = 0;
        for (let b = 0; b < nb[j] - 1; b++) {
          ls += hs[b]; lc += hc[b];
          for (const missLeft of mc ? [true, false] : [false]) {
            const L = missLeft ? ls + ms : ls, Lc = missLeft ? lc + mc : lc, R = sum - L, Rc = rows.length - Lc;
            if (Lc < minLeaf || Rc < minLeaf) continue;
            const gain = (L * L) / (Lc + lambda) + (R * R) / (Rc + lambda) - parentScore;
            if (!best || gain > best.gain) best = { gain, j, b, missLeft };
          }
        }
      }
      if (!best || best.gain <= 1e-9) return { value };
      const left = [], right = [];
      for (const i of rows) { const b = B[i][best.j]; ((b === MISSING ? best.missLeft : b <= best.b) ? left : right).push(i); }
      return { j: best.j, b: best.b, missLeft: best.missLeft, left: grow(left, d + 1), right: grow(right, d + 1) };
    }
  }
  return { base, lr, forest, edges, p, gain: featureGain(forest, p) };
}

function leafValue(node, bins) {
  while (node.left) { const b = bins[node.j]; node = (b === MISSING ? node.missLeft : b <= node.b) ? node.left : node.right; }
  return node.value;
}
function featureGain(forest, p) {
  const out = new Array(p).fill(0);
  const walk = n => { if (!n.left) return; out[n.j]++; walk(n.left); walk(n.right); };
  forest.forEach(walk);
  return out;
}

export function predictGbm(model, x) {
  if (!model) return null;
  const bins = x.map((v, j) => binOf(model.edges[j], v));
  let s = model.base; for (const t of model.forest) s += model.lr * leafValue(t, bins);
  return s;
}
