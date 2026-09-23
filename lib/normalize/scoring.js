import { finiteNumber } from "../sources/contracts.js";

const RULES = {
  pass_yd: "passing_yards", pass_td: "passing_tds", pass_int: "passing_interceptions", pass_2pt: "passing_2pt_conversions",
  pass_att: "attempts", pass_cmp: "completions", rush_yd: "rushing_yards", rush_td: "rushing_tds", rush_2pt: "rushing_2pt_conversions", rush_att: "carries",
  rec: "receptions", rec_yd: "receiving_yards", rec_td: "receiving_tds", rec_2pt: "receiving_2pt_conversions",
  fum_lost: "fumbles_lost_total", fum: "fumbles_total", fum_rec_td: "fumble_recovery_tds", st_td: "special_teams_tds",
  xpm: "pat_made", xpmiss: "pat_missed", fgmiss: "fg_missed", fgm: "fg_made",
  fgm_0_19: "fg_made_0_19", fgm_20_29: "fg_made_20_29", fgm_30_39: "fg_made_30_39", fgm_40_49: "fg_made_40_49", fgm_50_59: "fg_made_50_59", fgm_60p: "fg_made_60_",
};
const DEFENSE = new Set(["sack", "int", "ff", "fum_rec", "def_td", "safe", "blk_kick", "tkl", "tkl_solo", "tkl_ast", "tkl_loss", "qb_hit", "pass_def"]);
const kicking = key => /^(fg|xp)/.test(key);
const defense = key => DEFENSE.has(key) || /^(def_|pts_allow|yds_allow|idp_)/.test(key);

export function scoreStats(raw, settings, position = raw.position) {
  if (position === "DEF" || !["QB", "RB", "WR", "TE", "K"].includes(position)) return { points: null, status: "unsupported", unsupported_rules: ["D/ST and IDP historical scoring"], missing_stats: [], components: {} };
  const unsupported = [], missing = [], components = {};
  for (const [rule, coefficient] of Object.entries(settings || {})) {
    if (Number(coefficient) === 0 || defense(rule) || (position !== "K" && kicking(rule))) continue;
    let count;
    if (rule === "bonus_rec_te" || rule === "bonus_rec_rb" || rule === "bonus_rec_wr") {
      if (position !== rule.slice(-2).toUpperCase()) continue;
      count = finiteNumber(raw.receptions);
    } else if (rule === "pass_inc") {
      const attempts = finiteNumber(raw.attempts), completions = finiteNumber(raw.completions);
      count = attempts === null || completions === null ? null : attempts - completions;
    } else if (RULES[rule]) count = finiteNumber(raw[RULES[rule]]);
    else { unsupported.push(rule); continue; }
    if (count === null) { missing.push(RULES[rule] || rule); continue; }
    components[rule] = count * Number(coefficient);
  }
  const points = Math.round(Object.values(components).reduce((a, b) => a + b, 0) * 10000) / 10000;
  return { points: missing.length ? null : points, supported_points: points,
    status: unsupported.length || missing.length ? "partial" : "complete", unsupported_rules: unsupported, missing_stats: missing, components };
}

export const scoringProfile = settings => JSON.stringify(Object.fromEntries(Object.entries(settings || {}).sort(([a], [b]) => a.localeCompare(b))));
