import { buildDecisionContext } from "./decision/build-context.js";
export function createDecisionService(build = buildDecisionContext, now = Date.now) {
  const cache = new Map();
  return (league, options = {}) => {
    const key = JSON.stringify([league, options.identity && "userId" in options.identity ? options.identity.userId : "installation-default", options.identity?.rosterId ?? null, options.identity?.season ?? null]);
    const existing = cache.get(key); if (existing?.expires > now()) return existing.promise;
    const promise = build(league, options);
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: now() + 30000, promise });
    promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
    return promise;
  };
}
export const decisionService = createDecisionService();
