# Evaluation Protocol v1

- Date: 2026-09-29
- Task: EVAL-PROTOCOL-01 (ADR 0007)
- Status: **submitted for registration.** This document becomes Protocol v1 only when it is merged to `main` with the repository owner's approval (section 14). Until then nothing below is in force.
- Scope: documentation only. No code, schema, workflow, weight, threshold or policy is changed by this document.
- Derived from: the project's Thread 5 evaluation design and Thread 3 hypothesis list (research reports in the project shared folder, not in this repository; everything needed is restated here) and the owner decisions of 2026-09-29 recorded in section 1. Where they differ, section 1 wins.

## 0. Purpose

Every accuracy or decision claim about Fantasy-Dashboard should be checkable and unrewritable. This protocol fixes, before any confirmatory outcome exists: which seasons are consumed and which is sealed, what a prediction of record is, what is measured, against what, with what statistical rules, and what evidence is needed before a model change. It does not describe the model (`docs/v0.3.2.md`) and does not authorize any change to it.

## 1. Adopted owner decisions

| # | Decision | Source |
|---|---|---|
| D1 | 2022, 2023, 2024 and 2025 are **consumed** seasons: usable for retrospective development, walk-forward evaluation and exploration, never as pristine holdouts. 2023, 2024 and 2025 are not described as untouched holdouts anywhere. | Thread 5 policy, owner 2026-09-29 |
| D2 | 2026 is the **prospective sealed season**, sealed only after this protocol is registered. Existing pre-registration 2026 captures are **pilot/debugging evidence**, not confirmatory. | same |
| D3 | Provisional practical-significance screens: **0.05 MAE** (point forecast) and **0.1 lineup points per roster-week** (decision level). Not permanent constants; not sufficient for promotion by themselves. | same |
| D4 | Consensus projections are archived as a **benchmark only**, pending licensing confirmation. Never a production model input. Betting/odds-derived data stays excluded. | same, owner 2026-09-29 (item 10) |
| D5 | **Prediction of record.** Waiver: for each league waiver processing run, the last valid scheduled waiver capture before the authoritative waiver processing cutoff (before that claim window closes). Lineup: the last valid prediction before each player's kickoff. | owner 2026-09-29 (item 2); waiver wording clarified by the owner's PM review of PR #13 |
| D6 | Historical hypotheses **H1–H10 are frozen** (section 10). Null and negative findings are preserved; H8 tests the null that late-season endpoint surge adds nothing beyond the existing prior. | Thread 3 decisions, owner 2026-09-29 |
| D7 | **Birthdate rule.** Crosswalk vs nflverse difference ≤ 30 days: age may be used and a discrepancy flag is preserved. Difference > 30 days: `age = unknown` until resolved. One source is never silently chosen. | owner 2026-09-29 (item 4) |
| D8 | Phase 0 offline historical research and Tier A are approved after this protocol is committed; Tier C stays blocked until Tier A shows value. No production model, schema, weight or policy change follows from research alone. | owner 2026-09-29 (items 3, 7) |

## 2. Season ledger

| Season(s) | Status | Permitted use | Forbidden use |
|---|---|---|---|
| 2016–2021 | development / priors | feature research, priors, walk-forward training | any claim of held-out performance |
| 2022–2025 | **consumed** | retrospective development, walk-forward folds, exploratory analysis, ablations | selecting or tuning as though untouched; describing 2023–2025 as holdouts |
| 2026 before registration | **pilot** | debugging the scorer, cadence and record contents | confirmatory claims; selecting models, thresholds or hypotheses |
| 2026 after registration | **sealed** | prospective scoring under this protocol only | tuning, threshold setting, candidate selection or hypothesis design informed by its outcomes |

Rules:

1. A season is **consumed** once any candidate has been scored on it for a decision. Reporting a consumed season is allowed; selecting on it as if it were clean is not.
2. **Sealing.** No research, feature, threshold or model design may use outcomes of sealed 2026 games. Phase 0 and Tier A research (section 10) uses seasons ≤ 2025 only. Sealed outcomes are read only by the scorer at the scheduled looks in section 11.5.
3. **Pilot boundary.** A capture is pilot if its `generated_at` is earlier than the registration commit time on `main` (section 14). At the time of writing that is all 72 known captures (2026-09-24 through 2026-09-29, two Sleeper leagues, 17 distinct `implementation_revision` values, weeks 3–4).
4. **Walk-forward.** For each test season Y, train on seasons < Y−1, select on Y−1, test on Y, and report every fold separately. A pooled figure is never shown without the folds. With the consumed seasons this gives retrospective folds only; the sealed season is confirmation.
5. **xFP floor.** `ffopportunity` was trained on 2006–2020, so xFP-dependent evaluation is valid only for seasons ≥ 2021.
6. The season ledger changes only through a new protocol version (section 13).

## 3. Data-vintage layers and claim classes

| Layer | Contents | Use |
|---|---|---|
| V0 | nflverse/ffopportunity/DynastyProcess files as downloaded today (corrected, not publication-time vintages) | development and selection. Known optimism from stat corrections. |
| V1 | records from `data-archive` with true `available_at` / `generated_at` | prospective scoring. The only layer that can claim publication-time honesty. |

Every result states its layer and one claim class. A result of one class is never presented as another.

| Class | Meaning |
|---|---|
| **R** retrospective | V0 data, consumed seasons. Development evidence. |
| **P** pilot | pre-registration 2026 captures. Debugging evidence. |
| **X** exploratory | any post-hoc or unregistered analysis, on any data. Never feeds a promotion decision. |
| **C** confirmatory | V1 records generated after registration, meeting the validity rules in section 4, scored under this protocol. |

**What a class-C claim may contain.** A metric is confirmatory only if every input is in the archived record or is a hash-pinned as-of source recorded with it. Per the Thread 5 review of the archive (2026-09-29), the current archive does not yet hold frozen baseline forecasts, the full ranked alternatives, the recommended lineup or a protocol hash. Therefore, until the archive follow-up in section 12 is separately approved and shipped:

- Confirmatory-eligible: absolute accuracy, bias and calibration of the recorded forecast against realised outcomes; ranking metrics computed from recorded values; outcome scoring of the recorded best add/drop pair.
- Not confirmatory: any comparison against a baseline that was not frozen in the record. Such comparisons may be computed from V0 data and are labelled class X ("reconstructed baseline").

## 4. Prediction of record

### 4.1 Rules (owner decision D5)

- **Lineup of record.** For each player and game, the last **valid** prediction whose `generated_at` is earlier than that player's kickoff. Every later capture is supplementary. A player who kicks off before any valid capture has no lineup-of-record and is counted in the dropped-case table.
- **Waiver of record.** For each league waiver processing run, the last **valid scheduled waiver capture** that (a) occurs after the prior week's games and data have settled sufficiently for `data_through_week` = evaluated week − 1, and (b) is strictly earlier than the **authoritative waiver processing cutoff** for that run (that is, before that claim window closes). This is the latest valid pre-processing decision snapshot. It is not "before the window opens". Captures outside that class are supplementary. If an authoritative processing cutoff cannot be established for a run, that run has **no class-C waiver-of-record**; a cutoff is never inferred retrospectively.

### 4.2 Definitions (v1 operationalization)

These definitions make D5 testable. Both points that were open at submission were resolved by the owner's PM review of PR #13 and are recorded below.

