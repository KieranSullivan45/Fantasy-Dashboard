"use client";
import { useEffect, useState } from "react";
import { useDashboard, useViewState, DataRequired } from "../DashboardShell.js";
import TradeResult from "../../components/TradeResult.js";
import { createTradeLoader } from "../../../lib/trade-loader.js";
import { decisionBasis } from "../../../lib/decision/basis.js";
import { rosterCompartment, tradeAssetSupport } from "../../../lib/trade-display.js";

const MAX_PER_SIDE = 2, COMPARTMENT_ORDER = ["Starter", "Bench", "IR", "Taxi"];

function TeamPicker({ side, label, roster, otherId, rosters, picked, onTeam, onToggle, onClear, contexts }) {
  const players = roster ? [...roster.all_players].map(p => ({ p, where: rosterCompartment(p, roster), support: tradeAssetSupport(p, contexts?.[p.player_id]) }))
    .sort((a, b) => COMPARTMENT_ORDER.indexOf(a.where) - COMPARTMENT_ORDER.indexOf(b.where)) : [];
  const full = picked.length >= MAX_PER_SIDE;
  return <section className="card tradeTeam" aria-label={label}>
    <label className="tradeTeamSelect">{label}
      <select aria-label={label} value={roster ? String(roster.roster_id) : ""} onChange={e => onTeam(side, e.target.value)}>
        <option value="">Choose a team</option>
        {rosters.map(r => <option key={r.roster_id} value={String(r.roster_id)} disabled={String(r.roster_id) === otherId}>{r.team_name}{r.is_user ? " (you)" : ""}</option>)}
      </select>
    </label>
    {roster ? <>
      <div className="tradePicked" aria-live="polite">
        <p className="muted">Sends {picked.length} of {MAX_PER_SIDE} max</p>
        {picked.map(id => { const p = roster.all_players.find(x => x.player_id === id); return <button key={id} type="button" className="tradeChip" onClick={() => onToggle(side, id)}>Remove {p?.name || id}</button>; })}
        {picked.length ? <button type="button" className="tradeChip" onClick={() => onClear(side)}>Clear</button> : null}
      </div>
      <ul className="tradePlayers">{players.map(({ p, where, support }) => {
        const checked = picked.includes(p.player_id), disabled = !checked && (full || !support.supported);
        return <li key={p.player_id}><label className={`tradePlayer${disabled ? " disabled" : ""}`}>
          <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(side, p.player_id)} />
          <span><strong>{p.name || p.player_id}</strong><span className="muted"> {(p.fantasy_positions || [p.position]).join("/")}{p.team ? ` · ${p.team}` : ""} · {where}</span>
            {!support.supported ? <span className="muted tradeReason">{support.reason}</span> : null}</span>
        </label></li>;
      })}</ul>
      {full ? <p className="muted">Maximum of two players from this team.</p> : null}
    </> : <p className="muted">Choose a team to list its rostered players.</p>}
  </section>;
}

export default function TradeView() {
  const { data, decision } = useDashboard();
  const [teams, setTeams] = useViewState("tradeTeams", { a: null, b: "" });
  const [picks, setPicks] = useViewState("tradePicks", { a: [], b: [] });
  const [result, setResult] = useState({ key: null, basis: null, loading: false, error: "", data: null });
  const [loader] = useState(() => createTradeLoader(setResult));
  useEffect(() => () => loader.cancel(), [loader]);
  if (!data) return <><h1>Trade</h1><DataRequired /></>;

  const rosters = data.rosters, find = id => rosters.find(r => String(r.roster_id) === id) || null;
  // Team A defaults to the resolved/selected roster only; spectators choose both teams. Ownership is never inferred.
  const rosterA = find(teams.a ?? (data.my_roster ? String(data.my_roster.roster_id) : "")), rosterB = find(teams.b);
  const current = (roster, ids) => roster ? ids.filter(id => roster.all_players.some(p => p.player_id === id)) : [];
  const picked = { a: current(rosterA, picks.a), b: current(rosterB, picks.b) };
  const basis = decisionBasis(data);
  const key = JSON.stringify([basis, rosterA?.roster_id ?? null, [...picked.a].sort(), rosterB?.roster_id ?? null, [...picked.b].sort()]);
  const sameTeam = rosterA && rosterB && rosterA.roster_id === rosterB.roster_id;
  const problem = !rosterA || !rosterB ? "Choose two teams." : sameTeam ? "Choose two different teams."
    : !picked.a.length || !picked.b.length ? "Select one or two players from each team." : null;
  const shown = result.key === key && result.basis === basis ? result : null;
  const names = Object.fromEntries(rosters.flatMap(r => r.all_players.map(p => [p.player_id, p.name || p.player_id])));
  const slotCount = data.league.roster_positions.filter(p => !["BN", "IR", "TAXI"].includes(p)).length;

  const onTeam = (side, id) => { setTeams(t => ({ ...t, a: t.a ?? (rosterA ? String(rosterA.roster_id) : ""), [side]: id })); setPicks(p => ({ ...p, [side]: [] })); };
  const onToggle = (side, id) => setPicks(p => { const list = current(side === "a" ? rosterA : rosterB, p[side]);
    return { ...p, [side]: list.includes(id) ? list.filter(x => x !== id) : list.length < MAX_PER_SIDE ? [...list, id] : list }; });
  const onClear = side => setPicks(p => ({ ...p, [side]: [] }));
  const analyze = () => { if (!problem) loader.load(data, [{ rosterId: rosterA.roster_id, playerIds: picked.a }, { rosterId: rosterB.roster_id, playerIds: picked.b }], key); };

  return <><h1>Trade</h1>
    <p className="viewIntro">Build a 1–2 player trade between two teams and see what it does to each roster's legal lineup for the next game. Evaluation only: nothing is sent to {data.source || "the provider"}.</p>
    <div className="tradeBuilder">
      <TeamPicker side="a" label="Team A" roster={rosterA} otherId={rosterB ? String(rosterB.roster_id) : ""} rosters={rosters} picked={picked.a} onTeam={onTeam} onToggle={onToggle} onClear={onClear} contexts={decision?.player_context} />
      <TeamPicker side="b" label="Team B" roster={rosterB} otherId={rosterA ? String(rosterA.roster_id) : ""} rosters={rosters} picked={picked.b} onTeam={onTeam} onToggle={onToggle} onClear={onClear} contexts={decision?.player_context} />
    </div>
    <div className="tradeActions">
      <button type="button" className="tradeAnalyze" disabled={!!problem || (result.loading && result.key === key)} onClick={analyze}>{result.loading && result.key === key ? "Analyzing…" : "Analyze trade"}</button>
      {problem ? <p className="muted">{problem}</p> : null}
    </div>
    {shown?.loading ? <p className="status" role="status">Evaluating both rosters…</p> : null}
    {shown?.error ? <p className="status error" role="alert">{shown.error}</p> : null}
    {shown?.data ? <TradeResult evaluation={shown.data} rosters={rosters} names={names} slotCount={slotCount} /> : null}
  </>;
}
