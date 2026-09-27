import { privateModeEnabled } from "./config.js";
import { LOOPBACK_HEADER, TOKEN_ENV, loopbackProofMatches } from "./loopback.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const hostname = value => { try { return new URL(`http://${value}`).hostname; } catch { return null; } };
const loopbackOrigin = value => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && LOOPBACK.has(url.hostname); } catch { return false; } };

/**
 * Local private-mode request guard (ADR 0005). Returns the single local principal, or null when the request may not see
 * private league data. The decisive check is the connection-level loopback proof added by the private dev server
 * (lib/private/loopback.js), which a remote client cannot forge. Host, URL, Origin and Fetch Metadata are defense in
 * depth. A null result keeps today's public behavior, so private mode is never revealed.
 */
export function privateRequest(request, { env = process.env } = {}) {
  if (!privateModeEnabled(env)) return null;
  if (!loopbackProofMatches(request.headers.get(LOOPBACK_HEADER), env[TOKEN_ENV])) return null;
  const host = request.headers.get("host");
  if (!host || !LOOPBACK.has(hostname(host))) return null;
  let url;
  try { url = new URL(request.url); } catch { return null; }
  if (!LOOPBACK.has(url.hostname)) return null;
  const origin = request.headers.get("origin");
  if (origin !== null && !loopbackOrigin(origin)) return null;
  if (request.headers.get("sec-fetch-site") === "cross-site") return null;
  return { principal: "local-owner", mode: "local" };
}

/** Identity for a private ESPN request: the owner comes from the provider session or an explicit roster, never `user=`. */
export function privateIdentity(params, principal) {
  if (params.has("user")) throw new Error("user is not used for private ESPN leagues; the session team or roster= selects the roster");
  const roster = params.get("roster"), season = params.get("season");
  if (roster != null && (!/^\d{1,3}$/.test(roster) || Number(roster) < 1)) throw new Error("Invalid roster ID");
  if (season != null && (!/^\d{4}$/.test(season) || Number(season) < 2010 || Number(season) > 2100)) throw new Error("Invalid season");
  return { userId: null, principal: principal.principal, rosterId: roster ? Number(roster) : null, season: season ? Number(season) : null };
}
