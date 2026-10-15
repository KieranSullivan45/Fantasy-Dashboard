import { ProviderError } from "../contracts.js";
import { ESPNProvider } from "../espn.js";
import { loadPrivateConfig } from "../../private/config.js";
import { loadPlayerIds } from "../../normalize/player-ids.js";
import { readSavedFlaimBundle } from "./bundle-file.js";
import { readSavedLeagueFile } from "../espn-file/file-source.js";
import { crossCheckEspnScoring, crossCheckAllowsScoring } from "../espn-file/scoring-check.js";
import { createFlaimMcpClient } from "./mcp-client.js";
import { loadFlaimLiveFacts } from "./live-source.js";
import { authGeneration, readFlaimAuth } from "./auth-store.js";
import { createHash } from "node:crypto";

/** Live Flaim facts are reused for this long (bounded Flaim traffic); a manual refresh may reload sooner, after the cooldown. */
export const LIVE_TTL_MS = 2 * 60 * 1000;
export const LIVE_MANUAL_COOLDOWN_MS = 10 * 1000;

const CROSS_CHECK = {
  consistent: c => ["PROVENANCE", `League-file scoring items explicitly agree with the authorized scoring configuration on all ${c.compared} comparable rule(s); the configuration remains the scoring source. ${c.not_comparable + c.unverified} file scoring item(s) could not be compared and were not used.`],
  incomplete: c => ["UNSUPPORTED_FEATURE", `League-file scoring items omit ${c.missing} comparable rule(s); an omitted rule's value is unknown, so agreement cannot be shown and league scoring is disabled.`],
  unavailable: () => ["PROVENANCE", "The league file carries no scoring section, so no file cross-check occurred; the authorized scoring configuration remains the scoring source."],
  mismatch: () => ["UNSUPPORTED_FEATURE", "League-file scoring items disagree with the authorized scoring configuration on verified rules; league scoring is disabled until they agree."],
};

/**
 * Input revision of one committed live fact set (ADR 0013): a hash over (config revision, auth file, authorization generation,
 * facts digest). It changes whenever any of them changes and carries no token, auth-file bytes or payload content. Live facts
 * carry it in `provenance.input_revision`, so the snapshot's `coverage.input_revision` (and so the decision basis) names
 * exactly the facts it was built from.
 */
const liveRevision = (key, digest) => `espn-live:${createHash("sha256").update(JSON.stringify([key, digest])).digest("hex")}`;

/**
 * Local private-mode ESPN provider (ADR 0005, ADR 0012): private config → local facts source → ESPN facts → authorized scoring.
 * The only composition point for private ESPN sources; `ESPNProvider` itself stays source-agnostic. No network access.
 * Sources: a saved Flaim bundle (`flaim_bundle_file`), a sanitized ESPN league file (`espn_league_file`), or live Flaim
 * (`flaim_live`, ADR 0013: the only source with network access, to Flaim only, cached in memory for LIVE_TTL_MS). League-file
 * scoring items are corroboration only: on a mismatch or incomplete evidence the authorized configuration is not applied and
 * scoring stays unavailable. A league file has no owner data, so the configured `team_id` is validated but never selects a roster.
 * The public ID crosswalk comes from the existing shared source cache; if it is unavailable, identities stay unresolved.
 */
