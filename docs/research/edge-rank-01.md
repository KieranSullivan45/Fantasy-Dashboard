# EDGE-RANK-01: ranking-oriented forecast and lineup-edge research

Date: 2026-10-19. Evidence class X (exploratory). Research only: no production, calibration, weight, schema, signal, provider,
capture or UI change, and no protocol registration. Seasons ≤ 2025 only, with no 2026 file downloaded or read. 2022–2025 are
consumed development evidence, not held-out evidence.

Repository: branch `research/edge-rank-01-gx3j37` (from `main` at `cfaa336`).
- Harness: `lib/research/edgerank01/{candidates,lineup}.js` and `scripts/research/edge-rank-01.js`. It reuses the EDGE-01 data layer, case table, metrics and VIP map unchanged.
- Results: `artifacts/research/edge-rank-01-results.json`.
- Plan: `docs/research/edge-rank-01-analysis-plan.md`. The plan was written before any new candidate was scored, and it has two disclosed post-hoc addenda.
- Tests: `test/edgerank01-research.test.js`.

## 1. Executive answer

**Recommendation: WORTH PROSPECTIVE REGISTRATION** (a capture-only shadow, not a production change).

- **The EDGE-01 ridge lineup gain replicates.**
  - Against production it adds **+0.59 lineup points per roster-week** (95% CI 0.35 to 0.83). This uses the standard 1QB synthetic structure, the consumed folds 2022–2025 and 3 draft seeds; the EDGE-01 seed alone reproduces exactly at +0.50.
  - The gain is positive in all 7 walk-forward folds (2019–2025), every seed, every leave-one-fold-out, and every lineup structure (Superflex, deep FLEX, no-FLEX and synthetic dual eligibility).
  - It also holds when RBs keep production values (+0.38, CI 0.15 to 0.58).
  - With λ fixed rather than selected, it rises slightly to +0.61.
- **The gain is ordering information, not compression.**
  - A per-position linear recalibration of production gives the same slope and spread change but keeps the order. It gains +0.01 (CI −0.04 to 0.06).
  - Lineups with no FLEX slot, where per-position level cannot matter, show the same +0.63 gain.
- **Where the gain sits:**
  - By position, it comes from within-position ordering of RB (+0.21), WR (+0.30) and TE (+0.12). QB contributes nothing (0.00).
  - By week, it is concentrated in weeks 3–5 (+1.55) and 6–9 (+0.76). In weeks 10–17 it is small and not significant (+0.19, CI −0.08 to 0.45).
- **Point MAE does not move.**
  - Ridge MAE is −0.004 against production (CI −0.031 to 0.024).
  - RB MAE is worse (+0.044) because a mean-targeted fit is scored with an absolute loss on a right-skewed RB distribution. The penalty lands mostly on low-projection RBs; it is not a ranking failure. With an as-of median shift, ridge RB MAE beats production's.
- **A simpler candidate keeps all of the gain.** The ingredients are an all-games exponentially weighted level (EW16), recent form (R3) and recent snap share.
  - **P5 = per-position OLS on `[EW16, R3, snap_last2]`** gains **+0.60** (CI 0.33 to 0.88). It is positive in 7/7 folds and every structure, with stable coefficients and no VIP map.
  - P5 is a second-round post-hoc candidate.
  - VIP is not needed: ridge without VIP gains +0.56. VIP-A2, the EDGE-01 MAE winner, adds nothing to lineups (+0.01).
- **Choosing parameters on a ranking objective does not help.** It was no more stable than choosing on MAE, and in the VIP-blend family no objective produced a lineup gain.
- **Selection optimism is moderate.**
  - Picking the best candidate on season Y−1 and scoring it on Y realises +0.48 per roster-week, against +0.63 in-sample. All 4 folds stay positive (+0.25 to +0.64).
  - Every season ≤ 2025 has been looked at, so only a prospective test can be clean.

