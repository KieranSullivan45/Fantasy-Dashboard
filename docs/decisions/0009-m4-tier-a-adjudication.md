# 0009 — M4 Tier-A adjudication: retrospective findings and frozen prospective candidates

- Date: 2026-10-03
- Status: accepted (owner adjudication of 2026-10-03; recorded on merge of the M4-TIER-A-01 documentation pull request)
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
2. **H9 prospective candidate frozen:** a two-season exponentially weighted prior. Every regular-season game of seasons
   Y−1 and Y−2 gets weight `0.5^(g/16)`, where g is the number of games ago (half-life 16 games). It replaces the
   last-8 prior mean inside `Q`, with the same `k` rule, and requires at least one season Y−1 game (otherwise the prior
   is absent, as today). This is the `ew2_h16` variant of the analysis plan.
3. **H1** is recorded as a prospective candidate. No production change.
4. **H2** is recorded as *unsupported / partially testable*. Under the 50-unique-player minimum (§7), only RB and WR
   rounds 2–3 could be fit. Positions are not pooled, the threshold is not relaxed, and the frozen hypothesis is not
   modified.
5. **H3** is *blocked pending H4* (§10.2: postseason enters the prior only if H3 and H4 both pass).
6. **H10** and **H5** (non-xFP) are *unsupported at Tier-A strength*.
7. Retrospective (class R) evidence and prospective 2026 validation remain distinct. None of the above is class C or
   L4 evidence, and none authorizes a production, weight, schema, threshold or policy change (§9, class F).

## Alternatives considered

- **Treat H9 as passed because the permutation null rewards any smoother prior.** Rejected. The check was pre-registered, so it is
  applied as written. Whether a different null suits window/shrinkage questions is a matter for a future protocol version (§13).
- **Re-select the H9 window per season prospectively.** Rejected in favour of one frozen variant, so a prospective run involves
  no new selection.
- **Pool H2 positions or lower the cell minimum to make R1/TE/QB testable.** Rejected. Doing so would change a frozen
  hypothesis after its outcome was seen.

## Consequences

- Production is unchanged. `decision-0.3.2` / `weekly-features-2`, the calibrated weights and the production xFP
  dependency are untouched. Removing or replacing xFP is a separate owner decision.
- Prospective validation of the H9 and H1 candidates needs work this ADR does not authorize:
  - a scorer able to compute shadow candidates on the same cases;
  - the archive follow-ups in protocol §12 (frozen baselines and alternatives in a new record version);
  - for H1, a frozen set of age-band adjustments. The Tier-A run refit them per fold, so H1 has no single frozen variant yet.
- The candidate was frozen on 2026-10-03, after registration (2026-09-29) and after the first 2026 weeks had been played.
  Only games kicking off after this freeze can count toward any prospective H9 result.
- The Tier-A run made operational choices the protocol does not fix (marked [OP] in the analysis plan): membership,
  age bands, 50-player cell suppression, outcome window, team-season clustering, single-source birthdates treated as
  unknown, and roster status for H5. They were not separately adjudicated.
- Revisit when a prospective scorer exists, when H4 is run, or when a protocol v2 addresses the §8.4 null for
  window/shrinkage questions.
