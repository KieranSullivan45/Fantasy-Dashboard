# EDGE-01 — Forecast & opportunity edge: results and next production contract

- Date 2026-10-15. Branch `research/edge-01-forecast-opportunity` from `main` `4b912e1`. Research only: **no production
  behaviour, weight, threshold, schema or signal policy changed.**
- Plan written and committed before any outcome was scored: [`edge-01-analysis-plan.md`](edge-01-analysis-plan.md)
  (commit `5fdb942`). Families marked *post-hoc* were added after the pre-registered families were scored and are class X.
- Evidence: point forecasts are **class R** (V0 corrected nflverse data, walk-forward, train 2016…Y−2, select on Y−1 per
  position, score once on Y). Primary folds 2022–2025 are **consumed seasons, not holdouts**. Development folds 2019–2021 add
  replication. Lineup simulation and breakout signals are **class X**. **No 2026 data was downloaded or read.**
- Machine-readable results: `artifacts/research/edge-01-results.json` (schema `edge-01-results-1`, with source SHA-256s,
  every candidate including nulls, per-fold/position/stratum metrics and selected parameters).
- Reproduce: download the files listed in the plan to `.data/edge01/`, then `node scripts/research/edge-01.js .data/edge01`
  (about 5 minutes).

## Answers

1. **Is there a point-forecast candidate that materially and robustly improves on production?** Robustly yes; materially,
   not yet. Replacing betting-derived xFP with a non-betting **volume-implied points (VIP)** term beats production in all
   4 primary and all 3 development folds. The best combination, VIP plus the ADR 0009 H9 prior, gains −0.044 MAE.
   No candidate clears the 0.05 screen or the 0.1 lineup-points screen, so neither is promotion evidence on its own.
2. **Which positions benefit?** Every position benefits from VIP. QB gains most (−0.061; −0.075 with H9), then WR, RB and
   TE. No position is worse than production.
3. **Which features add meaningful incremental value?** VIP, the as-of opportunity level from the last two current-team
   games, adds about 0.03 MAE beyond a spread-matched production forecast. The H9 two-season EW prior adds about 0.01.
   xFP adds nothing once VIP is present: production + VIP gains only −0.008 over production. Role-change deltas, EW-all
   windows and heavier recency add nothing or hurt.
4. **Which opportunity/breakout signals show useful precision or lift?** None reaches decision-grade precision. On the
   *gain* outcome, flagged precision is 5–12% against a 4–5% base rate (lift 1.1–2.6). Draft capital is the strongest
   stable non-betting signal (lift ≈ 1.7–1.9, recall ≈ 0.46). The current engine's `ROLE_EXPANSION`/spike set (lift ≈ 1.7
   in both eras) is as good as or better than every new sustained-role flag. Sustained carry-share growth (RB) has the
   highest non-betting lift (1.8–2.6), but its flag count is small and it is suppressed per season.
5. **What failed?** Ungated and gated role-change adjustments, heavier recency (Q + R3), the EW-all-games window, the
   persistence requirement, the xFP weight refit, and ridge models on MAE. Details below.
6. **What to promote next:** a **capture-only prospective shadow** of VIP Start Value (with and without H9). Production
   should not change yet (contract below).
7. **What stays research-only:** every breakout/opportunity signal, ridge models (a ranking lead only), and anything that
   uses xFP.

## Point-forecast results (PPR, weeks 3–17, played cases)

Primary pool 2022–2025, n = 16,320 player-games, 813 players. About 26–30% of eligible cases have no next-game stat row;
they are censored (counted in `case_audit`), never scored as zero. Production: MAE 4.710, median AE 3.48, RMSE 6.40, bias
−0.04, calibration slope 0.89. The strongest simple baseline is **Q** (MAE 4.754), ahead of EW5 4.785, S 4.792 and EW3 4.805.

Δ is the candidate's MAE minus the comparator's (negative = candidate better), with paired cluster-bootstrap 95% intervals
(the wider of the by-player and by-season-week intervals). "vs shrunk prod" compares against production shrunk toward its own
as-of week × position mean, with the shrinkage selected walk-forward. That control separates information from a narrower
forecast spread.