- **Valid capture.** A `capture-1` record that: passes its schema check; has a parseable `generated_at`; declares a `data_through_week` equal to the evaluated week minus one (the last completed week); carries `model_version` and `feature_version`; and whose own source records report no failed required source. A capture failing any test is *invalid*, is never a record of record, and is listed in the dropped-case table.
- **Waiver processing cutoff.** The authoritative time at which a league's waiver run processes claims and its claim window closes. It must come from the provider or league settings for that run, not from a guess; where it cannot be established, section 4.1 applies (no class-C waiver-of-record for that run). The waiver-of-record capture is fixed before the decision is made and before any outcome exists.
- **Scheduled waiver capture.** A capture produced by a schedule dedicated to the waiver decision (Thread 5 proposed Wednesday–Thursday morning ET, illustrative). The current 6-hour cron (`17 */6 * * *`) and the post-`Validate` captures on `main` are **not** scheduled waiver-of-record captures and are never retroactively classified as such; records also do not state which trigger produced them. Creating a dedicated schedule changes `.github/workflows/`, which is a separate, unapproved change (section 12). Until it is approved and shipped, **no waiver outcome is class C** and waiver results remain class P or X. Lineup and forecast confirmatory claims may still proceed where the current archive supports them (section 3).
- **Kickoff source.** Kickoff times come from the same schedule source the scorer already uses (`evaluateObservation` counts only games with kickoff after `generated_at`). A row whose kickoff precedes `generated_at` is never scored; it is counted with reason `kickoff_before_capture`.

### 4.3 Dropped-case table

Every captured case is scored or appears in a table with one of these pre-defined reasons; no case is removed after its outcome is seen.

`invalid_capture` · `no_valid_capture_before_kickoff` · `kickoff_before_capture` · `bye_or_inactive` · `no_outcome_yet` · `unresolved_identity` · `missing_required_source` · `duplicate_evidence` · `superseded_supplementary`

`bye_or_inactive` cases are reported, never treated as zero points. Results are reported both **participation-conditional** (played) and **participation-inclusive** (with the count and rate of non-participants), because about 26% of candidate cases in the 2024 retrospective have no next-week stat row.

## 5. Evaluation units and primary metrics

The **primary** metric for each decision type is fixed here. All others are secondary and cannot support a promotion.

| Decision | Unit | Primary metric | Notable secondary metrics |
|---|---|---|---|
| Point forecast | player × week | MAE of Start Value central vs realised points (played only) | RMSE, bias, median absolute error, scale-normalised error, calibration slope, decile reliability |
| Ranking | week × position group | mean Spearman (macro over groups) | Kendall τ-b, NDCG@k, top-k regret, selective-accuracy curve for gaps δ ∈ {0, 1, 2, 3, 5} points |
| Start/sit | roster × week | lineup points ÷ hindsight-optimal legal lineup points (regret) | pairwise accuracy conditional on gap |
| Waiver | (pool, roster) × week | realised points over replacement of the recommended add over 1/3/4-week windows | false-drop rate, regret vs best available, realised lineup gain |
| Trade | proposal × roster | sign and calibration of predicted ΔLineup vs realised ΔLineup, `next_game` only | none for "fairness" (Market Value is `null`) |
| Breakout / upside | player × week × flag | precision@K and lift over base rate | recall, PR-AUC, lead time, false-positive cost |

Every headline table adds **lineup points per roster-week** from the lineup simulator so that an accuracy gain is expressed as a decision gain. Overlapping multi-week outcomes are never counted as independent trials. Confidence labels are ordinal and tested on scale-normalised error; a label must be monotone to be shown. Interval ranges are reported against nominal coverage. Any probability that is ever displayed must first pass Brier score, log loss and fixed-bin calibration in two seasons.

Strata are reported separately, never blended: weeks 1–2, weeks 3–14, weeks 15–17, week 18; PPR, half-PPR, standard, TE-premium and Superflex context; QB/RB/WR/TE; cohorts in section 8. ESPN is out of scope for this protocol version: ESPN decisions are not archived and their coverage is gated separately.

## 6. Baseline ladder

A candidate must beat the **strongest simple baseline**, not only season PPG.

