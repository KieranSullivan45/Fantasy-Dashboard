# Evaluation Protocol v2

- Date: 2026-10-19
- Task: EDGE-02-CAPTURE-01 (ADR 0014)
- Status: **submitted for registration.** This document becomes Protocol v2 only when it is merged to `main` with the repository owner's approval (section 9). Until then nothing below is in force.
- Scope: registers the EDGE-02 prospective candidate family and its capture requirements. It changes no production model, weight, threshold, policy, version or route.

## 0. Relation to Protocol v1

Protocol v2 **inherits every definition, rule, ledger, threshold and gate of Protocol v1** (`docs/evaluation-protocol-v1.md`), which is not edited. That includes the season ledger and sealing (v1 §2), data-vintage layers and claim classes (v1 §3), the prediction-of-record and dropped-case rules (v1 §4), primary metrics and strata (v1 §5), the baseline ladder (v1 §6), statistical and ablation rules (v1 §8), promotion gates (v1 §9), the frozen hypotheses (v1 §10), leakage controls, ledgers and looks (v1 §11) and the readiness gap (v1 §12).

v2 only **adds** the EDGE-02 candidate family (sections 1–7). Where v2 is stricter than v1 for EDGE-02, the stricter rule applies. Nothing in v2 weakens a v1 leakage, missingness, season-ledger, evaluation, promotion or governance rule. Results captured under v1 are still reported against v1 (v1 §13).

## 1. Registered candidates

| Role | ID | Prediction of record |
|---|---|---|
| **Primary (confirmatory)** | `edge02-vip-a2-w030-v1` | **A2 = 0.5·Q + 0.2·R3 + 0.3·VIP_last2** |
| Secondary (frozen) | `edge02-vip-x2-w030-v1` | **X2 = 0.5·H9_Q + 0.2·R3 + 0.3·VIP_last2** |

1. **w = 0.3 is fixed** for every supported position (QB, RB, WR, TE) and every supported format (section 3). There is no position-, season-, league- or interim-specific weight selection.
2. **A2 is the primary confirmatory candidate. X2 is a frozen secondary candidate.** Interim 2026 outcomes may never be used to choose between them, to re-rank them, or to promote X2 in A2's place.
3. **These exact candidates are new prospective specifications.** EDGE-01's retrospective −0.035 (A2 family) and −0.044 (H9 + VIP, post-hoc) MAE results are **not** attributed to them. EDGE-01 (class R/X) is the justification for testing the family prospectively, not evidence for these specifications.
4. Frozen configuration, coefficients and their digests: `lib/shadow/edge02/config.js` (`EDGE02_CONFIG_SHA256`), reproduction evidence in `artifacts/research/edge-02-vip-coefficients.json` (ADR 0014).

## 2. Inputs

