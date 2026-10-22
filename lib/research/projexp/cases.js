// Projection experiment case tables (research only). Reuses the EDGE-01 case table (production membership, production
// forecast, as-of opportunity windows) and adds game context, opponent strength and a rest-of-season (ROS) outcome.
// Inputs live under `f` (features) and `base` (fixed forecasts); outcomes live under `y`/`ros` only.
import { numeric, mean } from "../../decision/features.js";
import { buildCaseTable } from "../edge01/cases.js";
import { opponentFactor } from "./context.js";

export const ROS_DECISION_WEEKS = [4, 14];
export const ROS_LAST_WEEK = 17;
export const ROS_MIN_PLAYED = 3;

const om = (c, metric, w) => c.inputs.opp?.metrics?.[metric]?.[w] ?? null;

/** Feature vector for one EDGE-01 case. Missing stays null (the GBM routes it; linear fits drop it). */
export function featuresOf(c, ctx, oppFactor, teamGamesSoFar) {
  const i = c.inputs;
  return {
    Q: i.Q, S: i.S, P: i.P, P_ew16: i.P_ew16, h9q: i.h9q, R3: i.R3, EW3: i.EW3, EW5: i.EW5, last1: i.last1,
    ew8: i.ewall[8], ew16: i.ewall[16], ew24: i.ewall[24], n: i.n, k: i.k, changed_team: i.changed_team ? 1 : 0,
    calendar_gap: i.opp?.calendar_gap ?? null,
    snap_last1: om(c, "snap_share", "last1"), snap_last2: om(c, "snap_share", "last2"), snap_last3: om(c, "snap_share", "last3"), snap_season: om(c, "snap_share", "season"),
    tgtsh_last3: om(c, "target_share", "last3"), tgtsh_season: om(c, "target_share", "season"),
    carsh_last3: om(c, "carry_share", "last3"), carsh_season: om(c, "carry_share", "season"),
    targets_last3: om(c, "targets", "last3"), carries_last3: om(c, "carries", "last3"), air_last3: om(c, "air_yards", "last3"),
    airsh_season: om(c, "air_yard_share", "season"), wopr_last3: om(c, "wopr", "last3"),
    vip_last2: om(c, "vip", "last2"), vip_last3: om(c, "vip", "last3"), vip_season: om(c, "vip", "season"),
    team_pass_att_season: om(c, "team_pass_attempts", "season"), team_plays_season: om(c, "team_plays", "season"),
    pts_vol4: om(c, "points", "volatility4"),
    played_rate: numeric(teamGamesSoFar) && teamGamesSoFar > 0 ? Math.min(1, i.n / teamGamesSoFar) : null,
    opp_factor: oppFactor, home: ctx?.home ?? null, rest: ctx?.rest ?? null, opp_rest: ctx?.opp_rest ?? null, dome: ctx?.dome ?? null,
    week: c.week,
    // Betting-derived (closing lines). Kept in the same vector but only read by explicitly labelled models.
    implied_total: ctx?.implied_total ?? null, spread_for: ctx?.spread_for ?? null, game_total: ctx?.game_total ?? null,
  };
}

/**
 * Weekly and ROS rows for one season. gamesBySeason: EDGE-01 per-season game rows (PPR); schedule: scheduleContext();
 * allowed: allowedByDefense(); vipModel: EDGE-01 VIP (fitted 2014–2017).
 */
export function seasonRows(gamesBySeason, season, { vipModel, draft, schedule, allowed }) {
  const { cases } = buildCaseTable(gamesBySeason, season, { vipModel, draft });
  const games = gamesBySeason[season] || [];
  const byPlayer = new Map(); for (const g of games) (byPlayer.get(g.player_id) ?? byPlayer.set(g.player_id, []).get(g.player_id)).push(g);
  const teamGamesBefore = (team, week) => { let n = 0; for (let w = 1; w < week; w++) if (schedule.teamWeek.has(`${season}:${w}:${team}`)) n++; return n; };
  const weekly = [], ros = [];
  for (const c of cases) {
    const team = c.inputs.opp?.team ?? c.team;
    const ctx = team ? schedule.teamWeek.get(`${season}:${c.week}:${team}`) ?? null : null;
    const of = ctx ? opponentFactor(allowed, season, c.week, ctx.opponent, c.position) : null;
    const f = featuresOf(c, ctx, of, team ? teamGamesBefore(team, c.week) : null);
    const base = { prod: c.inputs.prod, noX: c.inputs.noX, Q: c.inputs.Q, h9q: c.inputs.h9q, vipA2: numeric(c.inputs.Q) && numeric(c.inputs.R3) && numeric(f.vip_last2) ? 0.5 * c.inputs.Q + 0.2 * c.inputs.R3 + 0.3 * f.vip_last2 : null };
    const row = { season, week: c.week, player_id: c.player_id, position: c.position, team, opponent: ctx?.opponent ?? null, gameday: ctx?.gameday ?? null,
      bye: !ctx, rosterable: c.rosterable, f, base, y: numeric(c.outcome.actual) ? c.outcome.actual : null };
    weekly.push(row);
    if (c.week < ROS_DECISION_WEEKS[0] || c.week > ROS_DECISION_WEEKS[1] || !team) continue;
    // ROS outcome over weeks w..17: scheduled (non-bye) games of the as-of team, realised points from stat rows.
    const sched = []; for (let w = c.week; w <= ROS_LAST_WEEK; w++) { const s = schedule.teamWeek.get(`${season}:${w}:${team}`); if (s) sched.push(s); }
    const played = (byPlayer.get(c.player_id) || []).filter(g => g.week >= c.week && g.week <= ROS_LAST_WEEK && numeric(g.points));
    const remainingOpp = sched.map(s => opponentFactor(allowed, season, c.week, s.opponent, c.position)).filter(numeric);
    ros.push({ season, week: c.week, player_id: c.player_id, position: c.position, team, rosterable: c.rosterable, gameday: ctx?.gameday ?? null,
      f: { ...f, ros_games: sched.length, ros_opp_factor: remainingOpp.length ? mean(remainingOpp) : null }, base,
      ros: { scheduled: sched.length, played: played.length, total: played.reduce((s, g) => s + g.points, 0),
        ppg: played.length >= ROS_MIN_PLAYED ? mean(played.map(g => g.points)) : null,
        played_rate: sched.length ? Math.min(1, played.length / sched.length) : null } });
  }
  return { weekly, ros };
}