| ID | Baseline | Notes |
|---|---|---|
| B0 | position-group mean | floor |
| B1 | season PPG | existing comparator |
| B2 | recent-3 PPG | |
| B3 | exponentially weighted PPG, half-lives 3 and 5 games | cheap, strong, currently missing |
| B4 | last-week points | overreaction test |
| B5 | opportunity volume mapped linearly to points, fitted on training seasons | |
| B6 | xFP only | valid from 2021 |
| B7 | shrunk PPG (Q) | model with recent PPG and xFP removed |
| B8 | consensus projection | **benchmark only, prospective only, pending licensing (D4)**. Cannot be backtested (no publication-timestamped history). Never a production input. |
| B9 | frozen production model `decision-0.3.2` | the champion; not edited during a comparison |
| B10 | offline ML ceiling on the same as-of features | not a production candidate |
| O1 | oracle | bound only; never a competitor |

Baselines for the other decision types: **waiver** — rank by recent PPG; rank by season snap share or opportunity; rank by add-interest percentile (prospective only); random eligible draw. **Start/sit** — start by season PPG; by recent PPG; the manager's actual lineup where known. **Breakout** — top by last-2-week PPG gain; top by snap-share delta; top by draft capital. **Trade** — no change; swap by season PPG. The existing 5% add-interest component of Pickup Rating must beat the "no attention" ablation to keep its weight, but changing it is a class E change (section 9), not something this protocol authorizes.

The **strongest simple baseline** is the best of B1, B3 and B7 by pooled walk-forward MAE on 2022–2025; its identity is measured and written to the analysis ledger before the first confirmatory outcome is scored, then held fixed for the season.

## 7. Cohorts and event definitions

Fixed before results are read. Cohort membership uses as-of attributes only.

| Primary cohort | Definition |
|---|---|
| Experience | rookie / year 2 / year 3 / years 4–6 / 7+, from draft year (immutable) |
| Draft capital | round 1 / rounds 2–3 / rounds 4–7 / undrafted, only where the draft dataset confirms the pick or the undrafted status (D7 data-quality rule) |
| Age band | from birthdate as of the decision date, subject to the birthdate rule (section 10.2) |
| Prior-season status | none / ≥ 8 prior games / role change |
| Team change | changed vs same team |
| Early sample | fewer than 4 current games |
| Late surge | bottom-half season PPG but top-quartile last-4-week usage change (a general rule, never a named-player rule) |

At most about eight primary cohorts; everything else is exploratory. A cohort or signal×cohort cell with fewer than **50 unique players** is suppressed, not interpreted.

**Breakout events** are defined from outcomes only, using three pre-registered competing definitions so the result cannot depend on one cut: (a) *rank*: as-of rank outside a stated tier and realised next-4-week mean rank inside a target tier; (b) *gain*: next-4-week mean points ≥ as-of season PPG + G with at least 3 of 4 weeks above replacement; (c) *persistence*: the role metric stays elevated in the following window and points follow. G and the tiers are recorded in the analysis ledger before the first breakout analysis is run, with the same rule for stash-cost measurement (value of the asset a manager would drop to hold the stash).

## 8. Ablation and statistical rules

1. **Kinds.** Leave-one-out for components in the model; add-one-in for candidates not in the model (age/development, historical breakout, red-zone, matchup at weight 0); permutation for correlated inputs. Leave-one-out is run **production-faithful** (component removed as deployed, falling back to Q, never zero, never renormalised) and **retrained**. Run at forecast level and decision level.
2. **Primary metric fixed before a run.** Paired per-case differences, clustered by player and separately by week; report the wider interval. Cases and independent clusters are stated.
3. **Multiplicity.** Every ablation, cohort and metric tried is counted. The pre-registered family (H1–H10 plus the primary metrics in section 5) is corrected with Benjamini–Hochberg (Thread 3 also allows Holm; BH is the protocol choice). Anything outside the family is class X.
4. **Selection optimism.** Rerun the selection procedure on outcome-permuted data; a claimed gain must exceed the chance improvement.
5. **Practical significance (D3).** A gain or deterioration is called practically significant only if its interval excludes zero **and** it exceeds 0.05 MAE (forecast) or 0.1 lineup points per roster-week (decision). The two figures are screens: clearing one is necessary and never sufficient (section 9).
6. **Outcomes.** Exactly three: **keep**, **simplification candidate** (no measurable contribution across seasons; removal still needs human approval), **inconclusive**. An effect must have the same sign in at least two independent seasons and not contradict prospective results.
7. **Power, stated honestly.** About 4,100 scored cases per season give a cluster SE of about 0.02–0.025 on a paired MAE difference and a minimum detectable effect of about 0.06 (about 0.035 pooling three seasons; about 0.08 midseason of a prospective season). Single-season results for small components are not evidence; cohort and signal questions of 100–300 cases and transaction-policy questions (roughly 300–500 events per comparison) will not resolve in one season.

