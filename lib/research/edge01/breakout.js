// EDGE-01 offline breakout / opportunity signal evaluator (class X). Signals use as-of inputs only; outcomes use only the
// w..w+3 window. Nothing here feeds Start Value, Pickup Rating, Trade Value or Market Value.
import { numeric, mean } from "../../decision/features.js";
import { playerSignals } from "../../signals/engine.js";
import { sustained } from "./features.js";
import { flagMetrics, averagePrecision } from "./metrics.js";

export const TIER = { QB: 12, RB: 24, WR: 36, TE: 12 };
export const GAIN = { QB: 5, RB: 5, WR: 5, TE: 4 };
export const ROLE_METRIC = { QB: null, RB: ["carry_share", 0.10], WR: ["target_share", 0.05], TE: ["target_share", 0.05] };
export const DECISION_WEEKS = [4, 14];
export const MIN_UNIQUE_PLAYERS = 50;

const met = (c, k) => c.inputs.opp?.metrics?.[k];

/** Weekly replacement points by season-week-position from all game rows (strict: fewer than N players → null). */
export function weeklyReplacement(games) {
  const by = new Map();
  for (const g of games) if (numeric(g.points)) { const k = `${g.season}:${g.week}:${g.position}`; (by.get(k) ?? by.set(k, []).get(k)).push(g.points); }
  const out = new Map();
  for (const [k, pts] of by) { const pos = k.split(":")[2], n = TIER[pos]; pts.sort((a, b) => b - a); out.set(k, pts.length >= n ? pts[n - 1] : null); }
  return out;
}

/** Outcome definitions (analysis plan). Returns null fields when the window is censored (< 3 played games). */
export function outcomes(c, replacement) {
  const fut = c.outcome.future.filter(r => numeric(r.points));
  if (fut.length < 3 || !numeric(c.inputs.S)) return null;
  const windowMean = mean(fut.map(r => r.points)), G = GAIN[c.position];
  const above = fut.filter(r => { const rep = replacement.get(`${c.season}:${r.week}:${c.position}`); return numeric(rep) && r.points > rep; }).length;
  const gain = windowMean >= c.inputs.S + G && above >= 3;
  let persistence = null;
  const role = ROLE_METRIC[c.position];
  if (role) {
    const [k, delta] = role, base = met(c, k)?.season, w = fut.map(r => r[k]);
    persistence = numeric(base) && w.every(numeric) ? mean(w) >= base + delta && windowMean >= c.inputs.S + G / 2 : null;
  }
  return { window_mean: windowMean, window_games: fut.length, gain, persistence };
}

/** Reconstructed production signals: playerSignals on as-of history only (no market, injury, schedule or high-value context). */
export function engineSignals(c, history) {
  const rows = history.filter(g => g.season === c.season && g.week < c.week);
  const context = { player: { player_id: c.player_id, team: c.team, injury_status: null, fantasy_positions: [c.position] },
    analytics: { history: rows, source_ids: ["nflverse"] }, model: { features: c.production_features } };
  return playerSignals(context, { leagueId: "edge01-research", season: c.season, week: c.week, throughWeek: c.week - 1, generatedAt: "1970-01-01T00:00:00.000Z", modelVersion: "decision-0.3.2" }).map(s => s.type);
}