Practical size: production's lineup averages 98.1 points per synthetic roster-week, with regret of 18.3 against the hindsight-optimal lineup. The candidate reduces regret by about 0.6 points (3%). That is about six times the 0.1 point screen, but it comes from simulated rosters (class X) and is mostly an early-season effect.

## 2. Candidate definitions

Every candidate is non-betting, PPR, and trained on 2016…Y−2 per position. Where a grid exists, the value is selected on Y−1; the candidate is scored once on Y. If an input is missing, the prediction falls back to noX (0.2–0.8% of cases, as in EDGE-01).

| ID | Class | Definition |
|---|---|---|
| prod | control | Production Start Value (betting-derived xFP from 2021) |
| noX, Q, S, R3 | baseline | Production without xFP; quality points Q; season PPG; recent-3 PPG |
| VIP_A2 | baseline | `0.5Q + 0.2R3 + 0.3·VIP_last2` (EDGE-01 fixed w = 0.3) |
| D1_ridge | baseline | EDGE-01 ridge `[Q, R3, S, EW16, VIP_last2, VIP_season, snap_last2]`, λ ∈ {1, 10, 100, 1000} by Y−1 MAE |
| A1–A3 | A (simple) | OLS `[Q, VIP2]`, `[Q, VIP2, snap2]`, `[Q, R3, VIP2, snap2]` |
| A4 | A | Linear recalibration of VIP_A2 |
| B1 | B | Ridge7 with fixed λ = 100 |
| B2 | B | B1 without VIP |
| B3 | B | B1 without recency: `[Q, S, EW16, VIP_season, snap_season]` |
| B4 | B | B1 without snap share |
| B5 | B | B1 without the S/EW16 level duplicates |
| B6 | B | B1 shrunk toward Q, a ∈ {0.25, 0.5, 0.75} |
| C_ridge7@obj | C | Ridge7, λ ∈ {1…10000} selected on Y−1 by MAE, macro Spearman, rosterable pair accuracy, gap ≥ 2 pair accuracy or synthetic lineup points |
| C_vipBlend@obj | C | `(0.8−w)Q + 0.2R3 + w·VIP2`, w ∈ {0…0.6}, selected by the same five objectives |
| P1–P3 | post-hoc round 1 | OLS `[Q, snap2]`, `[Q, R3, snap2]`, `[Q, snap_season]` |
| P4–P6 | post-hoc round 2 | OLS `[EW16, snap2]`, `[EW16, R3, snap2]`, `[EW16, S, R3, snap2]` |
| R_*_recal | control | Per-position `a + b·forecast` for production, Q and noX. These change level and spread only, never order |

Notes:
- EW16 is the EDGE-01 exponentially weighted mean over every as-of regular-season game in Y−2…Y, current season included, with a half-life of 16 games. It is not the H9 `ew2_h16` prior, which excludes the current season.
- snap_last2 is the mean offensive snap share over the last two current-team games, and is missing when either game is missing.

## 3. Selection and search space (full disclosure)

- **Search size:** 38 prediction series (7 baselines, 4 A, 8 B, 10 C, 6 P, 3 recalibration controls), plus "production values for RBs" hybrids for the 36 non-betting series. Each was run through 5 lineup structures × 3 seeds.
- **Before any new score:** the plan covered the A/B/C candidates, the controls, the metrics and the decision rule. The EDGE-01 results, including the D1 lineup lead, had already been seen.
- **Post-hoc round 1:** after the first full run showed the gain survives without VIP but not without snap share, P1–P3 were added.
- **Post-hoc round 2:** after the standardized-coefficient table showed EW16 and snap_last2 carry the ridge, P4–P6 were added. Nothing else was added, and no grid was widened.
- **No clean holdout:** development folds 2019–2021 were scored in the same runs as the consumed folds, so they are not clean either. Every season ≤ 2025 is now spent for this question.
- **Lineup simulation:** seeded noisy-Q snake drafts over played cases only, using the repository optimizer `lib/decision/optimizer.js` (Hungarian; legal slots filled first; one player per slot). The 3 seeds share the player pool, so they are not independent evidence.
- **What the lineups are not:** synthetic. No historical manager lineup is claimed.

