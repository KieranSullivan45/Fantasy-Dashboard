import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDecisionContext } from "../lib/decision/build-context.js";
import { getConfiguredLeagueIds, getConfiguredUsername } from "../lib/config.js";
import { appendCapture } from "../lib/history/git-store.js";
import { loadStats } from "../lib/sources/stats/nflverse.js";
import { buildH9ShadowCapture, appendH9ShadowCapture } from "../lib/shadow/h9.js";
const directory = process.argv[2] || ".data/archive-data";
await mkdir(directory, { recursive: true });
for (const league of getConfiguredLeagueIds()) {
  let shadowInputs = null;
  const decision = await buildDecisionContext(league, { identity: { userId: getConfiguredUsername() || null }, shadowObserver: inputs => { shadowInputs = inputs; },
    highValueSource: async season => { try { const data = JSON.parse(await readFile(join(directory, "high-value", `${season}.json`), "utf8")); return { source_id: "nflverse_high_value", data, status: "available", digest: data.provenance.sha256, warnings: [] }; } catch { return { source_id: "nflverse_high_value", data: null, status: "unavailable", warnings: ["Aggregate not available"] }; } },
    marketHistorySource: async season => { try { return { status: "available", data: JSON.parse(await readFile(join(directory, "market", `${season}.json`), "utf8")) }; } catch { return { status: "unavailable", data: null }; } },
  });
  // Worker revision is the code executing the capture, not the archive branch's old source copy.
  decision.implementation_revision = process.env.GITHUB_SHA || decision.implementation_revision;
  const capture = await appendCapture(directory, decision);
  console.log(JSON.stringify(capture));
  // H9 shadow (ADR 0009): research-only, written after the production capture; its failure never fails this run.
  try { console.log(JSON.stringify({ h9_shadow: await appendH9ShadowCapture(directory, await buildH9ShadowCapture({ decision, internals: shadowInputs, statsSource: loadStats, classification: "prospective", linkedCaptureId: capture.capture_id })) })); }
  catch (error) { console.log(JSON.stringify({ h9_shadow: { status: "failed", error: error.message } })); }
  const marketPath = join(directory, "market", `${decision.league.season}.json`); let market = { schema_version: "market-history-1", observations: [] };
  try { market = JSON.parse(await readFile(marketPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const current = Object.values(decision.player_context).map(c => c.market_attention).filter(m => m?.raw_count != null);
  const byWindow = new Map([...market.observations, ...current].map(m => [`${m.player_id}:${Math.floor(Date.parse(m.timestamp) / 21600000)}`, m]));
  const earliest = Date.parse(decision.generated_at) - 14 * 86400000;
  market.observations = [...byWindow.values()].filter(m => Date.parse(m.timestamp) >= earliest);
  market.note = "Rolling 14-day comparison index; original attention observations remain in immutable capture records and Git history.";
  await mkdir(join(directory, "market"), { recursive: true }); await writeFile(marketPath, JSON.stringify(market));
}