## 9. Promotion gates (change classes C–G)

| Class | Examples | Minimum evidence |
|---|---|---|
| A | labels, docs, display | normal review |
| B | informational signal thresholds | L3, task, rationale, tests, ADR |
| C | policy weights and gates | L4 |
| D | calibrated blend weights | L3 + L4, explicit recalibration scope |
| E | Pickup Rating component weights | L3 + L4 |
| F | new predictive input or data source (age, breakout, red-zone, matchup, consensus, postseason, upside) | L3 + L4, validated approved task |
| G | loosening a drop protection | L3 + L4 with safety metrics |

Evidence ladder: L0 anecdote → L1 in-sample → L2 walk-forward one season → L3 walk-forward replicated over at least two independent seasons → L4 prospective shadow confirmation → L5 monitored in production.

A promotion requires **all** of:

1. pre-registration of hypothesis, primary metric, baselines, cohorts and thresholds before the test period is scored;
2. improvement over frozen production **and** the strongest simple baseline in at least two of three rolling folds, with the paired cluster-bootstrap 95% lower bound above the practical threshold (D3);
3. non-inferiority guardrails: no position, format or pre-registered cohort worse by more than 0.10 MAE (upper bound); calibration slope within 0.9–1.1; lineup regret and false-drop rate not worse; results hold across formats and survive the V0/V1 vintage check;
4. search discipline: every candidate logged, nested walk-forward selection, gain above the permutation optimism, multiplicity controlled;
5. prospective shadow run of at least 8 scored weeks and 2,500 scored cases, non-inferior within 0.05 MAE and directionally consistent with the retrospective gain (a partial season can catch a failure, not prove superiority);
6. for transaction policy, decision-level evidence (lineup regret or realised gain on several hundred events per comparison, or a labelled simulation), never a rank correlation alone;
7. safety asymmetry: loosening a drop protection needs a false-drop analysis and a larger margin; tightening needs less;
8. governance: new `model_version`, the old version kept as comparator, an ADR, human approval, `--write-calibration` only under recalibration scope, rollback criteria.

**What does not count as evidence:** a single held-out season; gains on the season that selected the candidate; rank correlation without a decision metric; effects that vanish under V1 vintage or truncation-invariance tests; case studies of individual players; gains below the season MDE reported as resolved. The screens in D3 never substitute for these gates.

## 10. Frozen hypotheses and historical research

### 10.1 H1–H10 (frozen 2026-09-29)

Frozen as written in the Thread 3 research report (project shared folder). None may be dropped or reworded after an outcome-informed look. Each is reported with its result, including null.

| ID | Hypothesis | Primary test |
|---|---|---|
| H1 | Age curve improves the prior for years 3+ | week-1 and week-4 MAE vs Q |
| H2 | Draft-capital prior improves R1–R3 in years 1–2 | same, within cohort |
| H3 | Postseason-inclusive prior window beats REG-only | compare windows for playoff-team players |
| H4 | Postseason-minus-late usage adds information | partial effect after rest-game exclusion |
| H5 | Vacated opportunity improves projected role | opportunity-share error |
| H6 | On-field-on-dropbacks share beats snap share for receivers | next-year target share and PPG |
| H7 | First-read share adds beyond target share | same |
| H8 | Late-season endpoint gain has **no** incremental value | pre-registered **null**, tested against the existing prior |
| H9 | Prior-window length (4, 8, 12, full season, 2-season EW) | compare across cohorts |
| H10 | Prior weight k should depend on pedigree and sample quality | in-season MAE weeks 1–8 |

