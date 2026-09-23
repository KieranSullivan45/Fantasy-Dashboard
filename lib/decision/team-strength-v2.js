import { optimizeLineup } from "./optimizer.js";
import { valueOverReplacement, SKILL_POSITIONS } from "./replacement.js";
import { fantasyPositions } from "../normalize/positions.js";
import { unavailableThisWeek } from "./team-strength.js";
export function teamStrengthV2(roster, slots, contexts, levels, scoring) {
  const active = roster.all_players.filter(p => !p.reserve && !p.taxi);
  const usable = active.filter(p => !unavailableThisWeek(p) && contexts[p.player_id]?.schedule.status !== "no_scheduled_game");
  const values = Object.fromEntries(Object.entries(contexts).map(([id, c]) => [id, c.model.supported ? c.model.start_value.central : null]));
  const lineup = optimizeLineup(usable, slots, values), assigned = new Set(lineup?.map(p => p.player_id));
  const asset = p => ({ player_id: p.player_id, eligible_positions: fantasyPositions(p), ...valueOverReplacement(p, contexts[p.player_id]?.model.player_value, levels) });
  const bench = active.filter(p => !assigned.has(p.player_id)).map(asset);
  const positions = Object.fromEntries(SKILL_POSITIONS.map(pos => {
    const eligible = active.filter(p => fantasyPositions(p).includes(pos)).map(asset);
    const starters = (lineup || []).filter(p => p.player_id && (SKILL_POSITIONS.includes(p.slot) ? p.slot : contexts[p.player_id]?.model.replacement.position) === pos);
    const depth = bench.filter(p => p.position === pos);
    const positive = eligible.filter(p => p.value_over_replacement > 0);
    return [pos, { starter_strength: starters.reduce((s, p) => s + p.value, 0), starter_ids: starters.map(p => p.player_id),
      bench_strength: depth.reduce((s, p) => s + Math.max(0, p.value_over_replacement ?? 0), 0), bench_ids: depth.map(p => p.player_id),
      replacement: levels[pos], positive_vor_assets: positive.length,
      need_or_surplus: positive.length < Math.ceil(levels[pos].eligible_starter_demand) ? "need" : positive.length > Math.ceil(levels[pos].eligible_starter_demand) + 1 ? "surplus" : "balanced" }];
  }));
  return { contract_version: "2", roster_id: roster.roster_id, best_legal_lineup: lineup, positions, bench,
    starter_strength: lineup?.reduce((s, p) => s + (p.value ?? 0), 0) ?? null,
    unknown_slots: lineup?.filter(p => p.value == null).map(p => p.slot) || slots,
    injury_exposure: roster.all_players.filter(unavailableThisWeek).map(asset),
    bye_exposure: active.filter(p => contexts[p.player_id]?.schedule.status === "no_scheduled_game").map(p => p.player_id),
    superflex_qb_structural: slots.includes("SUPER_FLEX"), te_reception_premium: scoring.bonus_rec_te || 0,
    needs: Object.keys(positions).filter(p => positions[p].need_or_surplus === "need"), surpluses: Object.keys(positions).filter(p => positions[p].need_or_surplus === "surplus"),
    market_value: null, basis: "Legal one-player-one-slot allocation. Bench aggregates assign dual-position assets to their best VOR position once. Unsupported K/DST/IDP remain empty, not zero-value assets." };
}