## 4. Walk-forward point metrics

Consumed folds 2022–2025, pooled (16,320 player-games, the same frame as EDGE-01). Δ is against production, with a paired cluster bootstrap 95% CI.

| | MAE Δ | CI | QB / RB / WR / TE Δ | bias | slope |
|---|---|---|---|---|---|
| prod (MAE 4.710) | — | — | (6.06 / 4.73 / 4.81 / 3.80) | −0.04 | 0.89 |
| Q | +0.044 | 0.026, 0.062 | +.14 / +.06 / +.03 / +.01 | −0.12 | 0.89 |
| VIP_A2 | **−0.038** | −0.048, −0.029 | −.06 / −.04 / −.04 / −.03 | −0.18 | 0.91 |
| D1_ridge | −0.002 | −0.029, 0.026 | −.03 / **+.045** / −.01 / −.04 | +0.10 | 1.03 |
| B1 ridge7 λ100 | −0.004 | −0.031, 0.024 | −.03 / +.044 / −.01 / −.04 | +0.10 | 1.03 |
| B2 no-VIP | +0.011 | −0.016, 0.039 | −.03 / +.071 / .00 / −.02 | +0.13 | 1.03 |
| P5 EW16+R3+snap | +0.025 | −0.005, 0.055 | −.02 / **+.088** / +.02 / −.01 | +0.16 | 1.02 |
| A3 | +0.001 | −0.024, 0.026 | −.04 / +.051 / −.01 / −.02 | +0.08 | 1.03 |

On the development folds (2019–2021), every fitted candidate beats production on MAE by 0.04–0.06.

## 5. Ranking metrics

Macro Spearman is computed within week × position. Pair accuracy is on a fixed pair set: rosterable players in the same week and position whose actual points differ by at least 2, identical for every model.

| | Spearman, rosterable (Δ, CI) | Spearman, all Δ | Fixed-pair accuracy |
|---|---|---|---|
| prod | 0.318 | — | 0.639 |
| Q | −0.009 (−0.019, 0.000) | −0.010 | 0.634 |
| VIP_A2 | −0.003 (−0.010, 0.004) | +0.002 | 0.638 |
| D1 / B1 | +0.025 / +0.026 (0.015, 0.037) | +0.012 / +0.013 | 0.650 |
| B2 no-VIP | +0.022 (0.012, 0.033) | +0.010 | 0.650 |
| P5 | +0.025 (0.013, 0.037) | +0.010 | 0.651 |
| A2 / P2 | +0.011 / +0.010 | +0.008 / +0.007 | 0.645 / 0.644 |
| R_prod_recal | 0.000 (by construction) | 0.000 | 0.639 |

By fold, B1's rosterable Spearman beats production in 7/7 folds, and so does P5's. The ranking gain is small in absolute terms (+0.025, about 8% relative), but it is consistent.

## 6. Legal-lineup metrics

Δ lineup points per roster-week against production, pooled over 3 seeds, with a season-week cluster bootstrap 95% CI. All columns are the consumed folds except "Development".

