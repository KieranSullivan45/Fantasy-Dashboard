// A player dictionary removes repeated identities without losing roster membership.
export function compactSnapshot(snapshot) {
  const players = {};
  function reference(player) {
    const { player_id, name, position, fantasy_positions, team, injury_status, status, search_rank } = player;
    players[player_id] = { name, position, fantasy_positions, team, injury_status, status, search_rank };
    return player_id;
  }
  const rosters = snapshot.rosters.map(roster => ({
    roster_id: roster.roster_id,
    owner_id: roster.owner_id,
    team_name: roster.team_name,
    settings: roster.settings,
    waiver_position: roster.waiver_position,
    waiver_budget_used: roster.waiver_budget_used,
    starters: roster.starter_slots,
    bench: roster.bench.map(reference),
    ir: roster.reserve.map(reference),
    taxi: roster.taxi.map(reference),
  }));
  snapshot.rosters.forEach(roster => roster.starters.forEach(reference));
  const free_agents = Object.fromEntries(Object.entries(snapshot.free_agents).map(([position, group]) => [position,
    group.map(player => ({ player_id: reference(player), trending_adds_24h: player.trending_adds_24h })),
  ]));
  const recent_transactions = snapshot.recent_transactions.map(({ teams, adds, drops, ...tx }) => ({
    ...tx,
    adds: adds.map(item => ({ player_id: reference(item.player), roster_id: item.roster_id })),
    drops: drops.map(item => ({ player_id: reference(item.player), roster_id: item.roster_id })),
  }));
  const trending_available = snapshot.trending_available.map(player => ({ player_id: reference(player), count: player.count }));
  snapshot.matchup_players.forEach(reference);
  return {
    schema_version: "0.2", view: "compact",
    generated_at: snapshot.generated_at, source: snapshot.source,
    league: snapshot.league, nfl_state: snapshot.nfl_state,
    my_roster_id: snapshot.my_roster?.roster_id ?? null,
    players, rosters, standings: snapshot.standings,
    free_agents, trending_available, recent_transactions,
    matchup_week: snapshot.matchup_week, current_matchups: snapshot.current_matchups,
    coverage: snapshot.coverage, truncation: snapshot.truncation,
    partial: snapshot.partial, warnings: snapshot.warnings,
  };
}
