// Local ESPN league-file import (ESPN-FILE-01, ADR 0012): `pnpm espn:import <file> [--config <private-config.json>]`.
// Validates a sanitized `espn-league-file-1` file against the private configuration (ESPN_PRIVATE_CONFIG by default) and
// only then installs it, atomically, at the configuration's `facts_source.path` (outside the repository). No network.
// Output is a redacted summary: counts, verdicts and warning codes only, never names, ids, paths or file contents.
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ProviderError } from "../lib/providers/contracts.js";
import { readPrivateJson, validatePrivateConfig, MAX_PRIVATE_CONFIG_BYTES } from "../lib/private/config.js";
import { installLeagueFile } from "../lib/providers/espn-file/file-source.js";
import { crossCheckEspnScoring } from "../lib/providers/espn-file/scoring-check.js";
import { snapshotFromEspnFacts } from "../lib/providers/espn-normalize.js";

const USAGE = "Usage: pnpm espn:import <league-file.json> [--config <private-config.json>] (or set ESPN_PRIVATE_CONFIG)";
const fail = (message, code = 1) => { process.stderr.write(`${message}\n`); process.exit(code); };

export function importLeagueFile(argv, { env = process.env, root = process.cwd(), now = Date.now() } = {}) {
  const args = [...argv], at = args.indexOf("--config");
  const configArg = at >= 0 ? args.splice(at, 2)[1] : null;
  if (args.length !== 1 || (at >= 0 && !configArg)) return { exit: 2, lines: [USAGE] };
  const configPath = configArg ?? env.ESPN_PRIVATE_CONFIG?.trim();
  if (!configPath || !isAbsolute(configPath)) return { exit: 2, lines: ["Import refused: the private configuration path must be absolute (--config or ESPN_PRIVATE_CONFIG)."] };
  try {
    const { value } = readPrivateJson(configPath, { root, maxBytes: MAX_PRIVATE_CONFIG_BYTES, label: "configuration" });
    const config = validatePrivateConfig(value, { configPath, root });
    if (config.facts_kind !== "espn_league_file") return { exit: 1, lines: ["Import refused: the private configuration's facts_source.kind is not espn_league_file."] };
    let check = null;
    const mapped = installLeagueFile(resolve(args[0]), config.facts_path, { root, now, validate: ({ facts, observedScoring }) => {
      if (facts.league.id !== config.league_id || facts.league.season !== config.season) throw new ProviderError("LEAGUE_NOT_FOUND", "espn", "The league file is for a different league or season than the private configuration.");
      if (config.team_id != null && !facts.teams.some(t => t.id === config.team_id)) throw new ProviderError("PRIVATE_CONFIG_INVALID", "espn", "The configured team is not in the league file.");
      check = config.scoring ? crossCheckEspnScoring(observedScoring, config.scoring) : null;
    } });
    const { facts } = mapped, snapshot = snapshotFromEspnFacts(facts);
    const entries = facts.teams.reduce((n, t) => n + t.entries.length, 0), finals = facts.matchups.filter(m => m.final).length;
    const codes = [...new Set(snapshot.warnings.map(w => w.code))].sort();
    return { exit: 0, lines: [
      "ESPN league file accepted and installed (previous file kept as .prev).",
      `Captured: ${facts.provenance.captured_at}`,
      `Teams: ${facts.teams.length}; roster entries: ${entries}`,
      `Lineup slots: ${snapshot.league.roster_positions.length}; unsupported slots: ${snapshot.coverage.unsupported_slots.length}`,
      `Matchups: ${facts.matchups.length} (final: ${finals})`,
      `Available players: ${facts.available ? `observed subset of ${facts.available.players.length}, never complete` : "not included"}`,
      `Scoring: ${!config.scoring ? "no authorized configuration; scoring unavailable" : `authorized configuration; file cross-check ${check.status} (compared ${check.compared}, mismatched ${check.mismatched}, not compared ${check.not_comparable + check.unverified})${check.status === "mismatch" ? "; scoring will be unavailable" : ""}`}`,
      `Warning codes: ${codes.join(", ") || "none"}`,
      "Roster selection: pass roster=<team id> explicitly; the configured team is validated only.",
    ] };
  } catch (error) {
    // ProviderError messages never echo values or paths; anything else is reported generically.
    return { exit: 1, lines: [error instanceof ProviderError ? `Import refused (${error.code}): ${error.message}` : "Import failed: the file could not be read or installed."] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { exit, lines } = importLeagueFile(process.argv.slice(2));
  if (exit) fail(lines.join("\n"), exit); else process.stdout.write(`${lines.join("\n")}\n`);
}