| | Standard 1QB | Development 2019–21 | No-FLEX | Superflex | Deep FLEX | Dual (synthetic) | RBs on production values |
|---|---|---|---|---|---|---|---|
| D1_ridge | **+0.59** (0.35, 0.83) | +0.56 (0.17, 0.95) | +0.59 | +0.60 | +0.77 | +0.60 | +0.36 (0.15, 0.57) |
| B1 | **+0.61** (0.36, 0.87) | +0.64 (0.24, 1.02) | +0.63 | +0.62 | +0.78 | +0.62 | +0.38 (0.15, 0.58) |
| B2 no-VIP | +0.56 (0.33, 0.83) | +0.74 | +0.59 | +0.68 | +0.75 | +0.56 | +0.34 |
| **P5** | **+0.60** (0.33, 0.88) | +0.70 (0.27, 1.13) | +0.69 | +0.80 | +0.82 | +0.61 | +0.39 (0.16, 0.65) |
| P2 `[Q, R3, snap2]` | +0.35 (0.11, 0.60) | +0.51 | +0.32 | +0.39 | +0.52 | +0.35 | +0.12 (−0.09, 0.34) |
| A2 `[Q, VIP2, snap2]` | +0.36 (0.13, 0.60) | +0.39 | +0.27 | +0.28 | +0.50 | +0.36 | +0.17 |
| VIP_A2 | +0.01 (−0.14, 0.14) | −0.09 | −0.10 | −0.06 | +0.05 | +0.02 | −0.02 |
| R_prod_recal | +0.01 (−0.04, 0.06) | +0.03 | 0.00 | +0.03 | +0.09 | −0.01 | — |
| noX | −0.37 | +0.01 | −0.17 | −0.31 | −0.20 | −0.36 | — |
| Q / S / R3 | −0.59 / −1.09 / −2.24 | | | | | | |

Structure details:
- Superflex has 3 QBs, 10 teams and a SUPER_FLEX slot. Some synthetic Superflex teams could not fill 3 QBs and are dropped, leaving 6,262 roster-weeks against 8,592 for the standard structure.
- In synthetic dual eligibility, 25% of RBs and of TEs are also WR-eligible. Real dual eligibility does not exist in the nflverse history, so this tests only that the optimizer path does not erase the gain.

Does better ranking turn into better lineups? Yes for the ridge, EW and snap family: ranking gains and lineup gains move together across the ablations. VIP_A2 improves MAE but not ranking, and gives no lineup gain.

## 7. Position, fold and stratum robustness (standard 1QB unless stated)

- **By fold (B1):** 2019 +0.79, 2020 +0.63, 2021 +0.49, 2022 +0.77, 2023 +0.49, 2024 +0.31 (CI −0.15 to 0.94), 2025 +0.87. P5 by fold: +0.69, +0.78, +0.62, +0.88, +0.47, +0.25, +0.78. 2024 is the weak season for every candidate.
- **Leave one consumed fold out:** B1 +0.52 to +0.71; P5 +0.50 to +0.71.
- **Seeds:** B1 +0.59, +0.72, +0.53; P5 +0.59, +0.56, +0.64.
- **Per position** (exact additive decomposition in the no-FLEX structure):

  | | QB | RB | WR | TE |
  |---|---|---|---|---|
  | B1 | 0.00 | +0.21 | +0.30 | +0.12 |
  | P5 | +0.04 | +0.20 | +0.37 | +0.09 |

  The gain is not concentrated in one position, and QB gets nothing.
- **Weeks (B1):**

  | Weeks | Gain | CI |
  |---|---|---|
  | 3–5 | +1.55 | 1.07, 2.13 |
  | 6–9 | +0.76 | 0.36, 1.28 |
  | 10–17 | +0.19 | −0.08, 0.45 |

  P5 shows the same pattern: +1.65, +0.61, +0.20.
- **Early vs established samples** (MAE Δ against production): for 4 or fewer current-season games, B1 −0.039 and P5 −0.009. For 5 or more games, B1 +0.011 and P5 +0.039. The edge is an early-season role and recency effect.
- **Rosterable vs all:** the Spearman gain is about twice as large among rosterable players (+0.026) as among all players (+0.013).
- **Coefficient stability (standardized, across 7 folds):**
  - P5 is very stable. EW16 sits at 2.0–2.4 (RB), 2.6–2.9 (WR), 1.9–2.4 (TE) and 2.3–2.4 (QB). snap_last2 sits at 1.8–2.3 (RB), 1.2–1.4 (WR) and about 1.0 (TE). R3 is positive everywhere.
  - In B1, EW16 and snap_last2 are stable and dominant, but Q flips sign for QB, S is negative for TE, and VIP_season for QB drifts from 0.62 to 0.03. This is collinearity among Q, S, EW16 and VIP_season.

