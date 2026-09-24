import { loadCsvSource } from "../sources/http.js";
export const loadPlayerIds = options => loadCsvSource("ffverse_ids", "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv", {
  ttl: 86400000, ...options, required: ["sleeper_id", "gsis_id"],
});

export function playerIdMap(rows, idColumn = "sleeper_id") {
  const groups = new Map();
  for (const row of rows) {
    if (!row.gsis_id || !row[idColumn] || ["NA", "null"].includes(row[idColumn]) || ["NA", "null"].includes(row.gsis_id)) continue;
    if (!groups.has(row.gsis_id)) groups.set(row.gsis_id, new Set());
    groups.get(row.gsis_id).add(String(row[idColumn]));
  }
  const map = new Map(), ambiguous = [];
  for (const [gsis, ids] of groups) {
    if (ids.size === 1) map.set(gsis, [...ids][0]); else ambiguous.push(gsis);
  }
  return { map, ambiguous };
}
