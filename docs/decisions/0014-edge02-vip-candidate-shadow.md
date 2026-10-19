# 0014 — EDGE-02 prospective VIP candidate shadow

- Date: 2026-10-19
- Status: proposed (accepted at the merge of the EDGE-02-CAPTURE-01 pull request)
- Task: EDGE-02-CAPTURE-01
- Deciders: repository owner; ChatGPT PM (strategic approval of a capture-only task); recorded by Claude Code

## Context

EDGE-01 (PR #23, `docs/research/edge-01.md`) found that a non-betting volume-implied points term (VIP)
in place of betting-derived xFP beats production by about −0.035 MAE retrospectively (class R; −0.044 with the H9 prior,
post-hoc class X), below the 0.05 screen. Promotion needs prospective evidence (Protocol v1 §9, L4). Prospective evidence
cannot be recovered later: a candidate forecast must be frozen next to the production forecast before kickoff. ADR 0011
established the pattern for H9. Protocol v1 cannot be edited, and protected record schemas cannot be redefined in place.

## Decision

1. **Candidate architecture.** Two frozen candidates, registered in Protocol v2 (`docs/evaluation-protocol-v2.md`):
   primary `edge02-vip-a2-w030-v1` (A2 = 0.5·Q + 0.2·R3 + 0.3·VIP_last2) and secondary `edge02-vip-x2-w030-v1`
   (X2 = 0.5·H9_Q + 0.2·R3 + 0.3·VIP_last2). w = 0.3 for every position and format. Interim 2026 outcomes never select
   between them. Q and R3 are production's `weeklyFeatures` values from the same build; H9_Q is the same run's H9 record
   (ADR 0011), never recomputed; the H9 Start-frame comparator is recorded separately under its own name.
2. **Coefficient freeze.** The four-decimal coefficients in the EDGE-01 artifact are not used. The unchanged EDGE-01
   fitter (`fitVipModel`, OLS) was re-run on 2014–2017 only, for the four research formats, with the exact
   hash-matched stats and snap inputs EDGE-01 recorded (`scripts/research/edge-02-freeze-vip.js`). The full-precision
   result is a literal in `lib/shadow/edge02/config.js` and in `artifacts/research/edge-02-vip-coefficients.json`, which
   also keeps the source SHA-256 manifest, the fitting-code SHA-256s and a check that every value rounds to the published
   EDGE-01 coefficients. All nine inputs (four seasons of stats and snaps plus `ids.csv`) match the EDGE-01 SHA-256
   provenance; the script refuses any mismatch. The DynastyProcess `ids.csv` has since changed on its master branch, so
   the exact EDGE-01 bytes were recovered from dynastyprocess/data commit `2bbc02b` (recorded in the artifact). As extra
   evidence, an empty crosswalk gives bit-identical coefficients (the crosswalk only joins snap counts). The fitting-code
   identity is the SHA-256 of the artifact's per-file code digests (`FITTING_CODE_SHA256`).
   The whole configuration has a registered SHA-256 (`EDGE02_CONFIG_SHA256`); the builder and writer refuse to run if the
   computed digest differs, so any coefficient or formula change is a new identity.
3. **Fallback semantics.** Whole-candidate fallback N = production `forecast(features, [0.8, 0.2, 0, 0])`. Ordinary VIP or
   R3 missingness → N; production Q missing → withheld; X2 needs a valid, persisted, same-basis H9 record (a no-prior H9
   Q is valid), otherwise X2 alone is withheld; X2's missing-VIP fallback is production N, never H9. Unsupported scoring
   and corrupt identity or source evidence withhold both. Every record states `computed`, `fallback` or `withheld` with
   structured reasons.
4. **Exact scoring compatibility.** VIP runs only when the league's effective offensive scoring equals PPR, half,
   standard or TE premium exactly, as Protocol v2 §3 lists. Only kicker/team-defense/IDP keys that production scoring
   never applies to an offensive player are ignored; every other non-zero key (including `fum_rec_td` and `st_*`) makes
   the league incompatible. Under TE premium, mixed TE eligibility is withheld. No nearest format, no refit.
5. **Private-data exclusion.** Defense in depth: the worker entry, builder and writer each require positive proof of an
   approved public context (explicit Sleeper decision and identity, league in the configured archive list, and no
   `visibility` field at all). A missing `visibility: "private"` is not proof. No owner IDs, names, tokens or auth paths
   enter records.
6. **New sidecar schemas.** `candidate-shadow-1` records in `candidate-shadow-capture-1` files and `candidate-lineup-1`
   records in `candidate-lineup-capture-1` files, under `data/shadow/edge02-vip/` and `data/shadow/edge02-lineup/`
   (`<classification>/<season>/<league>/<capture_id>.json.gz`) on `data-archive`. Created exclusively (`wx`); an existing
   file is kept byte-for-byte, and a stored file whose records differ from the claimed ID is a refused conflict. Record
   IDs derive from the evidence and the six-hour bucket; run metadata (freeze time, writer, eligibility) is kept in the
   file but outside the ID, so a retry deduplicates and keeps the first stored timestamps, and corrected source data gets
   a new ID. The lineup sidecar freezes every roster's membership (starters, bench, IR, taxi), slots, eligibility,
   schedule, availability and each variant's values, plus the existing Hungarian optimizer's assignment over offensive
   slots only, with K/DEF/IDP slots and lock semantics disclosed as unsupported. Not a generic plugin or schema framework.
7. **Effective boundary.** The merge commit time on `main` of this ADR's pull request (Protocol v2 §6, §9), not the
   EDGE-01 research date. The code records it as `pending_registration_record` and keeps every timestamp and the
   implementation SHA, so the evaluator applies it from main's history; capture runs only on `main`, after the merge.
   A record is technically prospective only if `effective_at ≤ generated_at ≤ frozen_at < kickoff`, which is still not
   class C: the evaluator must also see the approved workflow's data-archive commit before kickoff. Trusted-writer metadata
   (GitHub Actions run, ref, SHA) is recorded additively; per-source acquisition completion is recorded as unknown with a
   program-order upper bound.
8. **Production isolation.** The existing `shadowObserver` hook additionally passes the current-season raw rows,
   production per-player summaries and the normalized rosters it already holds. The capture worker runs EDGE-02 after the
   production capture and the H9 shadow; the entry point never throws, so a shadow failure is logged and never fails
   history capture. Nothing in `app/` or production `lib/` imports the shadow. No workflow, cadence, model, weight,
   threshold, version, H9, signal, Pickup Rating, add/drop, trade, route or UI change.

## Alternatives considered

- **Use the published four-decimal coefficients.** Rejected by the task contract: rounded constants are not the fit.
- **Add candidate fields to `observation-1` or `h9-shadow-1`.** Rejected: protected and immutable schemas change only by a
  new version.
- **Infer a nearest format or refit VIP for custom scoring.** Rejected: guessing; a refit is a different candidate family.
- **Treat the absence of `visibility: "private"` as public.** Rejected: positive approval is required.
- **Hard-code an effective-boundary timestamp before merge.** Rejected: the boundary is the merge time, which cannot be
  known in advance; a guessed earlier time would admit pre-registration records.

## Consequences

- Records begin when this code is on `main` and the existing `Capture prospective history` workflow runs (every six
  hours and after `Validate`). The workflow already commits everything under `data/`.
- Leagues whose scoring includes any unregistered offensive rule (for example a non-zero `fum_rec_td` or `st_td`) get
  withheld records with structured reasons and no VIP value; coverage depends on the configured leagues' scoring.
- An outcome scorer and the lineup evaluator are separate, later tasks; no EDGE-02 outcome is looked at before the end of
  the 2026 regular season.
