import { finiteNumber, normalizeTeam } from "../sources/contracts.js";
import { scoreStats } from "../normalize/scoring.js";

export function buildProduction(rawRows, ids, { season, week, settings, platformPlayers = new Map() }) {
  const gamesByPlayer = new Map(), games = [], seen = new Set(), unmatched = new Set();
  for (const raw of rawRows) {
    const mappedId = ids.get(raw.player_id);
    const eligibility = platformPlayers.get(mappedId)?.fantasy_positions || [];
    const offensive = eligibility.filter(p => ["QB", "RB", "WR", "TE", "K"].includes(p));
    const providerPosition = raw.position === "FB" ? "RB" : raw.position;
    // A defensive provider label cannot erase a platform-eligible offensive asset.
    const position = ["QB", "RB", "WR", "TE", "K"].includes(providerPosition) ? providerPosition : offensive.length === 1 ? offensive[0] : null;
    if (Number(raw.season) !== Number(season) || raw.season_type !== "REG" || Number(raw.week) >= week || !["QB", "RB", "WR", "TE", "K"].includes(position)) continue;
    const key = `${raw.player_id}:${raw.game_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const player_id = ids.get(raw.player_id) || null;
    if (!player_id) unmatched.add(raw.player_id);
    const scoringPosition = offensive.length === 1 ? offensive[0] : position;
    const scoring = scoreStats(raw, settings, scoringPosition);
    if (offensive.length > 1 && new Set(offensive.map(p => Number(settings?.[`bonus_rec_${p.toLowerCase()}`] || 0))).size > 1) {
      scoring.points = null; scoring.status = "partial"; scoring.missing_stats.push("ambiguous platform position for reception premium");
    }
    const game = { player_id, source_player_id: raw.player_id, game_id: raw.game_id, week: Number(raw.week),
      team: normalizeTeam(raw.team), opponent: normalizeTeam(raw.opponent_team), position, scoring_position: scoringPosition, provider_position: raw.position,
      points: scoring.points, scoring, targets: finiteNumber(raw.targets), carries: finiteNumber(raw.carries), raw_stats: raw };
    games.push(game);
    if (!player_id) continue;
    if (!gamesByPlayer.has(player_id)) gamesByPlayer.set(player_id, []);
    gamesByPlayer.get(player_id).push(game);
  }
  const players = {};
  for (const [id, playerGames] of gamesByPlayer) {
    playerGames.sort((a, b) => b.week - a.week);
    const scored = playerGames.filter(game => game.points !== null);
    const recent = playerGames.slice(0, 3);
    const mean = group => group.length && group.every(g => g.points !== null) ? group.reduce((sum, g) => sum + g.points, 0) / group.length : null;
    const totals = group => group.length && group.every(g => g.targets !== null && g.carries !== null) ? group.reduce((sum, g) => sum + g.targets + g.carries, 0) / group.length : null;
    const recentUsage = totals(playerGames.slice(0, 2)), previousUsage = totals(playerGames.slice(2, 4));
    players[id] = { provider_positions: [...new Set(playerGames.map(g => g.provider_position))], analytics_positions: [...new Set(playerGames.map(g => g.position))], scoring_positions: [...new Set(playerGames.map(g => g.scoring_position))], ppg: mean(playerGames), recorded_games: playerGames.length, scored_games: scored.length,
      denominator: "nflverse statistical appearances; missing zero-action appearances are not imputed",
      scoring_status: playerGames.every(g => g.scoring.status === "complete") ? "complete" : "partial",
      unsupported_rules: [...new Set(playerGames.flatMap(g => g.scoring.unsupported_rules))],
      missing_stats: [...new Set(playerGames.flatMap(g => g.scoring.missing_stats))],
      recent_average: mean(recent), recent_games: recent.map(({ raw_stats, scoring, ...game }) => ({ ...game, scoring_status: scoring.status })),
      usage_trend: playerGames.length >= 4 && recentUsage !== null && previousUsage !== null ? recentUsage - previousUsage : null,
      usage_basis: "targets + carries per recorded game: latest two vs preceding two" };
  }
  return { players, games, unmatched_ids: [...unmatched] };
}
