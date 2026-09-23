import { fitsSlot, uniquePlayers, SLOT_POSITIONS } from "../normalize/positions.js";
/** Rectangular Hungarian assignment. Maximize filled legal slots, then value, one player once. */
export function optimizeLineup(players, slots, values) {
  if (slots.some(s => !SLOT_POSITIONS[s]) || slots.length > 64) return null;
  const pool = uniquePlayers(players).filter(p => Number.isFinite(values[p.player_id]));
  const n = slots.length, m = pool.length + n, u = Array(n + 1).fill(0), v = Array(m + 1).fill(0), p = Array(m + 1).fill(0), way = Array(m + 1).fill(0);
  const fillBonus = 1 + pool.reduce((sum, player) => sum + Math.abs(values[player.player_id]), 0);
  const cost = (i, j) => j > pool.length ? 0 : fitsSlot(pool[j - 1], slots[i - 1]) ? -fillBonus - values[pool[j - 1].player_id] : 1e12;
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = Array(m + 1).fill(Infinity), used = Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const cur = cost(i0, j) - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = slots.map((slot, index) => ({ slot, index, player_id: null, value: null }));
  for (let j = 1; j <= pool.length; j++) if (p[j]) result[p[j] - 1] = { slot: slots[p[j] - 1], index: p[j] - 1, player_id: pool[j - 1].player_id, value: values[pool[j - 1].player_id] };
  return result;
}
