import { fantasyPositions, leaguePositions } from "./normalize/positions.js";
const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const NFL_TEAMS = new Set("ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS".split(" "));

export function rosterPlayerIds(roster) {
  return [...new Set([...(roster.players || []), ...(roster.starters || []), ...(roster.reserve || []), ...(roster.taxi || [])]
    .filter(id => id != null && String(id) !== "0").map(String))];
}

export function isCurrentFantasyPlayer(raw, trendingAdds = 0, allowedPositions = FANTASY_POSITIONS) {
  if (!raw) return false;
  const positions = fantasyPositions(raw);
  if (!allowedPositions.some(pos => positions.includes(pos))) return false;
  const status = String(raw.status || "").toLowerCase();
  if (/retired|retirement|deceased/.test(status)) return false;
  if (raw.position === "DEF" || positions.includes("DEF")) return NFL_TEAMS.has(raw.team || raw.player_id);
  const currentTeam = NFL_TEAMS.has(raw.team);
  // Active is not game-day availability. Keep team-associated IR/PUP/out assets.
  const injury = String(raw.injury_status || "").toLowerCase();
  const injured = /^(ir|out|pup|questionable|doubtful|sus|suspended|nfi)$/.test(injury) || /injured|\bir\b|pup|reserve|out|questionable|doubtful|suspended/.test(status);
  if (currentTeam) return raw.active !== false || injured || status === "active";
  // Explicitly active unsigned players need contemporary interest, not an old rank.
  return !raw.team && raw.active === true && trendingAdds > 0;
}

export function pointsFromSettings(settings = {}, prefix = "fpts") {
  const whole = Number(settings[prefix] || 0);
  const decimal = Number(settings[`${prefix}_decimal`] || 0) / 100;
  return whole + decimal;
}

export function getTeamName(user, rosterId) {
  return (
    user?.metadata?.team_name ||
    user?.display_name ||
    user?.username ||
    `Team ${rosterId}`
  );
}

export function normalizePlayer(playerId, players = {}) {
  const p = players[playerId];
  if (!p) {
    const defense = NFL_TEAMS.has(String(playerId));
    return {
      player_id: String(playerId),
      name: defense ? `${playerId} D/ST` : String(playerId),
      first_name: null,
      last_name: null,
      position: defense ? "DEF" : null,
      fantasy_positions: defense ? ["DEF"] : [],
      team: defense ? String(playerId) : null,
      injury_status: null,
      status: null,
      search_rank: null,
    };
  }

  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || String(playerId);
  return {
    player_id: String(playerId),
    name,
    first_name: p.first_name || null,
    last_name: p.last_name || null,
    position: p.position || p.fantasy_positions?.[0] || null,
    fantasy_positions: p.fantasy_positions || (p.position ? [p.position] : []),
    team: p.team || null,
    injury_status: p.injury_status || null,
    status: p.status || null,
    search_rank: Number.isFinite(p.search_rank) ? p.search_rank : null,
  };
}

export function buildRosterViews({ rosters = [], users = [], players = {}, userId, rosterPositions = [] }) {
  const usersById = Object.fromEntries(users.map((u) => [u.user_id, u]));

  return rosters.map((roster) => {
    const owner = usersById[roster.owner_id] || null;
    const starterIds = (roster.starters || []).map(id => id == null || String(id) === "0" ? null : String(id));
    const starterSet = new Set(starterIds.filter(Boolean));
    const reserveSet = new Set((roster.reserve || []).map(String));
    const taxiSet = new Set((roster.taxi || []).map(String));
    const playerIds = rosterPlayerIds(roster);
    const slots = rosterPositions.filter(pos => !["BN", "IR", "TAXI"].includes(pos));

    const mapped = playerIds.map((id) => ({
      ...normalizePlayer(id, players),
      starter: starterSet.has(id),
      reserve: reserveSet.has(id),
      taxi: taxiSet.has(id),
    }));

    return {
      roster_id: roster.roster_id,
      owner_id: roster.owner_id || null,
      is_user: roster.owner_id === userId || (roster.co_owners || []).includes(userId),
      team_name: getTeamName(owner, roster.roster_id),
      avatar: owner?.avatar || null,
      record: {
        wins: Number(roster.settings?.wins || 0),
        losses: Number(roster.settings?.losses || 0),
        ties: Number(roster.settings?.ties || 0),
        points_for: pointsFromSettings(roster.settings, "fpts"),
        points_against: pointsFromSettings(roster.settings, "fpts_against"),
      },
      waiver_position: roster.settings?.waiver_position ?? null,
      waiver_budget_used: roster.settings?.waiver_budget_used ?? null,
      settings: roster.settings || {},
      starter_slots: Array.from({ length: Math.max(slots.length, starterIds.length) }, (_, index) => ({
        slot: slots[index] || "STARTER", player_id: starterIds[index] || null,
      })),
      starters: starterIds.filter(Boolean).map(id => mapped.find(p => p.player_id === id)),
      bench: mapped.filter((p) => !p.starter && !p.reserve && !p.taxi),
      reserve: mapped.filter((p) => p.reserve),
      taxi: mapped.filter((p) => p.taxi),
      all_players: mapped,
    };
  });
}

