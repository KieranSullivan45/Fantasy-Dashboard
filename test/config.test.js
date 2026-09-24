import test from "node:test";
import assert from "node:assert/strict";
import installation from "../config/installation.json" with { type: "json" };
import { getConfiguredLeagueIds } from "../lib/config.js";
test("blank optional deployment league configuration retains installation defaults", () => {
  const previous = process.env.SLEEPER_LEAGUE_IDS;
  try {
    for (const value of ["", "  "]) { process.env.SLEEPER_LEAGUE_IDS = value; assert.deepEqual(getConfiguredLeagueIds(), installation.league_ids); }
    process.env.SLEEPER_LEAGUE_IDS = "333333,444444,555555";
    assert.deepEqual(getConfiguredLeagueIds(), ["333333", "444444", "555555"]);
  } finally { if (previous === undefined) delete process.env.SLEEPER_LEAGUE_IDS; else process.env.SLEEPER_LEAGUE_IDS = previous; }
});
