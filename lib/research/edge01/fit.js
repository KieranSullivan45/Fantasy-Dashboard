// Small, dependency-free linear fitting for EDGE-01 research (ridge on standardized features, unpenalized intercept).
import { numeric } from "../../decision/features.js";

export function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Ridge regression. rows: [{ x: number[], y: number }]; rows with any non-finite value are skipped (complete-case fit,
 * never zero-filled). Returns coefficients on the original scale: { coef: [intercept, ...betas], n, means, sds }.
 */
export function ridge(rows, lambda = 0) {
  const data = rows.filter(r => numeric(r.y) && r.x.every(numeric));
  const p = data[0]?.x.length ?? 0;
  if (data.length <= p + 1) return null;
  const means = Array(p).fill(0), sds = Array(p).fill(0);
  for (const r of data) r.x.forEach((v, j) => { means[j] += v / data.length; });
  for (const r of data) r.x.forEach((v, j) => { sds[j] += (v - means[j]) ** 2 / data.length; });
  for (let j = 0; j < p; j++) sds[j] = Math.sqrt(sds[j]) || 1;
  const ym = data.reduce((s, r) => s + r.y, 0) / data.length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0)), Xty = Array(p).fill(0);
  for (const r of data) {
    const z = r.x.map((v, j) => (v - means[j]) / sds[j]);
    for (let i = 0; i < p; i++) { Xty[i] += z[i] * (r.y - ym); for (let j = 0; j < p; j++) XtX[i][j] += z[i] * z[j]; }
  }
  for (let i = 0; i < p; i++) XtX[i][i] += lambda;
  const beta = p ? solve(XtX, Xty) : [];
  if (!beta) return null;
  const betas = beta.map((b, j) => b / sds[j]);
  const intercept = ym - betas.reduce((s, b, j) => s + b * means[j], 0);
  return { coef: [intercept, ...betas], n: data.length, lambda };
}
export const predictLinear = (model, x) => model && x.every(numeric) ? model.coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : x[i - 1]), 0) : null;
