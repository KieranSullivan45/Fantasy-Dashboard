// Presentation helpers for the Trade Analyzer. Unknown values render as words, never as 0; no verdict vocabulary.
import { fantasyPositions } from "./normalize/positions.js";
const MODELED = ["QB", "RB", "WR", "TE"];

export const STATUS_LABELS = Object.freeze({
  evaluated: ["Evaluated", "Both rosters were evaluated before and after the trade."],
  blocked: ["Blocked", "At least one roster cannot make the required forced drops without dropping a protected player."],
  withheld: ["Withheld", "Evidence is insufficient to choose forced drops or value an after-state; see each roster."],
  invalid: ["Invalid proposal", "The proposal or league context failed validation; nothing was valued."],
  unsupported: ["Unsupported", "This package is outside what the analyzer supports; nothing was valued."],
});
export const FORCED_DROP_LABELS = Object.freeze({
  none: "No forced drops needed", selected: "Forced drops required", blocked: "Forced drops blocked", undetermined: "Forced drops undetermined",
});
export const PLACEMENT_LABELS = Object.freeze({ active: "Active roster", reserve: "IR", taxi: "Taxi" });

/** Signed change with an explicit + or − sign; null ⇒ "Unknown" (never 0). */
export function formatSigned(value) {
  if (value == null || !Number.isFinite(value)) return "Unknown";
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(1)}`;
}
/** Plain value; null ⇒ "Unavailable" (never 0). */
export const formatValue = value => (value == null || !Number.isFinite(value) ? "Unavailable" : value.toFixed(1));

/** Whether a rostered player can be offered: only players with modeled football value (QB/RB/WR/TE and a supported model). */
export function tradeAssetSupport(player, context) {
  if (!fantasyPositions(player).some(p => MODELED.includes(p))) return { supported: false, reason: "No modeled football value (K/DEF/IDP)" };
  if (context?.model && context.model.supported !== true) return { supported: false, reason: "Football value not modeled for this player" };
  return { supported: true, reason: null };
}
/** Current roster compartment of a player on a normalized snapshot roster. */
export function rosterCompartment(player, roster) {
  if (player.reserve) return "IR";
  if (player.taxi) return "Taxi";
  return (roster?.starter_slots || []).some(s => s.player_id === player.player_id) ? "Starter" : "Bench";
}
/** Replaces leading or listed player ids in an engine message with names (messages stay otherwise verbatim). */
export function nameMessage(message, names) {
  return String(message).replace(/^(\S+) counts against/, (match, id) => names[id] ? `${names[id]} counts against` : match);
}
