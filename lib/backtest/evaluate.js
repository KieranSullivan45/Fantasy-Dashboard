import { weeklyFeatures, forecast, numeric, mean } from "../decision/features.js";
export const CANDIDATES = {
  historical_quality: [1, 0, 0, 0], recent_form: [0.2, 0.8, 0, 0], expected_opportunity: [0, 0, 1, 0],
  balanced: [0.5, 0, 0.5, 0], opportunity_recent: [0.2, 0.2, 0.6, 0],
  quality_recent: [0.6, 0.2, 0.2, 0], role_mix: [0.3, 0.1, 0.4, 0.2], opportunity_role: [0.2, 0, 0.6, 0.2],
};
export function buildCases(games, season) {
  const groups = new Map();
  for (const g of games) { if (!groups.has(g.player_id)) groups.set(g.player_id, []); groups.get(g.player_id).push(g); }
  const cases = []; let missingWeekly = 0;
  for (let week = 3; week <= 17; week++) for (const [id, rows] of groups) {
    const history = rows.filter(r => r.season === season && r.week < week).sort((a, b) => a.week - b.week);
    const last = history.at(-1);
    // Membership uses past activity only. No current roster, market, future score or ownership filter.
    if (history.length < 2 || !last || last.week < week - 3 || !history.slice(-2).some(g => g.snap_share >= 0.1 || g.targets + g.carries >= 3 || g.passing_attempts >= 10)) continue;
    const prior = rows.filter(r => r.season === season - 1);
    const features = weeklyFeatures(history, prior, last.position, { season, week, currentTeam: last.team });
    const actual = rows.find(r => r.season === season && r.week === week)?.points ?? null;
    if (!numeric(actual)) missingWeekly++;
    const outcomes = Object.fromEntries([1, 3, 4].map(horizon => {
      const future = rows.filter(r => r.season === season && r.week >= week && r.week < week + horizon && r.week <= 18);
      return [horizon, { points: mean(future.map(g => g.points)), xfp: mean(future.map(g => g.xfp)), snap_share: mean(future.map(g => g.snap_share)), games: future.filter(g => numeric(g.points)).length }];
    }));
    cases.push({ player_id: id, season, week, position: last.position, features, actual, outcomes });
  }
  return { cases, missing_weekly_outcomes: missingWeekly };
}
export function ranks(xs) {
  const sorted = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x), result = Array(xs.length);
  for (let i = 0; i < sorted.length;) { let j = i + 1; while (j < sorted.length && sorted[j].x === sorted[i].x) j++;
    for (let k = i; k < j; k++) result[sorted[k].i] = (i + j - 1) / 2 + 1; i = j;
  }
  return result;
}
export function spearman(xs, ys) {
  if (xs.length < 3) return null;
  const x = ranks(xs), y = ranks(ys), mx = mean(x), my = mean(y);
  const covariance = x.reduce((s, a, i) => s + (a - mx) * (y[i] - my), 0);
  const denominator = Math.sqrt(x.reduce((s, a) => s + (a - mx) ** 2, 0) * y.reduce((s, a) => s + (a - my) ** 2, 0));
  return denominator ? covariance / denominator : null;
}
export function evaluate(cases, predict, target = c => c.actual, { pointScale = true } = {}) {
  const rows = cases.map(c => ({ c, y: target(c), prediction: predict(c) })).filter(r => numeric(r.y) && numeric(r.prediction));
  const groups = new Map();
  for (const r of rows) { const key = `${r.c.season}:${r.c.week}:${r.c.position}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const correlations = [], hits = []; let comparisons = 0, correct = 0;
  for (const group of groups.values()) {
    const corr = spearman(group.map(r => r.prediction), group.map(r => r.y)); if (corr != null) correlations.push(corr);
    const k = Math.min({ QB: 12, RB: 24, WR: 24, TE: 12 }[group[0].c.position], group.length);
    const actualTop = new Set([...group].sort((a, b) => b.y - a.y || a.c.player_id.localeCompare(b.c.player_id)).slice(0, k).map(r => r.c.player_id));
    hits.push([...group].sort((a, b) => b.prediction - a.prediction || a.c.player_id.localeCompare(b.c.player_id)).slice(0, k).filter(r => actualTop.has(r.c.player_id)).length / k);
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (group[i].y !== group[j].y) {
      comparisons++; const delta = group[i].prediction - group[j].prediction; correct += delta === 0 ? 0.5 : Math.sign(delta) === Math.sign(group[i].y - group[j].y) ? 1 : 0;
    }
  }
  return { n: rows.length, groups: groups.size, mae: pointScale ? mean(rows.map(r => Math.abs(r.prediction - r.y))) : null,
    spearman: mean(correlations), top_n_hit_rate: mean(hits), correct_pair_rate: comparisons ? correct / comparisons : null,
    confidence: Object.fromEntries(["low", "moderate"].map(confidence => {
      const bucket = rows.filter(r => r.c.features.confidence === confidence), ranges = bucket.filter(r => r.c.features.uncertainty.floor_like != null);
      return [confidence, { n: bucket.length, mae: pointScale ? mean(bucket.map(r => Math.abs(r.prediction - r.y))) : null,
        observed_range_coverage: pointScale ? mean(ranges.map(r => r.y >= r.c.features.uncertainty.floor_like && r.y <= r.c.features.uncertainty.ceiling_like ? 1 : 0)) : null, range_n: pointScale ? ranges.length : 0 }];
    })) };
}
export function candidateForecast(name, c) { return forecast(c.features, CANDIDATES[name]).central; }

// Frozen v0.3.1 football-only components. Roster/interest/matchup are intentionally not fabricated.
export function legacyScores(cases) {
  const groups = new Map(), result = new Map();
  for (const c of cases) { const key = `${c.season}:${c.week}:${c.position}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); }
  for (const group of groups.values()) for (const c of group) {
    const pct = key => { const values = group.map(x => x.features[key]).filter(numeric); return numeric(c.features[key]) ? values.filter(v => v < c.features[key]).length / values.length * 100 : 0; };
    result.set(c, 0.2 * pct("season_ppg") + 0.1 * pct("recent_ppg") + 0.2 * pct("legacy_opportunity"));
  }
  return result;
}

