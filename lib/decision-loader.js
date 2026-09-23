import { decisionBasis } from "./decision/basis.js";
export function createDecisionLoader(publish, fetcher = fetch) {
  let generation = 0, controller;
  return {
    async load(snapshot) {
      const request = ++generation;
      controller?.abort(); controller = new AbortController();
      const basis = decisionBasis(snapshot);
      publish({ basis, loading: true, error: "", data: null });
      try {
        const response = await fetcher(`/api/decision-support?league=${encodeURIComponent(snapshot.league.league_id)}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Decision support unavailable");
        if (data.basis !== basis) throw new Error("League state changed while loading decision support. Refresh to synchronize.");
        if (request === generation) publish({ basis, loading: false, error: "", data });
      } catch (error) {
        if (request === generation) publish({ basis, loading: false, error: error.message, data: null });
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