/** Point-in-time signals. Every value derives from c.inputs (as-of) or the as-of engine call. */
export function signals(c, engineTypes) {
  const o = c.inputs.opp;
  const sus = (k, tau) => o ? sustained(o.metrics[k], tau) === 1 : false;
  const pts = met(c, "points"), earlier = pts && pts.games >= 4 && numeric(pts.season) && numeric(pts.last2) ? (pts.season * pts.games - pts.last2 * 2) / (pts.games - 2) : null;
  const bl1Value = earlier === null ? null : pts.last2 - earlier;
  const N1 = sus("snap_share", 0.10), N2 = sus("target_share", 0.05), N3 = sus("carry_share", 0.10), NAY = sus("air_yard_share", 0.05), N5 = sus("vip", 3);
  const up = new Set(["ROLE_EXPANSION", "SNAP_SHARE_SPIKE", "TARGET_SHARE_SPIKE", "CARRY_SHARE_SPIKE"]);
  return {
    flags: {
      BL1_points_gain: bl1Value !== null && bl1Value >= GAIN[c.position],
      BL2_snap_delta: numeric(met(c, "snap_share")?.d_2v2) && met(c, "snap_share").d_2v2 >= 0.10,
      BL3_draft_r1_r2: c.draft_round === 1 || c.draft_round === 2,
      ENG_ROLE_EXPANSION: engineTypes.includes("ROLE_EXPANSION"),
      ENG_ANY_UP: engineTypes.some(t => up.has(t)) || (engineTypes.includes("BACKFIELD_SHIFT") && (met(c, "carry_share")?.d_2v2 ?? met(c, "carry_share")?.d_1v3 ?? 0) > 0),
      ENG_XFP_BREAKOUT: engineTypes.includes("XFP_BREAKOUT"),
      N1_sustained_snap: N1, N2_sustained_target_share: N2, N3_sustained_carry_share: N3,
      N4_multi_dimension: [N1, N2, N3, NAY].filter(Boolean).length >= 2,
      N5_sustained_vip: N5,
      N6_quiet_vip_growth: N5 && numeric(met(c, "points")?.last2) && numeric(met(c, "vip")?.last2) && met(c, "points").last2 <= met(c, "vip").last2,
      N7_one_week_spike: !!(o?.spike_only?.snap_share || o?.spike_only?.vip),
      N8_sustained_xfp: sus("xfp", 3),
      // Post-hoc (class X): role growth restricted to early-round draft capital (round 1–3; unknown never qualifies).
      PH1_role_growth_and_draft: (N1 || N2 || N3) && [1, 2, 3].includes(c.draft_round),
    },
    scores: { vip_delta_2v2: met(c, "vip")?.d_2v2 ?? null, snap_delta_2v2: met(c, "snap_share")?.d_2v2 ?? null, points_gain_last2: bl1Value, xfp_delta_2v2: met(c, "xfp")?.d_2v2 ?? null },
    early: !(numeric(pts?.last2) && pts.last2 >= c.inputs.S + GAIN[c.position] / 2),
  };
}
export const POST_HOC_SIGNALS = new Set(["PH1_role_growth_and_draft"]);
export const BETTING_DERIVED_SIGNALS = new Set(["ENG_XFP_BREAKOUT", "N8_sustained_xfp", "xfp_delta_2v2"]);

