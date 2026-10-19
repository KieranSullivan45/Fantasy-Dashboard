import { digest } from "../../history/contracts.js";

/**
 * EDGE-02 frozen candidate configuration (Evaluation Protocol v2, ADR 0014). Research-only: nothing here is read by
 * production decision routes, the UI or any model. Changing any value below is a new candidate specification, not a fix.
 */
const deepFreeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };

export const VIP_TRAINING_SEASONS = Object.freeze([2014, 2015, 2016, 2017]);
/**
 * Identity of the fitting code: SHA-256 (canonical JSON) of the `fitting_code` file/SHA-256 list recorded in
 * artifacts/research/edge-02-vip-coefficients.json (the EDGE-01 fitter, merged to main in PR #23, merge commit cfaa336).
 * Kept as a digest so no production-tree module names research code paths.
 */
export const FITTING_CODE_SHA256 = "22ffd721d7100d1ab495a8f61d3990022624e0da21f362c2a22c30789c247a88";

/** Frozen research formats: the complete effective offensive scoring contract each VIP fit was scored under. */
export const FROZEN_FORMATS = deepFreeze({
  ppr: { pass_yd: 0.04, pass_td: 4, pass_2pt: 2, pass_int: -1, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, bonus_rec_te: 0 },
  half: { pass_yd: 0.04, pass_td: 4, pass_2pt: 2, pass_int: -1, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, bonus_rec_te: 0 },
  standard: { pass_yd: 0.04, pass_td: 4, pass_2pt: 2, pass_int: -1, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, bonus_rec_te: 0 },
  te_premium: { pass_yd: 0.04, pass_td: 4, pass_2pt: 2, pass_int: -2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2, bonus_rec_te: 0.5 },
});
/** Keys a league must state explicitly (a missing one is incomplete evidence). bonus_rec_te alone may be absent, meaning 0. */
export const EXPLICIT_KEYS = Object.freeze(["pass_yd", "pass_td", "pass_2pt", "pass_int", "rush_yd", "rush_td", "rush_2pt", "rec", "rec_yd", "rec_td", "rec_2pt", "fum_lost"]);

/** EDGE-01 VIP inputs (its features.js VIP_INPUTS) and the raw nflverse columns they come from (lib/backtest/data.js). */
export const VIP_INPUTS = deepFreeze({ QB: ["passing_attempts", "carries"], RB: ["carries", "targets"], WR: ["targets", "air_yards", "carries"], TE: ["targets", "air_yards"] });
export const VIP_RAW_COLUMNS = deepFreeze({ passing_attempts: "attempts", carries: "carries", targets: "targets", air_yards: "receiving_air_yards" });

/**
 * Full-precision OLS coefficients [intercept, ...betas] per format and position, reproduced by
 * `scripts/research/edge-02-freeze-vip.js` from the hash-matched 2014–2017 inputs (artifacts/research/edge-02-vip-coefficients.json).
 */
