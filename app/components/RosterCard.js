import CompactPlayer from "./CompactPlayer.js";
import ExpandableDetail from "./ExpandableDetail.js";
import { transactionPieces } from "../../lib/transaction-display.js";
export function PlayerRow({ player, context }) { return <CompactPlayer player={player} context={context} />; }

export function RosterCard({ roster, settings = {}, contexts = {} }) {
  return (
    <article className={`card rosterCard ${roster.is_user ? "mine" : ""}`}>
      <div className="cardHeader">
        <div>
          <h3>{roster.is_user ? "My Team" : roster.team_name}</h3>
          <p className="muted">
            {roster.record.wins}-{roster.record.losses}{roster.record.ties ? `-${roster.record.ties}` : ""} · {roster.record.points_for.toFixed(1)} PF
          </p>
        </div>
        {roster.is_user ? <span className="pill">YOU</span> : null}
      </div>
      <ExpandableDetail id={`starters:${roster.roster_id}`} label={`Starters (${roster.starter_slots.length})`} initial>
      <div className="compactList">
        {roster.starter_slots.map((entry, index) => (
          <div key={index}>
            <span className="muted">{entry.slot}</span>
            {entry.player_id ? <PlayerRow player={roster.starters.find(p => p.player_id === entry.player_id)} context={contexts[entry.player_id]} /> : <div className="playerRow muted">Empty slot</div>}
          </div>
        ))}
      </div>
      </ExpandableDetail>
      {[["Bench", roster.bench, true], ["IR", roster.reserve, settings.reserve_slots > 0], ["Taxi", roster.taxi, settings.taxi_slots > 0]]
        .filter(([, group, enabled]) => enabled || group.length)
        .map(([label, group]) => (
          <ExpandableDetail key={label} id={`roster:${roster.roster_id}:${label}`} label={`${label} (${group.length})`} initial={label === "Bench"}>
            <div className="compactList detailsList">
              {group.map(p => <PlayerRow key={p.player_id} player={p} context={contexts[p.player_id]} />)}
              {!group.length ? <span className="muted">No players</span> : null}
            </div>
          </ExpandableDetail>
        ))}
    </article>
  );
}

export function Transaction({ tx, rosters }) {
  const pieces = transactionPieces(tx, rosters);
  return (
    <div className="transaction">
      <strong>{tx.type.replaceAll("_", " ")} · {tx.status}</strong>
      <span>{pieces.join(" · ") || tx.teams.join(" ↔ ")}</span>
      {tx.waiver_bid !== null ? <span className="muted">FAAB {tx.waiver_bid}</span> : null}
    </div>
  );
}