export function buildStandings(rosterViews = []) {
  return [...rosterViews]
    .sort((a, b) => {
      if (b.record.wins !== a.record.wins) return b.record.wins - a.record.wins;
      if (b.record.ties !== a.record.ties) return b.record.ties - a.record.ties;
      return b.record.points_for - a.record.points_for;
    })
    .map((team, index) => ({
      rank: index + 1,
      roster_id: team.roster_id,
      team_name: team.team_name,
      is_user: team.is_user,
      ...team.record,
    }));
}

export function buildFreeAgents({ players = {}, rosters = [], trending = [], rosterPositions }) {
  const rostered = new Set(rosters.flatMap(rosterPlayerIds));
  const trendMap = new Map(trending.map((item) => [String(item.player_id), Number(item.count || 0)]));
  const allowed = rosterPositions ? leaguePositions(rosterPositions) : FANTASY_POSITIONS;
  const groups = Object.fromEntries([...new Set([...FANTASY_POSITIONS, ...allowed])].map((pos) => [pos, []]));

  for (const [playerId, raw] of Object.entries(players)) {
    if (rostered.has(playerId)) continue;
    if (!isCurrentFantasyPlayer(raw, trendMap.get(playerId) || 0, allowed)) continue;

    const eligible = allowed.filter(pos => fantasyPositions(raw).includes(pos));
    if (!eligible.length) continue;

    const player = normalizePlayer(playerId, players);
    for (const position of eligible) groups[position].push({
      ...player,
      trending_adds_24h: trendMap.get(playerId) || 0,
    });
  }

  for (const position of allowed) {
    groups[position].sort((a, b) => {
      const rankA = a.search_rank ?? 999999;
      const rankB = b.search_rank ?? 999999;
      if (rankA !== rankB) return rankA - rankB;
      return b.trending_adds_24h - a.trending_adds_24h || a.player_id.localeCompare(b.player_id);
    });
  }

  return groups;
}

export function summarizeTransactions({ transactions = [], players = {}, rosterViews = [] }) {
  const teams = Object.fromEntries(rosterViews.map((r) => [r.roster_id, r.team_name]));

  const unique = new Map();
  for (const tx of transactions) {
    const previous = unique.get(tx.transaction_id);
    if (!previous || Number(tx.status_updated || tx.created || 0) >= Number(previous.status_updated || previous.created || 0)) unique.set(tx.transaction_id, tx);
  }
  return [...unique.values()]
    .filter((t) => ["complete", "pending"].includes(t.status))
    .sort((a, b) => Number(b.created || 0) - Number(a.created || 0))
    .map((t) => {
      const adds = Object.entries(t.adds || {}).map(([playerId, rosterId]) => ({
        player: normalizePlayer(playerId, players),
        roster_id: rosterId,
        team_name: teams[rosterId] || `Team ${rosterId}`,
      }));
      const drops = Object.entries(t.drops || {}).map(([playerId, rosterId]) => ({
        player: normalizePlayer(playerId, players),
        roster_id: rosterId,
        team_name: teams[rosterId] || `Team ${rosterId}`,
      }));

      return {
        transaction_id: t.transaction_id,
        type: t.type,
        status: t.status,
        created: t.created || null,
        status_updated: t.status_updated ?? null,
        leg: t.leg ?? null,
        settings: t.settings || {},
        metadata: t.metadata || {},
        draft_picks: (t.draft_picks || []).map(pick => ({ ...pick })),
        waiver_budget: (t.waiver_budget || []).map(transfer => ({ ...transfer })),
        roster_ids: t.roster_ids || [],
        teams: (t.roster_ids || []).map((id) => teams[id] || `Team ${id}`),
        waiver_bid: t.settings?.waiver_bid ?? null,
        adds,
        drops,
      };
    });
}

export function trimFreeAgents(freeAgents, limit = 50) {
  return Object.fromEntries(
    Object.entries(freeAgents).map(([position, players]) => [position, players.slice(0, limit)])
  );
}
