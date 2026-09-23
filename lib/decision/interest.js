import { fantasyPositions, uniquePlayers } from "../normalize/positions.js";
export function interestContext(candidates, unavailable = false) {
  const players = uniquePlayers(candidates), observed = players.filter(p => p.trending_adds_24h > 0);
  const percentile = (player, pool) => pool.length ? 100 * pool.filter(p => (p.trending_adds_24h || 0) < player.trending_adds_24h).length / pool.length : null;
  return Object.fromEntries(players.map(player => [player.player_id, {
    sleeper_adds_24h: unavailable || !(player.trending_adds_24h > 0) ? null : player.trending_adds_24h,
    available_percentile: !unavailable && player.trending_adds_24h > 0 ? percentile(player, players) : null,
    positional_percentiles: Object.fromEntries(fantasyPositions(player).map(pos => [pos, !unavailable && player.trending_adds_24h > 0 ? percentile(player, players.filter(p => fantasyPositions(p).includes(pos))) : null])),
    available_rank: !unavailable && player.trending_adds_24h > 0 ? 1 + observed.filter(p => p.trending_adds_24h > player.trending_adds_24h).length : null,
    pool_size: players.length, upstream_limit: 100, observation: unavailable ? "source_unavailable" : player.trending_adds_24h > 0 ? "observed" : "not_in_top_100",
    meaning: "Sleeper add interest only. Top-100 feed; unlisted players are censored below the cutoff, not known zero adds. Percentiles are among available players, not ownership or usage." }]));
}