- **Q**: production `weeklyFeatures` `quality_points` from the same decision build (`decision-0.3.2` / `weekly-features-2`). Not reinterpreted.
- **R3**: production `recent_ppg` from the same build.
- **H9_Q**: the same run's H9 record (ADR 0009/0011) `h9.quality_points`, including a legitimate no-prior H9 Q. Never recomputed; never confused with the H9 Start-frame comparator.
- **VIP_last2** (identical to EDGE-01 `opportunityFeatures` `metrics.vip.last2`):
  1. current season only;
  2. rows strictly before the target week;
  3. statistical rows (nflverse weekly player stats, positions QB/RB/WR/TE/FB with FB as RB), never snap-only rows;
  4. team of the latest such row (the historical team, even when the platform's current team differs; the discrepancy is recorded);
  5. rows on that team only;
  6. the two latest such rows;
  7. every required predictor finite in both games (QB: passing attempts, carries; RB: carries, targets; WR: targets, air yards, carries; TE: targets, air yards);
  8. each game's VIP at full precision with the frozen coefficients for the league's format and that game's statistical position;
  9. the mean of exactly two values;
  10. no clipping, zero filling or partial averaging.
- **Integrity before normalization.** For each player, raw current-season rows are checked before any lossy step: canonical season type (`REG`/`POST` only), positive integer week, non-empty `game_id`, no duplicate player-game, no two games in one week, exact one-to-one statistical-ID crosswalk. A failure withholds both candidates for that player (section 5); it is never treated as ordinary missingness.

## 3. Exact scoring-format compatibility

VIP runs only when the league's complete effective offensive scoring contract equals one frozen research format exactly. The league display label is never used.

| Format | Registered offensive rules |
|---|---|
| PPR | pass_yd 0.04, pass_td 4, pass_2pt 2, pass_int −1, rush_yd 0.1, rush_td 6, rush_2pt 2, rec 1, rec_yd 0.1, rec_td 6, rec_2pt 2, fum_lost −2, no TE reception bonus |
| Half | PPR with rec 0.5 |
| Standard | PPR with rec 0 |
| TE premium | PPR with pass_int −2 and an additional TE reception bonus 0.5 |

1. The twelve base keys must each be present with a finite numeric value. A missing or non-numeric one is **incomplete** evidence. The TE bonus may be absent, meaning 0.
2. Keys that score only kickers, team defenses or IDP (`fg*`, `xp*`, `def_*`, `pts_allow*`, `yds_allow*`, `idp_*`, and `sack`, `int`, `ff`, `fum_rec`, `def_td`, `safe`, `blk_kick`, `tkl`, `tkl_solo`, `tkl_ast`, `tkl_loss`, `qb_hit`, `pass_def`) are ignored. These are exactly the keys production scoring (`lib/normalize/scoring.js`) never applies to a QB/RB/WR/TE, so they cannot affect a VIP target.
3. Every other key with a non-zero value makes the league **incompatible**: attempt, completion or incompletion scoring, yardage bands, bonuses, RB/WR reception premiums, other fumble rules (`fum`, `fum_rec_td`), special-teams player scoring (`st_*`), first-down scoring and any unknown key.
4. A registered key with a value different from every format, or a combination matching no single format, is **incompatible**.
5. Player level: the VIP model position (the statistical position of the latest VIP game, as in EDGE-01) must equal production's model position. Under TE premium a player whose fantasy eligibility mixes TE with another offensive position, or a player production marks ambiguous for the reception premium, is withheld.
6. Incompatibility is returned as structured reasons. A generic or nearest format is never substituted, and VIP is never refitted for custom scoring here (that would be a separate candidate family).

## 4. Fallback and withholding (whole candidate)

Fallback **N** is production's own forecast machinery with weights `[Q, R3, X, opportunity] = [0.8, 0.2, 0, 0]` (`forecast(features, [0.8, 0.2, 0, 0])`).

| Situation | A2 | X2 |
|---|---|---|
| All inputs valid | formula | formula |
| VIP ordinarily missing (fewer than two team games, a required predictor missing) | N | N (production Q, never H9 Q) |
| R3 missing | N | N |
| production Q missing | withheld | withheld |
| H9 valid finite Q, including a legitimate no-prior H9 Q | — | formula allowed |
| H9 unavailable, not persisted, withheld, invalid or from another decision basis | — | withheld |
| Unsupported or incomplete scoring | withheld | withheld |
| Corrupt identity or source evidence | withheld | withheld |

Each record states `computed`, `fallback` or `withheld` for each candidate, the structured reasons and the fallback value. Missing stays missing; integrity failure is never disguised as ordinary missingness.

## 5. Records

Records are additive and research-only (ADR 0014): `candidate-shadow-1` inside `candidate-shadow-capture-1` files and `candidate-lineup-1` inside `candidate-lineup-capture-1` files, on `data-archive` under `data/shadow/edge02-vip/` and `data/shadow/edge02-lineup/` with `<classification>/<season>/<league>/`. No existing schema (`observation-1`, `capture-1`, `archive-index-1`, `h9-shadow-1`, `h9-shadow-capture-1`) is changed. Files are created exclusively and never overwritten. Production routes, models and the UI never read them.

## 6. Prospective integrity and the effective boundary

1. **Effective boundary.** EDGE-02 prospective evidence begins at the **merge commit time on `main` of the pull request that registers this protocol and ADR 0014** (section 9). It is not the EDGE-01 research date. Because it is unknown while the code is written, the code records it as `pending_registration_record`; the evaluator applies it from main's merge commit.
2. **Technical prospective record.** `effective_at ≤ generated_at ≤ frozen_at < target kickoff`, every timestamp finite, classification `prospective`, written within 30 minutes of the wall clock. Historical reconstruction is `replay`, never `prospective`; `prospective`, `replay` and `test` never share a partition or an ID.
3. **Not by itself class C.** A technically prospective record is only a candidate for confirmatory use. The evaluator must also establish that the file was published by the approved `Capture prospective history` workflow to `data-archive` before target kickoff (the Git commit and push are the witness; the record never claims a publication time). Each record carries additive trusted-writer metadata when available (`GITHUB_ACTIONS`, run ID and attempt, workflow, ref, event, repository, source SHA; no secrets). A record without that witness is `non_confirmatory`.
4. **Acquisition.** Source bytes must be acquired before the candidate freeze. Per-source completion time is recorded as **unknown** (the existing `fetched_at` is the request start). The record keeps a program-order upper bound: every decision source and the same-run H9 capture completed before the candidate builder started (`candidate_started_at ≤ frozen_at`). Confirmatory eligibility is judged conservatively from that.
5. **Prompt, same-state generation.** Candidates are computed from the same decision build's inputs, after the production capture and the H9 shadow, and written immutably in the same run.

## 7. Looks and evaluation

1. **No EDGE-02 outcome look before the end of the 2026 regular season.** Protocol v1's week-6 and week-10 looks do not apply to EDGE-02; no interim EDGE-02 analysis is run.
2. Evaluation additionally requires the v1 minimum samples (v1 §9.5: at least 8 scored weeks and 2,500 scored cases) and every other v1 promotion gate. A2 is evaluated as the primary; X2 is reported as a frozen secondary and cannot replace A2 on the strength of 2026 outcomes.
3. **2026 stays sealed.** No 2026 outcome is read for implementation, coefficient reproduction, tests or registration. Coefficients were reproduced from 2014–2017 only (ADR 0014).
4. Lineup evidence (`candidate-lineup-1`) is preserved now so that a future lineup evaluation is not reconstructed from later roster state. It covers offensive slots only; K/DEF/IDP slots and platform lock semantics are unsupported and disclosed, so no confirmatory full-lineup metric is claimed from it.
5. Any production change remains a class D/F change under v1 §9 with owner approval and a new `model_version`.

## 8. Not authorized by v2

Production model, weight, threshold, version or forecast changes; H9 changes; Pickup Rating, add/drop, replacement, trade or signal changes; outcome-driven candidate selection; custom-scoring VIP refits; workflow changes; private or ESPN contexts in the archive; Market Value.

## 9. Registration

Protocol v2 becomes effective at the **merge commit time** of the pull request that adds it, provided the owner approves it. That time is the EDGE-02 effective boundary (section 6.1). Immediately after merge, the merge commit SHA, merge time and the SHA-256 of this file (`git show <merge-commit>:docs/evaluation-protocol-v2.md | sha256sum`) are recorded in the `EDGE-02-CAPTURE-01` entry of `TASKS.md`. That bookkeeping does not move the boundary. Like v1, v2 is never edited after registration except for a non-semantic typo or link fix.
