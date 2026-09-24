import { validLeagueId, validUserId, resolveSeason } from "./sleeper.js";
import { getConfiguredUsername } from "../config.js";
export function requestIdentity(params, league, configuredIds) {
  const requested = params.get("user"), roster = params.get("roster"), season = params.get("season");
  if (requested && requested !== "spectator" && !validUserId(requested)) throw new Error("user must be a stable Sleeper user ID or spectator");
  if (roster != null && (!/^\d{1,3}$/.test(roster) || Number(roster) < 1)) throw new Error("Invalid roster ID");
  if (season != null) resolveSeason(season);
  return { userId: requested === "spectator" ? null : requested || (configuredIds.includes(league) ? getConfiguredUsername() || null : null),
    rosterId: roster ? Number(roster) : null, season: season ? Number(season) : null };
}
export function acceptedLeague(id, configuredIds) { return configuredIds.includes(id) || validLeagueId(id); }
