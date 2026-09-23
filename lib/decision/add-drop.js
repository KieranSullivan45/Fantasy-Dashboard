import { optimizeLineup } from "./optimizer.js";
import { unavailableThisWeek } from "./team-strength.js";
import { fantasyPositions, fitsSlot } from "../normalize/positions.js";
import { valueOverReplacement } from "./replacement.js";
import { POLICY } from "./model-config.js";
import { numeric } from "./features.js";
const total = lineup => lineup?.reduce((s, p) => s + (p.value ?? 0), 0) ?? null;
export function transactionEvaluator(roster, rosterPositions, contexts, levels) {
  const slots = rosterPositions.filter(p => !["BN", "IR", "TAXI"].includes(p));
  const active = (roster?.all_players || []).filter(p => !p.reserve && !p.taxi);
  const capacity = rosterPositions.filter(p => !["IR", "TAXI"].includes(p)).length;
  const quality = Object.fromEntries(Object.entries(contexts).map(([id, c]) => [id, c.model?.player_value ?? null]));
  const weekly = Object.fromEntries(Object.entries(contexts).map(([id, c]) => [id, c.model?.start_value?.central ?? null]));
  const usable = list => list.filter(p => !unavailableThisWeek(p) && contexts[p.player_id]?.schedule?.status !== "no_scheduled_game");
  const before = optimizeLineup(usable(active), slots, weekly);
  const vor = p => valueOverReplacement(p, quality[p.player_id], levels).value_over_replacement;
  const depth = (list, lineup) => { const starters = new Set(lineup?.map(p => p.player_id)); return list.filter(p => !starters.has(p.player_id)).reduce((s, p) => s + Math.max(0, vor(p) ?? 0), 0); };
  const protectedPlayers = active.map(player => {
    const c = contexts[player.player_id], f = c?.model?.features, pos = fantasyPositions(player), reasons = [];
    if (!numeric(quality[player.player_id])) reasons.push("Unknown asset value");
    if (unavailableThisWeek(player)) reasons.push("Injured/reserve asset protected");
    if (c?.schedule?.status === "kickoff_passed") reasons.push("Game has started; platform drop lock unverified");
    if (!pos.some(p => ["QB", "RB", "WR", "TE"].includes(p))) reasons.push("K/DST/IDP advanced value unsupported");
    if (slots.includes("SUPER_FLEX") && pos.includes("QB")) reasons.push("Structural Superflex QB asset");
    if (f?.provisional_role_expansion || f?.role_change) reasons.push("Expanding-role stash");
    if (pos.includes("RB") && (f?.feature_inputs.snap_share >= POLICY.protected.snapShare || f?.feature_inputs.carry_share >= POLICY.protected.carryShare)) reasons.push("Meaningful observed backfield role");
    const positionalValues = Object.values(contexts).filter(x => fantasyPositions(x.player).some(p => pos.includes(p))).map(x => x.model?.player_value).filter(numeric);
    if (numeric(quality[player.player_id]) && positionalValues.filter(v => v < quality[player.player_id]).length / Math.max(1, positionalValues.length) >= POLICY.protected.elitePercentile / 100) reasons.push("Upper-tier football asset");
    return { player_id: player.player_id, reasons };
  }).filter(p => p.reasons.length);
  const protectedIds = new Set(protectedPlayers.map(p => p.player_id));
  const drops = active.filter(p => !protectedIds.has(p.player_id));
  return candidate => {
    const base = { lineup_before: before, protected_players: protectedPlayers, evaluated_pairs: 0, pairs: [], best: null,
      starter_gain: null, depth_gain: null, net_roster_improvement: null, legal_status: "conditional",
      basis: "Active-roster capacity and platform eligibility validated; commissioner locks/transaction deadlines are not available. No IR/taxi moves assumed. Values are model heuristics, not guaranteed points." };
    if (!roster || !before || active.length > capacity || !numeric(quality[candidate.player_id])) return { ...base, reason: "Roster capacity or player evidence unavailable" };
    const compatible = slots.filter(s => fitsSlot(candidate, s));
    const unknown = active.some(p => !numeric(weekly[p.player_id]) && !unavailableThisWeek(p) && compatible.some(s => fitsSlot(p, s)));
    const locked = active.some(p => contexts[p.player_id]?.schedule?.status === "kickoff_passed");
    const options = active.length < capacity ? [null] : drops;
    const pairs = options.map(drop => {
      const afterPlayers = [...active.filter(p => p.player_id !== drop?.player_id), candidate];
      const after = optimizeLineup(usable(afterPlayers), slots, weekly);
      const starter = !unknown && !locked && after ? total(after) - total(before) : null;
      const depthChange = depth(afterPlayers, after) - depth(active, before);
      const scarcity = POLICY.scarcityWeight * ((vor(candidate) ?? 0) - (drop ? vor(drop) ?? 0 : 0));
      const net = starter == null ? null : starter + POLICY.depthWeight * depthChange + scarcity;
      return { add_player_id: candidate.player_id, drop_player_id: drop?.player_id ?? null,
        starter_improvement: starter, depth_change: depthChange, depth_weight: POLICY.depthWeight, scarcity_adjustment: scarcity,
        net_roster_improvement: net, dropped_player_value: drop ? quality[drop.player_id] : 0, dropped_player_vor: drop ? vor(drop) : 0,
        lineup_after: after, transaction_type: drop ? "add_drop" : "vacant_active_slot", recommended: net != null && net > 0 };
    }).sort((a, b) => (b.net_roster_improvement ?? -Infinity) - (a.net_roster_improvement ?? -Infinity));
    const best = pairs[0] || null, after = best?.lineup_after ?? null;
    for (const pair of pairs) delete pair.lineup_after;
    return { ...base, evaluated_pairs: pairs.length, pairs: pairs.slice(0, POLICY.maximumPairsReturned), best,
      lineup_after: after, starter_gain: best?.starter_improvement ?? null, depth_gain: best?.depth_change ?? null,
      net_roster_improvement: best?.net_roster_improvement ?? null, unknown_compatible_players: unknown,
      reason: !options.length ? "No conservatively eligible drop; reserve/taxi assets cannot free an active slot" : locked ? "Current-week lineup locks unverified; weekly marginal estimate withheld" : null };
  };
}


