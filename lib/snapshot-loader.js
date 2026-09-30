// Aborting saves work; the generation guard also handles responses already parsing.
export const selectionKey = (leagueId, identity = {}) => JSON.stringify([leagueId, identity.userId ?? null, identity.rosterId ?? null, identity.season ?? null]);
const REVISIONS_KEPT = 20;
export const REVISION_MISMATCH = "The server answered with a different sync of this league than the one already shown, so it was not used. Sync again to update.";
const retryHint = seconds => seconds > 0 ? ` Retry available in ${seconds} s.` : "";
function identityFields(identity) {
  const fields = {};
  if ("userId" in identity) fields.user = identity.userId || "spectator";
  if (identity.rosterId) fields.roster = String(identity.rosterId);
  if (identity.season) fields.season = String(identity.season);
  return fields;
}
/**
 * `load` is a selection change: old data is cleared so it is never shown as the new selection's. `refresh` is the same
 * selection (POST /api/refresh): current data stays visible, a failure keeps it (last-known-good) with a retryable error.
 * Both share one generation counter + AbortController, so a late response of any kind cannot overwrite newer state.
 */
export function createSnapshotLoader(publish, fetcher = fetch, now = Date.now) {
  let generation = 0, controller, current = null;
  // Latest committed revision seen per selection: later GETs name it (`rev`) so a stale shared-cache copy is not reused.
  const revisions = new Map();
  const emit = state => { current = state; publish(state); };
  const remember = (key, data) => {
    const revision = data?.coverage?.input_revision;
    if (typeof revision !== "string") return;
    revisions.delete(key); revisions.set(key, revision);
    if (revisions.size > REVISIONS_KEPT) revisions.delete(revisions.keys().next().value);
  };
  const begin = () => { const request = ++generation; controller?.abort(); controller = new AbortController(); return request; };
  return {
    async load(leagueId, identity = {}) {
      const request = begin();
      const key = selectionKey(leagueId, identity);
      // Same-selection data is kept aside (not shown while loading) so a revision mismatch can fall back to it.
      const retained = current?.selectionKey === key ? current.data : null, retainedAt = retained ? current.receivedAt : null;
      emit({ leagueId, selectionKey: key, loading: true, refreshing: false, error: "", refreshError: "", data: null, receivedAt: null });
      try {
        const params = new URLSearchParams({ league: leagueId, compact: "0", ...identityFields(identity) });
        const rev = revisions.get(key);
        if (rev) params.set("rev", rev);
        const response = await fetcher(`/api/snapshot?${params}`, {
          cache: "no-store", signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Sleeper data");
        if (String(data.league?.league_id) !== String(leagueId)) throw new Error("Snapshot league mismatch");
        if (request !== generation) return;
        // Downgrade guard: a read that named revision R never accepts another revision (older or newer; hashes are not
        // ordered). It is not published and does not replace the remembered revision; an explicit sync can resolve it.
        if (rev && data.coverage?.input_revision !== rev) {
          emit({ leagueId, selectionKey: key, loading: false, refreshing: false, mismatch: true, error: retained ? "" : REVISION_MISMATCH,
            refreshError: retained ? REVISION_MISMATCH : "", data: retained, receivedAt: retainedAt });
          return;
        }
        { remember(key, data); emit({ leagueId, selectionKey: key, loading: false, refreshing: false, error: "", refreshError: "", data, receivedAt: now() }); }
      } catch (error) {
        if (request === generation) emit({ leagueId, selectionKey: key, loading: false, refreshing: false, error: error.message || "Could not load Sleeper data", refreshError: "", data: null, receivedAt: null });
      }
    },
    /** mode "manual" forces dynamic league resources; "due" (automatic) refreshes only resources past their window. */
    async refresh(leagueId, identity = {}, { mode = "manual" } = {}) {
      const key = selectionKey(leagueId, identity);
      const same = current?.selectionKey === key;
      if (same && current.refreshing) return; // one refresh at a time per selection; duplicate clicks join nothing
      const request = begin();
      const retained = same ? current.data : null, receivedAt = same ? current.receivedAt : null;
      emit({ leagueId, selectionKey: key, loading: !retained, refreshing: true, error: "", refreshError: "", data: retained, receivedAt });
      try {
        const response = await fetcher("/api/refresh", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ league: String(leagueId), ...identityFields(identity), mode }) });
        const result = await response.json();
        if (!response.ok || result?.schema_version !== "refresh-1" || !result.snapshot) throw new Error(result?.error || "Refresh failed");
        if (String(result.snapshot.league?.league_id) !== String(leagueId)) throw new Error("Snapshot league mismatch");
        if (request !== generation) return;
        remember(key, result.snapshot);
        emit({ leagueId, selectionKey: key, loading: false, refreshing: false, error: "",
          refreshError: result.status === "failed" ? `Sleeper league data could not be refreshed (${(result.unresolved ?? result.failed ?? []).join(", ") || "core resources"}).${retryHint(result.retry_after_seconds)}` : "",
          data: result.snapshot, receivedAt: now(), refresh: { status: result.status, failed: result.failed, unresolved: result.unresolved ?? result.failed ?? [],
            deferred: result.deferred ?? [], retry_after_seconds: result.retry_after_seconds ?? null, revision_changed: result.revision_changed } });
      } catch (error) {
        if (request !== generation) return;
        const message = error.message || "Refresh failed";
        emit({ leagueId, selectionKey: key, loading: false, refreshing: false, error: retained ? "" : message, refreshError: retained ? message : "", data: retained, receivedAt });
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
