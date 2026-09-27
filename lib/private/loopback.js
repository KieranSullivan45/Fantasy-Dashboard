import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Connection-level loopback proof for local private mode (ADR 0005). The private dev server (`pnpm dev:private`,
 * scripts/dev-private.js) listens on 127.0.0.1 only and, for every incoming connection, removes any client-supplied
 * LOOPBACK_HEADER and adds it back with a random per-process token only when the socket's remote address is loopback.
 * Request headers alone (Host, Origin, Fetch Metadata) can be forged by a remote client; this token cannot.
 */
export const LOOPBACK_HEADER = "x-fantasy-private-loopback";
export const TOKEN_ENV = "FANTASY_LOOPBACK_TOKEN";
export const newLoopbackToken = () => randomBytes(32).toString("hex");
export const validLoopbackToken = token => typeof token === "string" && /^[0-9a-f]{64}$/.test(token);

export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return address === "::1" || /^127(\.\d{1,3}){3}$/.test(v4);
}

/** Server-side: strip forged proofs, then tag genuine loopback connections. Mutates the Node IncomingMessage. */
export function tagLoopbackRequest(req, token) {
  if (!validLoopbackToken(token)) throw new Error("A valid loopback token is required.");
  delete req.headers[LOOPBACK_HEADER];
  const raw = [];
  for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2) if (req.rawHeaders[i].toLowerCase() !== LOOPBACK_HEADER) raw.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
  const loopback = isLoopbackAddress(req.socket?.remoteAddress);
  if (loopback) { req.headers[LOOPBACK_HEADER] = token; raw.push(LOOPBACK_HEADER, token); }
  req.rawHeaders = raw;
  return loopback;
}

/** Route-side: constant-time comparison of the request's proof with this process's token. */
export function loopbackProofMatches(value, token) {
  if (!validLoopbackToken(token) || typeof value !== "string" || value.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
