/**
 * SourceResult<T>: { source_id, status, fetched_at, published_at, url, data: T[], warnings: string[] }
 * status: available | unavailable | unsupported. Missing observations are null, never zero.
 * Imported observations: { player_id (Sleeper), source_id, source_family, season, week,
 *   scoring_profile, published_at, value, position? }. Keys/credentials remain server-side.
 * Raw source rows remain separate from normalized rows and derived league metrics.
 */
export function unavailableSource(source_id, reason, status = "unavailable") {
  return { source_id, status, fetched_at: null, published_at: null, url: null, data: [], warnings: [reason] };
}

export function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || value === "NA") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTeam(team) {
  return ({ LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR", JAC: "JAX", WSH: "WAS" })[team] || team || null;
}
