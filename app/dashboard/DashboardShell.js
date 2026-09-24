"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createSnapshotLoader, selectionKey } from "../../lib/snapshot-loader.js";
import { createDecisionLoader } from "../../lib/decision-loader.js";
import { decisionBasis } from "../../lib/decision/basis.js";
import AccountManager from "../components/AccountManager.js";
const Context = createContext(null);
export const useDashboard = () => useContext(Context);
export const destinations = ["Home", "Waivers", "Lineup", "Signals", "League", "Players", "More"];
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
export default function DashboardShell({ children }) {
  const pathname = usePathname(), main = useRef(null), previousPath = useRef(pathname);
  const [selection, setSelection] = useState({ leagueId: "", userId: null, season: null, rosterId: null });
  const activeKey = selectionKey(selection.leagueId, selection);
  const [snapshot, setSnapshot] = useState({ loading: false, data: null });
  const [loader] = useState(() => createSnapshotLoader(setSnapshot));
  const data = snapshot.selectionKey === activeKey ? snapshot.data : null;
  const [decisionState, setDecisionState] = useState({ data: null });
  const [decisionLoader] = useState(() => createDecisionLoader(setDecisionState));
  const basis = data ? decisionBasis(data) : null;
  const decision = data && decisionState.basis === basis ? decisionState.data : null;
  const decisionError = decisionState.basis === basis ? decisionState.error : null;
  const [views, setViews] = useState({});
  useEffect(() => { if (selection.leagueId) loader.load(selection.leagueId, selection); return () => loader.cancel(); }, [activeKey, loader]);
  useEffect(() => { if (data) decisionLoader.load(data); return () => decisionLoader.cancel(); }, [data, decisionLoader]);
  useEffect(() => { if (previousPath.current !== pathname) main.current?.focus({ preventScroll: true }); previousPath.current = pathname; }, [pathname]);
  const nav = mobile => <nav aria-label={mobile ? "Mobile navigation" : "Desktop navigation"} className={mobile ? "mobileNav" : "desktopNav"}>{destinations.filter(name => !mobile || !["League", "Players"].includes(name)).map(name => {
    const path = `/dashboard/${name.toLowerCase()}`, current = pathname === path, secondary = mobile && name === "More" && ["/dashboard/league", "/dashboard/players"].includes(pathname);
    return <Link key={name} href={path} prefetch={false} aria-current={current ? "page" : undefined} className={current || secondary ? "active" : ""}>{name}{secondary ? <span className="srOnly"> — current section in More</span> : null}</Link>;
  })}</nav>;
  const query = new URLSearchParams({ league: selection.leagueId, user: selection.userId || "spectator", ...(selection.rosterId ? { roster: String(selection.rosterId) } : {}) }).toString();
  return <Context.Provider value={{ selection, data, decision, decisionError, views, setViews, query }}>
    <a className="skipLink" href="#view">Skip to content</a>
    <div className="appShell">
      <aside className="appSidebar"><Link className="brand" href="/dashboard/home">Fantasy<br />Command Center</Link>{nav(false)}</aside>
      <div className="appWorkspace">
        <header className="shellHeader"><Link className="mobileBrand" href="/dashboard/home">Fantasy Command Center</Link><span className="muted">Read-only Sleeper</span><button disabled={!selection.leagueId} onClick={() => loader.load(selection.leagueId, selection)}>Refresh</button></header>
        <AccountManager onChange={setSelection} selection={selection} rosters={data?.rosters || []} leagueName={data?.league.name} management={pathname === "/dashboard/more"} />
        {selection.leagueId && (!data || snapshot.loading) ? <p className="status" role="status">Syncing live Sleeper data…</p> : null}
        {snapshot.selectionKey === activeKey && snapshot.error ? <p className="status error" role="alert">{snapshot.error}</p> : null}
        {data?.partial ? <details className="status" role="status"><summary>Some league data is unavailable</summary>{data.warnings.map((w,i) => <p key={i}>{w.message}</p>)}</details> : null}
        <main id="view" ref={main} tabIndex={-1} className="routeContent">{children}</main>
      </div>
    </div>{nav(true)}
  </Context.Provider>;
}
