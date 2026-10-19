// EDGE-RANK-01 synthetic-league lineup structures (class X). Generalizes lib/research/edge01/lineup.js (whose seeded draft is
// reproduced exactly for the standard structure, seed 0). Rosters are SIMULATED; no historical manager lineup is claimed.
// Every lineup uses the repository legal-lineup optimizer (Hungarian; legal slots filled first, one player per slot).
import { optimizeLineup } from "../../decision/optimizer.js";
import { numeric } from "../../decision/features.js";
import { rng } from "../edge01/metrics.js";

export const STRUCTURES = {
  standard_1qb: { slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"], roster: { QB: 2, RB: 5, WR: 5, TE: 2 }, teams: 12 },
  no_flex: { slots: ["QB", "RB", "RB", "WR", "WR", "TE"], roster: { QB: 2, RB: 5, WR: 5, TE: 2 }, teams: 12 },
  superflex: { slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX"], roster: { QB: 3, RB: 5, WR: 5, TE: 2 }, teams: 10 },
  deep_flex: { slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "FLEX"], roster: { QB: 2, RB: 6, WR: 6, TE: 2 }, teams: 10 },
  // Synthetic eligibility: seeded 25% of rostered RBs also WR-eligible, 25% of TEs also WR-eligible. Not from any source.
  dual_synthetic: { slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"], roster: { QB: 2, RB: 5, WR: 5, TE: 2 }, teams: 12, dual: { RB: 0.25, TE: 0.25 } },
};
export const LEAGUES_PER_WEEK = 4;

/** Seeded noisy as-of-Q snake drafts (identical to EDGE-01 draftLeagues when seedOffset = 0 and the structure is standard). */
export function draftLeagues(cases, seed, { roster, teams, dual }) {
  const pool = cases.filter(c => numeric(c.outcome.actual) && numeric(c.inputs.Q) && roster[c.position]);
  const leagues = [];
  for (let l = 0; l < LEAGUES_PER_WEEK; l++) {
    const rand = rng(seed * 1009 + l * 7919 + 13);
    const noisy = pool.map(c => ({ c, v: c.inputs.Q + (rand() + rand() + rand() - 1.5) * 6 })).sort((a, b) => b.v - a.v || a.c.player_id.localeCompare(b.c.player_id));
    const ts = Array.from({ length: teams }, () => ({ players: [], need: { ...roster } })), taken = new Set();
    const rounds = Object.values(roster).reduce((a, b) => a + b, 0);
    for (let r = 0; r < rounds; r++) for (let i = 0; i < teams; i++) {
      const team = ts[r % 2 ? teams - 1 - i : i];
      const pick = noisy.find(x => !taken.has(x.c.player_id) && team.need[x.c.position] > 0);
      if (!pick) continue;
      taken.add(pick.c.player_id); team.need[pick.c.position]--; team.players.push(pick.c);
    }
    const drand = rng(seed * 31 + l * 17 + 5);
    for (const t of ts.filter(t => Object.values(t.need).every(v => v === 0))) {
      leagues.push(t.players.map(c => ({ c, positions: dual?.[c.position] && drand() < dual[c.position] ? [c.position, "WR"] : [c.position] })));
    }
  }
  return leagues;
}

/** Legal lineup for given values; returns per-slot rows with the realised points, or null if a slot cannot be filled. */
export function lineup(roster, slots, values) {
  const result = optimizeLineup(roster.map(r => ({ player_id: r.c.player_id, position: r.c.position, fantasy_positions: r.positions })), slots, values);
  if (!result || result.some(s => !s.player_id)) return null;
  const byId = new Map(roster.map(r => [r.c.player_id, r.c]));
  return result.map(s => ({ slot: s.slot, player_id: s.player_id, position: byId.get(s.player_id).position, points: byId.get(s.player_id).outcome.actual }));
}

/**
 * Lineup points per roster-week for each predictor. Rows carry total points, per-slot-position points (additive decomposition,
 * exact for structures without flexible slots) and the hindsight-optimal legal lineup.
 */
export function simulate(casesBySeasonWeek, predictors, structure, seedOffset = 0) {
  const { slots } = structure, perRoster = [];
  for (const [key, cases] of casesBySeasonWeek) {
    const [season, week] = key.split(":").map(Number);
    for (const roster of draftLeagues(cases, season * 100 + week + seedOffset * 100003, structure)) {
      const opt = lineup(roster, slots, Object.fromEntries(roster.map(r => [r.c.player_id, r.c.outcome.actual])));
      const row = { season, week, optimal: opt ? opt.reduce((s, x) => s + x.points, 0) : null, by: {} };
      for (const [name, pred] of Object.entries(predictors)) {
        const values = {}; for (const r of roster) { const v = pred(r.c); if (numeric(v)) values[r.c.player_id] = v; }
        const lu = lineup(roster, slots, values);
        row[name] = lu ? lu.reduce((s, x) => s + x.points, 0) : null;
        if (lu) { const bp = {}; for (const x of lu) { const k = ["QB", "RB", "WR", "TE"].includes(x.slot) ? x.slot : "FLEX_ANY"; bp[k] = (bp[k] ?? 0) + x.points; } row.by[name] = bp; }
      }
      perRoster.push(row);
    }
  }
  return perRoster;
}
