// ESPN pool study (class X, offline): how often would the T2 "decision-sufficient" certificate pass if Flaim returns only
// the top-100 available players per position by ESPN-wide rostered rate? Synthetic league (rostered = most-owned players
// ESPN-wide, a stated approximation); values = production Start Value from the EDGE-01 case table. No league data is used.
// Usage: node scripts/research/projexp/espn-pool-certificate.js [dataDir] [rows] [out]
import { readFile, writeFile } from "node:fs/promises";
import { loadCsv } from "../../../lib/research/edge01/data.js";
import { scheduleContext, fantasyProsToGsis } from "../../../lib/research/projexp/context.js";
import { numeric } from "../../../lib/decision/features.js";

const dir = process.argv[2] || ".data/edge01", rowsFile = process.argv[3] || ".data/projexp/rows.json", out = process.argv[4] || "artifacts/research/espn-pool-certificate.json";
const prov = [];
const own = await loadCsv(`${dir}/ownership.csv`, prov), ids = await loadCsv(`${dir}/ids.csv`, prov), sched = await loadCsv(`${dir}/games-le2025.csv`, prov);
const { weekDates } = scheduleContext(sched), fp = fantasyProsToGsis(ids);
const weeks = [...weekDates.entries()].map(([k, d]) => ({ k, ...d })).sort((a, b) => a.first.localeCompare(b.first));
// Latest ownership scrape strictly before the week's first game (Tuesday-waiver-like timing).
const byDate = new Map(); for (const r of own) (byDate.get(r.scrape_date) ?? byDate.set(r.scrape_date, []).get(r.scrape_date)).push(r);
const dates = [...byDate.keys()].sort();
const ownershipFor = wk => { const d = dates.filter(x => x < wk.first && x >= addDays(wk.first, -9)).at(-1); if (!d) return null; const m = new Map(); for (const r of byDate.get(d)) { const g = fp.get(r.fantasypros_id); if (g) m.set(g, Number(r.owned_espn)); } return { date: d, m }; };
function addDays(date, n) { const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }

const data = JSON.parse(await readFile(rowsFile, "utf8"));
const LEAGUES = { "8-team (owner's ESPN size)": { teams: 8, roster: { QB: 2, RB: 5, WR: 5, TE: 2 } }, "12-team": { teams: 12, roster: { QB: 2, RB: 5, WR: 5, TE: 2 } } };
const CAP = 100, result = {};
for (const [name, L] of Object.entries(LEAGUES)) {
  const tally = {};
  for (const wk of weeks) {
    const [season, week] = wk.k.split(":").map(Number); if (season < 2021 || week < 3 || week > 17) continue;
    const o = ownershipFor(wk); if (!o) continue;
    const universe = data.weekly.filter(r => r.season === season && r.week === week && numeric(r.base.prod));
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      // Players without an archived ESPN rate sort last (they are on no consensus page; worst case for the cap).
      const pool = universe.filter(r => r.position === pos).map(r => ({ v: r.base.prod, own: o.m.get(r.player_id) ?? -1, id: r.player_id }))
        .sort((a, b) => b.own - a.own || a.id.localeCompare(b.id));
      const k = L.teams * L.roster[pos], rostered = pool.slice(0, k), avail = pool.slice(k), returned = avail.slice(0, CAP), omitted = avail.slice(CAP);
      const desc = xs => xs.map(x => x.v).sort((a, b) => b - a);
      const third = desc(returned)[2] ?? -Infinity, r = desc([...rostered, ...returned])[k] ?? -Infinity; // demand rank ≈ rostered count
      const threshold = Math.min(third, r), maxOmitted = omitted.length ? Math.max(...omitted.map(x => x.v)) : -Infinity;
      const t = tally[pos] ??= { position_weeks: 0, cap_binds: 0, certificate_passes: 0, omitted_above_threshold_players: 0, lookups_needed_when_failing: [] };
      t.position_weeks++; if (omitted.length) t.cap_binds++;
      const above = omitted.filter(x => x.v > threshold).length;
      if (above === 0) t.certificate_passes++; else { t.omitted_above_threshold_players += above; t.lookups_needed_when_failing.push(above); }
    }
  }
  for (const t of Object.values(tally)) { const l = t.lookups_needed_when_failing.sort((a, b) => a - b); t.pass_rate = t.certificate_passes / t.position_weeks; t.max_lookups = l.at(-1) ?? 0; t.median_lookups_when_failing = l[Math.floor(l.length / 2)] ?? 0; delete t.lookups_needed_when_failing; }
  result[name] = tally;
}
await writeFile(out, JSON.stringify({ task: "PROJECTION-EXPERIMENT-01 / ESPN pool certificate feasibility", evidence_class: "X (synthetic league)", cap_per_position: CAP, provenance: prov,
  assumptions: ["rostered set = most ESPN-owned players at the position (approximation of a real league)", "Flaim order = ESPN-wide rostered rate (documented ordering)", "value = production Start Value", "threshold = min(3rd best returned value, value at the rostered-count rank in rostered ∪ returned)", "unrated players sort last (worst case)"], result }, null, 1));
console.log(JSON.stringify(result, null, 1));
