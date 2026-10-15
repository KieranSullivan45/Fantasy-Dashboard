import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join } from "node:path";
import { creationOutsideRepository, outsideRepository } from "../../private/config.js";
import { FLAIM_MCP_URL, FLAIM_ORIGIN, FlaimAuthError, authRequired } from "./oauth.js";

/**
 * Local Flaim authorization file (`flaim-auth-1`, ESPN-LIVE-01, ADR 0013). Lives outside the repository at the path the private
 * config names. Holds the registered public client id, Flaim's token endpoint, and the current access/refresh tokens. Never
 * logged, printed, returned to a browser or used in cache keys. Writes are atomic (temp file beside it, flush, rename) with
 * owner-only permissions where the platform supports them, so a rotated refresh token is never half-written. Symlinks are refused.
 */
export const FLAIM_AUTH_VERSION = "flaim-auth-1";
export const MAX_AUTH_BYTES = 64 * 1024;
const KEYS = ["schema_version", "issuer", "resource", "client_id", "token_endpoint", "access_token", "access_expires_at", "refresh_token", "scope", "updated_at"];
const refuse = message => new FlaimAuthError("PRIVATE_CONFIG_INVALID", `Flaim authorization file rejected: ${message}`);
const str = (v, max = 8192) => typeof v === "string" && v.length > 0 && v.length <= max;

function checkPath(path, root, creating) {
  if (typeof path !== "string" || !isAbsolute(path)) throw refuse("its path must be absolute");
  if (!(creating ? creationOutsideRepository(path, root) : outsideRepository(path, root))) throw refuse("it must be stored outside the repository");
  let info = null;
  try { info = lstatSync(path); } catch { /* not created yet */ }
  if (info && !info.isFile()) throw refuse("it must be a regular file (links are not followed)");
  return info;
}

export function validateAuth(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !KEYS.includes(k))) throw refuse("unexpected structure");
  if (value.schema_version !== FLAIM_AUTH_VERSION || value.issuer !== FLAIM_ORIGIN || value.resource !== FLAIM_MCP_URL) throw refuse("unsupported version or issuer");
  let endpoint = null;
  try { endpoint = new URL(value.token_endpoint); } catch { /* invalid */ }
  if (!endpoint || endpoint.protocol !== "https:" || endpoint.origin !== FLAIM_ORIGIN) throw refuse("the token endpoint must be on Flaim's origin");
  if (!str(value.client_id, 512) || !str(value.access_token) || !str(value.refresh_token) || !Number.isFinite(Date.parse(value.access_expires_at))) throw refuse("missing token fields");
  return value;
}

/** Reads and validates the authorization file. Missing → AUTH_REQUIRED (reconnect); malformed → PRIVATE_CONFIG_INVALID. */
export function readFlaimAuth(path, { root = process.cwd() } = {}) {
  const info = checkPath(path, root, false);
  if (!info) throw authRequired("No Flaim authorization is stored yet.");
  if (info.size > MAX_AUTH_BYTES) throw refuse("it is too large");
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw refuse("it is not readable JSON"); }
  return validateAuth(value);
}

/** Atomically writes the authorization file (owner-only mode on POSIX). The previous version is replaced, never kept. */
export function writeFlaimAuth(path, auth, { root = process.cwd(), now = Date.now } = {}) {
  const value = validateAuth({ ...auth, schema_version: FLAIM_AUTH_VERSION, issuer: FLAIM_ORIGIN, resource: FLAIM_MCP_URL, updated_at: new Date(now()).toISOString() });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  checkPath(path, root, true);
  if (!creationOutsideRepository(temp, root)) throw refuse("it must be stored outside the repository");
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_AUTH_BYTES) throw refuse("it is too large");
  let fd = null;
  try {
    fd = openSync(temp, "wx", 0o600); writeSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = null;
    renameSync(temp, path);
  } catch {
    if (fd !== null) try { closeSync(fd); } catch { /* already closed */ }
    rmSync(temp, { force: true });
    throw refuse("it could not be written");
  }
  return value;
}
