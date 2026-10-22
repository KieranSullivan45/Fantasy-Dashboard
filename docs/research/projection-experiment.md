# PROJECTION-EXPERIMENT-01: a weekly + rest-of-season projection model, and ESPN pool alternatives

- Date 2026-10-22. Branch `claude/project-thread-dw1k4w` from `main` `cfaa336`. This was an owner-authorized experiment.
  It is research only. **No production model, weight, threshold, schema or policy changed. Nothing was registered or
  promoted.** No 2026 data was read.
- Plan frozen and pushed before scoring: [`projection-experiment-plan.md`](projection-experiment-plan.md) (commit `735e050`).
  Design was chosen on development folds 2019–2021. Consumed seasons 2022–2025 were scored once. A second run added the
  per-fold ROS breakdown the plan's rule needs, and it reproduced every other number byte for byte.
- Evidence class **X**. The 2022–2025 seasons are consumed (reported, not holdouts). Earlier project results on them were
  known when the design was chosen.
- Artifacts:
  - `artifacts/research/projection-experiment-results.json`: final results.
  - `artifacts/research/projection-experiment-dev.json`: every development candidate, including the ones not chosen.
  - `artifacts/research/espn-pool-certificate.json`: the ESPN pool study.
- Reproduce:
  1. Download the EDGE-01 files and the schedule/consensus extracts listed in the plan to `.data/edge01/`.
  2. `node scripts/research/projexp/build.js`
  3. `node scripts/research/projexp/experiment.js --phase=final` (about 5 minutes).

## Bottom line

1. **The new weekly model makes better start/sit decisions than production. Its point-accuracy gain falls short of the
   screen.**
   - **Decisions.** PX (a non-betting blend of a 5-input linear model and boosted trees) gains **+0.91 lineup points per
     roster-week vs production [+0.49, +1.34]**. It is better in all 4 seasons and passes the 0.1 screen by a wide margin.
     That is 0.33/week more than the EDGE-RANK-01 P5 lead (+0.58 here).
   - **Accuracy.** MAE improves by only −0.028 [−0.061, +0.003]. That **fails** the 0.05 MAE screen. Development had shown
     −0.072, so the selection optimism was large.
2. **Adding betting lines clears both screens.** PXbet (adds closing implied team total, spread and total) gets −0.063 MAE
   [−0.097, −0.033] (4/4 folds) and **+1.41 lineup points [+0.94, +1.91]**. It is betting-derived, so production use needs
   the AGENTS.md betting gate and owner approval.
3. **The uncertainty ranges are honest.** Walk-forward conformal 80% intervals cover **80.0%** of 2022–2025 outcomes:
   - by position, QB 79.3%, RB 79.6%, WR 80.6%, TE 79.6%;
   - 79.2% for rosterable players;
   - 50% intervals cover 50.2%.

   A typical 80% range is about ±7 points around the projection, which is how noisy weekly scoring really is.
4. **Rest of season (ROS) is the biggest practical gain over today's dashboard.**
   - The ROS points-per-game model beats production's flat weekly value by −0.108 PPG MAE [−0.156, −0.057], 4/4 folds.
     That passes the screen.
   - Adding an availability model cuts ROS total-points error by 3.5 points per player (26.99 → 23.45). Most of that is
     simply not assuming every remaining game is played: production held flat over-forecasts by +12.8 points.
   - It also ranks ROS totals better (pair accuracy +0.014 [+0.010, +0.019]).
   - ROS 80% intervals cover 79.4% overall (QB 75%, the weakest).
5. **No edge over expert consensus.** FantasyPros weekly ECR (Friday, before Sunday kickoffs) ranks players better than PX:
   - pairwise accuracy 0.672 vs 0.663, interval excluding 0, in every season and position;
   - when PX and the experts disagree on who scores more, PX is right **46%** of the time;
   - the same holds for ROS: consensus 0.715 vs 0.697, and PX is right 45% when they disagree.

   Production is further behind (0.654, right 43%). One measurable complement: a consensus + PX blend beats
   consensus-only point error by −0.081 MAE [−0.103, −0.060]. PX carries magnitude information the rank does not. The
   blend's ranking and lineup results are equal to consensus, not better. The experts' advantage almost certainly comes
   from Friday news (injuries, depth charts, role changes), which a stats-only model does not see.