export const VIP_COEFFICIENTS = deepFreeze({
  ppr: {
    QB: {inputs:["passing_attempts","carries"],coef:[0.43474192108413057,0.3906627140158081,0.9163111676953346],n:2388},
    RB: {inputs:["carries","targets"],coef:[-0.16145132509960014,0.6056640905572497,1.4536272854163805],n:6586},
    WR: {inputs:["targets","air_yards","carries"],coef:[-0.07904892152072218,1.5114834642974326,0.012693622360780754,0.7681895173928979],n:8942},
    TE: {inputs:["targets","air_yards"],coef:[0.06737367087327417,1.4610635501576295,0.02852177464761277],n:4505},
  },
  half: {
    QB: {inputs:["passing_attempts","carries"],coef:[0.4321411540950191,0.3906121259399334,0.9159765342533936],n:2388},
    RB: {inputs:["carries","targets"],coef:[-0.15059143637595618,0.6055452211837368,1.079270173977635],n:6586},
    WR: {inputs:["targets","air_yards","carries"],coef:[-0.06270791473040216,1.1261455312661535,0.020273705868615897,0.7579610108877093],n:8942},
    TE: {inputs:["targets","air_yards"],coef:[0.09032180603070383,1.0681293275869639,0.03631401073454123],n:4505},
  },
  standard: {
    QB: {inputs:["passing_attempts","carries"],coef:[0.42954038710588627,0.39056153786406,0.9156419008114458],n:2388},
    RB: {inputs:["carries","targets"],coef:[-0.1397315476521639,0.6054263518101995,0.704913062538901],n:6586},
    WR: {inputs:["targets","air_yards","carries"],coef:[-0.04636690794025977,0.7408075982346928,0.027853789376470012,0.7477325043826424],n:8942},
    TE: {inputs:["targets","air_yards"],coef:[0.11326994118805356,0.6751951050163394,0.04410624682146768],n:4505},
  },
  te_premium: {
    QB: {inputs:["passing_attempts","carries"],coef:[0.34743805888654045,0.3672796112582059,0.9418051607896064],n:2388},
    RB: {inputs:["carries","targets"],coef:[-0.1616460898472427,0.6056830199122523,1.4535853508433765],n:6586},
    WR: {inputs:["targets","air_yards","carries"],coef:[-0.07948023813774086,1.5113923590297391,0.012703182001302596,0.7683456593113078],n:8942},
    TE: {inputs:["targets","air_yards"],coef:[0.04506361220829458,1.8539757600178657,0.02069910233301731],n:4505},
  },
});

export const SOURCE_MANIFEST = deepFreeze([
  {file:"ids.csv",sha256:"9bc031b09ccb2fc72e173856dcc80fc7e5e19f3e0fedef47850ee8aee2585b2d",bytes:2639486,edge01_sha256:"9bc031b09ccb2fc72e173856dcc80fc7e5e19f3e0fedef47850ee8aee2585b2d",matches_edge01:true},
  {file:"stats-2014.csv",sha256:"a389b10d94eb8e6b9a153223d381aab821b0eff4cd73967835a21032192abc61",bytes:7883194,edge01_sha256:"a389b10d94eb8e6b9a153223d381aab821b0eff4cd73967835a21032192abc61",matches_edge01:true},
  {file:"snaps-2014.csv",sha256:"84540709d9483552185c8ca3ef30b2f66fb94b30c3e6c21e7a27205f337f21d3",bytes:2156558,edge01_sha256:"84540709d9483552185c8ca3ef30b2f66fb94b30c3e6c21e7a27205f337f21d3",matches_edge01:true},
  {file:"stats-2015.csv",sha256:"21052baa3b3291a92faf3e6827891295010dca8cc5cefd5a909984b9d7b64664",bytes:7881066,edge01_sha256:"21052baa3b3291a92faf3e6827891295010dca8cc5cefd5a909984b9d7b64664",matches_edge01:true},
  {file:"snaps-2015.csv",sha256:"841496252ada825c3c50d3ba9b4b26d3f4fabd0fedc5fb44f286ddaaa5bdb7e0",bytes:2155797,edge01_sha256:"841496252ada825c3c50d3ba9b4b26d3f4fabd0fedc5fb44f286ddaaa5bdb7e0",matches_edge01:true},
  {file:"stats-2016.csv",sha256:"eb0264c65d1ef593196afcd4ba24e9f2e9b7942923bf6f4bb4639684e2c4d470",bytes:7852359,edge01_sha256:"eb0264c65d1ef593196afcd4ba24e9f2e9b7942923bf6f4bb4639684e2c4d470",matches_edge01:true},
  {file:"snaps-2016.csv",sha256:"a778e24e9eb665ffe8f16093b03c5a263dca0250b3aa92bd6002f61f534bea59",bytes:2157110,edge01_sha256:"a778e24e9eb665ffe8f16093b03c5a263dca0250b3aa92bd6002f61f534bea59",matches_edge01:true},
  {file:"stats-2017.csv",sha256:"592b0916065987b0b3afb0480162f03350d16b12250dc42b0f194e2ab1378563",bytes:7821392,edge01_sha256:"592b0916065987b0b3afb0480162f03350d16b12250dc42b0f194e2ab1378563",matches_edge01:true},
  {file:"snaps-2017.csv",sha256:"eab2fad2df99249d4061ed9c5c34d312cdba07cf3159d027d255bdc9b6526917",bytes:2157818,edge01_sha256:"eab2fad2df99249d4061ed9c5c34d312cdba07cf3159d027d255bdc9b6526917",matches_edge01:true},
]);