## 8. Null and negative findings

- **VIP is not the source of the lineup gain.** Removing it changes +0.61 to +0.56. VIP_A2 (+0.01) and the VIP blend selected by any of the five objectives (−0.17 to +0.02) show no lineup gain. VIP's EDGE-01 value is point accuracy only.
- **Objective selection (class C) is not more stable than MAE selection.** The lineup objective picked a single λ that varied 1 → 100 → 10 → 1000 → 100 → 100 → 10000 across folds, and gained +0.50, below MAE selection's +0.59. The gap ≥ 2 pair objective picked λ = 10000 almost everywhere: it over-shrank (MAE +0.094, slope 1.13, top-quintile bias −1.20) and gained only +0.50. Macro Spearman selection gained +0.50 with MAE +0.051.
- **Season-level snap share (P3) is null to harmful:** −0.18 lineup, MAE +0.067. Recent snap share is what carries the information.
- **Removing recency (B3) cuts the gain to +0.17.** The CI includes 0, and the gain is negative in weeks 10–17 (−0.36).
- **Shrinking toward Q erases the gain monotonically:** a = 0.25 gives +0.43, 0.5 gives +0.21 and 0.75 gives −0.12.
- **Recalibrating production's level and spread does nothing:** +0.01. noX loses 0.37 to production, so production's xFP term is worth about 0.37 lineup points. The non-betting candidates beat noX by +0.96 (B1) and +0.97 (P5).
- **No candidate helps QB lineup decisions.**

## 9. Selection optimism and sensitivity

- **Meta walk-forward over the 32-series candidate pool** (pick on Y−1 lineup Δ, score on Y):

  | Season scored | Chosen series | In-sample | Out-of-sample |
  |---|---|---|---|
  | 2022 | B6 shrink 0.25 | 0.68 | 0.55 |
  | 2023 | P5 | 0.88 | 0.47 |
  | 2024 | P6 | 0.63 | 0.25 |
  | 2025 | C_ridge7@pair_rosterable | 0.35 | 0.64 |

  Mean in-sample is 0.63 and mean out-of-sample 0.48, roughly 25% optimism. The out-of-sample gain stays positive and above the screen every season.
- **Best of pool:** the pooled consumed-fold ranking is led by B1 (+0.61), P5 (+0.60), D1 (+0.59) and P6 (+0.58). The family top is flat, so which member wins is noise; the family-level effect is the finding.
- **Required adversarial tests:** without RB (RB values from production), +0.38 / +0.39. Removing each fold leaves +0.50 or more. Without VIP, +0.56. Without recency, +0.17 (n.s.). Shrunk toward Q, gone by a = 0.75.
- **Forecast spread and compression:**
  - Candidates have a smaller within-week rosterable spread (SD 2.6 against 3.4) and a calibration slope of 1.02–1.03 against 0.89.
  - Production over-forecasts its top quintile by +1.18 points; B1 under-forecasts it by 0.28.
  - The recalibration control shows that this spread change alone is worth nothing for lineups.
- **Point calibration and positional bias:** candidate bias by position (QB / RB / WR / TE) is −0.13 / +0.20 / +0.20 / −0.11, against production's −0.25 / −0.07 / +0.14 / −0.25. No harmful cross-position bias appears: FLEX-dependent structures gain about as much as no-FLEX. Median residuals are higher (RB 1.48 against 0.98) because these are mean fits.
- **Why RB MAE is worse:** RB next-game points have a mean of 8.65 and a median of 6.5. The ridge predicts 2.6 and 5.0 for the two lowest forecast quintiles, where median actuals are 1.2 and 3.1; production predicts 1.8 and 4.4. MAE by quintile against production is +0.26, +0.06 and +0.05 for the bottom three, and better in the top two. With each fold's residual median shifted using the previous fold's RB median residual (as-of), ridge RB MAE is 4.577 against production's 4.647. The deficit is the mean-versus-median target, and it sits among bench and waiver RBs.

