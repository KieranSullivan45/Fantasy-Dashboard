import { buildLeagueSnapshot } from "../../sleeper.js";

// Internal full-pool view only. /api/snapshot keeps all v0.2 limits and fields.
export const loadSleeperContext = (leagueId, options = {}) =>
  buildLeagueSnapshot(leagueId, { ...options, freeAgentLimit: Number.MAX_SAFE_INTEGER });
