// EDGE-01 point-in-time opportunity / role-change features (research only).
// Every function takes the evaluated (season, week) and drops any row at or after it before computing anything.
import { mean, numeric } from "../../decision/features.js";

export const ROLE_METRICS = ["snap_share", "target_share", "carry_share", "targets", "carries", "air_yards", "air_yard_share", "wopr", "points", "vip", "xfp",
  "team_target_share", "team_carry_share", "team_pass_attempts", "team_plays"];
/** Metrics whose inputs come from ffopportunity xFP: betting-derived (certificate 2026-10-03). Labelled wherever used. */
export const BETTING_DERIVED = new Set(["xfp"]);

const sd = xs => { const v = xs.filter(numeric); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(mean(v.map(x => (x - m) ** 2))); };

/** Strict as-of filter: same season, earlier week only. */
export function asOf(rows, season, week) {
  return rows.filter(g => Number(g.season) === Number(season) && Number(g.week) < week).sort((a, b) => a.week - b.week);
}

/** Volume-implied points: per-position linear map from same-game opportunity volume to points, fitted on training seasons only. */
export const VIP_INPUTS = { QB: ["passing_attempts", "carries"], RB: ["carries", "targets"], WR: ["targets", "air_yards", "carries"], TE: ["targets", "air_yards"] };
export function vipOf(game, model) {
  const m = model?.[game.position]; if (!m) return null;
  const xs = VIP_INPUTS[game.position].map(k => game[k]);
  if (xs.some(x => !numeric(x))) return null;
  return m.coef.reduce((s, c, i) => s + c * (i === 0 ? 1 : xs[i - 1]), 0);
}

/** Derived per-game context. Team shares only when the team total is observed and positive. */
export function enrichGame(game, vipModel) {
  const share = (x, total) => numeric(x) && numeric(total) && total > 0 ? x / total : null;
  return { ...game, vip: vipOf(game, vipModel), team_target_share: share(game.targets, game.team_targets), team_carry_share: share(game.carries, game.team_carries) };
}

function windows(values) {
  // values: chronological numeric-or-null per recorded game (no calendar padding: absent games are not rows).
  const at = i => values.length - i; // 1-based from the end
  const slice = (from, to) => values.slice(Math.max(0, at(to)), Math.max(0, at(from) + 1)); // games from-th..to-th most recent
  const avg = xs => xs.length && xs.every(numeric) ? mean(xs) : null; // a window with a missing value is missing, never partially averaged
  const last1 = values.length >= 1 ? avg(slice(1, 1)) : null;
  const last2 = values.length >= 2 ? avg(slice(1, 2)) : null, prev2 = values.length >= 4 ? avg(slice(3, 4)) : null;
  const last3 = values.length >= 3 ? avg(slice(1, 3)) : null, prev3 = values.length >= 6 ? avg(slice(4, 6)) : null;
  const before1 = values.length >= 4 ? avg(slice(2, 4)) : null;
  const season = mean(values);
  const d = (a, b) => a === null || b === null ? null : a - b;
  const recentTwo = values.length >= 4 ? slice(1, 2) : null;
  return {
    last1, last2, prev2, last3, prev3, season, games: values.filter(numeric).length,
    d_1v3: d(last1, before1), d_2v2: d(last2, prev2), d_3v3: d(last3, prev3),
    // Persistence: both of the two most recent games exceed the previous-two baseline by tau (sign-aware helper below).
    recent_two: recentTwo && recentTwo.every(numeric) ? recentTwo : null,
    // Consecutive direction: number of most-recent consecutive game-to-game increases (decreases negative).
    streak: (() => { let s = 0; for (let i = values.length - 1; i > 0; i--) { const a = values[i], b = values[i - 1]; if (!numeric(a) || !numeric(b) || a === b) break; const dir = Math.sign(a - b); if (s === 0 || Math.sign(s) === dir) s += dir; else break; } return s; })(),
    volatility4: values.length >= 4 && slice(1, 4).every(numeric) ? sd(slice(1, 4)) : null,
  };
}

