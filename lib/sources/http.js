import { parseCsv } from "./csv.js";
import { unavailableSource } from "./contracts.js";
import { createHash } from "node:crypto";

const cache = new Map();
export async function loadCsvSource(source_id, url, { required, ttl = 3600000, fetcher = fetch, now = Date.now() } = {}) {
  const key = `${source_id}:${url}`;
  const existing = fetcher === fetch ? cache.get(key) : null;
  if (existing && existing.expires > now) return existing.promise;
  const promise = (async () => {
    try {
      const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > 15000000) throw new Error("Dataset exceeds size limit");
      const text = await response.text();
      if (text.length > 15000000) throw new Error("Dataset exceeds size limit");
      const parsed = parseCsv(text);
      if (!required.every(field => parsed.headers.includes(field))) throw new Error("Source columns changed");
      if (!parsed.rows.length) throw new Error("Source returned no records");
      return { source_id, status: "available", digest: createHash("sha256").update(text).digest("hex"), fetched_at: new Date(now).toISOString(),
        published_at: response.headers.get("last-modified"), url, data: parsed.rows, warnings: [] };
    } catch (error) { return { ...unavailableSource(source_id, error.message), url }; }
  })();
  if (fetcher === fetch) {
    // In-memory request cache only, not persistent ownership/history storage.
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: now + ttl, promise });
    promise.then(result => { if (result.status !== "available") cache.delete(key); });
  }
  return promise;
}
