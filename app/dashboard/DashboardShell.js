"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createSnapshotLoader, selectionKey } from "../../lib/snapshot-loader.js";
import { createDecisionLoader } from "../../lib/decision-loader.js";
import { createAutoRefresh } from "../../lib/auto-refresh.js";
import { decisionBasis } from "../../lib/decision/basis.js";
import AccountManager from "../components/AccountManager.js";
const Context = createContext(null);
export const useDashboard = () => useContext(Context);
export const destinations = ["Home", "Waivers", "Lineup", "Signals", "Trade", "League", "Players", "More"];
/** Reached from More on mobile, so the bottom bar keeps five destinations at 320px. */
const moreSections = ["Trade", "League", "Players"];
export function useViewState(key, initial) {
  const { views, setViews } = useDashboard();
  return [views[key] ?? initial, value => setViews(previous => ({ ...previous, [key]: typeof value === "function" ? value(previous[key] ?? initial) : value }))];
}
export function DataRequired({ children }) {
  const { data, selection } = useDashboard();
  return data ? children : <p className="card">{selection.leagueId ? "Loading this league…" : "Choose a league above, or add a Sleeper account in More."}</p>;
}
export function DecisionPending() {
  const { decision, decisionError } = useDashboard();
  return !decision ? <p className="muted" role="status">{decisionError || "Loading decision evidence…"}</p> : null;
}
const clock = iso => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ago = seconds => seconds < 90 ? "just now" : seconds < 5400 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
/** Last sync and staleness from the snapshot's per-resource freshness (process-local server state; ADR 0008). */
export function SyncStatus({ data }) {
  const resources = data?.coverage?.freshness?.resources;
  if (!resources) return null;
  const at = Date.now(), rows = Object.entries(resources).map(([name, r]) => ({ name, ...r,
    stale: !r.last_success_at || at - Date.parse(r.last_success_at) >= r.stale_after_seconds * 1000 }));
  const rosters = resources.rosters, stale = rows.filter(r => r.stale), failed = rows.filter(r => ["failed", "not_promoted"].includes(r.last_attempt_status));
  return <div className="syncStatus muted" aria-label="Data freshness">
    {rosters?.last_success_at ? <span>League synced {clock(rosters.last_success_at)} ({ago((at - Date.parse(rosters.last_success_at)) / 1000)})</span> : <span>League sync time unknown</span>}
    {stale.length ? <span className="syncStale"> · Older than its refresh window: {stale.map(r => r.name).join(", ")}</span> : null}
    {failed.length ? <span className="syncFailed"> · Not updated, previous data kept: {failed.map(r => `${r.name} (${r.error?.message || "unavailable"})`).join("; ")}</span> : null}
  </div>;
}
export default function DashboardShell({ children }) {
  const pathname = usePathname(), main = useRef(null), previousPath = useRef(pathname);
  const [selection, setSelection] = useState({ leagueId: "", userId: null, season: null, rosterId: null });
  const activeKey = selectionKey(selection.leagueId, selection);
  const [snapshot, setSnapshot] = useState({ loading: false, data: null });
  const [loader] = useState(() => createSnapshotLoader(setSnapshot));
  const current = snapshot.selectionKey === activeKey ? snapshot : null;
  const data = current?.data ?? null, refreshing = !!current?.refreshing;
  const latest = useRef({ data: null, selection }), auto = useRef(null);
  latest.current = { data, selection };
  const [decisionState, setDecisionState] = useState({ data: null });
  const [decisionLoader] = useState(() => createDecisionLoader(setDecisionState));
  const basis = data ? decisionBasis(data) : null;
  const decision = data && decisionState.basis === basis ? decisionState.data : null;
  const decisionError = decisionState.basis === basis ? decisionState.error : null;
  const [views, setViews] = useState({});
  useEffect(() => { if (selection.leagueId) loader.load(selection.leagueId, selection); return () => loader.cancel(); }, [activeKey, loader]);
  // Keyed on the basis (which carries the committed input revision): an unchanged refresh keeps the decision; a new revision reloads it.
  useEffect(() => { if (latest.current.data) decisionLoader.load(latest.current.data); return () => decisionLoader.cancel(); }, [basis, decisionLoader]);
  useEffect(() => {
    if (!selection.leagueId || typeof document === "undefined") return;
    const timer = createAutoRefresh({ isVisible: () => document.visibilityState === "visible",
      onDue: () => { const { selection: s } = latest.current; if (s.leagueId) loader.refresh(s.leagueId, s, { mode: "due" }); },
      subscribe: listener => { document.addEventListener("visibilitychange", listener); return () => document.removeEventListener("visibilitychange", listener); } });
    auto.current = timer;
    return () => { timer.stop(); if (auto.current === timer) auto.current = null; };
  }, [activeKey, loader]);
  useEffect(() => { if (current?.receivedAt) auto.current?.synced(current.receivedAt); }, [current?.receivedAt, activeKey]);
  useEffect(() => { if (previousPath.current !== pathname) main.current?.focus({ preventScroll: true }); previousPath.current = pathname; }, [pathname]);
  const nav = mobile => <nav aria-label={mobile ? "Mobile navigation" : "Desktop navigation"} className={mobile ? "mobileNav" : "desktopNav"}>{destinations.filter(name => !mobile || !moreSections.includes(name)).map(name => {
    const path = `/dashboard/${name.toLowerCase()}`, current = pathname === path, secondary = mobile && name === "More" && moreSections.some(section => pathname === `/dashboard/${section.toLowerCase()}`);
    return <Link key={name} href={path} prefetch={false} aria-current={current ? "page" : undefined} className={current || secondary ? "active" : ""}>{name}{secondary ? <span className="srOnly"> — current section in More</span> : null}</Link>;
  })}</nav>;
  const query = new URLSearchParams({ league: selection.leagueId, user: selection.userId || "spectator", ...(selection.rosterId ? { roster: String(selection.rosterId) } : {}) }).toString();
  return <Context.Provider value={{ selection, data, decision, decisionError, views, setViews, query }}>
    <a className="skipLink" href="#view">Skip to content</a>
    <div className="appShell">
      <aside className="appSidebar"><Link className="brand" href="/dashboard/home">Fantasy<br />Command Center</Link>{nav(false)}</aside>
      <div className="appWorkspace">
        <header className="shellHeader"><Link className="mobileBrand" href="/dashboard/home">Fantasy Command Center</Link><span className="muted">Read-only Sleeper</span><button disabled={!selection.leagueId || refreshing} aria-busy={refreshing} onClick={() => loader.refresh(selection.leagueId, selection)}>{refreshing ? "Refreshing…" : "Refresh"}</button></header>
        <AccountManager onChange={setSelection} selection={selection} rosters={data?.rosters || []} leagueName={data?.league.name} management={pathname === "/dashboard/more"} />
        {selection.leagueId && !data && (!current || current.loading) ? <p className="status" role="status">Syncing live Sleeper data…</p> : null}
        {data && refreshing ? <p className="status" role="status">Refreshing Sleeper data… current league data stays visible.</p> : null}
        {current?.error ? <p className="status error" role="alert">{current.error} <button type="button" onClick={() => loader.refresh(selection.leagueId, selection)}>Retry</button></p> : null}
        {data && current.refreshError ? <p className="status error" role="alert">{current.mismatch ? "Sync mismatch:" : "Refresh failed:"} {current.refreshError} Showing the last good league data. <button type="button" disabled={refreshing} onClick={() => loader.refresh(selection.leagueId, selection)}>Retry</button></p> : null}
        {data ? <SyncStatus data={data} /> : null}
        {data?.partial ? <details className="status" role="status"><summary>Some league data is unavailable</summary>{data.warnings.map((w,i) => <p key={i}>{w.message}</p>)}</details> : null}
        <main id="view" ref={main} tabIndex={-1} className="routeContent">{children}</main>
      </div>
    </div>{nav(true)}
  </Context.Provider>;
}