## 10. Recommendation

**WORTH PROSPECTIVE REGISTRATION.**

Against the pre-stated decision rule, every criterion passes for B1 and P5:
- standard-structure gain of at least 0.1, with a CI that excludes 0;
- the same sign on development folds;
- positive in 4/4 consumed folds, in leave-one-fold-out, without RB, and across all structures and seeds;
- not reproduced by recalibration;
- MAE no worse by more than 0.05 overall or 0.10 at any position. P5's RB +0.088 is close to that limit.

The evidence is still class X: synthetic rosters, a participation-conditional frame and post-hoc candidates. Only a sealed prospective season can confirm it. No production promotion follows from this report.

## 11. Proposed candidates (for a future registration; nothing implemented or registered)

**Primary: P5 "EW-role ranker".** Per-position OLS with intercept on three as-of, non-betting inputs:
- EW16: all-games exponentially weighted PPG over Y−2…Y, half-life 16 games;
- R3: recent-3 PPG;
- snap_last2: mean offensive snap share over the last two current-team games.

Coefficients are frozen once, fit on 2016–2025 per position, and never refit in-season. The 2025-fold coefficients, for reference, are QB 1.93 + 0.49·EW16 + 0.16·R3 + 4.17·snap2 and RB 0.02 + 0.40·EW16 + 0.22·R3 + 8.42·snap2. Where an input is missing, the value is recorded as null and evaluated with the production fallback, disclosed. Why P5: three inputs, coefficients stable in every fold, no VIP map, and the full lineup gain.

**Secondary: B1 ridge7 with fixed λ = 100.** This is the EDGE-01 D1 lead with selection removed. It keeps the original lead's form and has the best MAE of the gainers (−0.004), with smaller RB damage (+0.044).

A suggested contract for the owner and PM to decide, modelled on the ADR 0011 capture-only shadow:
- **Primary endpoint:** standard-1QB synthetic lineup points against production, weeks 3–17.
- **Secondary endpoint:** rosterable Spearman.
- **Guardrails:** MAE no worse than production by more than 0.05 overall or 0.10 at any position.
- **Pre-stated expectation:** most of the effect falls in weeks 3–9, so an early-season endpoint should be named in advance rather than found afterwards.

A 2026 shadow can only start after Evaluation Protocol registration under the existing sealed-season rule.

## Validation and reproducibility

- **Data:** nflverse stats and snap counts 2014–2025, DynastyProcess ids, and ffopportunity 2021–2025, which the production control needs. Files were re-downloaded to the ignored `.data/edge01/`.
  - 28 of 29 SHA-256 hashes match EDGE-01. The exception is `ids.csv`, which DynastyProcess has updated since.
  - The EDGE-01 D1 ridge MAE (−0.0023) and lineup (+0.502, CI 0.160 to 0.856) reproduce exactly.
- **Leakage:** the truncation canary compared 1,420 cases with 0 mismatches. No season ≥ 2026 was loaded.
- **Determinism:** two full runs produced identical artifacts apart from `generated_at`. Reproduce with `node scripts/research/edge-rank-01.js .data/edge01` (about 6 minutes).
- **Tests:** `pnpm test` 438/438 passed, including 6 new tests in `test/edgerank01-research.test.js`: EDGE-01 draft parity, lineup legality in every structure, walk-forward isolation, no xFP in candidates, missing values not zero-filled, and a shared parameter under joint selection. `pnpm build` passes. No UI, route or loader change, so `pnpm test:ui` was not run.
- **No production file differs from `main`.**
