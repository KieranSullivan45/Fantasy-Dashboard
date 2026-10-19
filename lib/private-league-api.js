// GET /api/private-league (ESPN-LIVE-01, ADR 0013): lets the local dashboard find the configured private ESPN league so the
// owner never types it. Answers only a guarded loopback request in local private mode; every other request gets the same
// `available: false` answer (no console error in public mode), so public deployments never reveal whether private mode exists. Returns the league binding and source kind only: no facts, paths or tokens.
import { privateRequest } from "./private/guard.js";
import { loadPrivateConfig } from "./private/config.js";

const PRIVATE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const SOURCES = { flaim_live: "live_flaim", flaim_bundle_file: "saved_flaim_bundle", espn_league_file: "saved_league_file" };

export function handlePrivateLeagueRequest(request, { loadConfig = loadPrivateConfig } = {}) {
  if (!privateRequest(request)) return Response.json({ schema_version: "private-league-1", available: false }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  let config;
  try { config = loadConfig(); } catch { return Response.json({ error: "The private ESPN configuration is invalid; see docs/providers/espn.md." }, { status: 503, headers: PRIVATE }); }
  return Response.json({ schema_version: "private-league-1", available: true, provider: "espn", league_id: config.league_id, season: config.season, source: SOURCES[config.facts_kind] }, { headers: PRIVATE });
}
