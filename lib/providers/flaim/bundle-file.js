import { readFileSync, statSync } from "node:fs";
import { ProviderError } from "../contracts.js";
import { rejectCredentials } from "../espn-normalize.js";
import { readPrivateJson } from "../../private/config.js";
import { espnFactsFromFlaim } from "./espn-map.js";
import { unwrapFlaimResult } from "./schema.js";

/**
 * Saved Flaim bundle (local private mode, ADR 0005): the tool results of one capture, stored outside the repository.
 * Server-only; no network. The file is re-read only when it changes.
 */
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const KEYS = new Set(["_fixture", "captured_at", "session", "leagueInfo", "rosters", "historicalRosters", "standings", "matchups", "freeAgents", "transactions", "draft"]);
const refuse = message => new ProviderError("INVALID_IMPORT", "espn", `Saved ESPN bundle rejected: ${message}`);

/** Saved bundle object (tool envelopes) → ESPN facts with `access: "flaim_saved_bundle"`. */
export function espnFactsFromSavedBundle(saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || !Object.keys(saved).every(k => KEYS.has(k))) throw refuse("unexpected structure");
  rejectCredentials(saved);
  const one = key => saved[key] == null ? null : unwrapFlaimResult(saved[key]);
  const many = key => { if (saved[key] == null) return []; if (!Array.isArray(saved[key])) throw refuse(`${key} must be a list`); return saved[key].map(unwrapFlaimResult); };
  const session = one("session");
  const capturedAt = typeof saved.captured_at === "string" ? saved.captured_at : typeof session?.currentDate === "string" ? session.currentDate : null;
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) throw refuse("a capture time is required");
  return espnFactsFromFlaim({ session, leagueInfo: one("leagueInfo"), rosters: many("rosters"), historicalRosters: many("historicalRosters"), standings: one("standings"),
    matchups: one("matchups"), freeAgents: one("freeAgents"), transactions: one("transactions"), draft: one("draft") }, { access: "flaim_saved_bundle", capturedAt });
}

let cached = null;
/** Reads a saved bundle file (outside the repository, size-limited) → `{ facts, key }`; unchanged files reuse the facts. */
export function readSavedFlaimBundle(path, { root = process.cwd(), read = readFileSync, stat = statSync } = {}) {
  const { value, key } = readPrivateJson(path, { root, maxBytes: MAX_BUNDLE_BYTES, label: "facts bundle", read, stat });
  if (cached?.key === key) return cached;
  cached = { key, facts: espnFactsFromSavedBundle(value) };
  return cached;
}
