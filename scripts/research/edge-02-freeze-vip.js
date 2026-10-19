// EDGE-02 VIP coefficient freeze (deterministic reproduction only; class R; offline; seasons 2014–2017 only).
// Usage: node scripts/research/edge-02-freeze-vip.js [dataDir=.data/edge01] [--out=artifacts/research/edge-02-vip-coefficients.json]
// Re-runs the unchanged EDGE-01 fitter (`fitVipModel`) on the hash-matched 2014–2017 inputs EDGE-01 recorded, and exports
// the full-precision coefficients. It selects nothing, reads no outcome after 2017, and refuses any input whose SHA-256
// differs from the EDGE-01 provenance. ids.csv comes from the mutable DynastyProcess master branch; the exact EDGE-01 bytes
// are its version at dynastyprocess/data commit 2bbc02be740f0972e4a13791cd9f8ffd1b78a9d2 (files/db_playerids.csv).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "../../lib/sources/csv.js";
import { buildSeasonGames, RESEARCH_FORMATS } from "../../lib/research/edge01/data.js";
import { fitVipModel, withFormat } from "../../lib/research/edge01/cases.js";
import { VIP_TRAINING_SEASONS } from "../../lib/shadow/edge02/config.js";

/** Code whose SHA-256 identifies the fitting procedure (EDGE-01, merged in PR #23, merge commit cfaa336). */
const FITTING_CODE_FILES = Object.freeze(["lib/research/edge01/cases.js", "lib/research/edge01/fit.js", "lib/research/edge01/features.js",
  "lib/research/edge01/data.js", "lib/backtest/data.js", "lib/normalize/scoring.js", "lib/sources/csv.js", "lib/sources/contracts.js", "lib/decision/features.js"]);

const args = process.argv.slice(2), opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const dir = args.find(a => !a.startsWith("--")) || ".data/edge01";
const OUT = opt("out", "artifacts/research/edge-02-vip-coefficients.json");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

const edge01 = JSON.parse(await readFile("artifacts/research/edge-01-results.json", "utf8"));
const recorded = new Map(edge01.provenance.files.map(f => [f.file, f]));
const manifest = [], read = async file => {
  const bytes = await readFile(`${dir}/${file}`), expected = recorded.get(file), digest = sha(bytes);
  manifest.push({ file, sha256: digest, bytes: bytes.length, edge01_sha256: expected?.sha256 ?? null, matches_edge01: digest === expected?.sha256 });
  return parseCsv(bytes.toString("utf8")).rows;
};

const ids = await read("ids.csv"), raw = {};
for (const season of VIP_TRAINING_SEASONS) raw[season] = { stats: await read(`stats-${season}.csv`), snaps: await read(`snaps-${season}.csv`) };
const mismatched = manifest.filter(m => !m.matches_edge01);
if (mismatched.length) throw new Error(`Training inputs differ from the EDGE-01 provenance: ${mismatched.map(m => m.file).join(", ")}. Stop and escalate.`);
for (const { stats } of Object.values(raw)) if (stats.some(r => Number(r.season) >= 2018)) throw new Error("Rows after 2017 present in a training file");

// The EDGE-01 procedure, unchanged: per season buildSeasonGames, per format withFormat, then fitVipModel on 2014–2017.
const fitWith = idRows => {
  const games = Object.fromEntries(VIP_TRAINING_SEASONS.map(s => [s, buildSeasonGames({ ...raw[s], opportunity: [], ids: idRows }, s)]));
  return Object.fromEntries(Object.keys(RESEARCH_FORMATS).map(format => [format, fitVipModel(VIP_TRAINING_SEASONS.flatMap(s => withFormat(games[s], format)))]));
};
const models = fitWith(ids);
// Additional evidence: ids.csv only joins snap counts (lib/backtest/data.js historicalGames) and the VIP fit reads stats
// columns only, so an empty crosswalk gives bit-identical coefficients. Recorded, not relied on: every input is hash-matched.
const identical = JSON.stringify(models) === JSON.stringify(fitWith([]));

const round4 = v => +v.toFixed(4);
const published = edge01.vip_models, agreement = [];
for (const [format, byPos] of Object.entries(models)) for (const [position, m] of Object.entries(byPos)) {
  const p = published[format]?.[position];
  agreement.push({ format, position, n: m.n, published_n: p?.n ?? null, rounded_matches_published: !!p && p.n === m.n && JSON.stringify(m.coef.map(round4)) === JSON.stringify(p.coef) });
}
if (agreement.some(a => !a.rounded_matches_published)) throw new Error("Full-precision fit does not round to the published EDGE-01 coefficients. Stop and escalate.");

const code = [];
for (const file of FITTING_CODE_FILES) code.push({ file, sha256: sha(await readFile(file)) });
const out = { schema: "edge02-vip-freeze-1", task: "EDGE-02-CAPTURE-01", evidence_class: "R (deterministic reproduction; no selection)",
  training_seasons: VIP_TRAINING_SEASONS, formats: Object.keys(RESEARCH_FORMATS), procedure: "lib/research/edge01/cases.js fitVipModel (OLS, ridge lambda 0) on buildSeasonGames rows, per research format and position",
  coefficients: Object.fromEntries(Object.entries(models).map(([f, byPos]) => [f, Object.fromEntries(Object.entries(byPos).map(([pos, m]) => [pos, { inputs: m.inputs, coef: m.coef, n: m.n }]))])),
  source_manifest: manifest,
  ids_source: { url: "https://raw.githubusercontent.com/dynastyprocess/data/2bbc02be740f0972e4a13791cd9f8ffd1b78a9d2/files/db_playerids.csv", note: "Exact EDGE-01 bytes; the master-branch file has since changed upstream." },
  ids_independence: { identical_with_empty_crosswalk: identical, note: "ids.csv only feeds the snap-count join; the VIP fit reads stats columns only." },
  published_agreement: agreement, fitting_code: code,
  no_2026: "Only 2014–2017 files are read; the loader refuses seasons >= 2026 and this script refuses rows after 2017." };
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ written: OUT, all_inputs_match_edge01: manifest.every(m => m.matches_edge01), identical_without_ids: identical, all_rounded_match: true }));