/** Sustained change: both of the two latest games beyond the previous-two mean by tau in the same direction. */
export function sustained(w, tau) {
  if (!w.recent_two || w.prev2 === null) return 0;
  if (w.recent_two.every(v => v >= w.prev2 + tau)) return 1;
  if (w.recent_two.every(v => v <= w.prev2 - tau)) return -1;
  return 0;
}
/** One-game spike: the latest game beyond the previous-three mean by tau while the game before it was not. */
export function spikeOnly(values, tau) {
  if (values.length < 4 || !values.slice(-4).every(numeric)) return false;
  const base = mean(values.slice(-4, -1));
  return values.at(-1) >= base + tau && values.at(-2) < base + tau;
}

/**
 * Opportunity features for one player at (season, week). Role windows use only current-team games (the team of the
 * latest as-of game), matching production `weeklyFeatures`. Points season-to-date uses all as-of games.
 */
export function opportunityFeatures(playerRows, { season, week, vipModel }) {
  const all = asOf(playerRows, season, week).map(g => enrichGame(g, vipModel));
  if (!all.length) return null;
  const team = all.at(-1).team, current = all.filter(g => g.team === team);
  const out = { season, week, data_through_week: all.at(-1).week, team, current_team_games: current.length, games: all.length,
    calendar_gap: week - all.at(-1).week, metrics: {}, coverage: {} };
  for (const m of ROLE_METRICS) {
    const values = (m === "points" ? all : current).map(g => numeric(g[m]) ? g[m] : null);
    out.metrics[m] = windows(values);
    out.coverage[m] = values.length ? values.filter(numeric).length / values.length : null;
  }
  out.spike_only = { snap_share: spikeOnly(current.map(g => g.snap_share), 0.15), vip: spikeOnly(current.map(g => g.vip), 4) };
  return out;
}

/** H9 ew2_h16 prior (ADR 0009): Y−1 + Y−2 REG games with numeric points, half-life 16 games, no Y−2-only fallback. */
export function ewTwoSeasonPrior(playerRows, season, halfLife = 16) {
  const y1 = playerRows.filter(g => g.season === season - 1 && numeric(g.points)).sort((a, b) => a.week - b.week);
  if (!y1.length) return null;
  const y2 = playerRows.filter(g => g.season === season - 2 && numeric(g.points)).sort((a, b) => a.week - b.week);
  const games = [...y2, ...y1]; let s = 0, w = 0;
  games.forEach((g, i) => { const wt = 0.5 ** ((games.length - 1 - i) / halfLife); s += wt * g.points; w += wt; });
  return s / w;
}

/** Exponentially weighted mean over every as-of REG game in seasons Y−2..Y (current season included), by game order. */
export function ewAllGames(playerRows, season, week, halfLife) {
  const games = playerRows.filter(g => numeric(g.points) && ((g.season === season && g.week < week) || g.season === season - 1 || g.season === season - 2))
    .sort((a, b) => a.season - b.season || a.week - b.week);
  if (!games.length) return null;
  let s = 0, w = 0; games.forEach((g, i) => { const wt = 0.5 ** ((games.length - 1 - i) / halfLife); s += wt * g.points; w += wt; });
  return s / w;
}

/** Field inventory: share of game rows with a numeric value, per season. Used to document what history actually exists. */
export function inventory(gamesBySeason) {
  const fields = ["points", "snap_share", "snap_count", "targets", "target_share", "carries", "carry_share", "air_yards", "air_yard_share", "wopr", "racr", "passing_attempts", "xfp", "fpoe", "team_targets", "team_carries", "team_pass_attempts", "team_plays"];
  return Object.fromEntries(Object.entries(gamesBySeason).map(([season, games]) => [season, { rows: games.length,
    coverage: Object.fromEntries(fields.map(f => [f, games.length ? +(games.filter(g => numeric(g[f])).length / games.length).toFixed(4) : null])) }]));
}