Thread 3's Phase 2/3 design ("2023 selection, 2024 and 2025 run once as held-out") is **superseded** by section 2: consumed seasons are walk-forward development evidence; confirmation is the sealed 2026 season.

### 10.2 Conditions on how research results may be used

- **Phase 0** (offline, ignored `.data/` paths, source URL and SHA-256 manifests, ID/birthdate/draft/postseason audits, prior-season joins, as-of validation) and **Tier A** (age/draft-capital prior, prior-window length, postseason inclusion, vacated opportunity) are approved after this protocol is committed. Tier B follows; Tier C stays blocked until Tier A shows value. All Phase 0 work uses seasons ≤ 2025 and produces class R or X evidence only. Its results cannot change production.
- **Birthdate rule (D7).** Age is used only when the crosswalk and nflverse agree within 30 days, with the discrepancy flag kept; a larger difference gives `age = unknown` with a warning; neither source is silently preferred. A missing draft pick is not treated as undrafted unless the draft dataset confirms it; unknown and undrafted stay distinct.
- **Postseason** is research and evidence display only. It enters the Football Value prior only if H3 and H4 pass under this protocol, after controlling for regular-season baseline, age, draft capital, resting starters, playoff-team selection and game-script effects.
- **Route participation** is at most a derived, clearly labelled "on-field-on-dropbacks share", never "routes run", with construction, coverage and missingness documented. No paid route feed.
- **Upside Evidence** is a separate informational layer (Football Value / Upside Evidence / Roster Value / Market Value = `null`). It is not fed into Football Value, Start Value, Pickup Rating, trade deltas or replacement values. Loveland-type cases are generalized test cases, never named-player rules.
- **Young-asset drop protection:** research only, with an over-blocking analysis (later-regretted drops prevented, correct drops blocked, opportunity cost of holding). No policy change.

## 11. Leakage controls and the prospective process

### 11.1 Leakage rules

