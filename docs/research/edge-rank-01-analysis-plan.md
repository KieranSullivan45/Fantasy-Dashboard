# EDGE-RANK-01 analysis plan (written before any new candidate was scored)

Research only (class X, exploratory). No production, calibration, schema, signal, provider, capture or UI change. No protocol
registration. Seasons ≤ 2025 only; 2026 is sealed and no 2026 file is downloaded or read. 2022–2025 are consumed development
evidence, never held-out. The EDGE-01 results (including the D1 ridge lineup lead) were already seen when this plan was
written, so every candidate below is post-hoc relative to EDGE-01 and is labelled class X.

## Question

Can a model chosen for player ordering / lineup decisions beat production Start Value on legal-lineup outcomes even when
point MAE barely changes, and can a simple non-betting candidate keep most of the EDGE-01 ridge (D1) lineup gain?

## Frame (reused unchanged from EDGE-01)

- Case table, VIP map (fit 2014–2017), features and outcome: `lib/research/edge01/*`, PPR only. Weeks 3–17, next-game points,
  played only (missing stays missing, no participation zero-imputation). Common frame = played cases with a production forecast.
- Walk-forward: fit on 2016…Y−2, select (where a grid exists) on Y−1 per position, score once on Y. Development folds
  2019–2021, consumed folds 2022–2025. A candidate whose inputs are missing falls back to noX (fallback rate reported).
- No xFP / betting-derived input in any candidate. Production (contains xFP from 2021) is the control and is labelled.

## Candidates (complete search space)

Baselines: production, noX, Q, season PPG (S), recent-3 (R3), VIP-A2 fixed `0.5Q + 0.2R3 + 0.3·VIP_last2`, EDGE-01 D1 ridge
replica (7 features `[Q, R3, S, EW16, VIP_last2, VIP_season, snap_last2]`, λ ∈ {1, 10, 100, 1000} by Y−1 MAE).

A. Simple ranking scores (per-position OLS with intercept, fitted on training seasons, no grid):
A1 `[Q, VIP_last2]`; A2 `[Q, VIP_last2, snap_last2]`; A3 `[Q, R3, VIP_last2, snap_last2]`;
A4 linear recalibration of VIP-A2 (`a_p + b_p·VIP-A2`).

B. Regularized linear ranker perturbations (λ fixed at 100 to remove selection noise unless stated):
B1 ridge7 fixed λ; B2 no-VIP (drop both VIP terms); B3 no-recency (`[Q, S, EW16, VIP_season, snap_season]`);
B4 no-snap; B5 de-duplicated level block `[Q, R3, VIP_last2, VIP_season, snap_last2]`;
B6 B1 shrunk toward Q with a ∈ {0.25, 0.5, 0.75} (fixed sensitivity curve, no selection).

C. Selection objective. The same grids chosen on Y−1 by each of: MAE (default), macro Spearman over week × position (all),
pairwise accuracy among rosterable players, the same restricted to forecast gap ≥ 2 (all existing EDGE-01 metrics), and
synthetic legal-lineup points (standard structure; one λ/w shared by all positions because the lineup is joint).
Grids: ridge7 λ ∈ {1, 10, 100, 1000, 10000}; VIP blend `(0.8−w)Q + 0.2R3 + w·VIP_last2`, w ∈ {0, 0.1, …, 0.6}.

Controls for spread / level (Q7): per-position linear recalibration of production, Q and noX (`a_p + b_p·forecast`, fit on
training seasons). They change only level/spread, never within-position order.

## Metrics

MAE, bias, calibration slope, within week × position forecast SD; macro Spearman (all, rosterable); pairwise accuracy
(rosterable; forecast gap ≥ 2; and a fixed pair set with |actual difference| ≥ 2, identical across models). Paired cluster
bootstrap (season-week clusters) for ΔMAE, ΔSpearman and Δ lineup points.

Lineups (class X, simulated rosters, repo Hungarian optimizer `lib/decision/optimizer.js`): standard 1QB
(`QB RB RB WR WR TE FLEX`, rosters 2/5/5/2, 12 teams), no-FLEX (within-position only; additive per position), Superflex
(`+SUPER_FLEX`, 3 QBs, 10 teams), deep (`3 WR, 2 FLEX`, 2/6/6/2, 10 teams), and synthetic dual eligibility (seeded 25% of
RBs also WR, 25% of TEs also WR; eligibility is synthetic, labelled). Three draft seeds each (seed 0 = EDGE-01). No claim
about historical manager lineups.

## Robustness

Fold-by-fold; position; weeks 3–5 / 6–9 / 10–17; rosterable vs all; early (≤ 4 games) vs established (≥ 5); coefficient
stability (standardized); leave-one-fold-out; RB excluded (ranking metrics without RB; lineups with production values for
RBs and in the additive no-FLEX decomposition); VIP removed; recency removed; shrink toward Q. Selection optimism: a
walk-forward meta-selection that picks the best candidate on Y−1 lineup points and scores it on Y, compared with the
in-sample best.

## Decision rule (stated before results)

Screens: 0.05 MAE and 0.1 lineup points per roster-week (provisional, owner 2026-09-29). A candidate is "worth prospective
registration" only if its standard-structure lineup gain vs production is ≥ 0.1 with a season-week bootstrap interval
excluding zero on consumed folds, the sign holds on development folds, in ≥ 3 of 4 consumed folds, in leave-one-fold-out,
without RB and across structures/seeds, it is not reproduced by the level/spread recalibration controls, and it does not
worsen MAE by more than 0.05 overall or 0.10 at any position. Otherwise "more research" if the lead survives partially,
"drop" if it does not survive the perturbations.

## Post-hoc addendum (written after the first full run; disclosed)

The first run showed that the ridge lineup gain survives removing VIP (B2) but falls when snap share is removed (B4) and
that A2 (`[Q, VIP_last2, snap_last2]`) keeps most of it while A1 (`[Q, VIP_last2]`) keeps almost none. Three post-hoc
candidates were then added, labelled class P (post-hoc) everywhere: P1 `[Q, snap_last2]`, P2 `[Q, R3, snap_last2]`,
P3 `[Q, snap_season]` (per-position OLS, no grid). No other candidate was added and no grid was widened.

Second post-hoc round (after the standardized-coefficient table showed EW16 and snap_last2 carry most of the ridge weight
while Q, S and VIP_season were unstable across folds): P4 `[EW16, snap_last2]`, P5 `[EW16, R3, snap_last2]`,
P6 `[EW16, S, R3, snap_last2]` (per-position OLS, no grid). These were the last candidates added.
