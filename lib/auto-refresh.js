// Visible-only automatic refresh for the dashboard (SLEEPER-REFRESH-01). One pending timer at most, no polling loop:
// the timer is set for the moment the last sync becomes due. Hidden or inactive views pause it; becoming visible
// refreshes once if due. The server decides which resources are actually due (5 min dynamic, 15 min slow, 24 h catalog).
export const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function createAutoRefresh({ interval = AUTO_REFRESH_MS, now = Date.now, isVisible, onDue, subscribe, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let last = null, timer = null, stopped = false;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  const dueNow = () => last !== null && now() - last >= interval;
  const run = () => { last = now(); onDue(); };
  function schedule() {
    clear();
    if (stopped || last === null || !isVisible()) return;
    timer = setTimer(() => { timer = null; if (stopped || !isVisible()) return; if (dueNow()) run(); schedule(); }, Math.max(0, last + interval - now()));
  }
  const unsubscribe = subscribe(() => {
    if (stopped) return;
    if (!isVisible()) return clear();
    if (dueNow()) run();
    schedule();
  });
  return {
    /** Records a successful sync (manual, automatic or initial load) and re-arms the timer from it. */
    synced(at = now()) { last = at; schedule(); },
    stop() { stopped = true; clear(); unsubscribe(); },
  };
}
