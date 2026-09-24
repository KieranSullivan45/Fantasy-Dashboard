import { digest } from "./contracts.js";
/** Outcome records never mutate predictors; kickoff timestamps are mandatory to prevent same-day leakage. */
export function evaluateObservation(observation, games, { evaluatedAt, seasonComplete = false }) {
  const cutoff = Date.parse(observation.generated_at), end = Date.parse(evaluatedAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(end) || end <= cutoff) throw new Error("Invalid evaluation time");
  const rows = games.filter(g => String(g.player_id) === observation.player_id && Number(g.season) === Number(observation.season) &&
    Date.parse(g.kickoff) > cutoff && Date.parse(g.completed_at) <= end && Date.parse(g.available_at) <= end).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const unique = [...new Map(rows.map(r => [r.game_id, r])).values()];
  const windows = Object.fromEntries([1, 3, 4, "ros"].map(n => {
    const selected = n === "ros" ? unique : unique.slice(0, n);
    const means = Object.fromEntries(["points", "xfp", "snap_share", "target_share", "carry_share"].map(key => { const values = selected.map(g => g[key]).filter(Number.isFinite); return [key, { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, observed_games: values.length }]; }));
    return [n, { complete: n === "ros" ? seasonComplete : selected.length === n, games: selected.map(g => g.game_id), metrics: means }];
  }));
  const record = { schema_version: "outcome-1", observation_id: observation.observation_id, evaluated_at: evaluatedAt, windows,
    basis: "Post-observation games with known completion/publication times. Missing games are not zeroes; no claim of causality." };
  return { outcome_id: digest(record), ...record };
}