export const CANDIDATES = deepFreeze({
  a2: { id: "edge02-vip-a2-w030-v1", role: "primary", formula: "0.5*Q + 0.2*R3 + 0.3*VIP_last2", quality_input: "production_quality_points", weights: { quality: 0.5, recent: 0.2, vip: 0.3 } },
  x2: { id: "edge02-vip-x2-w030-v1", role: "secondary", formula: "0.5*H9_Q + 0.2*R3 + 0.3*VIP_last2", quality_input: "h9_quality_points", weights: { quality: 0.5, recent: 0.2, vip: 0.3 } },
});
/** Whole-candidate fallback N: the production forecast machinery with weights [Q, R3, X, opportunity] = [0.8, 0.2, 0, 0]. */
export const FALLBACK = deepFreeze({ id: "production_noX", weights: [0.8, 0.2, 0, 0], machinery: "lib/decision/features.js forecast(production features, weights)" });

export const EDGE02_CONFIG = deepFreeze({
  task: "EDGE-02-CAPTURE-01", protocol: "evaluation-protocol-v2", adr: "docs/decisions/0014-edge02-vip-candidate-shadow.md",
  candidates: CANDIDATES, fallback: FALLBACK, weight_policy: "w = 0.3 for every supported position and format; no position, season, league or interim selection",
  formats: FROZEN_FORMATS, explicit_keys: EXPLICIT_KEYS,
  vip: { inputs: VIP_INPUTS, raw_columns: VIP_RAW_COLUMNS, coefficients: VIP_COEFFICIENTS, training_seasons: VIP_TRAINING_SEASONS, source_manifest: SOURCE_MANIFEST,
    fitting: { procedure: "EDGE-01 fitVipModel, unchanged (OLS via ridge lambda 0)", revision: "cfaa336 (PR #23 merge)", artifact: "artifacts/research/edge-02-vip-coefficients.json", code_sha256: FITTING_CODE_SHA256 },
    window: "VIP_last2: current season, REG rows strictly before the target week, statistical rows only; team of the latest such row; the two latest rows on that team; every required predictor finite in both; full precision; mean of exactly two" },
  positions: ["QB", "RB", "WR", "TE"],
});
/** Registered identity of the frozen configuration. The builder refuses to run if the computed digest differs. */
export const EDGE02_CONFIG_SHA256 = "de8783b1e11cc97c715ea0d988d155e81bf4c3863b142c12edb9245a4911b945";
export const computedConfigSha256 = () => digest(EDGE02_CONFIG);

/**
 * Effective boundary: the merge commit time on `main` of the pull request that registers Protocol v2 and ADR 0014. It is
 * unknown when this code is written, so it is recorded as pending; every record keeps its own timestamps and the
 * implementation SHA, and the evaluator applies `effective_at <= generated_at` from main's merge commit (Protocol v2 §6).
 */
export const EDGE02_BOUNDARY = deepFreeze({ effective_at: null, status: "pending_registration_record",
  rule: "merge commit time on main of the PR adding docs/evaluation-protocol-v2.md and ADR 0014; recorded in TASKS.md after merge" });
