# EDGE-01 analysis plan (written before any EDGE-01 outcome metric was computed)

- Task: EDGE-01, Forecast & Opportunity Edge research slice. Branch `research/edge-01-forecast-opportunity` from `main` at `4b912e1`.
- Written and committed before any candidate, baseline or signal was scored against realised outcomes in this task. Prior project
  results that already used these consumed seasons (forecast audit 2026-10-03, M4 Tier A / ADR 0009) were known when this
  plan was written; that prior knowledge is disclosed, not hidden.
- Evidence class: **R** (V0 corrected public data, walk-forward) for point-forecast folds; **X** for the synthetic lineup
  simulation, the breakout/opportunity signal study and anything added after this plan. Nothing here is class C, and
  Evaluation Protocol v1 is not edited.
- **No 2026 file is downloaded or read.** Loaders refuse season ≥ 2026 (`SEALED_SEASON`).

## Data (layer V0)

Already-approved public files the repository and earlier research used, downloaded to ignored `.data/edge01/` with SHA-256
recorded in the results artifact: nflverse `stats_player_week_{2014..2025}`, `snap_counts_{2014..2025}`; DynastyProcess
`db_playerids.csv`; ffopportunity `v1.0.0-data` `ep_weekly_{2021..2025}` only (xFP floor, protocol §2.5). xFP is
**betting-derived** (certificate 2026-10-03); every xFP-dependent column, candidate or signal is labelled `betting_derived`
and evaluated only as a comparison. No other betting/odds column is read. No play-by-play, injury, route or news data.

Game rows come from the production backtest builder `lib/backtest/data.js historicalGames` (read-only). Team-game totals
(targets, carries, pass attempts, air yards, and a team-plays proxy = max offensive snap count on the team in that game)
are summed from the same files. A team share is computed only when the total is observed and positive.

## Cases and outcome (point forecast)

- Membership, production features and the production forecast: repo `buildCases` → `weeklyFeatures` → `forecast`
  (weeks 3–17, ≥ 2 current-season games, last game within 3 weeks, past-activity rule).
- Outcome: PPR points in week w (played only). A case without a stat row is censored and counted, never zero.
- Formats: PPR primary. Half-PPR, standard (repo PPR with `rec` 0.5 / 0) and TE premium are reported for the control set and
  the family winners; weights/parameters are always selected on PPR only.

## Folds (protocol §2.4)

Test season Y; train on 2016…Y−2; select on Y−1; score once on Y. **Primary folds: Y ∈ {2022, 2023, 2024, 2025}** (consumed:
reported, never described as holdouts). **Development folds: Y ∈ {2019, 2020, 2021}** (development seasons; reported as
walk-forward development evidence with no held-out claim). xFP-dependent fitted candidates need training seasons ≥ 2021, so
they run only for Y ∈ {2023, 2024, 2025}. Production on Y ≤ 2020 has no xFP and therefore equals `noX`; it is labelled so.
Every pooled number is shown next to its folds.

## Controls and baselines

`prod` (B9, frozen `decision-0.3.2` Start Value, contains betting-derived xFP from 2021), `noX` `[0.8, 0.2, 0, 0]`, Q (B7),
season PPG S (B1), EW3 / EW5 (B3), recent-3 R3 (B2), last game (B4). Strongest simple baseline = best of B1/B3/B7 by pooled
primary-fold MAE (expected Q, per the forecast audit).

## Opportunity features (Milestone 2)

Per player, as of week w, from current-team games only (team of the latest as-of game), for each metric in
{snap share, target share, carry share, targets, carries, air yards, air-yard share, WOPR, points, VIP, xFP†, team-target
share, team-carry share, team pass attempts, team plays}: last-1, last-2, previous-2, last-3, previous-3, season-to-date;
deltas last-1 vs previous-3, last-2 vs previous-2, last-3 vs previous-3 (absolute only; no ratio deltas); consecutive-direction
streak; 4-game volatility; coverage. A window containing a missing value is missing (never partially averaged, never zero).
Games are recorded appearances, not calendar weeks (absent weeks are not padded).

**VIP (volume-implied points)**: a non-betting analogue of xFP. Per position OLS of same-game points on volume (QB: pass
attempts, carries; RB: carries, targets; WR: targets, air yards, carries; TE: targets, air yards), fitted once per format on
**2014–2017 rows only**, which precede every fold's selection season, so it never sees a selection or test season.

