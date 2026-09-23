import { finiteNumber as n } from "../sources/contracts.js";
const RULES = { pass_yd: "pass_yards_gained", pass_td: "pass_touchdown", pass_int: "pass_interception", pass_cmp: "pass_completions", pass_2pt: "pass_two_point_conv", rec: "receptions", rec_yd: "rec_yards_gained", rec_td: "rec_touchdown", rec_2pt: "rec_two_point_conv", rush_yd: "rush_yards_gained", rush_td: "rush_touchdown", rush_2pt: "rush_two_point_conv" };
// Re-score expected event counts; never use the provider's generic fantasy-point totals.
export function scoreOpportunity(row, settings, position) {
  if (!["QB", "RB", "WR", "TE"].includes(position)) return null;
  const components = {}, excluded = [], missing = [];
  for (const [rule, coefficient] of Object.entries(settings)) {
    if (!Number(coefficient) || /^(def_|pts_allow|yds_allow|fg|xp)/.test(rule) || ["sack", "int", "ff", "fum_rec", "safe", "blk_kick"].includes(rule)) continue;
    let field = RULES[rule];
    if (/^bonus_rec_(te|rb|wr)$/.test(rule)) {
      if (position !== rule.slice(-2).toUpperCase()) continue;
      field = "receptions";
    }
    if (!field) { excluded.push(rule); continue; }
    const expected = n(row[`${field}_exp`]), actual = n(row[field]);
    if (expected === null || actual === null) { missing.push(field); continue; }
    components[rule] = { actual: actual * coefficient, expected: expected * coefficient, raw_actual: actual, raw_expected: expected, coefficient };
  }
  const expected = missing.length ? null : Object.values(components).reduce((s, c) => s + c.expected, 0);
  const actual = missing.length ? null : Object.values(components).reduce((s, c) => s + c.actual, 0);
  return { expected_points: expected, actual_matching_rules: actual, points_over_expected: expected === null ? null : actual - expected,
    status: missing.length || excluded.length ? "partial" : "complete", excluded_rules: excluded, missing_fields: missing, components,
    basis: "ffopportunity expected event counts re-scored with league coefficients. Actual-minus-expected uses identical covered rules; excludes unsupported events. Not a projection." };
}
