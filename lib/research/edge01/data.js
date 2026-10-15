// EDGE-01 research data layer (class R/X, offline only). Never imported by production runtime paths.
// Wraps the production backtest game builder read-only and adds team context derived from the same files.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseCsv } from "../../sources/csv.js";
import { historicalGames, FORMATS } from "../../backtest/data.js";
import { finiteNumber as n, normalizeTeam } from "../../sources/contracts.js";

/** Evaluation Protocol v1 §2: 2026 is sealed. No research loader may read it. */
export const SEALED_SEASON = 2026;
/** Protocol v1 §2.5: ffopportunity xFP is valid only from 2021 (trained on 2006–2020). */
export const XFP_FLOOR = 2021;
/** Research formats: repo PPR / TE premium plus PPR with the reception value changed (research-only, never calibrated). */
export const RESEARCH_FORMATS = { ppr: FORMATS.ppr, half: { ...FORMATS.ppr, rec: 0.5 }, standard: { ...FORMATS.ppr, rec: 0 }, te_premium: FORMATS.te_premium };

export function assertNotSealed(season) {
  if (!Number.isInteger(season) || season >= SEALED_SEASON) throw new Error(`Season ${season} is sealed or invalid for EDGE-01 research`);
}

export async function loadCsv(path, provenance) {
  const text = await readFile(path, "utf8");
  provenance?.push({ file: path.split("/").at(-1), sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text) });
  return parseCsv(text).rows;
}

/** Team-game totals derived only from rows in the same files. Absent teams/games stay absent (never zero). */
export function teamTotals(stats, snaps) {
  const totals = new Map();
  for (const r of stats) {
    if (r.season_type !== "REG") continue;
    const key = `${normalizeTeam(r.team)}:${r.game_id}`;
    const t = totals.get(key) || { targets: 0, carries: 0, pass_attempts: 0, air_yards: 0, plays: null };
    t.targets += n(r.targets) || 0; t.carries += n(r.carries) || 0; t.pass_attempts += n(r.attempts) || 0; t.air_yards += n(r.receiving_air_yards) || 0;
    totals.set(key, t);
  }
  // Team offensive plays proxy: the largest offensive snap count any player on the team recorded in that game.
  for (const r of snaps) {
    if (r.game_type !== "REG") continue;
    const key = `${normalizeTeam(r.team)}:${r.game_id}`, s = n(r.offense_snaps), t = totals.get(key);
    if (t && s !== null && (t.plays === null || s > t.plays)) t.plays = s;
  }
  return totals;
}

/**
 * One row per player-game with PPR as the base row and every research format's points attached.
 * Pre-2021 seasons get no xFP (ffopportunity is not loaded and would be in-sample there).
 */
export function buildSeasonGames({ stats, snaps, opportunity, ids }, season) {
  assertNotSealed(season);
  const opp = season >= XFP_FLOOR ? opportunity : [];
  const base = historicalGames(stats, snaps, opp, ids, RESEARCH_FORMATS.ppr);
  // xFP/FPOE are re-scored per format by ffopportunity's components, exactly like points; never reuse PPR xFP elsewhere.
  const byKey = new Map(base.map(g => [`${g.player_id}:${g.game_id}`, { ...g, points_by_format: { ppr: g.points }, xfp_by_format: { ppr: g.xfp }, fpoe_by_format: { ppr: g.fpoe } }]));
  for (const [name, settings] of Object.entries(RESEARCH_FORMATS)) {
    if (name === "ppr") continue;
    for (const g of historicalGames(stats, snaps, opp, ids, settings)) {
      const row = byKey.get(`${g.player_id}:${g.game_id}`);
      if (row) { row.points_by_format[name] = g.points; row.xfp_by_format[name] = g.xfp; row.fpoe_by_format[name] = g.fpoe; }
    }
  }
  const totals = teamTotals(stats, snaps);
  for (const g of byKey.values()) {
    const t = totals.get(`${g.team}:${g.game_id}`);
    g.team_targets = t ? t.targets : null; g.team_carries = t ? t.carries : null;
    g.team_pass_attempts = t ? t.pass_attempts : null; g.team_air_yards = t ? t.air_yards : null; g.team_plays = t ? t.plays : null;
    g.xfp_valid = season >= XFP_FLOOR;
  }
  return [...byKey.values()].filter(g => g.season === season);
}

/** Exact gsis_id → draft round from the DynastyProcess crosswalk. Duplicated ids stay unknown (no identity guessing). */
export function draftRounds(ids) {
  const out = new Map(), dup = new Set();
  for (const r of ids) {
    if (!r.gsis_id || r.gsis_id === "NA") continue;
    if (out.has(r.gsis_id)) dup.add(r.gsis_id);
    const round = Number(r.draft_round);
    out.set(r.gsis_id, r.draft_round && r.draft_round !== "NA" && Number.isInteger(round) && round >= 1 && round <= 7 ? round : null);
  }
  for (const d of dup) out.set(d, null);
  return out;
}

/** Load every season in [first, last] from a local directory of already-downloaded public files. */
export async function loadSeasons(dir, first, last) {
  assertNotSealed(last);
  const provenance = [];
  const ids = await loadCsv(`${dir}/ids.csv`, provenance);
  const games = {};
  for (let season = first; season <= last; season++) {
    const stats = await loadCsv(`${dir}/stats-${season}.csv`, provenance);
    const snaps = await loadCsv(`${dir}/snaps-${season}.csv`, provenance);
    const opportunity = season >= XFP_FLOOR ? await loadCsv(`${dir}/xfp-${season}.csv`, provenance) : [];
    if (stats.some(r => Number(r.season) >= SEALED_SEASON)) throw new Error("Sealed-season rows present in a research input");
    games[season] = buildSeasonGames({ stats, snaps, opportunity, ids }, season);
  }
  return { games, ids, draft: draftRounds(ids), provenance };
}
