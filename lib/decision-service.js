import { buildDecisionState } from "./decision/build-context.js";
import { getProvider } from "./providers/index.js";
/**
 * Bounded 30 s decision-state cache keyed on provider, league, identity, principal and input revision. With `pin`, a request
 * that brings no revision first pins the provider's committed inputs (ADR 0008): the revision joins the key BEFORE lookup and
 * the build runs on exactly that bundle, so a newer promoted revision never reuses, or is satisfied by, an older build.
 */
export function createDecisionService(build = buildDecisionState, now = Date.now, pin = null) {
  const cache = new Map();
  const cached = (league, options) => {
    const key = JSON.stringify([options.provider || "sleeper", league, options.identity && "userId" in options.identity ? options.identity.userId : "installation-default", options.identity?.rosterId ?? null, options.identity?.season ?? null, ...(options.identity?.principal ? [options.identity.principal] : []), ...(options.revision ? [options.revision] : [])]);
    const existing = cache.get(key); if (existing?.expires > now()) return existing.promise;
    const promise = build(league, options);
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: now() + 30000, promise });
    promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
    return promise;
  };
  return (league, options = {}) => {
    if (!pin || options.revision || options.providerAdapter || options.loadLeague) return cached(league, options);
    return Promise.resolve(pin(league, options)).then(pinned => cached(league, pinned ? { ...options, providerAdapter: pinned.adapter, revision: pinned.revision } : options));
  };
}
/** Public Sleeper builds pin the committed Sleeper input revision; other providers keep their own revision handling. */
export const pinSleeperInputs = (league, options = {}) => (options.provider || "sleeper") === "sleeper" ? getProvider("sleeper").pinInputs(league) : null;
/** Server-internal decision state (decision + snapshot + full contexts) for one identity-keyed basis. Never sent to clients. */
export const decisionStateService = createDecisionService(buildDecisionState, Date.now, pinSleeperInputs);
/** Public decision-support result, projected from the same cached state build as the trade endpoint. */
export const decisionService = (league, options = {}) => decisionStateService(league, options).then(state => state.decision);