/** Build evaluation rows for one season's cases. */
export function breakoutRows(cases, gamesOfSeason, replacement) {
  const byPlayer = new Map(); for (const g of gamesOfSeason) (byPlayer.get(g.player_id) ?? byPlayer.set(g.player_id, []).get(g.player_id)).push(g);
  const eligible = cases.filter(c => c.week >= DECISION_WEEKS[0] && c.week <= DECISION_WEEKS[1]);
  // As-of tier membership: rank by as-of season PPG among that week's eligible same-position cases.
  const groups = new Map(); for (const c of eligible) { const k = `${c.week}:${c.position}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(c); }
  const asofRank = new Map();
  for (const g of groups.values()) [...g].sort((a, b) => (b.inputs.S ?? -Infinity) - (a.inputs.S ?? -Infinity) || a.player_id.localeCompare(b.player_id)).forEach((c, i) => asofRank.set(c, i + 1));
  const rows = [];
  for (const c of eligible) {
    const sig = signals(c, engineSignals(c, byPlayer.get(c.player_id) || []));
    rows.push({ c, key: `${c.season}:${c.week}:${c.player_id}`, outside_tier: asofRank.get(c) > TIER[c.position], ...sig, out: outcomes(c, replacement) });
  }
  // (a) rank outcome: window-mean rank inside the tier among same-week same-position rows with a defined window.
  const defined = new Map(); for (const r of rows) if (r.out) { const k = `${r.c.week}:${r.c.position}`; (defined.get(k) ?? defined.set(k, []).get(k)).push(r); }
  for (const g of defined.values()) [...g].sort((a, b) => b.out.window_mean - a.out.window_mean || a.c.player_id.localeCompare(b.c.player_id)).forEach((r, i) => { r.out.rank = i + 1 <= TIER[r.c.position]; });
  return rows;
}

const suppress = (m, players) => players < MIN_UNIQUE_PLAYERS ? { ...m, suppressed: true, precision: null, lift: null, recall: null, false_positive_rate: null, false_positive_window_points_vs_pool: null } : m;

/** Flag and score metrics for one definition over a set of rows (censored windows excluded and counted). */
export function evaluateSignals(rows, definition, { k = 5 } = {}) {
  const usable = rows.filter(r => r.out && r.out[definition] !== null && r.out[definition] !== undefined);
  const flagNames = Object.keys(rows[0]?.flags || {}), scoreNames = Object.keys(rows[0]?.scores || {});
  const flags = {};
  for (const f of flagNames) {
    const m = flagMetrics(usable.map(r => ({ flag: r.flags[f], event: r.out[definition], value: r.out.window_mean })));
    const flaggedPlayers = new Set(usable.filter(r => r.flags[f]).map(r => r.c.player_id)).size;
    const tps = usable.filter(r => r.flags[f] && r.out[definition]);
    flags[f] = { ...suppress(m, flaggedPlayers), flagged_unique_players: flaggedPlayers, betting_derived: BETTING_DERIVED_SIGNALS.has(f), post_hoc: POST_HOC_SIGNALS.has(f),
      early_share_of_true_positives: tps.length ? tps.filter(r => r.early).length / tps.length : null };
  }
  const scores = {};
  for (const s of scoreNames) {
    const weeks = new Map(); for (const r of usable) { const key = `${r.c.season}:${r.c.week}`; (weeks.get(key) ?? weeks.set(key, []).get(key)).push(r); }
    const pAtK = mean([...weeks.values()].filter(g => g.length >= k).map(g => [...g].sort((a, b) => (numeric(b.scores[s]) ? b.scores[s] : -Infinity) - (numeric(a.scores[s]) ? a.scores[s] : -Infinity) || a.key.localeCompare(b.key)).slice(0, k).filter(r => r.out[definition]).length / k));
    scores[s] = { precision_at_k: pAtK, k, base_rate: usable.length ? usable.filter(r => r.out[definition]).length / usable.length : null,
      pr_auc: averagePrecision(usable.map(r => ({ score: r.scores[s], event: r.out[definition], key: r.key }))), coverage: usable.length ? usable.filter(r => numeric(r.scores[s])).length / usable.length : null,
      betting_derived: BETTING_DERIVED_SIGNALS.has(s) };
  }
  return { rows: rows.length, usable: usable.length, censored: rows.filter(r => !r.out).length, flags, scores };
}

/** Lead time: for early true positives, weeks until BL1 (points-gain baseline) first fires for the same player (cap 4). */
export function leadTimes(rows, flag, definition = "gain") {
  const idx = new Map(rows.map(r => [`${r.c.season}:${r.c.player_id}:${r.c.week}`, r]));
  const leads = [];
  for (const r of rows) if (r.out?.[definition] && r.flags[flag] && r.early) {
    let lead = null; for (let d = 0; d <= 4; d++) { const later = idx.get(`${r.c.season}:${r.c.player_id}:${r.c.week + d}`); if (later?.flags.BL1_points_gain) { lead = d; break; } }
    leads.push(lead);
  }
  return { early_true_positives: leads.length, mean_weeks_until_points_baseline: mean(leads.filter(numeric)), points_baseline_never_within_4: leads.filter(l => l === null).length };
}
