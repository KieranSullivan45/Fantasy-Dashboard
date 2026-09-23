export function transactionPieces(tx, rosters = []) {
  const names = new Map(rosters.map(r => [String(r.roster_id), r.team_name]));
  const team = id => names.get(String(id)) || `Team ${id}`;
  return [
    ...tx.adds.map(add => `+ ${add.player.name} → ${add.team_name}`),
    ...tx.drops.map(drop => `− ${drop.player.name} ← ${drop.team_name}`),
    ...(tx.draft_picks || []).map(pick => `${pick.season} round ${pick.round} pick (original: ${team(pick.roster_id)}) · ${team(pick.previous_owner_id)} → ${team(pick.owner_id)}`),
    ...(tx.waiver_budget || []).map(transfer => `FAAB ${transfer.amount} · ${team(transfer.sender)} → ${team(transfer.receiver)}`),
  ];
}