6. **The ESPN pool blocker can probably be closed with data we already have and approved paths, and without a new
   provider.** Flaim still caps available players at 100 per position with no paging (tool schema re-checked today). But
   the T2 "decision-sufficient certificate" works:
   1. Take the universe of NFL players.
   2. Remove the complete Flaim rosters.
   3. Keep only unrostered players omitted from the list whose value could change a decision.

   In a synthetic study that uses ESPN-wide rostered rates (8-team league like the owner's):
   - QB, RB and TE always certify;
   - WR fails in 78% of weeks, but at most 8 players (median 3) need an individual check;
   - `get_players` can confirm each with an ESPN id and `league_status`.

   FantasyPros, now connected, does sync this ESPN league, but its free tier gives names-only rosters (unusable under
   the identity rules) and its waiver tool is paid. It is not a fix.

## Weekly results (PPR, weeks 3–17, played games, 2022–2025, n = 16,320)

Δ = candidate minus production (negative MAE = better). Intervals are paired cluster bootstraps, the wider of the
by-player and by-season-week intervals. Lineup = EDGE-01 synthetic 12-team leagues, points per roster-week vs
production.

| Model | MAE | Δ MAE vs prod | Folds better | Rosterable pair acc. | Lineup Δ | Betting-derived |
|---|---|---|---|---|---|---|
| Production Start Value | 4.710 | — | — | 0.622 | — | yes (xFP) |
| Q | 4.754 | +0.044 | 0/4 | 0.618 | −0.56 | no |
| EDGE-01 A2 (VIP) | 4.672 | −0.039 [−0.048, −0.028] | 4/4 | 0.621 | +0.15 [−0.06, +0.38] | no |
| EDGE-RANK-01 P5 | 4.728 | +0.018 | — | 0.632 | +0.58 [+0.20, +1.00] | no |
| P5ctx (P5 + opponent, home) | 4.718 | +0.008 | — | 0.634 | +0.71 | no |
| GBM alone | 4.705 | −0.005 | — | 0.631 | +0.61 | no |
| **PX = ½ P5ctx + ½ GBM** | **4.682** | **−0.028 [−0.061, +0.003]** | 3/4 | **0.636** | **+0.91 [+0.49, +1.34]** | **no** |
| **PXbet** | **4.647** | **−0.063 [−0.097, −0.033]** | 4/4 | **0.641** | **+1.41 [+0.94, +1.91]** | **yes (closing lines)** |

- PX vs production by fold: 2022 −0.059, 2023 +0.004, 2024 −0.026, 2025 −0.033 MAE. Lineup +1.20, +0.89, +0.48, +1.08.
- PX vs production by position (MAE): QB −0.089, RB +0.013, WR −0.033, TE −0.040.
  - RB is the one position where PX is worse. That matches EDGE-RANK-01: mean-fitted models over-project low-end RBs.
  - PX's overall bias is +0.18 vs production's −0.04.
- PX vs P5 directly: −0.046 MAE [−0.061, −0.032].
- By part of season (lineup Δ vs production):
  - weeks 3–9: +1.38 [+0.68, +2.09];
  - weeks 10–17: +0.51 [+0.00, +0.97].

  The gain is concentrated early, as EDGE-RANK-01 found.
- Selection optimism from development to consumed seasons:
  - PX: MAE −0.072 → −0.028; lineup +0.99 → +0.91;
  - PXbet: MAE −0.085 → −0.063; lineup +1.23 → +1.41.

  The decision gain held up and the accuracy gain shrank.

Pre-registered rules: (1) MAE screen: PX **fails**, PXbet passes. (2) Lineup screen: PX **passes**, PXbet passes.
(3) Calibration: **passes** for both.

### Uncertainty ranges

Walk-forward conformal intervals use residual quantiles from the previous two seasons' out-of-sample predictions, binned by
position × projection quintile. Nothing from the scored season is used.

| | 80% coverage | 50% coverage | Mean 80% width | Pinball loss |
|---|---|---|---|---|
| PX | 0.800 | 0.502 | 14.7 pts | 1.591 |
| PXbet | 0.800 | 0.502 | 14.6 | 1.584 |
| Production + same method | 0.799 | 0.500 | 14.8 | 1.622 |

The method calibrates any point forecast, production's included. PX's ranges are slightly tighter and score better
(pinball). Ranges for rosterable players are wider (about 19 points) because better players are more variable.

## Rest of season (decision weeks 4–14, outcomes over weeks w..17)

| ROS points per game (≥ 3 games) | MAE | Δ vs production flat | Folds better |
|---|---|---|---|
| Production weekly value held flat | 2.739 | — | — |
| Season-to-date PPG | 2.920 | +0.181 | 0/4 |
| PX weekly held flat | 2.663 | −0.076 [−0.121, −0.033] | 4/4 |
| **R_BLEND** (½ GBM + ½ OLS on EW16, S, H9 prior, season snap share, R3) | **2.631** | **−0.108 [−0.156, −0.057]** | **4/4** |

| ROS total points (n = 16,452) | MAE | Bias | Δ MAE vs prod flat | Rosterable pair acc. |
|---|---|---|---|---|
| Production flat × scheduled games | 26.99 | +12.8 | — | 0.679 |
| Season PPG × games × as-of played rate | 25.57 | +4.1 | −1.43 | 0.669 |
| **ROS model (R_BLEND × games × availability)** | **23.45** | **−1.4** | **−3.55 [−4.24, −2.75]** | **0.693** |

- The availability model (A_GBM) is barely better than the as-of played rate on its own: MAE 0.211 vs 0.212. It does
  remove that baseline's optimism (bias −0.01 vs +0.07). It is not an injury model, because no injury data is used.
- ROS total 80% intervals cover 79.4% overall: QB 75.2%, RB 79.2%, WR 79.7%, TE 81.0%. A typical 80% range for a
  rosterable player is about ±50 points. ROS is genuinely uncertain, and the dashboard should say so.

## Against expert consensus (benchmark only; 2022–2025, players inside the consensus top-N)

The consensus rank is turned into points by a per-position OLS on ln(rank), fitted on earlier seasons only.

| Weekly (9,720 player-games) | Pair accuracy | Δ vs consensus | Right when disagreeing with consensus | MAE |
|---|---|---|---|---|
| Consensus (FantasyPros ECR, Friday) | 0.672 | — | — | 5.569 |
| PX | 0.663 | −0.009 [−0.012, −0.006] | 46.4% [45.2, 47.5] | 5.516 |
| PXbet | 0.666 | −0.007 [−0.010, −0.004] | 47.2% | 5.471 |
| Production | 0.654 | −0.019 [−0.023, −0.015] | 42.8% | 5.625 |
| Consensus + PX blend | 0.671 | −0.002 [−0.004, −0.000] | 48.4% | **5.488 (−0.081 vs consensus)** |

- Consensus wins in every season: PX's pair-accuracy gap is −0.004 (2022), −0.008, −0.010, −0.015 (2025).
- Consensus wins at every position: QB −0.017, RB −0.009, WR −0.008, TE −0.010.
- Synthetic lineups using consensus beat PX by 0.65 points/roster-week [−1.26, +0.05]. The blend is +0.14 [−0.39, +0.64]
  vs consensus.
- ROS (6,812 player-weeks): consensus ROS rank pair accuracy is 0.715 vs ROS model 0.697 [−0.024, −0.013]. The ROS model
  is right 44.6% of the time when they disagree.

Rule (4), edge over consensus: **fails**. Rule (4b), adds point information beyond consensus: **passes**, at the
magnitude level only.

## ESPN pool blocker: alternatives checked today

| Option | Finding |
|---|---|
| Flaim `get_free_agents` paging | The schema re-checked 2026-10-22 still allows `count` ≤ 100 with no offset. The `get_players` docs now call ESPN availability "bounded 100-player". No change. |
| **Complement certificate** (T2 direction: universe − exact Flaim rosters, then the lemma threshold) | **Feasible.** Synthetic study, 2021–2025, 45 weeks with archived ESPN-wide rostered rates, value = production Start Value. 8-team league: QB/RB/TE certify in 100% of weeks. WR certifies in 22%, and when it fails a median of 3 (max 8) omitted players exceed the threshold. 12-team league: WR certifies in 93% (max 2 checks). Each failing candidate can be checked through the approved `get_players` path, whose ESPN id and `league_status` meet the identity rules. Unlisted players have unknown waiver state, so they can certify a replacement level but are never recommended as adds. |
| FantasyPros MCP (connected to this project) | It does sync the owner's 8-team ESPN league. The free tier returns all rosters as **names only**, with no player ids, so the identity invariant rules it out as a roster source. The waiver tool is paid. Projections/ECR are benchmark-only pending licensing. It is the same cookie-sync trust model as Flaim. **Not a fix.** |
| Direct ESPN read (espn-api style, bookmarklet) | Unchanged from ESPN-ALT-IMPORT-01: technically removes the cap, but it uses undocumented endpoints, which AGENTS.md forbids without a new owner policy decision. |

Recommendation: build the certificate as a scoped M3 task (offline core plus a bounded `get_players` confirmation step).
It needs no new provider, credential or policy, and it would unlock replacement level, VOR and trade bench terms on ESPN.
Pickup Rating stays withheld (T2 F5). The synthetic study is class X. Rostered sets were approximated by ESPN-wide
popularity, the universe is limited to recently active players, and only 45 weeks have archived ownership. The first
live run should report the certificate's actual pass rate.

## Limits

- Consumed seasons. The design was chosen on 2019–2021, but earlier project work on 2022–2025 informed the feature ideas
  (EW16, snap share and P5 came from EDGE-RANK-01). Treat the results as strong retrospective evidence, not a holdout.
- Played-only weekly frame. Snap-confirmed zero-stat games and inactive players are censored, as in EDGE-01. The ROS
  total counts them as 0, which is the realised roster-spot production.
- Lineup results are synthetic leagues (EDGE-01), not real rosters. They show decision quality, not a forecast of the
  owner's wins.
- The consensus mapping is a simple ln-rank fit. A better mapping might narrow the MAE gap, but it cannot change the
  ranking result.
- No injury, depth-chart or news inputs exist in these sources, which is the most likely reason consensus wins.
  NEWS-SOURCE-01 already scoped that layer.
- PX is the equal-weight blend fixed on development data. No weights were tuned on consumed seasons.

## What this means and what to do next (for the PM)

1. **Prospective shadow of PX (and PXbet labelled betting-derived) beside production**, capture-only (ADR 0011 pattern).
   The lineup gain is the strongest decision evidence the project has: +0.91 non-betting, every season, larger than P5.
   The MAE screen was not met, so this is a shadow, not a promotion.
2. **Ship a ROS view built on R_BLEND × availability with the 80% ranges.** It fills the dream-gap report's biggest
   missing horizon. It beats what the dashboard implies today, and its ranges are calibrated. It is a new horizon, so it
   needs PM approval and must stay labelled "ROS model (research)". It must not change waiver or trade policy.
3. **Do not claim an edge over expert rankings.** The data says consensus ranks better, so the honest product position is
   "match the experts, add calibrated ranges, league-specific lineups and ROS". The single biggest lever for closing the
   gap is the injury/status layer (NEWS-SOURCE-01). Showing consensus next to our numbers would need FantasyPros licensing
   clarity first.
4. **ESPN: build the pool certificate as the next ESPN task.** See above.
