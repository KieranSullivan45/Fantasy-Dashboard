// Platform eligibility is authoritative for fantasy slots; provider positions are provenance.
export const SLOT_POSITIONS = {
  QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
  FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["WR", "RB"],
  DL: ["DL", "DE", "DT"], DE: ["DE"], DT: ["DT"], LB: ["LB"],
  DB: ["DB", "CB", "S"], CB: ["CB"], S: ["S"],
  IDP_FLEX: ["DL", "DE", "DT", "LB", "DB", "CB", "S"],
};
export const fantasyPositions = player => [...new Set(Array.isArray(player.fantasy_positions)
  ? player.fantasy_positions : player.position ? [player.position] : [])];
export const fitsSlot = (player, slot) => (SLOT_POSITIONS[slot] || []).some(pos => fantasyPositions(player).includes(pos));
export const leaguePositions = slots => [...new Set(slots.flatMap(slot => SLOT_POSITIONS[slot] || []))];
export const uniquePlayers = players => [...new Map(players.map(p => [p.player_id, p])).values()];
