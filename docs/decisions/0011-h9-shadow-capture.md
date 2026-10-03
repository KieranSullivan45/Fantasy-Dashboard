# 0011 — H9 `ew2_h16` prospective shadow capture record

- Date: 2026-10-03
- Status: proposed (accepted at the merge of the H9-SHADOW-01 pull request)
- Task: H9-SHADOW-01
- Deciders: repository owner; recorded by Claude Code

## Context

ADR 0009 froze the H9 prospective candidate `ew2_h16` and made it effective at the merge of PR #17
(`merged_at` 2026-10-03T03:15:40Z). Only 2026 games kicking off after that boundary count as H9 evidence. Prospective
evidence needs the candidate's prediction frozen next to the production forecast **before** outcomes exist. The current
archive (`observation-1` inside `capture-1`) holds the production forecast but no candidate forecast. Protected record
schemas cannot be redefined in place (`AGENTS.md`). Evaluation Protocol v1 §11.5.7 requires candidates to run in shadow,
never shown to users.

## Decision

1. **New record, not an observation change.** The capture worker (`scripts/capture-history.js`) writes a separate
   `h9-shadow-capture-1` gzip file of `h9-shadow-1` records for the same player contexts as each `capture-1`, under
   `data/shadow/h9-ew2_h16/<classification>/<season>/<league>/<capture_id>.json.gz` on `data-archive`
   (non-Sleeper providers add a `<provider>` segment). Files are created exclusively (`wx`) and never overwritten.
   There is no shadow index. `observation-1`, `capture-1` and `archive-index-1` are unchanged.
2. **Computation (`lib/shadow/h9.js`).** The prior is computed exactly as ADR 0009 states. It uses Y−2 then Y−1 regular-season
   rows. Non-numeric points are excluded before g is assigned. `w_g = 0.5^(g/16)`, and the prior is absent when Y−1 has no
   numeric row. Only P inside Q is replaced. S, n and k are production's values from the same `weeklyFeatures` call.
   That includes k's existing last-8 definition: k = 0 when the existing last-8 prior is absent, as in the retrospective
   computation. The record flags that case (`existing_prior_absent_h9_present`). The Y−1 rows are the exact rows production used, passed out by an optional
   `shadowObserver` hook on `buildDecisionState`. Y−2 rows are loaded by the shadow with the same identity map, league
   scoring and player set. Prior rows must carry an explicit season type (on the row or its raw source row); only `REG`
   rows count, and a row of unknown type is never assumed to be `REG`. ADR 0009 defines no duplicate resolution, so H9 relies
   on the existing upstream precondition: `buildProduction` keeps one row per statistical player and `game_id`. If more than one row
   per player-game still reaches H9, or a row has no season type, H9 is withheld (`invalid_input`) rather than choosing. A per-player basis check recomputes production's last-8 prior and Q from those rows. On a
   mismatch, or if Y−2 is unavailable, H9 is withheld (`null` with a reason) and never computed from partial history.
3. **Record contents.** Each record holds: `generated_at`; season, week and `data_through_week`; provider and league ID
   (the same public Sleeper identity `observation-1` already archives); the scoring-settings hash and profile; the provider
   and exact-crosswalk statistical player IDs; position and schedule/kickoff; and the production Start Value, Q and prior.
   It also holds the H9 prior (status, included and excluded counts, input hash), H9 Q and a comparator Start-weights frame,
   plus the frame inputs (R, X, opportunity). Identifiers are the model/feature versions, implementation revision,
   calibration and model-config hashes, the decision-basis hash, the source digests for Y−1 and Y−2, and links to the
   `observation-1`/`capture-1` IDs. A record ID is derived from the evidence and the six-hour bucket, the same way as
   observations. The H9 prediction of record is H9 Q, the quantity ADR 0009 evaluated. The Start-weights frame is a
   comparator only.
4. **Prospective vs replay.** `classification` is one of `prospective`, `replay` or `test`. It is part of the record ID
   and of the partition path. A `prospective` record is refused unless its `generated_at` is at or after the ADR 0009
   boundary and within 30 minutes of the wall clock when it is computed and written, so a reconstructed decision cannot be labelled prospective.
   The worker writes `prospective` only. Each record also retains `frozen_at`, the time taken after every H9 value in the
   capture was computed, and a per-player `prospective_eligibility`. A record is eligible only if it is `prospective`, H9 was
   not withheld, its target game (the decision week's scheduled game, `schedule.game_id`/`kickoff`) kicks off strictly after
   `frozen_at`, and that kickoff is strictly after the ADR 0009 boundary. Ineligible records stay in the file with
   their reason (`kickoff_not_after_freeze`, `kickoff_not_after_candidate_boundary`, `no_target_kickoff`, `h9_withheld`).
   `generated_at` alone never establishes eligibility. A prospective capture is refused if it is written more than
   30 minutes after `frozen_at`. `frozen_at` is excluded from the record ID, so identical evidence still deduplicates and the
   first stored freeze time is kept. Replay/test records never share its partition, and a capture mixing
   classifications is refused.
5. **Isolation.** The hook is optional and its exceptions are swallowed. The shadow reads a finished decision without
   mutating it, runs after the production capture is written, and its failure is logged without failing the run. No
   public route, cache or UI reads it. Private (`visibility: "private"`) decisions are refused.

## Alternatives considered

- **Add H9 fields to `observation-1`.** Rejected: changing a protected record schema needs a new version, and the
  protocol §12 archive schema version is a separate, broader approved follow-up.
- **Recompute Y−1 in the shadow from a fresh download.** Rejected: it could silently diverge from the decision state.
  The hook passes the exact rows production used instead.
- **Backfill earlier 2026 weeks.** Rejected: ADR 0009 is not backdated. Replay records are allowed only under `replay`.

## Consequences

- Records start only once this code is on `main` and the existing `Capture prospective history` workflow runs. The
  workflow already commits everything under `data/`, so no workflow change is needed.
- Coverage is the capture's player contexts (rostered and returned), every 6 hours and after `Validate` on `main`. The
  lineup-of-record selection (last valid record before each player's kickoff) and outcome scoring are a separate task.
- No production, weight, threshold, policy, schema or protocol change. Shadow output is not class C until the scorer
  and the §12 follow-ups exist.
