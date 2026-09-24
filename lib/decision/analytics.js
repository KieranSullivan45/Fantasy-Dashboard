import { finiteNumber as n, normalizeTeam } from "../sources/contracts.js";
import { playerIdMap } from "../normalize/player-ids.js";
const mean = values => values.length && values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) / values.length : null;
const ratio = (a, b) => a !== null && b !== null && b > 0 ? a / b : null;
const sum = values => values.length && values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
const fraction = value => { const v = n(value); return v !== null && v >= 0 && v <= 1 ? v : null; };

export function usageTrend(history, field, throughWeek) {
  const recent = history.slice(-2), prior = history.slice(-4, -2);
  const current = mean(recent.map(h => h[field])), previous = mean(prior.map(h => h[field]));
  const window = history.slice(-4);
  const sufficient = window.length === 4 && new Set(window.map(h => h.team)).size === 1 && window.at(-1).week >= throughWeek && window.at(-1).week - window[0].week <= 4;
  return { recent_average: current, prior_average: previous, delta: sufficient && current !== null && previous !== null ? current - previous : null,
    recent_games: recent.length, prior_games: prior.length, through_week: history.at(-1)?.week ?? null,
    basis: "Latest two vs previous two recorded games on the same team; minimum four games, current prior week required" };
}

export function usageSignals(history, throughWeek) {
  const signals = [];
  const flag = (label, metric, threshold, direction = 1) => {
    const evidence = usageTrend(history, metric, throughWeek);
    if (evidence.delta !== null && direction * evidence.delta >= threshold) signals.push({ label, metric, evidence, threshold, sample_games: 4, predictive: false });
  };
  flag("Role expanding", "snap_share", 0.15);
  flag("Role contracting", "snap_share", 0.15, -1);
  flag("Target share rising", "target_share", 0.06);
  flag("Backfield takeover watch", "carry_share", 0.15);
  const targets = usageTrend(history, "target_share", throughWeek), points = usageTrend(history, "fantasy_points", throughWeek);
  if (targets.delta >= 0.06 && targets.delta !== null && points.delta !== null && points.delta <= 0) signals.push({ label: "Production lagging opportunity", metric: "targets_vs_points", evidence: { target_share: targets, fantasy_points: points }, sample_games: 4, predictive: false });
  const racr = usageTrend(history, "racr", throughWeek), air = history.slice(-2);
  if (racr.delta !== null && racr.recent_average > 1.5 && air.every(h => h.air_yards >= 30)) signals.push({ label: "Efficiency warning", metric: "racr", evidence: { ...racr, recent_air_yards: air.map(h => h.air_yards), threshold: 1.5 }, sample_games: 4, predictive: false });
  const wopr = usageTrend(history, "wopr", throughWeek);
  if (wopr.delta !== null && wopr.recent_average >= 0.6) signals.push({ label: "High-value receiving usage", metric: "wopr", evidence: { ...wopr, threshold: 0.6 }, sample_games: 4, predictive: false });
  return signals;
}

