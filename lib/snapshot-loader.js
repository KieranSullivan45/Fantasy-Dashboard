// Aborting saves work; the generation guard also handles responses already parsing.
export function createSnapshotLoader(publish, fetcher = fetch) {
  let generation = 0;
  let controller;
  return {
    async load(leagueId) {
      const request = ++generation;
      controller?.abort();
      controller = new AbortController();
      publish({ leagueId, loading: true, error: "", data: null });
      try {
        const response = await fetcher(`/api/snapshot?league=${encodeURIComponent(leagueId)}&compact=0`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Sleeper data");
        if (String(data.league?.league_id) !== String(leagueId)) throw new Error("Snapshot league mismatch");
        if (request === generation) publish({ leagueId, loading: false, error: "", data });
      } catch (error) {
        if (request === generation) publish({ leagueId, loading: false, error: error.message || "Could not load Sleeper data", data: null });
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
