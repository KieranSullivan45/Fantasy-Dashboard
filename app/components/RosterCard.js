import PlayerContextCard from "./PlayerContextCard.js";
import PlayerQuickContext from "./PlayerQuickContext.js";
import { transactionPieces } from "../../lib/transaction-display.js";
export function PlayerRow({ player, context }) {
  return (
    <div className="playerWithContext"><div className="playerRow">
      <div>
        <strong>{player.name}</strong>
        <span className="muted"> {(player.fantasy_positions || [player.position]).join("/")} {player.team ? `· ${player.team}` : ""}</span>
      </div>
      <div className="badges">
        {player.injury_status ? <span className="badge warn">{player.injury_status}</span> : null}
        {context?.interest?.available_rank ? <span className="badge">Sleeper interest #{context.interest.available_rank}</span> : null}
      </div>
    </div><PlayerQuickContext context={context} />{context ? <details className="playerContext"><summary>Weekly context</summary><PlayerContextCard context={context} /></details> : null}</div>
  );
}

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
      <h4>Starters</h4>
      <div className="compactList">
        {roster.starter_slots.map((entry, index) => (
          <div key={index}>
            <span className="muted">{entry.slot}</span>
            {entry.player_id ? <PlayerRow player={roster.starters.find(p => p.player_id === entry.player_id)} context={contexts[entry.player_id]} /> : <div className="playerRow muted">Empty slot</div>}
          </div>
        ))}
      </div>
      {[["Bench", roster.bench, true], ["IR", roster.reserve, settings.reserve_slots > 0], ["Taxi", roster.taxi, settings.taxi_slots > 0]]
        .filter(([, group, enabled]) => enabled || group.length)
        .map(([label, group]) => (
          <details key={label}>
            <summary>{label} ({group.length})</summary>
            <div className="compactList detailsList">
              {group.map(p => <PlayerRow key={p.player_id} player={p} context={contexts[p.player_id]} />)}
              {!group.length ? <span className="muted">No players</span> : null}
            </div>
          </details>
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