export function buildAnalytics(rawRows, snapRows, idRows, { season, week, production, idColumn = "sleeper_id" }) {
  const gsis = playerIdMap(idRows, idColumn).map;
  const pfr = playerIdMap(idRows.map(row => ({ ...row, gsis_id: row.pfr_id })), idColumn).map;
  const valid = (row, type) => Number(row.season) === season && row[type] === "REG" && Number(row.week) > 0 && Number(row.week) < week;
  const rows = [...new Map(rawRows.filter(r => valid(r, "season_type")).map(r => [`${r.player_id}:${r.game_id}`, r])).values()];
  const teamGames = new Map();
  for (const row of rows) {
    const key = `${normalizeTeam(row.team)}:${row.game_id}`;
    if (!teamGames.has(key)) teamGames.set(key, []);
    teamGames.get(key).push(row);
  }
  const histories = new Map();
  const record = (id, row) => {
    if (!histories.has(id)) histories.set(id, new Map());
    const games = histories.get(id);
    if (!games.has(row.game_id)) games.set(row.game_id, { game_id: row.game_id, week: Number(row.week), team: normalizeTeam(row.team), snap_count: null, snap_share: null, targets: null, target_share: null, carries: null, carry_share: null, opportunities: null, air_yards: null, air_yard_share: null, wopr: null, racr: null, fantasy_points: null });
    return games.get(row.game_id);
  };
  for (const row of rows) {
    const id = gsis.get(row.player_id); if (!id) continue;
    const game = record(id, row), team = teamGames.get(`${normalizeTeam(row.team)}:${row.game_id}`);
    const totalCarries = sum(team.map(r => n(r.carries)));
    const targets = n(row.targets), carries = n(row.carries);
    Object.assign(game, { provider_position: row.position, targets, carries, target_share: fraction(row.target_share), carry_share: ratio(carries, totalCarries), team_carries: totalCarries,
      opportunities: targets !== null && carries !== null ? targets + carries : null,
      air_yards: n(row.receiving_air_yards), air_yard_share: n(row.air_yards_share), wopr: n(row.wopr), racr: n(row.racr),
      fantasy_points: production.games.find(g => g.player_id === id && g.game_id === row.game_id)?.points ?? null,
      passing_epa: n(row.passing_epa), passing_attempts: n(row.attempts), sacks: n(row.sacks_suffered),
      passing_epa_per_attempt_or_sack: ratio(n(row.passing_epa), n(row.attempts) !== null && n(row.sacks_suffered) !== null ? n(row.attempts) + n(row.sacks_suffered) : null) });
  }
  let unmappedSnaps = 0;
  for (const row of snapRows.filter(r => valid(r, "game_type"))) {
    const id = pfr.get(row.pfr_player_id); if (!id) { unmappedSnaps++; continue; }
    const game = record(id, row);
    game.snap_count = n(row.offense_snaps); game.snap_share = fraction(row.offense_pct); game.snap_provider_position = row.position;
  }
  const players = {};
  for (const [id, records] of histories) {
    const history = [...records.values()].sort((a, b) => a.week - b.week);
    const trends = Object.fromEntries(["snap_share", "target_share", "carry_share", "opportunities"].map(key => [key, usageTrend(history, key, week - 1)]));
    players[id] = { source_ids: ["nflverse_stats", "nflverse_snaps"], history, latest: history.at(-1), trends,
      signals: usageSignals(history, week - 1), recorded_games: history.length, through_week: history.at(-1).week, small_sample: history.length < 4,
      season: Object.fromEntries(["snap_share", "targets", "carries", "opportunities", "target_share", "carry_share", "wopr", "racr"].map(key => [key, { mean_per_recorded_game: mean(history.map(h => h[key])), observed_games: history.filter(h => h[key] !== null).length }])),
      missing_metrics: ["red_zone_opportunities", "xfp", "fantasy_points_over_expected"],
      xfp: null, fantasy_points_over_expected: null, red_zone_opportunities: null };
  }
  const environment = {};
  for (const [key, group] of teamGames) {
    const row = group[0], team = normalizeTeam(row.team);
    const attempts = sum(group.map(r => n(r.attempts))), sacks = sum(group.map(r => n(r.sacks_suffered))), carries = sum(group.map(r => n(r.carries)));
    // EPA blanks on zero-action defensive/kicking rows are not observations.
    const passing = group.filter(r => (n(r.attempts) || 0) + (n(r.sacks_suffered) || 0) > 0);
    const rushing = group.filter(r => n(r.carries) > 0);
    const passingEPA = sum(passing.map(r => n(r.passing_epa))), rushingEPA = sum(rushing.map(r => n(r.rushing_epa)));
    const dropbacks = attempts !== null && sacks !== null ? attempts + sacks : null;
    const plays = dropbacks !== null && carries !== null ? dropbacks + carries : null;
    if (!environment[team]) environment[team] = [];
    environment[team].push({ game_id: row.game_id, week: Number(row.week), pass_attempts: attempts, sacks, carries,
      passing_epa: passingEPA, rushing_epa: rushingEPA, pass_attempt_or_sack_rate: ratio(dropbacks, plays),
      epa_per_recorded_play: ratio(passingEPA !== null && rushingEPA !== null ? passingEPA + rushingEPA : null, plays),
      success_rate: null, basis: "Recorded plays = attempts + sacks + carries; not full play-by-play. Scrambles are carries, not dropbacks." });
  }
  return { players, environment: Object.fromEntries(Object.entries(environment).map(([team, games]) => [team, games.sort((a, b) => a.week - b.week)])), unmapped_snap_rows: unmappedSnaps };
}