| Candidate | Δ vs prod | Δ vs Q | Δ vs shrunk prod | Folds better than prod (primary / dev) | Worst position vs prod | Lineup pts/roster-week vs prod |
|---|---|---|---|---|---|---|
| **A2 VIP in place of xFP** `(0.8−w)Q + 0.2R3 + w·VIP` | **−0.035 [−0.043, −0.027]** | −0.079 [−0.098, −0.061] | −0.029 [−0.038, −0.020] | 4/4, 3/3 | −0.024 (TE) | +0.14 [−0.06, +0.34] |
| **X2 H9 + VIP** *(post-hoc)* | **−0.044 [−0.057, −0.033]** | −0.088 [−0.110, −0.068] | −0.038 [−0.050, −0.027] | 4/4, 3/3 | −0.032 (TE) | +0.08 [−0.17, +0.34] |
| X1 A2, wider grid *(post-hoc)* | −0.034 [−0.045, −0.023] | −0.078 | −0.028 | 4/4 | −0.019 | +0.09 |
| B1 H9 prior, production frame† | −0.014 [−0.024, −0.007] | −0.059 | −0.009 [−0.018, +0.002] | 4/4, 3/3 | −0.007 | −0.03 |
| B1 H9 prior, noX frame | −0.005 [−0.017, +0.008] | −0.049 | +0.001 | 3/4 | +0.020 (QB) | −0.16 |
| X3 production + VIP† *(post-hoc)* | −0.008 [−0.015, −0.001] | −0.052 | −0.002 | 3/4 | −0.001 | +0.12 |
| X4 production shrunk† *(post-hoc control)* | −0.006 [−0.015, +0.002] | −0.050 | — | 4/4 | — | +0.01 |
| D1 ridge, 7 features | −0.002 [−0.032, +0.022] | −0.047 | +0.004 | 2/4, 3/3 | **+0.045 (RB)** | **+0.50 [+0.16, +0.86]** |
| D2 ridge + xFP† (2023–25) | −0.009 [−0.038, +0.019] | −0.063 | −0.005 | 2/3 | +0.059 (RB) | +0.37 [−0.06, +0.78] |
| A3 xFP weight refit† (2023–25) | +0.003 [−0.003, +0.008] | −0.051 | +0.007 | 1/3 | +0.006 | −0.13 |
| C2 role change, sustained-gated | +0.013 [+0.004, +0.022] | −0.032 | +0.018 | 0/4 | +0.025 | −0.38 |
| C1 role change, ungated | +0.013 [+0.005, +0.022] | −0.031 | +0.019 | 0/4 | +0.023 | −0.32 |
| A1 Q + recent-3 refit | +0.019 [+0.009, +0.031] | −0.025 | +0.025 | 0/4 | +0.074 (QB) | −0.40 |
| B2 EW over all games Y−2…Y | +0.031 [+0.015, +0.050] | −0.013 | +0.037 | 0/4 (dev 2/3) | +0.064 | +0.07 |

† contains ffopportunity xFP, which is betting-derived (certificate 2026-10-03).

Per-fold Δ vs production:

| Fold | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|
| A2 | −0.054 | −0.015 | −0.037 | −0.038 | −0.028 | −0.032 | −0.042 |
| X2 | −0.059 | −0.025 | −0.041 | −0.043 | −0.029 | −0.046 | −0.058 |

The other formats use parameters selected on PPR. A2 gives −0.034 in half-PPR, −0.034 in standard and −0.034 in TE
premium; X2 gives −0.043, −0.039 and −0.044.

Production in 2019–2020 has no xFP, so it equals `noX` there.

What the gain is and is not:
- **Selected VIP weight.** w = 0.3 in most fold × position cells (TE 0.15–0.3). The wider grid still mostly picks 0.3, so
  0.3 is interior.
- **Ranking is unchanged.** Rosterable Spearman is 0.315 vs 0.318, and rosterable pair accuracy 0.621 vs 0.622. VIP
  reproduces the ranking information xFP gives production, without betting inputs, and improves point accuracy.
- **Bias.** A2 under-forecasts slightly more than production (−0.17 vs −0.04). Its calibration slope is 0.91 vs 0.89.
- **Selection optimism (§8.4)** is pre-registered against Q.
  - A2 passes, barely: real −0.079 against the best of 20 permutations, −0.077.
  - X2 fails: −0.088 against −0.097. X2 is post-hoc, so this check is informational only.
  - As ADR 0009 noted, the check is structurally biased against shrinkage-type candidates. The spread-matched control is
    the more direct test, and both candidates beat it with intervals excluding 0.
- **Ridge.** It ranks best (rosterable Spearman 0.343) and gives the only lineup gain whose interval excludes 0. Its MAE
  is unstable across folds and it is +0.045 worse at RB. It is a lead for ranking work, not a forecast candidate.

## Opportunity features (Milestone 2)

The sources cover 2014–2025 for points, targets, target share, carries, air yards, air-yard share, WOPR, pass attempts and
team totals (100% of game rows). Snap share covers 99.1–99.6% of rows; RACR about 73%. xFP exists only from 2021 (the
floor). Computed point-in-time per player-week: last-1 / last-2 / previous-2 / last-3 / previous-3 / season windows,
absolute deltas (1v3, 2v2, 3v3), direction streak, 4-game volatility and coverage. These cover snap share, target share,
carry share, team-target and team-carry share, targets, carries, air yards, air-yard share, WOPR, team pass attempts, team
plays, points, VIP and xFP†.

Not built, because the data does not exist in the repository's sources: routes, red-zone (play-by-play not loaded), injuries,
depth charts, and in-season vacated opportunity (H5 was already null).

**VIP** is a per-position OLS of same-game points on volume, fitted once on 2014–2017 rows. It precedes every selection and
test season.

| Position | VIP (PPR) |
|---|---|
| QB | 0.43 + 0.39·pass attempts + 0.92·carries |
| RB | −0.16 + 0.61·carries + 1.45·targets |
| WR | −0.08 + 1.51·targets + 0.013·air yards + 0.77·carries |
| TE | 0.07 + 1.46·targets + 0.029·air yards |

