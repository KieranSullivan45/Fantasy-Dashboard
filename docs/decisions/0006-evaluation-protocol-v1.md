# 0006 — Evaluation Protocol v1: season ledger and prediction of record

- Date: 2026-09-29
- Status: proposed (becomes accepted when `docs/evaluation-protocol-v1.md` is merged to `main` with owner approval and registered per its section 14)
- Task: EVAL-PROTOCOL-01
- Deciders: repository owner (decisions of 2026-09-29); proposed by Claude Code

## Context

The repository has a leakage-aware retrospective harness (`scripts/backtest.js`, `lib/backtest/*`) and an immutable prospective ledger (`observation-1`, `capture-1`, `outcome-1` on `data-archive`), but no registered protocol. Seasons 2022–2025 have each been scored and re-examined, so they can no longer serve as clean holdouts. The 2026 season is the only remaining source of prospective evidence and every capture made before a protocol exists is only pilot evidence. The archive is written every 6 hours and after every green `Validate` run on `main`, so "which prediction counts" is undefined.

## Decision

1. Adopt `docs/evaluation-protocol-v1.md` as the evaluation protocol. It is documentation only and changes no code, schema, workflow, weight, threshold or policy.
2. Treat 2022–2025 as consumed seasons (development and walk-forward evidence only). Treat 2026 as sealed from registration onward, and all earlier 2026 captures as pilot.
3. Define the prediction of record: lineup = last valid prediction before each player's kickoff; waiver = last valid scheduled waiver capture before the applicable waiver decision window.
4. Adopt provisional practical-significance screens (0.05 MAE; 0.1 lineup points per roster-week) that are necessary and never sufficient for promotion, plus the promotion gates in the protocol.
5. Freeze hypotheses H1–H10 and preserve null results. Consensus projections are a benchmark only.
6. Record what the protocol cannot yet support (frozen baselines, full alternatives, recommended lineup, protocol hash, a scheduled waiver capture). Those need a new record schema version and a workflow change, which are separate approvals and are not made here.

## Alternatives considered

- **Keep 2024–2025 as held-out.** Rejected: they were reported in v0.3.2 and re-examined; calling them clean would overstate the evidence.
- **Wait for the archive schema change before registering.** Rejected: every week without a registered protocol becomes pilot data. Registering definitions now costs nothing and limits class C claims honestly (protocol section 3).
- **Define the prediction of record as the newest capture at any time.** Rejected: later captures can see information the decision could not, and the current cadence produced 17 implementation revisions in five days.

## Consequences

- Confirmatory claims are limited until the archive follow-up ships; waiver outcomes stay pilot or exploratory until a scheduled waiver capture exists.
- The 2026 sealed outcomes must not inform research or design; Phase 0 research uses seasons ≤ 2025.
- A wrong frozen definition costs a season; corrections need a new protocol version, not an edit.
- Open points for the owner at registration: the exact meaning of "before the applicable waiver decision window" and the "scheduled waiver capture" class (protocol section 4.2, marked Q).
- Revisit when: the archive schema version and scheduled capture exist, Market Value has an approved source, consensus licensing is confirmed, or a season's results show the definitions cannot be scored.