Not built (no supporting historical data in the repository's sources): routes, red-zone, injuries, depth charts, vacated
opportunity in-season (H5 already null), participation on dropbacks. Efficiency (FPOE, RACR) is kept out of opportunity.

† betting-derived.

## Point-forecast candidates (Milestone 3) and their pre-listed grids

Every candidate keeps the production fallback rule: if a candidate input is missing the candidate returns `noX` for that
case (disclosed fallback rate). Grids are selected per position on Y−1 PPR MAE; nothing is selected on a test season.

| ID | Family | Definition | Grid |
|---|---|---|---|
| A1 `qr` | recency | w·Q + (1−w)·R3 | w ∈ {0.6, 0.7, 0.8, 0.9, 1.0} |
| A2 `qrv` | role level | (0.8−w)·Q + 0.2·R3 + w·VIP_last2 (production structure, VIP in place of xFP) | w ∈ {0.05, 0.1, 0.15, 0.2, 0.3} |
| A3 `qrx`† | xFP refit | (0.8−w)·Q + 0.2·R3 + w·X | w ∈ {0, 0.1, 0.15, 0.2, 0.25, 0.3} |
| B1 `h9` | EW prior | ADR 0009 `ew2_h16` Q (production k) in the `noX` frame and in the production frame | fixed |
| B2 `ewall` | EW production | 0.8·EWall(h) + 0.2·R3, EWall = EW mean over all REG games Y−2…Y as of w | h ∈ {8, 12, 16, 24} |
| C1 `role_always` | role change | noX + β·(VIP_last2 − VIP_season) | β ∈ {0.1, 0.2, 0.3, 0.5} |
| C2 `role_gated` | role change | noX + β·(VIP_last2 − VIP_season) only when VIP or snap share changed in a **sustained** way (both latest two games beyond previous-two mean by τ: VIP 3 pts, snap share 0.10), else noX | β ∈ {0.1, 0.2, 0.3, 0.5} |
| D1 `ridge` | fitted linear | per position ridge on [Q, R3, S, EWall16, VIP_last2, VIP_season, snap_last2] | λ ∈ {1, 10, 100, 1000} |
| D2 `ridge_x`† | fitted linear | D1 + [X, X_season] (Y ≥ 2023 only) | same |

Metrics per fold, position and week stratum (3–5, 6–9, 10–17): n, MAE (primary), RMSE, median AE, bias, calibration slope,
macro Spearman over week × position (all cases and as-of rosterable: top 24 QB / 48 RB / 60 WR / 24 TE by as-of Q), pair
accuracy within week × position (all, rosterable, and rosterable with forecast gap ≥ 2). Paired cluster bootstrap (1,000
draws, by player and by season-week, wider interval reported) for each family winner vs `prod` and vs Q, per fold and pooled.

Decision screens (D3): 0.05 MAE; 0.1 lineup points per roster-week. A **promotion-worthy** forecast candidate must, on the
primary folds: beat `prod` and Q pooled with the 95% upper bound below 0; be better than `prod` in ≥ 3 of 4 folds; have no
position worse than `prod` by > 0.10 MAE; and exceed the selection-optimism gain (§8.4: whole selection rerun on outcomes
permuted within season × week × position, 20 permutations). Clearing 0.05 is a further screen, not required for "worth a
prospective shadow". Cross-family comparison on the consumed folds is disclosed as selection over consumed seasons; the
honest confirmation is a prospective shadow (L4).

**Lineup simulation (class X)**: per season-week, 4 synthetic 12-team leagues per seed; rosters of 2 QB / 5 RB / 5 WR / 2 TE
drafted by seeded noisy as-of-Q snake order from played cases only (participation-conditional); lineup QB, RB, RB, WR, WR, TE,
FLEX via the repo legal-lineup optimizer; metric = realised lineup points per roster-week and regret vs the hindsight-optimal
legal lineup. No historical roster state is claimed.

## Breakout / opportunity signals (Milestone 4; class X)

Unit: player × decision week w ∈ 4…14, RB/WR/TE primary (QB reported only), membership as above. Outcome window: weeks
w…w+3; outcome defined only if the player has ≥ 3 played games in the window (otherwise censored and counted, never zero).
**Waiver-relevant pool (primary)**: as-of season-PPG rank at the position, among that week's eligible cases, outside the tier
RB 24 / WR 36 / TE 12. Results also reported on all eligible cases.

Outcome definitions (all three reported; a signal must look good on (a) and (b) to be called useful):
- (a) **rank**: window mean points rank inside the tier among that week's same-position eligible cases with a defined window.
- (b) **gain**: window mean ≥ as-of season PPG + G (G = 5 RB/WR, 4 TE), and ≥ 3 window games above weekly replacement
  (weekly points of the RB24 / WR36 / TE12 player among all game rows that week).
- (c) **persistence**: window mean of the position role metric (RB carry share, WR/TE target share) ≥ as-of season mean
  + δ (0.10 RB, 0.05 WR/TE) and window mean points ≥ as-of season PPG + G/2. Disclosed: (c) shares a construct with
  role-share signals, so (c) is secondary.

Signals (computed from as-of data only):
- Baselines: BL1 last-2 PPG minus earlier-season PPG ≥ G; BL2 snap-share last-2 vs previous-2 ≥ 0.10; BL3 draft round 1–2.
- Current engine (`lib/signals/engine.js playerSignals`, called read-only on reconstructed history with no market, injury,
  schedule or high-value context): ENG_ROLE_EXPANSION; ENG_ANY_UP (any `up` role/participation/backfield signal, excluding
  XFP_BREAKOUT); ENG_XFP_BREAKOUT†.
- New: N1 sustained snap share (+0.10); N2 sustained target share (+0.05); N3 sustained carry share (+0.10); N4 multi-
  dimension (≥ 2 of N1–N3, or air-yard share +0.05); N5 sustained VIP (+3 pts); N6 quiet growth (N5 and last-2 points ≤
  last-2 VIP); N7 one-week spike only (control); N8 sustained xFP (+3)†.
- Ranking scores (precision@K, PR-AUC): VIP last-2 vs previous-2; snap-share delta; last-2 PPG gain; xFP delta†.

Metrics: per flag, flagged n, precision, base rate, lift, recall, false-positive rate, false-positive cost (mean window points
of false positives minus the pool mean); per score, precision@K (K = 5 per season-week across RB/WR/TE in the pool) and PR-AUC;
lead time = share of true positives flagged while last-2 points had not yet risen by G/2, and weeks until BL1 first fires for
them (capped at 4). Per fold (season 2016–2025 by test year) and position. Cells under 50 unique players are suppressed. No
signal is converted into Start Value, Pickup Rating, Trade Value or Market Value.
