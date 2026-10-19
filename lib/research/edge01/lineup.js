// EDGE-01 synthetic-league lineup simulation (class X). No historical roster state exists in the repository's sources, so
// rosters are SIMULATED (seeded noisy as-of-Q snake drafts) and labelled as such. Lineups use the repo legal-lineup optimizer.
import { optimizeLineup } from "../../decision/optimizer.js";
import { numeric, mean, quantile } from "../../decision/features.js";
import { rng } from "./metrics.js";

export const SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"];
export const ROSTER = { QB: 2, RB: 5, WR: 5, TE: 2 };
export const TEAMS = 12, LEAGUES_PER_WEEK = 4;

/** Rosters for one season-week from played cases only (participation-conditional, disclosed). Independent of any candidate. */
export function draftLeagues(cases, seed) {
  const pool = cases.filter(c => numeric(c.outcome.actual) && numeric(c.inputs.Q) && ROSTER[c.position]);
  const leagues = [];
  for (let l = 0; l < LEAGUES_PER_WEEK; l++) {
    const rand = rng(seed * 1009 + l * 7919 + 13);
    const noisy = pool.map(c => ({ c, v: c.inputs.Q + (rand() + rand() + rand() - 1.5) * 6 })).sort((a, b) => b.v - a.v || a.c.player_id.localeCompare(b.c.player_id));
    const teams = Array.from({ length: TEAMS }, () => ({ players: [], need: { ...ROSTER } })), taken = new Set();
    const rounds = Object.values(ROSTER).reduce((a, b) => a + b, 0);
    for (let r = 0; r < rounds; r++) for (let i = 0; i < TEAMS; i++) {
      const team = teams[r % 2 ? TEAMS - 1 - i : i];
      const pick = noisy.find(x => !taken.has(x.c.player_id) && team.need[x.c.position] > 0);
      if (!pick) continue;
      taken.add(pick.c.player_id); team.need[pick.c.position]--; team.players.push(pick.c);
    }
    leagues.push(teams.filter(t => Object.values(t.need).every(v => v === 0)).map(t => t.players));
  }
  return leagues.flat();
}

const lineupPoints = (roster, values) => {
  const result = optimizeLineup(roster.map(c => ({ player_id: c.player_id, position: c.position })), SLOTS, values);
  if (!result || result.some(s => !s.player_id)) return null;
  const actual = Object.fromEntries(roster.map(c => [c.player_id, c.outcome.actual]));
  return result.reduce((s, slot) => s + actual[slot.player_id], 0);
};

/** Lineup points per roster-week for each predictor; the hindsight-optimal legal lineup gives regret. */
export function simulate(casesBySeasonWeek, predictors) {
  const perRoster = [];
  for (const [key, cases] of casesBySeasonWeek) {
    const [season, week] = key.split(":").map(Number);
    for (const roster of draftLeagues(cases, season * 100 + week)) {
      const optimal = lineupPoints(roster, Object.fromEntries(roster.map(c => [c.player_id, c.outcome.actual])));
      const row = { season, week, optimal };
      for (const [name, pred] of Object.entries(predictors)) {
        const values = {}; for (const c of roster) { const v = pred(c); if (numeric(v)) values[c.player_id] = v; }
        row[name] = lineupPoints(roster, values);
      }
      perRoster.push(row);
    }
  }
  return perRoster;
}

export function summarize(perRoster, name, control, { draws = 1000, seed = 7 } = {}) {
  const rows = perRoster.filter(r => numeric(r[name]) && numeric(r[control]) && numeric(r.optimal));
  if (!rows.length) return null;
  const deltas = rows.map(r => r[name] - r[control]), est = mean(deltas);
  const clusters = new Map(); rows.forEach((r, i) => { const k = `${r.season}:${r.week}`; (clusters.get(k) ?? clusters.set(k, []).get(k)).push(deltas[i]); });
  const cl = [...clusters.values()].map(g => [g.reduce((a, b) => a + b, 0), g.length]), rand = rng(seed), stats = [];
  for (let b = 0; b < draws; b++) { let s = 0, n = 0; for (let i = 0; i < cl.length; i++) { const [cs, cn] = cl[Math.floor(rand() * cl.length)]; s += cs; n += cn; } stats.push(s / n); }
  return { roster_weeks: rows.length, lineup_points: mean(rows.map(r => r[name])), regret: mean(rows.map(r => r.optimal - r[name])),
    delta_vs_control: est, ci95_by_season_week: [quantile(stats, 0.025), quantile(stats, 0.975)] };
}