export function createPrivateEspnProvider({ env = process.env, root = process.cwd(), loadConfig = loadPrivateConfig, readBundle = readSavedFlaimBundle, readLeagueFile = readSavedLeagueFile, loadIds = () => loadPlayerIds(), now = () => Date.now(),
  createClient = authPath => createFlaimMcpClient({ authPath, root }), loadLive = loadFlaimLiveFacts,
  readGeneration = authPath => authGeneration(readFlaimAuth(authPath, { root })) } = {}) {
  const config = () => loadConfig({ env, root });
  // Live state is per process and per (config revision, auth file, authorization generation): a changed config never reuses
  // another binding's facts, and a reconnect (new generation, possibly another account) never reuses the previous
  // authorization's facts, while an ordinary token rotation (same generation) keeps them. Payloads stay in memory only.
  let live = null, inflight = null, client = null;
  const liveKey = c => JSON.stringify([c.revision, c.auth_path, readGeneration(c.auth_path)]);
  const fetchLive = (c, key) => {
    if (inflight?.key === key) return inflight.promise;
    if (client?.key !== key) client = { key, value: createClient(c.auth_path) };
    const promise = loadLive(client.value, { leagueId: c.league_id, season: c.season, teamId: c.team_id, now })
      .then(result => {
        // The authorization was replaced while loading: these facts may belong to either connection, so never commit them.
        if (liveKey(c) !== key) throw new ProviderError("PROVIDER_UNAVAILABLE", "espn", "The Flaim authorization changed while the league was loading; load it again.");
        const revision = liveRevision(key, result.digest);
        const loaded = { key, ...result, facts: { ...result.facts, provenance: { ...result.facts.provenance, input_revision: revision } }, revision, at: now() };
        if (inflight?.promise === promise) live = loaded;
        return loaded;
      })
      .finally(() => { if (inflight?.promise === promise) inflight = null; });
    inflight = { key, promise };
    return promise;
  };
  const liveFacts = async (c, maxAge = LIVE_TTL_MS) => { const key = liveKey(c); if (live && live.key !== key) live = null; return live && now() - live.at < maxAge ? live : fetchLive(c, key); };
  const read = c => c.facts_kind === "espn_league_file" ? readLeagueFile(c.facts_path, { root, now: now() }) : readBundle(c.bundle_path, { root });
  const bound = (facts, c) => {
    if (facts.league.id !== c.league_id || facts.league.season !== c.season) throw new ProviderError("LEAGUE_NOT_FOUND", "espn", c.facts_kind === "espn_league_file" ? "The league file is for a different league or season than the private configuration." : "The saved bundle is for a different league or season than the private configuration.");
  };
  // League-file cross-check per (file content, config content); facts objects stay stable so scored-facts caching holds.
  // Each checked facts object records the verdict and the config revision it was checked against, so scoring is decided
  // for exactly the facts being scored, never by a later re-read of the file (which may have been replaced meanwhile).
  let checked = null;
  const verdicts = new WeakMap();
  const leagueFile = c => {
    const file = read(c), key = `${file.digest}:${c.revision}`;
    if (checked?.key === key) return checked;
    bound(file.facts, c);
    if (c.team_id != null && !file.facts.teams.some(t => t.id === c.team_id)) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The configured team is not in the league file.");
    if (!c.scoring) { checked = { key, facts: { ...file.facts } }; verdicts.set(checked.facts, { allows: false, revision: c.revision }); return checked; }
    const result = crossCheckEspnScoring(file.observedScoring, c.scoring), [code, message] = CROSS_CHECK[result.status](result);
    checked = { key, facts: { ...file.facts, warnings: [...file.facts.warnings, { code, resource: "provider", message }] } };
    verdicts.set(checked.facts, { allows: crossCheckAllowsScoring(result), revision: c.revision });
    return checked;
  };
  const loadFacts = async () => {
    const c = config();
    if (c.facts_kind === "flaim_live") { const { facts } = await liveFacts(c); bound(facts, c); return facts; }
    const facts = c.facts_kind === "espn_league_file" ? leagueFile(c).facts : read(c).facts;
    bound(facts, c);
    if (c.facts_kind !== "espn_league_file" && c.team_id != null && facts.user_team_id !== c.team_id) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The saved bundle's session team does not match the configured team.");
    return facts;
  };
  // Validates the current private inputs and identifies them; decision caches key on it so no stale result outlives a change.
  const inputRevision = async () => {
    const c = config();
    if (c.facts_kind === "flaim_live") return (await liveFacts(c)).revision;
    const { digest } = read(c); return `config:${c.revision};${c.facts_kind === "espn_league_file" ? "league_file" : "bundle"}:${digest}`;
  };
  /**
   * Explicit or automatic refresh (POST /api/refresh, private path). Live Flaim reloads when the held facts are older than the
   * manual cooldown ("manual") or the TTL ("due"); file sources are re-read whenever their content changes, so nothing to do.
   */
  const refresh = async ({ mode = "manual" } = {}) => {
    const c = config();
    if (c.facts_kind !== "flaim_live") return { reloaded: false };
    const previous = live?.key === liveKey(c) ? live.revision : null;
    const result = await liveFacts(c, mode === "manual" ? LIVE_MANUAL_COOLDOWN_MS : LIVE_TTL_MS);
    return { reloaded: true, changed: previous !== null && previous !== result.revision, fetched_at: result.fetchedAt, input_revision: result.revision, previous_input_revision: previous };
  };
  const loadCrosswalk = async () => { try { const source = await loadIds(); return Array.isArray(source?.data) ? source.data : []; } catch { return []; } };
  const resolveScoringConfig = ({ provider, leagueId, season, facts }) => {
    const c = config();
    if (provider !== "espn" || c.league_id !== String(leagueId) || c.season !== Number(season)) return null;
    if (c.facts_kind === "espn_league_file") {
      // Fail closed unless these exact facts were cross-checked against this exact configuration and allowed it.
      const verdict = verdicts.get(facts);
      if (!verdict || !verdict.allows || verdict.revision !== c.revision) return null;
    }
    return c.scoring;
  };
  return new ESPNProvider({ loadFacts, loadCrosswalk, resolveScoringConfig, inputRevision, refresh, includeOwnPending: true });
}
