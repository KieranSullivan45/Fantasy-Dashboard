import { FORCED_DROP_LABELS, PLACEMENT_LABELS, STATUS_LABELS, formatSigned, formatValue, nameMessage } from "../../lib/trade-display.js";

const nameList = (ids, names) => ids?.length ? ids.map(id => names[id] || id).join(", ") : "None";

/** Why a before/after lineup has no valuation: the engine's own unknown or diagnostic, never an empty fake lineup. */
function withheldReason(side, label) {
  const unknown = side.unknowns.find(u => u.field === `${label}.starter_total` || u.field === label);
  if (unknown) return unknown.reason;
  const diagnostic = side.forced_drops.diagnostics.at(-1);
  return diagnostic?.message || "Not evaluated.";
}

function Lineup({ side, label, title, names, slotCount }) {
  const state = side[label];
  if (!state) return <div className="tradeLineup"><h4>{title}</h4><p className="muted">Unavailable: {withheldReason(side, label)}</p></div>;
  return <div className="tradeLineup"><h4>{title}</h4>
    <p className="muted">Filled starter slots: {state.filled_starter_slots} of {slotCount}</p>
    {state.lineup ? <ul className="tradeLineupList">{state.lineup.map((s, i) => <li key={i}>
      <span className="slotLabel">{s.slot}</span>
      <span>{s.player_id ? names[s.player_id] || s.player_id : <span className="muted">Empty slot</span>}</span>
      <span className="muted">{!s.valued ? "Value unavailable" : s.player_id ? formatValue(s.value) : ""}</span>
    </li>)}</ul> : <p className="muted">Lineup valuation withheld: {withheldReason(side, label)}</p>}
    <p className="tradeTotal">Starter total: <strong>{formatValue(state.starter_total)}</strong> · Bench depth (VOR): <strong>{formatValue(state.depth_total)}</strong></p>
    {state.unvalued_slots?.length ? <p className="muted">{[...new Set(state.unvalued_slots)].join(", ")} slots count for legality only; their value is unavailable.</p> : null}
  </div>;
}

function ForcedDrops({ side, names }) {
  const f = side.forced_drops;
  return <div><h4>Forced drops</h4>
    <p>{f.status ? FORCED_DROP_LABELS[f.status] : "Not resolved"}{f.required != null && f.required > 0 ? ` · ${f.required} required` : ""}</p>
    {f.status === "selected" ? <p>Would drop: <strong>{nameList(f.dropped, names)}</strong></p> : null}
    {f.diagnostics.map((d, i) => <p className="muted" key={i}>{d.message}</p>)}
    {f.excluded?.length ? <details><summary>Not eligible to be dropped ({f.excluded.length})</summary><ul className="tradeNotes">{f.excluded.map(e => <li key={e.player_id}>{names[e.player_id] || e.player_id}: {e.evidence === "insufficient" ? "protection evidence insufficient" : e.reasons.join("; ")}</li>)}</ul></details> : null}
  </div>;
}

function SideResult({ side, teamName, names, slotCount }) {
  return <article className="card tradeSide" aria-label={`${teamName} result`}>
    <h3>{teamName}</h3>
    <dl className="tradeFacts">
      <div><dt>Sends</dt><dd>{nameList(side.sends, names)}</dd></div>
      <div><dt>Receives</dt><dd>{nameList(side.receives, names)}</dd></div>
      <div><dt>Starter change (next game)</dt><dd data-testid="starter-change">{formatSigned(side.starter_change)}</dd></div>
      <div><dt>Bench depth change (VOR)</dt><dd data-testid="depth-change">{formatSigned(side.depth_change)}</dd></div>
    </dl>
    <div className="tradeLineups"><Lineup side={side} label="before" title="Before" names={names} slotCount={slotCount} /><Lineup side={side} label="after" title="After" names={names} slotCount={slotCount} /></div>
    <ForcedDrops side={side} names={names} />
    {side.reserve_placement.length ? <div><h4>Reserve / taxi placement</h4><ul className="tradeNotes">{side.reserve_placement.map(p => <li key={p.player_id}>
      {names[p.player_id] || p.player_id}: {p.placement ? PLACEMENT_LABELS[p.placement] : "Not resolved"}{p.limitations.length ? <span className="muted"> ({p.limitations.join("; ")})</span> : null}
    </li>)}</ul></div> : null}
    {side.unknowns.length ? <div><h4>Unknowns</h4><ul className="tradeNotes">{side.unknowns.map((u, i) => <li key={i}>{u.reason}{u.player_ids?.length ? ` (${nameList(u.player_ids, names)})` : ""}</li>)}</ul></div> : null}
    {side.warnings.length ? <div><h4>Warnings</h4><ul className="tradeNotes">{side.warnings.map((w, i) => <li key={i}>{nameMessage(w, names)}</li>)}</ul></div> : null}
  </article>;
}

/** Renders a trade-1 TradeEvaluation. Each roster is shown on its own: no fairness score, winner or recommendation. */
export default function TradeResult({ evaluation, rosters, names, slotCount }) {
  const [label, explanation] = STATUS_LABELS[evaluation.status] || [evaluation.status, ""];
  const teamName = id => rosters.find(r => String(r.roster_id) === String(id))?.team_name || `Roster ${id}`;
  const limitations = [...(evaluation.legality_limitations || []), ...(evaluation.horizon?.limitations || [])];
  return <section className="tradeResult" aria-label="Trade evaluation">
    <div className="card tradeSummary">
      <p className="tradeStatus">Status: <strong data-testid="trade-status">{label}</strong></p>
      <p className="muted">{explanation}</p>
      <dl className="tradeFacts">
        <div><dt>Horizon</dt><dd>{evaluation.horizon?.id === "next_game" ? "Next game" : evaluation.horizon?.id || "Unknown"}</dd></div>
        <div><dt>Legality</dt><dd>Conditional under known roster rules</dd></div>
        <div><dt>Market value</dt><dd>Not modeled</dd></div>
      </dl>
      {evaluation.errors.length ? <ul className="tradeNotes" aria-label="Evaluation issues">{evaluation.errors.map((e, i) => <li key={i}>
        {e.roster_id ? `${teamName(e.roster_id)}: ` : ""}{e.asset_id && names[e.asset_id] ? `${names[e.asset_id]} — ` : ""}{e.message}
      </li>)}</ul> : null}
      <details><summary>Limitations</summary><ul className="tradeNotes">{limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
      <p className="muted">Each roster is described separately. This analyzer explains roster consequences; it does not rate fairness or recommend accepting.</p>
    </div>
    {evaluation.sides.length ? <div className="tradeSides">{evaluation.sides.map(side => <SideResult key={side.roster_id} side={side} teamName={teamName(side.roster_id)} names={names} slotCount={slotCount} />)}</div>
      : <p className="muted">No roster valuation was performed.</p>}
  </section>;
}
