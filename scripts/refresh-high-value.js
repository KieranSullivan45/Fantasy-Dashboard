import { spawnSync } from "node:child_process";
import { getConfiguredLeagueIds } from "../lib/config.js";
import { publicSleeper } from "../lib/accounts/sleeper.js";
const seasons = new Set();
for (const id of getConfiguredLeagueIds()) {
  const league = await publicSleeper(`/league/${id}`);
  if (!league?.season || league.sport !== "nfl") throw new Error("Configured NFL league unavailable");
  seasons.add(String(league.season));
}
for (const season of seasons) {
  const result = spawnSync(process.execPath, ["scripts/precompute-high-value.js", season, process.argv[2] || ".data/precomputed"], { stdio: "inherit" });
  // Preserve prior aggregates and keep capturing even if a future-season PBP file is not yet published.
  if (result.status !== 0) console.warn(`High-value aggregate unavailable for ${season}; existing data (if any) retained with its original through-week.`);
}
