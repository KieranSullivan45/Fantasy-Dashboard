import { decisionBasis } from "./decision/basis.js";
/** Request body for POST /api/trade: the dashboard's league identity (as the decision loader sends it), its basis and player ids only. */
export function tradeRequestBody(snapshot, picks) {
  const body = { league: String(snapshot.league.league_id), basis: decisionBasis(snapshot), proposal: { horizon: "next_game",
    sides: picks.map(({ rosterId, playerIds }) => ({ roster_id: rosterId, sends: playerIds.map(id => ({ type: "player", id: String(id) })) })) } };
  if (snapshot.identity) body.user = snapshot.identity.provider_user_id || "spectator";
  if (snapshot.identity?.mode === "selected_roster") body.roster = String(snapshot.my_roster.roster_id);
  if (snapshot.identity?.provider && snapshot.identity.provider !== "sleeper") body.provider = snapshot.identity.provider;
  return body;
}
/** Lazy trade evaluation with the same stale-response guards as the snapshot/decision loaders (generation counter + abort). */
export function createTradeLoader(publish, fetcher = fetch) {
  let generation = 0, controller;
  return {
    async load(snapshot, picks, key) {
      const request = ++generation;
      controller?.abort(); controller = new AbortController();
      const basis = decisionBasis(snapshot);
      publish({ basis, key, loading: true, error: "", data: null });
      try {
        const response = await fetcher("/api/trade", { method: "POST", signal: controller.signal, cache: "no-store",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(tradeRequestBody(snapshot, picks)) });
        const data = await response.json();
        if (data?.schema_version !== "trade-1") throw new Error(data?.error || "Trade evaluation unavailable");
        if (data.basis !== null && data.basis !== basis) throw new Error("League state changed while evaluating. Refresh to synchronize.");
        if (request === generation) publish({ basis, key, loading: false, error: "", data });
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (request === generation) publish({ basis, key, loading: false, error: error.message || "Trade evaluation unavailable", data: null });
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
