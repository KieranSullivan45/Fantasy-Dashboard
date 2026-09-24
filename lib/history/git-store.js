import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { captureObservations, digest } from "./contracts.js";
const safe = value => { const s = String(value); if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw new Error("Invalid archive partition"); return s; };
/** Worker writes into an isolated data-branch checkout. Git commit/push supplies atomic publication. */
export async function appendCapture(directory, decision) {
  const observations = captureObservations(decision), captureId = digest(observations.map(o => o.observation_id).sort());
  const season = safe(decision.league.season), league = safe(decision.league.league_id);
  const provider = safe(decision.identity?.provider || "sleeper");
  const partition = provider === "sleeper" ? `observations/${season}/${league}` : `observations/${provider}/${season}/${league}`;
  const folder = join(directory, partition), file = `${captureId}.json.gz`;
  await mkdir(folder, { recursive: true });
  let bytes = gzipSync(JSON.stringify({ schema_version: "capture-1", capture_id: captureId, generated_at: decision.generated_at, observations })), created = true;
  try { await writeFile(join(folder, file), bytes, { flag: "wx" }); }
  catch (e) { if (e.code !== "EEXIST") throw e; created = false; bytes = await readFile(join(folder, file)); }
  const indexPath = join(directory, "index.json"); let index;
  try { index = JSON.parse(await readFile(indexPath, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; index = { schema_version: "archive-index-1", captures: [] }; }
  if (index.captures.some(c => c.capture_id === captureId)) return { created: false, capture_id: captureId };
  // Repair an interrupted index update using the immutable original, never the later refresh time.
  const stored = JSON.parse(gunzipSync(bytes));
  const entry = { capture_id: captureId, ...(provider !== "sleeper" ? { provider } : {}), generated_at: stored.generated_at, season: Number(season), week: decision.league.week, league_id: league,
    provider_user_id: decision.identity?.provider_user_id ?? null, roster_id: decision.my_roster_id, data_through_week: decision.data_through_week,
    model_version: decision.model_version, feature_version: decision.feature_version, implementation_revision: decision.implementation_revision,
    observation_count: stored.observations.length, path: `${partition}/${file}`, bytes: bytes.length, sha256: digest(stored.observations),
    scope: "Selected rostered/returned decision contexts; source warnings retained" };
  index.captures = [entry, ...index.captures].sort((a, b) => b.generated_at.localeCompare(a.generated_at)).slice(0, 1000);
  index.updated_at = decision.generated_at; index.retention = "Records append-only; latest 1000 captures indexed. Older files remain reachable in the Git tree/history; no automatic deletion.";
  await writeFile(indexPath + ".tmp", JSON.stringify(index)); await rename(indexPath + ".tmp", indexPath);
  return { created, ...entry };
}
