// The player catalog exceeds Next's 2 MB data-cache entry limit.
// Coalesce requests and keep one successful catalog per warm server process for 24 hours.
export function createPlayerCache(ttl = 86400000) {
  let cached = null;
  return (loader, now = Date.now()) => {
    if (cached && cached.expires > now) return cached.promise;
    const entry = { expires: now + ttl, promise: null };
    entry.promise = Promise.resolve().then(loader).then(data => {
      if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) throw new Error("Invalid player catalog");
      return data;
    }).catch(error => { if (cached === entry) cached = null; throw error; });
    cached = entry;
    return entry.promise;
  };
}
