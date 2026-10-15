import { createHash } from "node:crypto";
import { ProviderError } from "../contracts.js";
import { espnFactsFromFlaim } from "./espn-map.js";
import { unwrapFlaimResult, checkSession, checkLeagueInfo, checkRoster } from "./schema.js";

/**
 * Live Flaim → ESPN facts for the configured league (ESPN-LIVE-01, ADR 0013). Core resources (authenticated session, exact
 * league info, the current roster of every league team) fail closed. Standings, matchups, available players and recent
 * transactions are optional: a failure leaves that resource absent with a warning, never fabricated. The available-player list
 * is a provider-capped subset per position and stays `complete: false`. Everything goes through the existing Flaim schema
 * checks and `espnFactsFromFlaim(..., { access: "flaim_live" })`. Flaim is the only network peer; nothing is persisted.
 */
export const FREE_AGENT_POSITIONS = Object.freeze(["QB", "RB", "WR", "TE", "K", "D/ST"]);
export const FREE_AGENT_COUNT = 100;
export const TRANSACTION_COUNT = 50;
const OPTIONAL = { standings: "League standings", matchups: "Current matchups", freeAgents: "Available players", transactions: "Recent transactions" };
const notFound = message => new ProviderError("LEAGUE_NOT_FOUND", "espn", message);
const mismatch = message => new ProviderError("MAPPING_INCOMPLETE", "espn", `Live ESPN data via Flaim is inconsistent: ${message}`);
// Flaim throttles bursts of tool calls (each one is an upstream ESPN read), so a league load issues them one at a time.
export const FLAIM_CONCURRENCY = 1;

/** Live `get_user_session` answers flat (`{success: true, allLeagues, currentSeasons, ...}`); other tools wrap in `data`. */
export function sessionPayload(envelope) {
  if (envelope?.success === true && envelope.data === undefined) { const { success, ...session } = envelope; return session; }
  return unwrapFlaimResult(envelope);
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function bounded(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

/** Fetches and maps the configured league. `client` is a Flaim MCP client (`callTool(name, args)`). */
export async function loadFlaimLiveFacts(client, { leagueId, season, teamId = null, now = Date.now } = {}) {
  const base = { platform: "espn", sport: "football", league_id: String(leagueId), season_year: Number(season) };
  client.reset?.();
  const session = checkSession(sessionPayload(await client.callTool("get_user_session", {})));
  const entries = session.allLeagues.filter(l => l.platform === "espn" && (l.sport == null || l.sport === "football") && l.leagueId === String(leagueId) && Number(l.seasonYear) === Number(season));
  if (entries.length === 0) throw notFound("The configured ESPN league and season are not in the authenticated Flaim session.");
  if (entries.length > 1) throw mismatch("the session lists the configured league more than once");
  const info = checkLeagueInfo(unwrapFlaimResult(await client.callTool("get_league_info", base)));
  if (String(info.id) !== String(leagueId) || info.seasonId !== Number(season)) throw notFound("Flaim returned a different league or season than the private configuration.");

  // Every team's current roster is required; any failure or mismatch fails the load closed.
  const rosters = await bounded(info.teams.map(t => t.teamId), FLAIM_CONCURRENCY, async id => {
    const roster = checkRoster(unwrapFlaimResult(await client.callTool("get_roster", { ...base, team_id: String(id) })), "current");
    if (roster.teamId !== id) throw mismatch("a roster answered for a different team than requested");
    return roster;
  });

  const warnings = [];
  const optional = async (key, fn) => { try { return await fn(); } catch { warnings.push({ code: "PROVIDER_UNAVAILABLE", resource: "provider", message: `${OPTIONAL[key]} could not be loaded from Flaim this time; shown as unavailable.` }); return null; } };
  // Sequential like the core calls (see FLAIM_CONCURRENCY); each failure stays local to its resource.
  const [standings, matchups, freeAgents, transactions] = await bounded([
    () => optional("standings", async () => unwrapFlaimResult(await client.callTool("get_standings", base))),
    () => optional("matchups", async () => unwrapFlaimResult(await client.callTool("get_matchups", base))),
    () => optional("freeAgents", async () => {
      const pages = await bounded(FREE_AGENT_POSITIONS, FLAIM_CONCURRENCY, async position => unwrapFlaimResult(await client.callTool("get_free_agents", { ...base, position, count: FREE_AGENT_COUNT })));
      if (!pages.every(p => p && Array.isArray(p.freeAgents))) throw new Error("malformed");
      // A union of per-position capped lists: never a complete pool (espnFactsFromFlaim keeps complete=false).
      return { freeAgents: pages.flatMap(p => p.freeAgents), count: null };
    }),
    () => optional("transactions", async () => unwrapFlaimResult(await client.callTool("get_transactions", { ...base, count: TRANSACTION_COUNT }))),
  ], FLAIM_CONCURRENCY, run => run());
  const payload = { session, leagueInfo: info, rosters, standings, matchups, freeAgents, transactions };
  // An optional resource that contradicts the core league state (for example an available player who is rostered) fails the
  // whole load closed rather than being silently dropped; the next refresh retries.
  const facts = espnFactsFromFlaim(payload, { access: "flaim_live" });
  if (teamId != null && facts.user_team_id !== Number(teamId)) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The authenticated Flaim session's team does not match the configured team.");
  const fetchedAt = new Date(now()).toISOString();
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { facts: { ...facts, provenance: { ...facts.provenance, fetched_at: fetchedAt }, warnings: [...facts.warnings, ...warnings] }, digest, fetchedAt };
}
