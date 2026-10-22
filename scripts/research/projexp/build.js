// Projection experiment, step 1: build the point-in-time weekly and ROS case rows (PPR) for 2016–2025 and attach the
// consensus benchmark ranks. Offline; seasons ≤ 2025 only. Usage: node scripts/research/projexp/build.js [dataDir] [outFile]
import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadSeasons, loadCsv, SEALED_SEASON } from "../../../lib/research/edge01/data.js";
import { fitVipModel, withFormat } from "../../../lib/research/edge01/cases.js";
import { scheduleContext, allowedByDefense, fantasyProsToGsis, consensusSnapshots, snapshotBefore } from "../../../lib/research/projexp/context.js";
import { seasonRows } from "../../../lib/research/projexp/cases.js";

const dir = process.argv[2] || ".data/edge01", out = process.argv[3] || ".data/projexp/rows.json";
const t0 = Date.now(), log = (...x) => console.log(((Date.now() - t0) / 1000).toFixed(0) + "s", ...x);
const data = await loadSeasons(dir, 2014, 2025);
const provenance = [...data.provenance];
const schedRows = await loadCsv(`${dir}/games-le2025.csv`, provenance);
if (schedRows.some(r => Number(r.season) >= SEALED_SEASON)) throw new Error("sealed season in schedule");
const ecrRows = await loadCsv(`${dir}/ecr.csv`, provenance);
const schedule = scheduleContext(schedRows);
const games = Object.fromEntries(Object.entries(data.games).map(([s, g]) => [s, withFormat(g, "ppr")]));
const vipModel = fitVipModel([2014, 2015, 2016, 2017].flatMap(s => games[s]));
const allowed = allowedByDefense(games);
const snaps = consensusSnapshots(ecrRows, schedule.weekDates, fantasyProsToGsis(data.ids));
log("loaded");
const weekly = [], ros = [];
for (let s = 2016; s <= 2025; s++) {
  const r = seasonRows(games, s, { vipModel, draft: data.draft, schedule, allowed });
  for (const row of r.weekly) {
    const snap = row.gameday ? snapshotBefore(snaps.week.get(`${s}:${row.week}`), row.gameday) : null, e = snap?.byGsis.get(row.player_id);
    row.bench = { ecr_rank: e && e.position === row.position ? e.rank : null, ecr_snapshot: snap?.date ?? null };
  }
  for (const row of r.ros) {
    const snap = row.gameday ? snapshotBefore(snaps.ros.get(`${s}:${row.week}`), row.gameday) : null, e = snap?.byGsis.get(row.player_id);
    row.bench = { ros_rank: e && e.position === row.position ? e.rank : null, ros_snapshot: snap?.date ?? null };
  }
  weekly.push(...r.weekly); ros.push(...r.ros);
  log("season", s, r.weekly.length, r.ros.length);
}
const snapAudit = Object.fromEntries(["week", "ros"].map(k => [k, [...snaps[k].entries()].map(([wk, l]) => ({ wk, dates: l.map(x => x.date), matched: l.map(x => x.byGsis.size), unmatched: l.map(x => x.unmatched) }))]));
await mkdir(".data/projexp", { recursive: true });
await writeFile(out, JSON.stringify({ provenance, vipModel, snapAudit, weekly, ros }));
log("wrote", out, weekly.length, ros.length);
