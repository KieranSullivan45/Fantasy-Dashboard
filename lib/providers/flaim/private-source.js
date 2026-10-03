import { ProviderError } from "../contracts.js";
import { ESPNProvider } from "../espn.js";
import { loadPrivateConfig } from "../../private/config.js";
import { loadPlayerIds } from "../../normalize/player-ids.js";
import { readSavedFlaimBundle } from "./bundle-file.js";
import { readSavedLeagueFile } from "../espn-file/file-source.js";
import { crossCheckEspnScoring } from "../espn-file/scoring-check.js";

const CROSS_CHECK = {
  consistent: c => ["PROVENANCE", `League-file scoring items agree with the authorized scoring configuration on ${c.compared} verified rule(s); the configuration remains the scoring source. ${c.not_comparable + c.unverified} file scoring item(s) could not be compared and were not used.`],
  not_comparable: c => ["PROVENANCE", `League-file scoring items could not be compared with the authorized scoring configuration; the configuration remains the scoring source. ${c.not_comparable + c.unverified} file scoring item(s) were not used.`],
  unavailable: () => ["PROVENANCE", "The league file carries no scoring items; the authorized scoring configuration was not cross-checked."],
  mismatch: () => ["UNSUPPORTED_FEATURE", "League-file scoring items disagree with the authorized scoring configuration on verified rules; league scoring is disabled until they agree."],
};

/**
 * Local private-mode ESPN provider (ADR 0005, ADR 0012): private config → local facts source → ESPN facts → authorized scoring.
 * The only composition point for private ESPN sources; `ESPNProvider` itself stays source-agnostic. No network access.
 * Sources: a saved Flaim bundle (`flaim_bundle_file`) or a sanitized ESPN league file (`espn_league_file`). League-file
 * scoring items are cross-check evidence only: on a mismatch the authorized configuration is not applied and scoring stays
 * unavailable. A league file has no owner data, so the configured `team_id` is validated but never selects a roster.
 * The public ID crosswalk comes from the existing shared source cache; if it is unavailable, identities stay unresolved.
 */
export function createPrivateEspnProvider({ env = process.env, root = process.cwd(), loadConfig = loadPrivateConfig, readBundle = readSavedFlaimBundle, readLeagueFile = readSavedLeagueFile, loadIds = () => loadPlayerIds(), now = () => Date.now() } = {}) {
  const config = () => loadConfig({ env, root });
  const read = c => c.facts_kind === "espn_league_file" ? readLeagueFile(c.facts_path, { root, now: now() }) : readBundle(c.bundle_path, { root });
  const bound = (facts, c) => {
    if (facts.league.id !== c.league_id || facts.league.season !== c.season) throw new ProviderError("LEAGUE_NOT_FOUND", "espn", c.facts_kind === "espn_league_file" ? "The league file is for a different league or season than the private configuration." : "The saved bundle is for a different league or season than the private configuration.");
  };
  // League-file cross-check per (file content, config content); facts objects stay stable so scored-facts caching holds.
  let checked = null;
  const leagueFile = c => {
    const file = read(c), key = `${file.digest}:${c.revision}`;
    if (checked?.key === key) return checked;
    bound(file.facts, c);
    if (c.team_id != null && !file.facts.teams.some(t => t.id === c.team_id)) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The configured team is not in the league file.");
    if (!c.scoring) { checked = { key, facts: file.facts, mismatch: false }; return checked; }
    const result = crossCheckEspnScoring(file.observedScoring, c.scoring), [code, message] = CROSS_CHECK[result.status](result);
    checked = { key, mismatch: result.status === "mismatch", facts: { ...file.facts, warnings: [...file.facts.warnings, { code, resource: "provider", message }] } };
    return checked;
  };
  const loadFacts = async () => {
    const c = config(), facts = c.facts_kind === "espn_league_file" ? leagueFile(c).facts : read(c).facts;
    bound(facts, c);
    if (c.facts_kind !== "espn_league_file" && c.team_id != null && facts.user_team_id !== c.team_id) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The saved bundle's session team does not match the configured team.");
    return facts;
  };
  // Validates the current private inputs and identifies them; decision caches key on it so no stale result outlives a change.
  const inputRevision = async () => { const c = config(), { digest } = read(c); return `config:${c.revision};${c.facts_kind === "espn_league_file" ? "league_file" : "bundle"}:${digest}`; };
  const loadCrosswalk = async () => { try { const source = await loadIds(); return Array.isArray(source?.data) ? source.data : []; } catch { return []; } };
  const resolveScoringConfig = ({ provider, leagueId, season }) => {
    const c = config();
    if (provider !== "espn" || c.league_id !== String(leagueId) || c.season !== Number(season)) return null;
    if (c.facts_kind === "espn_league_file" && c.scoring && leagueFile(c).mismatch) return null;
    return c.scoring;
  };
  return new ESPNProvider({ loadFacts, loadCrosswalk, resolveScoringConfig, inputRevision, includeOwnPending: true });
}
