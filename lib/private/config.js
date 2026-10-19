import { readFileSync, statSync, realpathSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ProviderError } from "../providers/contracts.js";
import { rejectCredentials } from "../providers/espn-normalize.js";
import { validateEspnScoringConfig } from "../providers/espn-scoring.js";
import { TOKEN_ENV, validLoopbackToken } from "./loopback.js";

/**
 * Local private mode (ADR 0005, ADR 0012). Server-only: private league binding and authorized scoring are read from a file outside
 * the repository, named by ESPN_PRIVATE_CONFIG. Never bundled, committed, logged or returned. Production is unsupported.
 */
export const PRIVATE_CONFIG_VERSION = "espn-private-1";
export const MAX_PRIVATE_CONFIG_BYTES = 1024 * 1024;
/** Facts sources: a saved Flaim bundle (ADR 0005), a sanitized ESPN league file (ADR 0012) or live Flaim (ADR 0013). */
const FACTS_SOURCES = new Set(["flaim_bundle_file", "espn_league_file", "flaim_live"]);
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

/**
 * Like `outsideRepository`, for a path that may not exist yet and is about to be created or replaced. The nearest existing
 * ancestor (the path itself when it exists) is resolved through its real location, so a directory symlink or junction that
 * leads into the repository is caught before anything is created. An existing entry that cannot be resolved (a dangling
 * link) is refused.
 */
export function creationOutsideRepository(path, root = process.cwd()) {
  let existing = resolve(path);
  const rest = [];
  for (;;) {
    try { lstatSync(existing); break; } catch {
      const parent = dirname(existing);
      if (parent === existing) return false;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
  let resolved;
  try { resolved = realpathSync(existing); } catch { return false; }
  const rel = relative(real(resolve(root)), join(resolved, ...rest));
  if (rel === "") return false;
  if (isAbsolute(rel)) return true;
  return rel.split(sep)[0] === "..";
}

/**
 * Reads a private file with size and location checks. The cache identity is the SHA-256 of the bytes actually read (never
 * mtime/size), so any content change is detected. Messages never include the path or contents.
 */
export function readPrivateJson(path, { root = process.cwd(), maxBytes, label, read = readFileSync, stat = statSync } = {}) {
  need(typeof path === "string" && isAbsolute(path), `${label} path must be absolute`);
  need(outsideRepository(path, root), `${label} must be stored outside the repository`);
  let info;
  try { info = stat(path); } catch { throw refuse(`${label} is not readable`); }
  need(info.isFile() && info.size <= maxBytes, `${label} is missing or too large`);
  let bytes;
  try { bytes = read(path); } catch { throw refuse(`${label} is not readable`); }
  need(bytes.length <= maxBytes, `${label} is missing or too large`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  let value;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { throw refuse(`${label} is not valid JSON`); }
  return { value, digest, key: `${real(path)}:${digest}` };
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
  need(source && typeof source === "object" && FACTS_SOURCES.has(source.kind), "facts_source must be a flaim_bundle_file, an espn_league_file or flaim_live");
  const resolvePath = p => isAbsolute(p) ? p : resolve(dirname(configPath), p);
  let factsPath = null, authPath = null;
  if (source.kind === "flaim_live") {
    // Live Flaim reads league facts over the network; the config names only the local authorization file (never its contents).
    need(Object.keys(source).every(k => ["kind", "auth_path"].includes(k)) && typeof source.auth_path === "string" && source.auth_path.trim() !== "", "flaim_live needs only an auth_path");
    authPath = resolvePath(source.auth_path);
    need(creationOutsideRepository(authPath, root), "the Flaim authorization file must be stored outside the repository");
  } else {
    need(typeof source.path === "string" && source.path.trim() !== "", "facts_source must name a path");
    factsPath = resolvePath(source.path);
    need(outsideRepository(factsPath, root), "the facts source must be stored outside the repository");
  }
  // A league file or live Flaim can load without scoring (scoring stays unavailable); a saved Flaim bundle still requires it.
  const scoring = source.kind !== "flaim_bundle_file" && value.scoring == null ? null : validateEspnScoringConfig(value.scoring);
  need(scoring === null || (scoring.league_id === value.league_id && scoring.season === value.season), "scoring configuration is bound to a different league or season");
  return { league_id: value.league_id, season: value.season, team_id: value.team_id ?? null, facts_kind: source.kind, facts_path: factsPath, auth_path: authPath,
    bundle_path: source.kind === "flaim_bundle_file" ? factsPath : null, scoring };
}

let cached = null;
/** Loads and validates the private configuration; re-validated whenever its content changes. `revision` is the content digest. */
export function loadPrivateConfig({ env = process.env, root = process.cwd(), read, stat } = {}) {
  if (!privateModeEnabled(env)) throw new ProviderError("UNSUPPORTED_FEATURE", "espn", "Local private mode is not enabled.");
  const configPath = env.ESPN_PRIVATE_CONFIG.trim();
  const { value, key, digest } = readPrivateJson(configPath, { root, maxBytes: MAX_PRIVATE_CONFIG_BYTES, label: "configuration", read, stat });
  if (cached?.key === key && cached.root === root) return cached.config;
  const config = { ...validatePrivateConfig(value, { configPath, root }), revision: digest };
  cached = { key, root, config };
  return config;
}
