// Projection experiment: point-in-time game context, opponent strength and the consensus benchmark (research only).
// Every as-of quantity for (season, week) uses rows strictly before that week. Betting-derived columns (closing spread and
// total from the nflverse schedule) are labelled and kept apart so every model can be run with and without them.
import { numeric, mean } from "../../decision/features.js";
import { normalizeTeam } from "../../sources/contracts.js";
import { assertNotSealed } from "../edge01/data.js";

export const BETTING_DERIVED_FEATURES = new Set(["implied_total", "spread_for", "game_total"]);
const num = v => (v === "" || v === "NA" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Team-week schedule context from the nflverse schedule (REG only). Lines are closing lines: known before kickoff, betting-
 * derived. spread_line is the expected home margin; implied team total = (total ± spread) / 2.
 */
export function scheduleContext(rows) {
  const out = new Map(), weekDates = new Map();
  for (const r of rows) {
    if (r.game_type !== "REG") continue;
    const season = Number(r.season), week = Number(r.week); assertNotSealed(season);
    const home = normalizeTeam(r.home_team), away = normalizeTeam(r.away_team), spread = num(r.spread_line), total = num(r.total_line);
    const side = (team, opp, isHome) => ({ season, week, game_id: r.game_id, gameday: r.gameday, team, opponent: opp, home: isHome ? 1 : 0,
      rest: num(isHome ? r.home_rest : r.away_rest), opp_rest: num(isHome ? r.away_rest : r.home_rest), dome: r.roof === "dome" || r.roof === "closed" ? 1 : 0,
      spread_for: spread === null ? null : isHome ? spread : -spread, game_total: total,
      implied_total: spread === null || total === null ? null : (total + (isHome ? spread : -spread)) / 2 });
    out.set(`${season}:${week}:${home}`, side(home, away, true));
    out.set(`${season}:${week}:${away}`, side(away, home, false));
    const wk = `${season}:${week}`, d = weekDates.get(wk) || { first: r.gameday, last: r.gameday };
    if (r.gameday < d.first) d.first = r.gameday; if (r.gameday > d.last) d.last = r.gameday; weekDates.set(wk, d);
  }
  return { teamWeek: out, weekDates };
}

/**
 * Points allowed by each defense to each position, per game, from all player rows of a season (absent rows add nothing).
 * Returns season -> defense -> position -> [{ week, points }].
 */
export function allowedByDefense(gamesBySeason) {
  const out = {};
  for (const [season, games] of Object.entries(gamesBySeason)) {
    const per = new Map();
    for (const g of games) {
      if (!numeric(g.points) || !g.opponent) continue;
      const k = `${g.opponent}|${g.position}|${g.week}`; per.set(k, (per.get(k) || 0) + g.points);
    }
    const s = out[season] = {};
    for (const [k, pts] of per) { const [def, pos, week] = k.split("|"); ((s[def] ??= {})[pos] ??= []).push({ week: Number(week), points: pts }); }
  }
  return out;
}

/**
 * As-of opponent strength vs a position: current-season games before `week`, shrunk toward the defense's previous-season
 * mean with `k` pseudo-games, divided by the as-of league mean for that position. null when nothing is known.
 */
export function opponentFactor(allowed, season, week, defense, position, k = 4) {
  const cur = (allowed[season]?.[defense]?.[position] || []).filter(r => r.week < week).map(r => r.points);
  const prev = (allowed[season - 1]?.[defense]?.[position] || []).map(r => r.points);
  const league = [];
  for (const d of Object.values(allowed[season] || {})) for (const r of d[position] || []) if (r.week < week) league.push(r.points);
  const leaguePrev = []; for (const d of Object.values(allowed[season - 1] || {})) for (const r of d[position] || []) leaguePrev.push(r.points);
  const lm = league.length >= 32 ? mean(league) : leaguePrev.length ? mean(leaguePrev) : null;
  if (!lm) return null;
  const pm = prev.length ? mean(prev) : lm;
  const est = (cur.reduce((a, b) => a + b, 0) + k * pm) / (cur.length + k);
  return est / lm;
}

/** Exact fantasypros_id -> gsis_id from the DynastyProcess crosswalk; any id seen twice with different targets is unknown. */
export function fantasyProsToGsis(ids) {
  const out = new Map();
  for (const r of ids) {
    const fp = r.fantasypros_id, g = r.gsis_id;
    if (!fp || fp === "NA" || !g || g === "NA") continue;
    if (out.has(fp) && out.get(fp) !== g) out.set(fp, null); else if (!out.has(fp)) out.set(fp, g);
  }
  return out;
}

/**
 * Consensus (FantasyPros ECR) snapshots assigned to the NFL week they precede: a scrape belongs to the first REG week whose
 * last game date is after the scrape date. A player-game may use a snapshot only if it was scraped strictly before that
 * game's date. Benchmark only, never a model input.
 * Returns kind -> `${season}:${week}` -> [{ date, byGsis: Map(gsis -> { rank, ecr, sd }) }] (date ascending).
 */
export function consensusSnapshots(rows, weekDates, fpToGsis) {
  const weeks = [...weekDates.entries()].map(([k, d]) => ({ k, season: Number(k.split(":")[0]), week: Number(k.split(":")[1]), ...d }))
    .sort((a, b) => a.season - b.season || a.week - b.week);
  const assign = date => weeks.find(w => w.last > date && w.first >= addDays(date, -6));
  const snaps = { week: new Map(), ros: new Map() };
  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.kind}|${r.scrape_date}|${r.position}`; (grouped.get(key) ?? grouped.set(key, []).get(key)).push(r);
  }
  for (const [key, list] of grouped) {
    const [kind, date, position] = key.split("|"), w = assign(date);
    if (!w) continue;
    assertNotSealed(w.season);
    const byWeek = snaps[kind];
    const arr = byWeek.get(w.k) ?? byWeek.set(w.k, []).get(w.k);
    let snap = arr.find(s => s.date === date); if (!snap) { snap = { date, byGsis: new Map(), unmatched: 0 }; arr.push(snap); }
    // Positional rank by ECR (ties by id for determinism); the ECR value itself is an average expert rank.
    const sorted = list.filter(r => num(r.ecr) !== null).sort((a, b) => num(a.ecr) - num(b.ecr) || a.fantasypros_id.localeCompare(b.fantasypros_id));
    sorted.forEach((r, i) => {
      const g = fpToGsis.get(r.fantasypros_id);
      if (!g) { snap.unmatched++; return; }
      snap.byGsis.set(g, { position, rank: i + 1, ecr: num(r.ecr), sd: num(r.sd) });
    });
  }
  for (const m of Object.values(snaps)) for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return snaps;
}
const addDays = (date, d) => { const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/** Latest snapshot strictly before `gameday` (point-in-time for that game). */
export function snapshotBefore(list, gameday) {
  let best = null; for (const s of list || []) if (s.date < gameday) best = s;
  return best;
}