Production already ingests every one of these inputs (`lib/decision/analytics.js`).

## Breakout / opportunity signals (Milestone 4, class X)

Unit: RB/WR/TE × decision week 4–14, in the waiver-relevant pool (as-of season-PPG rank outside RB24 / WR36 / TE12). The
outcome window is the next 4 weeks and needs at least 3 played games. Censored windows (~36%) are counted, never zero.

*Gain* event: the window mean is at least as-of PPG + 5 (TE + 4), with 3 or more games above weekly replacement. Its base
rate is 4.4% (2016–21) and 4.8% (2022–25). The *rank* and *persistence* outcomes are in the artifact and agree directionally.

| Signal | Flags 22–25 | Precision 22–25 | Lift 16–21 / 22–25 | Recall 22–25 |
|---|---|---|---|---|
| Draft round 1–2 (baseline) | 1,934 | 8.3% | 1.94 / 1.74 | 0.46 |
| Engine `ROLE_EXPANSION` + spikes (`ENG_ANY_UP`) | 665 | 8.1% | 1.69 / 1.71 | 0.15 |
| Engine `XFP_BREAKOUT`† | 482 | 12.4% | 1.50 / 2.62 | 0.17 |
| N3 sustained carry-share growth (RB) | 162 | 8.6% | 2.56 / 1.82 | 0.04 |
| PH1 role growth × draft R1–3 *(post-hoc)* | 532 | 8.6% | 2.25 / 1.82 | 0.13 |
| N6 quiet VIP growth | 234 | 7.7% | 1.62 / 1.62 | 0.05 |
| N7 one-week spike (control) | 1,282 | 7.4% | 1.57 / 1.56 | 0.27 |
| N1 sustained snap share | 777 | 6.2% | 1.41 / 1.30 | 0.14 |
| N5 sustained VIP | 430 | 6.0% | 1.53 / 1.27 | 0.07 |
| Points gain last-2 (baseline) | 840 | 5.8% | 1.61 / 1.23 | 0.14 |
| N2 sustained target share | 426 | 5.4% | 1.62 / 1.14 | 0.07 |
| N4 multi-dimension | 424 | 5.4% | 1.52 / 1.14 | 0.07 |

- **Ranking scores.** Precision@5 per week on *gain*, 2022–25: VIP delta (2v2) 9.1%, snap-share delta 7.3%, points gain
  7.3%, xFP delta† 10.4%. On *rank*: VIP delta 28%, about equal to the points-gain baseline.
- **Lead time.** Early true positives (flagged before recent points rose) reached the points baseline about 1.6–2.0 weeks
  later. About 45% never triggered it within 4 weeks.
- **Null findings.**
  - Requiring persistence (N1/N2/N4/N5) did not beat a one-week spike or the current engine.
  - Team-share and multi-dimension expansion added no precision.
  - Opportunity signals do not beat draft capital as a breakout prior.

## Recommended next production contract (do not implement yet)

**EDGE-02 — VIP Start Value prospective shadow (capture-only, ADR 0011 pattern).** This is the smallest step the evidence
justifies. Production stays unchanged.

- **Change.** Record two shadow forecasts next to production and H9 for every captured player-week:
  - **VIP-A2**: `0.5·Q + 0.2·R3 + 0.3·VIP_last2`, the same for all positions (TE in the 0.15–0.3 range; one weight keeps
    it simple). VIP uses the frozen 2014–2017 coefficients for the league's format. A missing VIP falls back to Q, as X
    does today.
  - **VIP-X2**: the same, with Q replaced by H9 Q (ADR 0009, production k).
- **Expected benefit.** About −0.03 to −0.045 MAE versus production on all positions (largest at QB) and versus a
  spread-matched control. Ranking accuracy is unchanged, and the lineup gain is not resolved (+0.08 to +0.14, intervals
  include 0). It removes the betting-derived xFP dependency from Start Value at no accuracy cost.
- **Risks.**
  - The gain is below the 0.05 screen.
  - Slightly larger under-forecast bias.
  - VIP coefficients fitted on 2014–2017 may drift; check re-fitting on Y−1 against the frozen fit.
  - Non-PPR coefficients exist only for the four research formats. Custom scoring needs a fitting rule or must stay
    unsupported, since generic scoring cannot be assumed.
  - All evidence is V0 corrected data.
- **Validation required before any production change.**
  - Freeze w, the coefficients and the fallback in an ADR before the first shadow record.
  - Run a prospective shadow of at least 8 scored weeks and 2,500 cases, non-inferior within 0.05 and directionally
    consistent (protocol §9).
  - Report per position and format.
  - Score the lineup level with the lineup simulator.
  - Get owner approval and a new `model_version` (class D/F change under protocol §9).
- **Prospective evidence is still required.** EDGE-01 is L3 at best, and the strongest variant (X2) is post-hoc.

Research-only follow-ups, each needing its own approval:
- a ranking-targeted model, since ridge improves lineups but not MAE;
- an RB carry-share growth × draft-capital breakout feed as an informational Upside Evidence signal;
- a dedicated outcome-scorer for the H9 shadow, which would also score these shadows.
