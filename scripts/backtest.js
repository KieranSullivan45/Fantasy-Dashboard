import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseCsv } from "../lib/sources/csv.js";
import { historicalGames, FORMATS } from "../lib/backtest/data.js";
import { buildCases, CANDIDATES, candidateForecast, evaluate, legacyScores } from "../lib/backtest/evaluate.js";
const cache = new URL("../.data/backtest/", import.meta.url), sources = [];
await mkdir(cache, { recursive: true });
async function download(name, url) {
  const path = new URL(name, cache); let text;
  try { text = await readFile(path, "utf8"); } catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error(`${url}: ${response.status}`);
    text = await response.text(); await writeFile(path, text);
  }
  sources.push({ name, url, sha256: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text) });
  return parseCsv(text).rows;
}
const ids = await download("ids.csv", "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv");
const datasets = {};
for (const year of [2021, 2022, 2023, 2024, 2025]) {
  console.log(`Loading ${year} historical statistics, snaps and pinned xFP`);
  const stats = await download(`stats-${year}.csv`, `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`);
  const snaps = await download(`snaps-${year}.csv`, `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${year}.csv`);
  const opportunity = await download(`xfp-${year}.csv`, `https://github.com/ffverse/ffopportunity/releases/download/v1.0.0-data/ep_weekly_${year}.csv`);
  datasets[year] = Object.fromEntries(Object.entries(FORMATS).map(([name, settings]) => [name, historicalGames(stats, snaps, opportunity, ids, settings)]));
}
const report = { model_version: "decision-0.3.2", feature_version: "weekly-features-2", generated_at: new Date().toISOString(),
  protocol: { training: [2022], validation: [2023], test: [2024, 2025], prior_only: [2021], weeks: [3, 17], opportunity_model: "ffopportunity v1.0.0; documented training 2006–2020",
    selection: "Per-position validation MAE for starts; validation 3-week rank correlation for acquisition. Test years never select weights.",
    limitations: ["Corrected retrospective data, not archived publication-time vintages", "Missing future stat rows are censored, not assumed DNP zeroes", "Acquisition targets are observed-game means within 1/3/4 calendar weeks; not exact historical league waiver pools", "No historical injuries, current Sleeper ownership, or market data used", "Model weights calibrated in PPR only; TE-premium evaluated without re-tuning"] }, sources, formats: {}, selected: {} };
const allCases = {};
for (const format of Object.keys(FORMATS)) {
  const games = Object.values(datasets).flatMap(d => d[format]);
  allCases[format] = Object.fromEntries([2022, 2023, 2024, 2025].map(year => [year, buildCases(games, year)]));
}
for (const position of ["QB", "RB", "WR", "TE"]) {
  const validation = allCases.ppr[2023].cases.filter(c => c.position === position);
  const scores = Object.keys(CANDIDATES).map(name => ({ name, start: evaluate(validation, c => candidateForecast(name, c)), pickup: evaluate(validation, c => candidateForecast(name, c), c => c.outcomes[3].games >= 2 ? c.outcomes[3].points : null) }));
  const bestStart = [...scores].sort((a, b) => a.start.mae - b.start.mae)[0];
  const bestPickup = [...scores].sort((a, b) => b.pickup.spearman - a.pickup.spearman)[0];
  report.selected[position] = { start: { name: bestStart.name, weights: CANDIDATES[bestStart.name] }, pickup: { name: bestPickup.name, weights: CANDIDATES[bestPickup.name] }, validation_candidates: scores };
}
for (const format of Object.keys(FORMATS)) {
  report.formats[format] = {};
  for (const year of [2022, 2023, 2024, 2025]) {
    const { cases, missing_weekly_outcomes } = allCases[format][year], legacy = legacyScores(cases);
    const selected = c => candidateForecast(report.selected[c.position].start.name, c);
    const acquisition = c => candidateForecast(report.selected[c.position].pickup.name, c);
    const featureKeys = ["snap_share", "target_share", "carry_share", "air_yard_share", "wopr", "xfp", "fpoe", "racr", "passing_epa_per_dropback"];
    report.formats[format][year] = { cases: cases.length, missing_weekly_outcomes,
      start: evaluate(cases, selected), historical_ppg: evaluate(cases, c => c.features.season_ppg),
      v031_observable_components: evaluate(cases, c => legacy.get(c), c => c.actual, { pointScale: false }),
      per_position: Object.fromEntries(["QB", "RB", "WR", "TE"].map(pos => [pos, evaluate(cases.filter(c => c.position === pos), selected)])),
      acquisition: Object.fromEntries([1, 3, 4].map(h => [h, { calibrated: evaluate(cases, acquisition, c => c.outcomes[h].games >= (h === 1 ? 1 : 2) ? c.outcomes[h].points : null),
        ppg_baseline: evaluate(cases, c => c.features.season_ppg, c => c.outcomes[h].games >= (h === 1 ? 1 : 2) ? c.outcomes[h].points : null),
        future_xfp: evaluate(cases, acquisition, c => c.outcomes[h].xfp, { pointScale: false }), future_snap_share: evaluate(cases, acquisition, c => c.outcomes[h].snap_share, { pointScale: false }) }])),
      feature_screen: Object.fromEntries(featureKeys.map(key => [key, evaluate(cases, c => c.features.feature_inputs[key], c => c.actual, { pointScale: false })])),
      future_opportunity_screen: Object.fromEntries(featureKeys.map(key => [key, evaluate(cases, c => c.features.feature_inputs[key], c => c.outcomes[3].xfp, { pointScale: false })])),
    };
    console.log(JSON.stringify({ format, year, start: report.formats[format][year].start, baseline: report.formats[format][year].historical_ppg.mae }));
  }
}
await writeFile(new URL("../artifacts/backtests/v032-results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
const selected = Object.fromEntries(Object.entries(report.selected).map(([pos, models]) => [pos, { start: models.start, pickup: models.pickup }]));
// Explicit opt-in writes production weights; ordinary reproductions only update the report.
if (process.argv.includes("--write-calibration")) await writeFile(new URL("../lib/decision/calibration/weights.js", import.meta.url), `// Selected using 2023 validation only; 2024/2025 are untouched evaluation seasons.\nexport const CALIBRATION = ${JSON.stringify(selected, null, 2)};\n`);
console.log("Saved artifacts/backtests/v032-results.json");

