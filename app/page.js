"use client";

import { useEffect, useMemo, useState } from "react";
import { createSnapshotLoader } from "../lib/snapshot-loader.js";
import { transactionPieces } from "../lib/transaction-display.js";
import { createDecisionLoader } from "../lib/decision-loader.js";
import { decisionBasis } from "../lib/decision/basis.js";
import WeeklyMatchup from "./components/WeeklyMatchup.js";
import PlayerContextCard from "./components/PlayerContextCard.js";
import WaiverRecommendations from "./components/WaiverRecommendations.js";
import SourceStatus from "./components/SourceStatus.js";

const LEAGUES = ["1401373864818192384", "1395493939665989632"];
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

function PlayerRow({ player, context }) {
  return (
    <div className="playerWithContext"><div className="playerRow">
      <div>
        <strong>{player.name}</strong>
        <span className="muted"> {player.position || ""} {player.team ? `· ${player.team}` : ""}</span>
      </div>
      <div className="badges">
        {player.injury_status ? <span className="badge warn">{player.injury_status}</span> : null}
        {player.trending_adds_24h ? <span className="badge">+{player.trending_adds_24h}</span> : null}
      </div>
    </div>{context ? <details className="playerContext"><summary>Weekly context</summary><PlayerContextCard context={context} /></details> : null}</div>
  );
}

