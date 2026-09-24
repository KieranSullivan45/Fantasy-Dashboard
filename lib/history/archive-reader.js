import { archiveConfig } from "../config.js";
const cache = new Map();
export async function readArchiveJson(path, { fetcher = fetch } = {}) {
  if (!/^[a-zA-Z0-9_./-]+\.json$/.test(path) || path.includes("..")) throw new Error("Invalid archive path");
  const { repository, branch } = archiveConfig(), url = `https://raw.githubusercontent.com/${repository}/${branch}/data/${path}`;
  const cached = cache.get(url); if (fetcher === fetch && cached?.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    try { const r = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`Archive HTTP ${r.status}`);
      const text = await r.text(); if (text.length > 3000000) throw new Error("Archive JSON bound exceeded"); return { status: "available", data: JSON.parse(text), url }; }
    catch (e) { return { status: "unavailable", data: null, url, warning: e.message }; }
  })();
  if (fetcher === fetch) { if (cache.size > 50) cache.clear(); cache.set(url, { expires: Date.now() + 300000, promise }); }
  return promise;
}
export const loadMarketHistory = season => readArchiveJson(`market/${season}.json`);
