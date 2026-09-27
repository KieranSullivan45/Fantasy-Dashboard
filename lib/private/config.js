import { readFileSync, statSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { ProviderError } from "../providers/contracts.js";
import { rejectCredentials } from "../providers/espn-normalize.js";
import { validateEspnScoringConfig } from "../providers/espn-scoring.js";
import { TOKEN_ENV, validLoopbackToken } from "./loopback.js";

/**
 * Local private mode (ADR 0005). Server-only: private league binding and authorized scoring are read from a file outside
 * the repository, named by ESPN_PRIVATE_CONFIG. Never bundled, committed, logged or returned. Production is unsupported.
 */
export const PRIVATE_CONFIG_VERSION = "espn-private-1";
export const MAX_PRIVATE_CONFIG_BYTES = 1024 * 1024;
const refuse = message => new ProviderError("PRIVATE_CONFIG_INVALID", "espn", `Private ESPN configuration rejected: ${message}`);
const need = (ok, message) => { if (!ok) throw refuse(message); };

/**
 * Private mode is on only when explicitly requested, configured, not on Vercel, and running under the loopback-only
 * private dev server (which sets a fresh per-process token; plain `next dev`/`next start` never enable it).
 */
export function privateModeEnabled(env = process.env) {
  return env.FANTASY_PRIVATE_MODE === "local" && !env.VERCEL && typeof env.ESPN_PRIVATE_CONFIG === "string" && env.ESPN_PRIVATE_CONFIG.trim() !== ""
    && validLoopbackToken(env[TOKEN_ENV]);
}

const real = path => { try { return realpathSync(path); } catch { return resolve(path); } };
/**
 * True when `path` is not inside `root` (absolute, symlinks resolved), so private files cannot be committed by accident.
 * Compared by path segments: only a leading ".." segment (or another drive/root) is outside; "..private" or ".private"
 * directories inside the repository are inside.
 */
export function outsideRepository(path, root = process.cwd()) {
  const rel = relative(real(resolve(root)), real(resolve(path)));
  if (rel === "") return false;
  if (isAbsolute(rel)) return true;
  return rel.split(sep)[0] === "..";
}

/** Reads a private file with size and location checks. Messages never include the path or contents. */
export function readPrivateJson(path, { root = process.cwd(), maxBytes, label, read = readFileSync, stat = statSync } = {}) {
  need(typeof path === "string" && isAbsolute(path), `${label} path must be absolute`);
  need(outsideRepository(path, root), `${label} must be stored outside the repository`);
  let info;
  try { info = stat(path); } catch { throw refuse(`${label} is not readable`); }
  need(info.isFile() && info.size <= maxBytes, `${label} is missing or too large`);
  let value;
  try { value = JSON.parse(read(path, "utf8")); } catch { throw refuse(`${label} is not valid JSON`); }
  return { value, key: `${real(path)}:${info.mtimeMs}:${info.size}` };
}

export function validatePrivateConfig(value, { configPath, root = process.cwd() } = {}) {
  need(value && typeof value === "object" && !Array.isArray(value), "configuration object is required");
  rejectCredentials(value);
  const allowed = new Set(["schema_version", "provider", "league_id", "season", "team_id", "facts_source", "scoring"]);
  need(Object.keys(value).every(k => allowed.has(k)), "configuration has unrecognized fields");
  need(value.schema_version === PRIVATE_CONFIG_VERSION, "unsupported schema version");
  need(value.provider === "espn", "provider must be espn");
  need(typeof value.league_id === "string" && /^\d{1,25}$/.test(value.league_id), "league_id must be a numeric string");
  need(Number.isSafeInteger(value.season) && value.season >= 2010 && value.season <= 2100, "season must be a year");
  need(value.team_id == null || (Number.isSafeInteger(value.team_id) && value.team_id > 0), "team_id must be a positive integer when present");
  const source = value.facts_source;
  need(source && typeof source === "object" && source.kind === "flaim_bundle_file" && typeof source.path === "string" && source.path.trim() !== "", "facts_source must be a flaim_bundle_file");
  const bundlePath = isAbsolute(source.path) ? source.path : resolve(dirname(configPath), source.path);
  need(outsideRepository(bundlePath, root), "the facts bundle must be stored outside the repository");
  const scoring = validateEspnScoringConfig(value.scoring);
  need(scoring.league_id === value.league_id && scoring.season === value.season, "scoring configuration is bound to a different league or season");
  return { league_id: value.league_id, season: value.season, team_id: value.team_id ?? null, bundle_path: bundlePath, scoring };
}

let cached = null;
/** Loads and validates the private configuration; re-validated whenever the file changes. */
export function loadPrivateConfig({ env = process.env, root = process.cwd(), read, stat } = {}) {
  if (!privateModeEnabled(env)) throw new ProviderError("UNSUPPORTED_FEATURE", "espn", "Local private mode is not enabled.");
  const configPath = env.ESPN_PRIVATE_CONFIG.trim();
  const { value, key } = readPrivateJson(configPath, { root, maxBytes: MAX_PRIVATE_CONFIG_BYTES, label: "configuration", read, stat });
  if (cached?.key === key && cached.root === root) return cached.config;
  const config = validatePrivateConfig(value, { configPath, root });
  cached = { key, root, config };
  return config;
}