function RosterCard({ roster, settings = {}, contexts = {} }) {
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

function Transaction({ tx, rosters }) {
  const pieces = transactionPieces(tx, rosters);
  return (
    <div className="transaction">
      <strong>{tx.type.replaceAll("_", " ")} · {tx.status}</strong>
      <span>{pieces.join(" · ") || tx.teams.join(" ↔ ")}</span>
      {tx.waiver_bid !== null ? <span className="muted">FAAB {tx.waiver_bid}</span> : null}
    </div>
  );
}

export default function Home() {
  const [leagueId, setLeagueId] = useState(LEAGUES[0]);
  const [snapshot, setSnapshot] = useState({ loading: true, error: "", data: null });
  const [loader] = useState(() => createSnapshotLoader(setSnapshot));
  const data = snapshot.leagueId === leagueId ? snapshot.data : null;
  const error = snapshot.leagueId === leagueId ? snapshot.error : "";
  const loading = snapshot.leagueId !== leagueId || snapshot.loading;
  const [position, setPosition] = useState("RB");
  const [decisionState, setDecisionState] = useState({ data: null, loading: false, error: "" });
  const [decisionLoader] = useState(() => createDecisionLoader(setDecisionState));
  const basis = data ? decisionBasis(data) : null;
  const decision = decisionState.basis === basis ? decisionState.data : null;

  useEffect(() => {
    loader.load(leagueId);
    return () => loader.cancel();
  }, [leagueId, loader]);

  useEffect(() => {
    if (data) decisionLoader.load(data);
    return () => decisionLoader.cancel();
  }, [data, decisionLoader]);

  const myTeam = data?.my_roster;
  const opponents = useMemo(
    () => (data?.rosters || []).filter((team) => !team.is_user),
    [data]
  );

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">SLEEPER · LIVE READ-ONLY DATA</p>
          <h1>Fantasy Command Center</h1>
          <p className="subhead">A live league source of truth for roster, waiver and trade analysis.</p>
        </div>
        <div className="controls">
          <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} aria-label="League">
            {LEAGUES.map((id) => <option key={id} value={id}>{data?.league?.league_id === id ? data.league.name : id}</option>)}
          </select>
          <button onClick={() => loader.load(leagueId)}>Refresh</button>
        </div>
      </header>

      {loading ? <section className="status">Syncing live Sleeper data…</section> : null}
      {error ? (
        <section className="status error">
          <strong>Connection check failed.</strong>
          <div>{error}</div>
          <div className="muted">The app is built; this message will also catch an incorrect username/league ID or a temporary Sleeper API issue.</div>
        </section>
      ) : null}

      {data ? (
        <>
          {data.partial ? <section className="status" role="status"><strong>Some data is unavailable.</strong>{data.warnings.map((warning, index) => <div key={index}>{warning.message}</div>)}</section> : null}
          <section className="summaryGrid">
            <div className="stat"><span>League</span><strong>{data.league.name}</strong></div>
            <div className="stat"><span>Teams</span><strong>{data.league.total_rosters}</strong></div>
            <div className="stat"><span>NFL week</span><strong>{data.nfl_state.display_week || data.nfl_state.week}</strong></div>
            <div className="stat"><span>Last sync</span><strong>{new Date(data.generated_at).toLocaleTimeString()}</strong></div>
          </section>

          <WeeklyMatchup snapshot={data} decision={decision} />
          {decision ? <SourceStatus data={decision} /> : <p className="muted">{decisionState.basis === basis && decisionState.error ? decisionState.error : "Loading weekly player context…"}</p>}

          <section className="section">
            <div className="sectionTitle">
              <div><p className="eyebrow">ROSTER</p><h2>Your team</h2></div>
              <a href={`/api/snapshot?league=${leagueId}&compact=1`} target="_blank">Open ChatGPT snapshot ↗</a>
            </div>
            {myTeam ? <RosterCard roster={myTeam} settings={data.league.settings} contexts={decision?.player_context} /> : <div className="card">Your Sleeper account is not attached to a roster in this league.</div>}
          </section>

          {decision ? <WaiverRecommendations data={decision} position={position} /> : null}
          <section className="section">
            <div className="sectionTitle"><div><p className="eyebrow">WAIVERS</p><h2>Available players</h2></div></div>
            <div className="tabs">
              {POSITIONS.map((pos) => <button key={pos} className={position === pos ? "active" : ""} onClick={() => setPosition(pos)}>{pos}</button>)}
            </div>
            <div className="card freeAgents">
              {(data.free_agents[position] || []).slice(0, 20).map((p) => <PlayerRow key={p.player_id} player={p} context={decision?.player_context[p.player_id]} />)}
              {!data.free_agents[position]?.length ? <span className="muted">No eligible available players at this position.</span> : null}
            </div>
          </section>

          <section className="section twoCol">
            <div>
              <div className="sectionTitle"><div><p className="eyebrow">STANDINGS</p><h2>League table</h2></div></div>
              <div className="card standings">
                {data.standings.map((team) => (
                  <div className={team.is_user ? "standing mineLine" : "standing"} key={team.roster_id}>
                    <span>{team.rank}. {team.team_name}</span>
                    <strong>{team.wins}-{team.losses} · {team.points_for.toFixed(1)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="sectionTitle"><div><p className="eyebrow">ACTIVITY</p><h2>Recent moves</h2></div></div>
              <div className="card activity">
                {data.recent_transactions.slice(0, 12).map((tx) => <Transaction key={tx.transaction_id} tx={tx} rosters={data.rosters} />)}
                {!data.recent_transactions.length ? <span className="muted">No recent transactions returned.</span> : null}
              </div>
            </div>
          </section>

          <section className="section">
            <div className="sectionTitle"><div><p className="eyebrow">TRADE MAP</p><h2>Every opponent roster</h2></div></div>
            <div className="rosterGrid">
              {opponents.map((roster) => <RosterCard key={roster.roster_id} roster={roster} settings={data.league.settings} contexts={decision?.player_context} />)}
            </div>
          </section>

          <section className="section card endpoint">
            <p className="eyebrow">FOR CHATGPT</p>
            <h2>Machine-readable snapshot</h2>
            <p>This endpoint is intentionally read-only. Once the site is deployed, the live URL can be used as the current league source instead of screenshots.</p>
            <code>/api/snapshot?league={leagueId}&compact=1</code>
          </section>
        </>
      ) : null}
    </main>
  );
}
