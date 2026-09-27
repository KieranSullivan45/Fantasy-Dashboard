import { ProviderError } from "../contracts.js";
import { ESPNProvider } from "../espn.js";
import { loadPrivateConfig } from "../../private/config.js";
import { loadPlayerIds } from "../../normalize/player-ids.js";
import { readSavedFlaimBundle } from "./bundle-file.js";

/**
 * Local private-mode ESPN provider (ADR 0005): private config → saved Flaim bundle → ESPN facts → authorized scoring.
 * The only Flaim-aware composition point; `ESPNProvider` itself stays transport-agnostic. No Flaim network access.
 * The public ID crosswalk comes from the existing shared source cache; if it is unavailable, identities stay unresolved.
 */
export function createPrivateEspnProvider({ env = process.env, root = process.cwd(), loadConfig = loadPrivateConfig, readBundle = readSavedFlaimBundle, loadIds = () => loadPlayerIds() } = {}) {
  const config = () => loadConfig({ env, root });
  const loadFacts = async () => {
    const c = config(), { facts } = readBundle(c.bundle_path, { root });
    if (facts.league.id !== c.league_id || facts.league.season !== c.season) throw new ProviderError("LEAGUE_NOT_FOUND", "espn", "The saved bundle is for a different league or season than the private configuration.");
    if (c.team_id != null && facts.user_team_id !== c.team_id) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The saved bundle's session team does not match the configured team.");
    return facts;
  };
  const loadCrosswalk = async () => { try { const source = await loadIds(); return Array.isArray(source?.data) ? source.data : []; } catch { return []; } };
  const resolveScoringConfig = ({ provider, leagueId, season }) => {
    const c = config();
    return provider === "espn" && c.league_id === String(leagueId) && c.season === Number(season) ? c.scoring : null;
  };
  return new ESPNProvider({ loadFacts, loadCrosswalk, resolveScoringConfig, includeOwnPending: true });
}
