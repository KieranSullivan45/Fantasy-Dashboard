import PlayerQuickContext from "./PlayerQuickContext.js";
import PlayerContextCard from "./PlayerContextCard.js";
import ExpandableDetail from "./ExpandableDetail.js";
import Link from "next/link";
export const metric = value => value == null ? "Unavailable" : value.toFixed(1);
export function PlayerSummary({ context }) {
  return <p className="compactMetrics">StartValue {metric(context?.model?.start_value?.weekly_start_value)} · {context?.schedule?.opponent ? `Next: ${context.schedule.home ? "vs" : "@"} ${context.schedule.opponent}` : "Opponent unavailable"}</p>;
}
export default function CompactPlayer({ player, context, scope = "player", href, ownership }) {
  return <div className="compactPlayer"><div className="playerRow"><strong>{href ? <Link href={href}>{player.name}</Link> : player.name}</strong><span className="muted">{(player.fantasy_positions || [player.position]).join("/")} · {player.team || "No team"}</span></div>{ownership ? <p className="compactNote">{ownership}</p> : null}{player.injury_status ? <span className="badge warn">{player.injury_status}</span> : null}<PlayerSummary context={context} />
    {context ? <ExpandableDetail id={`${scope}:${player.player_id}`} label={`Details · ${player.name}`}><PlayerQuickContext context={context} /><PlayerContextCard context={context} /></ExpandableDetail> : null}
  </div>;
}
