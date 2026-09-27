import { buildDecisionState } from "./decision/build-context.js";
export function createDecisionService(build = buildDecisionState, now = Date.now) {
  const cache = new Map();
  return (league, options = {}) => {
    const key = JSON.stringify([options.provider || "sleeper", league, options.identity && "userId" in options.identity ? options.identity.userId : "installation-default", options.identity?.rosterId ?? null, options.identity?.season ?? null, ...(options.identity?.principal ? [options.identity.principal] : [])]);
    const existing = cache.get(key); if (existing?.expires > now()) return existing.promise;
    const promise = build(league, options);
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: now() + 30000, promise });
    promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
    return promise;
  };
}
/** Server-internal decision state (decision + snapshot + full contexts) for one identity-keyed basis. Never sent to clients. */
export const decisionStateService = createDecisionService();
/** Public decision-support result, projected from the same cached state build as the trade endpoint. */
export const decisionService = (league, options = {}) => decisionStateService(league, options).then(state => state.decision);
