# 0009 — M4 Tier-A adjudication: retrospective findings and frozen prospective candidates

- Date: 2026-10-03
- Status: proposed (owner adjudication of 2026-10-03, amended after the owner's PM review of the pull request; accepted, and effective, at the merge of the M4-TIER-A-01 documentation pull request)
- Task: M4-TIER-A-01 (M4 of the approved research plan; Tier A under Evaluation Protocol v1)
- Deciders: repository owner (PM adjudication of the M4 Tier-A report); recorded by Claude Code

## Context

Evaluation Protocol v1 (`docs/evaluation-protocol-v1.md`, ADR 0007) approved Phase 0 and Tier A historical research after
registration and froze hypotheses H1–H10 (§10.1). The M4 Tier-A run tested H1 (age curve), H2 (draft capital), H3
(postseason-inclusive prior window), H9 (prior-window length), H10 (pedigree/sample-dependent `k`) and H5 (vacated
opportunity from targets, carries and air yards only). xFP-dependent variants were excluded because the M4-DATA-READINESS-01
gate later confirmed that ffopportunity v1.0.0 xFP is betting-derived (see `TASKS.md`).

The evidence is **class R** (§3): V0 corrected nflverse data, walk-forward folds with test seasons 2022–2025 (all
consumed), fit on 2013…Y−2, select on Y−1. No 2026 data was read. Results were reported against `Q`, against the no-X
comparator `[0.8, 0.2, 0, 0]` (a comparator only, not a weight change) and, secondarily, against the production forecast,
which contains betting-derived xFP. The report, analysis plan (written before any outcome was computed), scripts, data
manifest and result files live in the project shared folder under `research/m4-tier-a/` and are not part of this
repository. SHA-256 at adjudication: `report.md` `335ca6a9…59cc3`, `analysis-plan.md` `fe5fd0ec…8d38`.

Pooled change in MAE vs `Q`, PPR points per player-game (negative = better), Benjamini–Hochberg over the 10 primary tests run:

| Hypothesis | Δ MAE vs Q [95% CI] | Folds better | 0.05 screen | Selection-optimism check (§8.4) |
|---|---|---|---|---|
| H1 age, years 3+ | −0.043 [−0.069, −0.016] week 1; −0.027 [−0.040, −0.013] week 4 | 3/4; 4/4 | not cleared | n/a |
| H2 draft, R1–R3, years 1–2 | +0.257 [+0.064, +0.452] week 1 (worse); +0.010 [−0.160, +0.175] week 4 | 0/4; 2/4 | harm at week 1 | n/a |
| H3 postseason window | −0.048 [−0.090, −0.011] weeks 1–8 | 3/4 | not cleared | n/a |
| H9 prior-window length | −0.068 [−0.098, −0.042] weeks 1–8 | 4/4 | cleared vs Q and no-X; not vs production | **failed** (permuted chance gain −0.078) |
| H10 `k` by pedigree × sample | −0.010 [−0.020, −0.001] weeks 1–8 | 3/4 | not cleared | passed |
| H5 vacated opportunity (non-xFP) | ≈ 0 share error on all three measures, intervals include 0 | — | no registered screen | n/a |

## Decision

1. **H9** is recorded as *promising but not Tier-A certified*, because the pre-registered §8.4 selection-optimism check
   failed. The protocol is not altered retroactively.
2. **H9 prospective candidate (`ew2_h16`).** The definition below replaces only the last-8 prior mean P inside `Q`. Everything
   else in `Q` and `weeklyFeatures` is unchanged.
   - Included games: season Y−1 and Y−2 regular-season player-game rows, selected with the same eligibility and missingness
     semantics as the existing `Q` prior. That means the player's regular-season stat rows for the season, whatever the team,
     with only rows whose points are numeric contributing. A missing row is never a zero, and postseason games are excluded.
   - Weights: `w_g = 0.5^(g/16)`, where g is the number of included prior player-games ago (g = 0 for the most recent
     included game). g is not counted in elapsed team or calendar weeks. The prior is the weighted mean `Σ w_g·points_g / Σ w_g`,
     with the weights normalized over the included games only.
   - Missing points: a recorded prior row whose points are missing or non-numeric is excluded **before** g is assigned. It
     consumes no g position, carries no weight, and is never a zero. A row with numeric points is "included" and counts for
     g. Unlike the existing last-8 prior, there is no row-count window to fill. This is exactly the retrospective `ew2_h16`
     computation: it filters Y−2 and Y−1 rows to numeric points, assigns g in that order (most recent g = 0), and returns no
     prior when Y−1 has no numeric-point row.
   - Absence: if the player has no included season Y−1 game, the prior is absent, exactly as today. There is no silent
     fallback to Y−2 alone.
   - `k` behaviour is preserved, including the changed-team / role-expansion branch (`k = 1`) and its existing definitions.
   - **Effective boundary.** The candidate becomes authoritative at the merge of the pull request that accepts this ADR. It
     is not backdated. Only 2026 games kicking off after that boundary can enter the prospective H9 evaluation, and every
     earlier 2026 game is excluded. This is a candidate-specific prospective test period. It does not retroactively make
     earlier 2026 outcomes H9 evidence.
3. **H1** is recorded as a *prospective candidate pending freeze specification*. The completed retrospective run used
   age at September 1 of season Y, accepted as an M4 operational choice for that run only. It does not define the
   prospective H1 candidate. A separate freeze task must specify one deterministic prospective procedure and parameter set,
   for example fixed age-band adjustments and their fitting seasons, before H1 is scored. No production change.
4. **H2** is recorded as *unsupported / partially testable*. Under the 50-unique-player minimum (§7), only RB and WR
   rounds 2–3 could be fit. Positions are not pooled, the threshold is not relaxed, and the frozen hypothesis is not
   modified.
5. **H3** is *blocked pending H4* (§10.2: postseason enters the prior only if H3 and H4 both pass).
6. **H10** and **H5** (non-xFP) are *unsupported at Tier-A strength*.
7. Retrospective (class R) evidence and prospective 2026 validation remain distinct. None of the above is class C or
   L4 evidence, and none authorizes a production, weight, schema, threshold or policy change (§9, class F).
8. **Archive readiness.** The protocol §12 archive follow-ups are required before any 2026 comparison can be called
   confirmatory. They do not block implementing a shadow scorer (a separate task). Comparisons against reconstructed or
   non-frozen baselines remain class X (§3).

## Operational choices of the retrospective M4 run

The analysis plan (`research/m4-tier-a/analysis-plan.md`, shared folder) marked with [OP] each choice the protocol does not fix. These
adjudications apply to the completed retrospective run only.

**Protocol-fixed, not [OP]:** test seasons and walk-forward roles (§2.4); seasons ≤ 2025 only (§2.2); the frozen hypothesis
texts and primary tests (§10.1); the birthdate rule (D7, §10.2); unknown draft kept distinct from undrafted (§10.2); the
50-unique-player cell minimum (§7); paired differences clustered by player and by week with the wider interval reported
(§8.2); Benjamini–Hochberg (§8.3); the selection-optimism permutation check (§8.4); the 0.05 MAE screen (D3, §8.5);
participation-conditional scoring with non-participants reported (§4.3, L4).

**Accepted by the owner:** PPR-only scope; rookies admitted only for H2; single-source birthdates treated as unknown;
pooled weeks 1–8 MAE as the H3 primary; half-life 16 and pooled weeks 1–8 MAE as the H9 primary; H10 "no pick record"
kept distinct from confirmed undrafted; H5 counting any roster status as on-team; 1,000 bootstrap draws; 20 outcome
permutations; team-season clustering for H5; age at September 1 of Y (retrospective run only, see decision 3).

**Recorded, not separately adjudicated:**
- the case-membership rule, i.e. current-season production activity rule, else prior-season last-8 activity;
- the H1 age bands, and the midpoint date used for birthdates that agree within 30 days;
- team-season clustering used in place of the degenerate single-week season-week clustering for week-1 and week-4 tests;
- the other H9 variants run alongside half-life 16 (last-4, last-12, full season, half-life 8);
- H10's k grid and its pedigree × prior-sample cells;
- H2's rookie prior with k = 4;
- H5's outcome (mean per-game share in weeks 1–8, at least 2 games) and its prior (at least 2 prior-season games).

None of these is a protocol amendment.

## Alternatives considered

- **Treat H9 as passed because the permutation null rewards any smoother prior.** Rejected. The check was pre-registered, so it is
  applied as written. Whether a different null suits window/shrinkage questions is a matter for a future protocol version (§13).
- **Re-select the H9 window per season prospectively.** Rejected in favour of one frozen variant, so a prospective run involves
  no new selection.
- **Backdate the H9 freeze to the adjudication date.** Rejected. While this ADR is unmerged, the freeze is not authoritative.
- **Pool H2 positions or lower the cell minimum to make R1/TE/QB testable.** Rejected. Doing so would change a frozen
  hypothesis after its outcome was seen.

## Consequences

- Production is unchanged. `decision-0.3.2` / `weekly-features-2`, the calibrated weights and the production xFP
  dependency are untouched. Removing or replacing xFP is a separate owner decision.
- Prospective work needs separately approved tasks:
  - a shadow scorer for the H9 candidate;
  - the §12 archive follow-ups, before any confirmatory claim;
  - an H1 freeze specification.
- The candidate-specific H9 test period starts at this ADR's merge. Every 2026 game before it is outside H9's
  prospective evidence.
- The no-betting statements in `docs/v0.3.2.md` and `docs/decision-model-research.md`, which the xFP certificate
  contradicted, were corrected separately by POLICY-BETTING-01 (ADR 0010), which is not part of this decision. ADR 0010 does
  not change the xFP exclusion applied in this Tier-A run, and Protocol v1 D4 continues to govern claims made under that
  protocol.
- Revisit when a shadow scorer exists, when H4 is run, when H1 is frozen, or when a protocol v2 addresses the §8.4 null
  for window/shrinkage questions.
