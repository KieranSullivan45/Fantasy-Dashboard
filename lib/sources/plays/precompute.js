import { parseCsv } from "../csv.js";
import { highValueOpportunities } from "./nflverse.js";
/** Logical CSV rows can span chunks/newlines; only explicitly allowed football fields are retained. */
export async function readFootballPlays(stream) {
  const allowed = new Set(["season", "season_type", "week", "game_id", "play_id", "posteam", "yardline_100", "no_play", "qb_kneel", "qb_spike", "two_point_attempt", "rush_attempt", "pass_attempt", "rusher_player_id", "receiver_player_id"]);
  let header = null, row = "", quoted = false, bytes = 0; const records = [], games = new Map();
  const consume = line => {
    if (!line.trim()) return;
    if (header == null) { header = line; const names = parseCsv(line + "\n").headers; if (!["season", "season_type", "week", "posteam", "rush_attempt", "pass_attempt", "play_id", "game_id", "yardline_100", "rusher_player_id", "receiver_player_id"].every(k => names.includes(k))) throw new Error("PBP columns changed"); return; }
    const parsed = parseCsv(header + "\n" + line).rows[0];
    if (!parsed || parsed.season_type !== "REG") return;
    if (parsed.game_id) games.set(parsed.game_id, { game_id: parsed.game_id, season: Number(parsed.season), week: Number(parsed.week) });
    const yard = parsed.yardline_100;
    if (yard !== "" && yard != null && Number(yard) <= 20) records.push(Object.fromEntries(Object.entries(parsed).filter(([k]) => allowed.has(k))));
  };
  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8"); bytes += Buffer.byteLength(text);
    if (bytes > 350000000) throw new Error("PBP uncompressed bound exceeded");
    for (const char of text) { if (char === '"') quoted = !quoted; if (char === "\n" && !quoted) { consume(row); row = ""; } else row += char; }
    if (row.length > 1000000) throw new Error("PBP row bound exceeded");
  }
  if (quoted) throw new Error("Unclosed PBP quote"); if (row) consume(row);
  return { records, games: [...games.values()], bytes };
}
export function aggregatePlays(parsed, { season, beforeWeek, provenance }) {
  const records = highValueOpportunities(parsed.records, { season, beforeWeek });
  const games = parsed.games.filter(g => g.season === season && g.week < beforeWeek);
  return { schema_version: "high-value-1", season, data_through_week: Math.max(0, ...games.map(g => g.week)), provenance,
    games, records, unsupported: ["end_zone_targets"], role: "informational; excluded from calibrated football inputs" };
}
