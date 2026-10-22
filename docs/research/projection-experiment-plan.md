# PROJECTION-EXPERIMENT-01 analysis plan (frozen before any 2022–2025 outcome was scored in this task)

- Date 2026-10-22. Branch `claude/project-thread-dw1k4w` from `main` `cfaa336`. Owner-authorized experiment (no routine
  sign-offs); research only. **No production behaviour, weight, threshold, schema or policy changes.** Nothing is registered
  under Protocol v1/v2, and this plan does not edit either protocol.
- Evidence class **X**: walk-forward on public data. 2022–2025 are **consumed** seasons. They are reported and never called
  holdouts. Prior project results on those seasons (forecast audit, EDGE-01, EDGE-RANK-01) were known when the design
  was chosen, and that is disclosed.
- **No 2026 data is read.** The schedule download kept only seasons ≤ 2025. The consensus archive extract dropped every row
  scraped on or after 2026-03-01 before any other step. Loaders refuse season ≥ 2026.

## Data

| Input | Source | Use |
|---|---|---|
| Player-week stats and snaps 2014–2025, DynastyProcess ids (commit `2bbc02b`), ffopportunity 2021–2025 | Same files as EDGE-01. All 30 SHA-256 values match `artifacts/research/edge-01-results.json`. | Cases, features, production forecast |
| nflverse schedule (`nfldata/games.csv`, seasons ≤ 2025) | Public | Opponent, home, rest, roof. **Betting-derived:** closing spread and total |
| FantasyPros ECR archive (DynastyProcess `db_fpecr.parquet`): weekly positional PPR pages and ROS pages, scraped Fridays, 2020–2025 | Public archive | **Benchmark only** (owner decision 2026-09-29). Never a model input. |

Consensus snapshot rule: a scrape belongs to the first regular-season week whose last game date is after the scrape date.
A player-game may use a snapshot only if it was scraped on an earlier date than that game. Thursday games therefore use
the previous scrape or none. Consensus identity comes only from the exact `fantasypros_id → gsis_id` crosswalk. An id with
conflicting targets is unknown and is never guessed.

## Cases and outcomes

- Weekly: EDGE-01 case table (production membership, weeks 3–17, PPR). The outcome is next-game points, scored on played
  games only. A case with no stat row is censored and never scored as zero.
- ROS: the same cases at decision weeks 4–14. Outcomes over weeks w..17 for the as-of team's scheduled games:
  - `ppg`: mean points per game with a stat row, needing ≥ 3 such games;
  - `played_rate`: stat-row games divided by scheduled games;
  - `total`: realised points summed over stat-row games. A scheduled game with no stat row adds 0. This is the realised
    fantasy production of that roster spot. It is an outcome definition, never an input imputation. It also includes
    snap-confirmed zero-stat games.

## Frozen design (chosen on development folds 2019–2021 only)

Fold Y trains on seasons 2016..Y−1 and scores Y once. Per-position fits are used throughout.

- **PX (primary weekly candidate, non-betting):** the equal-weight average of
  - P5ctx, an OLS on [EW16 all-games, recent-3 PPG, snap share last 2, as-of opponent factor, home] with the noX fallback;
  - GBM, gradient-boosted trees (200 trees, depth 5, learning rate 0.05, min leaf 200, subsample 0.8) on 42 as-of
    features (`WEEKLY_FEATURES`). Missing values get their own split branch.
- **PXbet (secondary, betting-derived):** the same blend with the closing implied team total (linear) and spread/total/implied
  total (GBM) added.
- **ROS:** points per game R_BLEND = average of R_GBM (same GBM settings, `ROS_FEATURES`) and R_LIN (OLS on [EW16, S, H9 prior,
  season snap share, R3]). Availability is A_GBM, clamped to [0, 1]. Total = R_BLEND × scheduled games × A_GBM.
- **Intervals:** walk-forward conformal. For season Y, the residual quantiles {10, 25, 50, 75, 90}% come from the candidate's
  out-of-sample predictions in Y−2 and Y−1, binned by position × prediction quintile.
- Development grid and alternatives that were tried and not chosen: four GBM settings, a compact-feature GBM, deeper trees,
  plain P5, P5 + context and single models. All are reported in the artifact under `development`.

Development results that motivated the freeze (2019–2021, n = 12,110 played):
- PX vs production: −0.072 MAE [−0.107, −0.034], lineup +0.99 points/roster-week [+0.46, +1.54].
- PXbet vs production: −0.085 MAE, lineup +1.23.
- 80% interval coverage: 0.797.
- ROS ppg vs flat production: −0.139 MAE.
- Consensus (2021 only): ranks better than PX (pair accuracy 0.653 vs 0.642).

## Comparators

Production Start Value (`prod`, betting-derived via xFP from 2021), noX, Q, EDGE-01 A2 (VIP) and EDGE-RANK-01 P5 (refit
per fold). Consensus rank → points uses a per-position OLS `y ~ ln(rank)` fitted on earlier archived seasons (from 2020).
The consensus + PX blend is a per-position OLS fitted on earlier seasons' out-of-sample PX. Consensus comparisons are
restricted to players inside the consensus top-N (QB 32, RB 60, WR 72, TE 32).

## Questions and decision rules (applied to 2022–2025 as scored once)

1. **Weekly accuracy:** PX clears the project's MAE screen if pooled Δ MAE vs production is ≤ −0.05, its 95% paired
   cluster-bootstrap interval excludes 0, and at least 3 of 4 folds are better.
2. **Weekly decisions:** PX clears the lineup screen if pooled lineup Δ vs production is ≥ +0.1 points/roster-week and its
   season-week bootstrap interval excludes 0.
3. **Honest ranges:** intervals are calibrated if pooled 80% coverage is within [0.77, 0.83] and every position is within
   [0.75, 0.85].
4. **Edge over consensus:** an "edge over the experts" is claimed only if PX's pairwise ordering accuracy minus consensus has
   an interval above 0. "Adds information beyond consensus" is claimed only if the consensus + PX blend beats
   consensus-only MAE with an interval below 0.
5. **ROS:** R_BLEND clears the screen vs flat production ppg on the same rule as (1). The ROS total and ranking vs flat
   production and vs consensus ROS are reported with intervals and carry no pass/fail claim.
6. Betting-derived PXbet is reported beside PX under the same rules and labelled. Its use in production would need the
   AGENTS.md betting gate.

Anything computed after the first final run is labelled post-hoc. A failed rule is reported as a failure. Nothing is re-tuned.
