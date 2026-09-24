// Aborting saves work; the generation guard also handles responses already parsing.
export const selectionKey = (leagueId, identity = {}) => JSON.stringify([leagueId, identity.userId ?? null, identity.rosterId ?? null, identity.season ?? null]);
export function createSnapshotLoader(publish, fetcher = fetch) {
  let generation = 0;
  let controller;
  return {
    async load(leagueId, identity = {}) {
      const request = ++generation;
      controller?.abort();
      controller = new AbortController();
      const key = selectionKey(leagueId, identity);
      publish({ leagueId, selectionKey: key, loading: true, error: "", data: null });
      try {
        const params = new URLSearchParams({ league: leagueId, compact: "0" });
        if ("userId" in identity) params.set("user", identity.userId || "spectator");
        if (identity.rosterId) params.set("roster", String(identity.rosterId));
        if (identity.season) params.set("season", String(identity.season));
        const response = await fetcher(`/api/snapshot?${params}`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Sleeper data");
        if (String(data.league?.league_id) !== String(leagueId)) throw new Error("Snapshot league mismatch");
        if (request === generation) publish({ leagueId, selectionKey: key, loading: false, error: "", data });
      } catch (error) {
        if (request === generation) publish({ leagueId, selectionKey: key, loading: false, error: error.message || "Could not load Sleeper data", data: null });
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