| # | Rule |
|---|---|
| L1 | Week-w features use only facts with `available_at` ≤ the decision cut for w |
| L2 | The prediction of record is frozen before outcomes are joined |
| L3 | Candidate membership uses past activity only |
| L4 | Do not condition targets on future participation without reporting it (participation-conditional and -inclusive) |
| L5 | Hyperparameters and thresholds are chosen on a period strictly before the test period |
| L6 | A consumed season is never used for selection or threshold setting as if untouched |
| L7 | xFP evaluation only on seasons ≥ 2021 |
| L8 | Identity and metadata joins use immutable as-of fields only (draft year, birthdate); team, position and status are time-varying |
| L9 | Opponent-adjusted context uses only prior weeks |
| L10 | Injury and depth data only where an as-of vintage exists; never back-filled with current status |
| L11 | Historical comparables satisfy the maturity rule (outcome window ended before the case's as-of date) |
| L12 | V0 data is never presented as prospective |
| L13 | Prospective rows require `generated_at` < player kickoff; failures are counted, not dropped silently |
| L14 | Signal thresholds are not tuned on the season used to discover them |
| L15 | Serial and cross-sectional dependence is respected in inference (cluster bootstrap, no naive t-tests) |

Canary tests required of any implementation of this protocol: truncation invariance (features from full-season data equal features from data truncated at w−1), future-shuffle placebo, negative control (features shifted a week lose accuracy), and an impossible-skill alarm.

### 11.2 Ledgers

Three append-only ledgers: **predictions** (`observation-1`/`capture-1` on `data-archive`), **outcomes** (`outcome-1`, versioned by settle time), **analysis** (dated protocol documents and result files). A result file is never edited; a correction is a new run. Each run writes a manifest: code SHA, data-file SHA-256s, protocol version, config hash, seed, and the dropped-case table.

### 11.3 Attribution and grouping

Results are grouped by `(model_version, feature_version, model-config hash)`, never by `implementation_revision` alone. The config hash does not exist yet. Until it does, results are stratified by `implementation_revision` and pooled across revisions only when a reviewer attests that the diff between them touches no path that can change an evaluated output (`lib/decision/`, `lib/signals/`, `lib/market/`, `lib/sources/`, `lib/providers/`, `lib/sleeper.js`, `lib/derive.js`, model config or calibration). Model changes are not forbidden by this protocol; each version is scored separately and groups are never merged retroactively.

### 11.4 Refresh interaction

A user-triggered Refresh (milestone M2) is a POST that never writes the archive and never creates a record of record. Only the archive workflow writes to `data-archive` (`AGENTS.md`). Refresh cadence therefore changes what data a capture sees, not what counts as a prediction of record.

### 11.5 Looks and rationalization rules

1. Metrics, baselines, cohorts, event definitions, thresholds, minimum sample sizes and the schedule are fixed here and hashed at registration (section 14) before the first confirmatory outcome.
2. All captured cases are scored or listed with a section 4.3 reason. Nothing is removed after its outcome is seen.
3. Every recommendation counts, not only those a manager acted on.
4. Interim looks happen only at weeks 6 and 10 and at end of regular season, with a futility/harm guard. No continuous peeking to time a change.
5. Post-hoc analyses live in a labelled exploratory section and never feed a promotion decision.
6. Scoring code is reviewed by someone other than its author (`AGENTS.md`).
7. Candidates run in **shadow** on the same cases before promotion; shadow forecasts are never shown to users.
8. Narrative claims ("the model caught X") are not evidence.
9. Report preliminary and final outcomes; the difference is measured outcome noise.

## 12. Readiness gap and separately approved follow-ups

This document fixes the definitions. It does not make the archive protocol-complete. The following are **not** approved and **not** done here; each needs its own task and human approval because they touch protected record schemas or CI/workflow configuration (`AGENTS.md`):

- a new archive/record schema version with the protocol hash, the model-config hash, frozen baseline forecasts (B1, B2, B3, B5, B7; B8 once licensed), full ranked alternatives (or top-K plus a count and hash of the remainder) and the recommended lineup — never an in-place redefinition of `observation-1`/`capture-1`;
- a scheduled waiver capture (section 4.2) and scheduled outcome scoring;
- the scoring harness extension: paired cluster intervals, cohort strata, participation reporting, truncation-invariance canary, ablation runner.

Until they ship, class C is limited as described in section 3, and waiver outcomes cannot be class C.

## 13. Amendments

Changing any definition, threshold, cohort, metric, baseline, hypothesis or season status requires a **new protocol version** committed to the repository, with an ADR when the change is a decision. v1 is never edited after registration; a correction to a typo or link is the only exception and must not change any definition. Results are always reported against the protocol version in force when their inputs were captured.

## 14. Registration

Protocol v1 becomes effective and registered at the **merge commit time** of the pull request that adds it, provided the owner has approved it and the section 4.2 definitions were resolved before merge (they were, in the owner's PM review of PR #13). That merge commit time is the pilot/confirmatory boundary for section 2: captures with an earlier `generated_at` are pilot.

Immediately after merge, the merge commit SHA, merge time and the SHA-256 of `docs/evaluation-protocol-v1.md` are recorded in the `EVAL-PROTOCOL-01` entry of `TASKS.md` (`git show <merge-commit>:docs/evaluation-protocol-v1.md | sha256sum`). That bookkeeping commit does **not** move the boundary and does not retroactively activate the protocol. External witness is the Git history of `main`; published history is never rewritten.

Before the merge, every 2026 capture is pilot.
