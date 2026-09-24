"use client";
import { useEffect, useRef, useState } from "react";
const STORAGE = "fantasy-accounts-v1";
export default function AccountManager({ onChange, selection, rosters = [], leagueName, management = false }) {
  const [accounts, setAccounts] = useState([]), [user, setUser] = useState(""), [season, setSeason] = useState(""), [username, setUsername] = useState(""), [leagueInput, setLeagueInput] = useState("");
  const [leagues, setLeagues] = useState([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const generation = useRef(0), current = useRef({ accounts: [], selection: null });
  const publish = (list, picked, accountList = accounts) => {
    const savedAccounts = accountList.map(a => a.provider_user_id === picked.userId ? { ...a, preferences: { ...a.preferences, [picked.season]: { leagueId: picked.leagueId, leagues: list } } } : a);
    setAccounts(savedAccounts); setLeagues(list); current.current = { accounts: savedAccounts, selection: { ...picked, leagues: list } };
    onChange({ ...picked, leagues: list });
    try { localStorage.setItem(STORAGE, JSON.stringify(current.current)); } catch { /* Read-only/private browser still works. */ }
  };
  useEffect(() => {
    let alive = true; const boot = ++generation.current;
    (async () => {
      try {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(STORAGE) || "null"); } catch { /* Damaged/private browser preferences must not prevent onboarding. */ }
        if (saved?.selection?.leagueId && Array.isArray(saved.accounts) && Array.isArray(saved.selection.leagues)) {
          if (!alive) return; setAccounts(saved.accounts); setUser(saved.selection.userId || ""); setSeason(String(saved.selection.season || "")); publish(saved.selection.leagues, saved.selection, saved.accounts); return;
        }
        const response = await fetch("/api/accounts"), result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!alive || boot !== generation.current) return;
        const account = result.defaults?.user ? { provider_user_id: result.defaults.user, username: "Installation account" } : null;
        const list = (result.defaults?.leagues || []).map(id => ({ league_id: id, name: id, season: result.season }));
        const accountList = account ? [account] : [];
        setAccounts(accountList); setUser(account?.provider_user_id || ""); setSeason(String(result.season));
        publish(list, { userId: account?.provider_user_id || null, season: result.season, leagueId: list[0]?.league_id || "" }, accountList);
      } catch (e) { if (alive) setError(e.message); }
    })();
    return () => { alive = false; ++generation.current; };
  }, []);
  async function discover(params, accountOverride) {
    const request = ++generation.current; setBusy(true); setError("");
    // Clear selected data immediately; a slow request must not leave another account's roster visible.
    onChange({ leagueId: "", userId: params.user || null, season: Number(params.season), leagues: [] });
    try {
      const response = await fetch(`/api/accounts?${new URLSearchParams(params)}`), data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (request !== generation.current) return;
      const list = data.leagues || [], account = data.account;
      const previousAccount = accounts.find(a => a.provider_user_id === account?.provider_user_id);
      const next = account ? [...accounts.filter(a => a.provider_user_id !== account.provider_user_id), { ...account, preferences: previousAccount?.preferences }] : accounts;
      setAccounts(next); setUser(account?.provider_user_id || accountOverride || ""); setSeason(String(data.season));
      const preferred = previousAccount?.preferences?.[data.season]?.leagueId;
      publish(list, { userId: account?.provider_user_id || null, season: data.season, leagueId: list.some(l => l.league_id === preferred) ? preferred : list[0]?.league_id || "", rosterId: null }, next);
    } catch (e) { if (request === generation.current) setError(e.message); }
    finally { if (request === generation.current) setBusy(false); }
  }
  return <section className="card accountManager" aria-label="Accounts and leagues">
    <details className="accountDetails" open={management}><summary>Accounts, leagues and season</summary>
      <p className="muted">Public read-only Sleeper access. Selections stay in this browser; entering a username does not authenticate as that person. Automatic history capture covers installation-configured leagues only.</p>
      <div className="accountFields">
        <form onSubmit={e => { e.preventDefault(); discover({ username, season }); }}><label>Sleeper username <input value={username} onChange={e => setUsername(e.target.value)} required maxLength={40} /></label><button disabled={busy}>Add account</button></form>
        <label>Account <select aria-label="Sleeper account" value={user} onChange={e => { setUser(e.target.value); if (e.target.value) discover({ user: e.target.value, season }); else publish([], { userId: null, season: Number(season), leagueId: "" }); }}><option value="">Spectator / direct league</option>{accounts.map(a => <option key={a.provider_user_id} value={a.provider_user_id}>{a.username || a.provider_user_id}</option>)}</select></label>
        <form onSubmit={e => { e.preventDefault(); discover({ league: leagueInput }); }}><label>Direct league ID <input value={leagueInput} onChange={e => setLeagueInput(e.target.value)} required pattern="[0-9]{6,25}" /></label><button disabled={busy}>Open league</button></form>
      </div>
    </details>
    <div className="accountFields accountToolbar">
      <label className="leagueControl">League <select aria-label="League" disabled={busy || !leagues.length} value={selection.leagueId || ""} onChange={e => publish(leagues, { userId: user || null, season: leagues.find(l => l.league_id === e.target.value)?.season || selection.season, leagueId: e.target.value, rosterId: null })}>{!leagues.length ? <option value="">Select a league</option> : leagues.map(l => <option key={l.league_id} value={l.league_id}>{l.league_id === selection.leagueId && leagueName ? leagueName : l.name}</option>)}</select></label>
      <form className="seasonControl" onSubmit={e => { e.preventDefault(); if (user) discover({ user, season }); else setError("Choose an account to discover that season's leagues, or add its league ID directly."); }}><label>Season <input aria-label="NFL season" type="number" min="2010" value={season} onChange={e => setSeason(e.target.value)} required /></label><button aria-label="Discover season" disabled={busy}>Go</button></form>
      {!selection.userId && rosters.length ? <label>Analyze roster <select aria-label="Analyze roster" value={selection.rosterId || ""} onChange={e => publish(leagues, { ...selection, rosterId: e.target.value ? Number(e.target.value) : null })}><option value="">Spectator — no “my roster”</option>{rosters.map(r => <option key={r.roster_id} value={r.roster_id}>{r.team_name}</option>)}</select></label> : null}
      <span className="muted accountContext">{busy ? "Discovering…" : `${accounts.find(a => a.provider_user_id === selection.userId)?.username || (selection.userId ? "Connected account" : "Spectator")} · ${leagues.length} leagues`}</span>
    </div>
    {error ? <p className="status error" role="alert">{error}</p> : null}
  </section>;
}
