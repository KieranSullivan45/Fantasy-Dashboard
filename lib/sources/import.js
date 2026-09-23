import { finiteNumber } from "./contracts.js";

// Deliberately no public upload route: callers supply permitted, normalized observations.
export function importObservations(rows, kind, { season, week, scoring_profile, now = Date.now() }) {
  const accepted = [], rejected = [];
  for (const row of rows || []) {
    const value = finiteNumber(row.value);
    const date = Date.parse(row.published_at);
    const valid = row.player_id && row.source_id && row.source_family &&
      Number(row.season) === Number(season) && Number(row.week) === Number(week) &&
      (kind === "ownership" || row.scoring_profile === scoring_profile) &&
      Number.isFinite(date) && date <= now && now - date <= 7 * 86400000 && value !== null &&
      (kind !== "rankings" || (value >= 1 && ["QB", "RB", "WR", "TE", "K", "DEF"].includes(row.position))) &&
      (kind !== "ownership" || (value >= 0 && value <= 100));
    if (!valid) { rejected.push({ player_id: row.player_id || null, reason: "Invalid, stale or incompatible observation" }); continue; }
    accepted.push({ ...row, player_id: String(row.player_id), value, kind });
  }
  return { accepted, rejected };
}
