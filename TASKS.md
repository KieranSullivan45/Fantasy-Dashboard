# TASKS.md — shared task ledger

Coordination rules: `AGENTS.md` → *Task ownership and multi-agent coordination*. In short:

- The repository owner or designated orchestrator assigns/confirms owner, reviewer, branch and scope before implementation starts; this ledger then records the authoritative assignment.
- This file is not a real-time lock across worktrees. Do not self-assign overlapping work; ask first.
- Scopes of `in-progress`, `in-review` and `blocked` tasks stay reserved until explicitly released.
- Edit only your own task's entry. Ledger updates for your task are always in scope.
- Placeholders for approved roadmap milestones are allowed (status `proposed`, planning-only scope). Do not add speculative implementation tasks.

Status values: `proposed` · `ready` · `in-progress` · `in-review` · `blocked` · `done` · `cancelled`.

## Template

```
### <TASK-ID> — <title>
- Status:
- Owner:                 (one agent or person, assigned/confirmed by owner or orchestrator)
- Reviewer:              (different from owner)
- Branch:
- Dependencies:
- Allowed scope:         (files/modules the owner may change; TASKS.md entry implied)
- Acceptance criteria:
- Handoff notes:         (completed work, files changed, tests run + results or why none, remaining work, open questions)
- Blockers:
```

## Active tasks

### AGENT-SETUP — Shared multi-agent documentation
- Status: done
- Owner: Claude Code
- Reviewer: Codex (independent review), then repository owner (human)
- Branch: `chore/agent-workflow-setup` (PR #1 merged)
- Dependencies: none
- Allowed scope: `AGENTS.md`, `ARCHITECTURE.md`, `PROJECT_SPEC.md`, `TASKS.md`, `docs/decisions/README.md`. No application code, tests, dependencies, workflows, config, `README.md`, `.gitignore` or `package.json`.
- Acceptance criteria: the five documents are concise, accurate against the repository at v0.3.4, preserve every invariant in `AGENTS.md`, and do not duplicate one another; no other files changed.
- Handoff notes: initial drafts committed (`0f838cf`) and pushed; PR #1 opened. Revision pass addressing the Codex review, with every finding verified against the code: Pickup Rating add-interest vs informational attention; archive mutability (rolling index, refreshed aggregates); actual Sleeper code locations; per-provider `idColumn` joins; concrete model safeguards; compatibility/UI-state guards; cache/GET wording; claim policy; v0.4 planning constraints; dated measurements. The unsourced "~6 MB" payload figure was removed. No tests or build run: documentation only, no executable behavior changed. Revision committed (`5595d6d`) and pushed to PR #1; Codex's second review returned PASS. Known stale metadata (README, `package.json` version, `.gitignore`) deliberately left for a separate task.
- Blockers: none. PR #1 merged to `main` as `e208969`.

### V04-PLANNING — v0.4 Trade Engine first-wave plan
- Status: in-review
- Owner: Claude Code
- Reviewer: Codex (independent review), then repository owner (arbitration, ADR acceptance)
- Branch: `chore/v04-trade-plan` (main worktree; PR #2)
- Dependencies: AGENT-SETUP (done)
- Allowed scope: `TASKS.md`, `docs/v0.4.md`, `docs/decisions/0001-trade-engine-architecture.md`. No code, tests, config or other docs.
- Acceptance criteria: v0.4 spec, ADR 0001 (context, decision, alternatives, consequences, open questions, revisit triggers) and executable first-wave tasks; honors `PROJECT_SPEC.md` → *v0.4 planning constraints*; every factual claim verified against the repository; unresolved questions stay open.
- Handoff notes: created `docs/v0.4.md` and ADR 0001 (status proposed); replaced the placeholder with V04-01/02/03; closed AGENT-SETUP (merged as `e208969`). Owner decisions of 2026-09-25 applied to all three documents (forced drops, package scope, reserve placement, `next_game` horizon, no combined score, no draft picks, task branches). Planner additions for reviewer attention (not owner decisions): an `undetermined` forced-drop state when unknown values prevent comparison, a stable player-id final tiebreak for determinism, and the bound `k ≤ 2` forced drops (a sent reserve/taxi player frees no active slot). Facts verified in code: horizons in `value-models.js` (Start Value next observed game; `pickup_value` three-week acquisition); drop protections inside `transactionEvaluator` (not exported); Sleeper `getDraftPicks` returns `transaction_history_only` while `draftPickTrading` is `available`; ESPN capabilities all unsupported; existing Sleeper test fixtures are a synthetic two-roster `RB/FLEX/BN` league, so no committed fixture models the 10-team SF/TEP or 12-team PPR structures yet. No tests or build run: documentation only, no executable behavior changed. Initial plan committed (`303da01`) and pushed; PR #2 opened. Codex review returned NEEDS CHANGES; targeted revision pass (same three files): authoritative drop-protection evidence from the full internal add/drop inputs, never recomputed from the decision-support `player_context` subset (verified: `player_context` is a selected subset of `contexts` in `build-context.js`; the upper-tier percentile in `add-drop.js` ranges over the whole `contexts` map); lexicographic forced-drop ranking (filled slots, starter total, bench VOR, canonical id sequence) with locale-independent id order and canonicalized optimizer input; operational unknown/`blocked`/`undetermined` and package-status semantics; trade-local context validation in addition to the unchanged basis check; joint reserve-slot allocation and conditional legality; corrected `C(n, k)` cost statement and `k ≤ 2` as a derived, never-truncating invariant; V04-01/V04-02 handoff flow and skip/TODO policy. The three planner additions are kept with those definitions. No tests or build run: documentation only.
- Blockers: owner review and merge. Remaining ADR 0001 open questions do not block V04-01 except question 7 (the `add-drop.js` protection-evidence helper), which is confirmed at assignment.

### V04-01 — Trade domain contracts and evaluator core
- Status: proposed (becomes `ready` when V04-PLANNING merges and the owner confirms assignment)
- Owner: Claude Code
- Reviewer: Codex (first pass), then repository owner
- Branch: `feat/v04-01-trade-evaluator-core`, created from updated `main`
- Worktree: `C:\Users\kiera\Downloads\Fantasy-Dashboard-Claude` (`agent/claude-v04` was a bootstrap branch only; not the implementation branch)
- Dependencies: V04-PLANNING merged (ADR 0001 accepted).
- Allowed scope: new `lib/trade/*` (contracts, types, context builder, validation, forced drops, evaluator); new `test/trade-core.test.js`; `docs/v0.4.md` contract section; this entry. One behavior-preserving change to `lib/decision/add-drop.js`: an exported helper exposing the existing protection evidence/results from the existing full internal inputs (no change to reasons, thresholds, ordering, outputs or `transactionEvaluator` behavior), only if the owner confirms. Production wiring of that evidence from `build-context.js` internal contexts is **not** in scope (later endpoint task). Forbidden: `app/`, API routes, `build-context.js`, `model-config.js`, calibration, signals, market, providers, history, schemas 0.2/0.3/chat-1, `package.json`/lockfile, CI/config, V04-02 files.
- Phases: **A — contracts checkpoint**: `lib/trade/contracts.js` (+ types) with `TradeContext`, `TradeProposal`, `TradeEvaluation`, horizon object and error codes as in `docs/v0.4.md`; pushed and recorded here as "contracts ready"; owner confirms before V04-02 starts. **B — evaluator** implementation against those contracts, in parallel with V04-02; findings Codex reports during phase B are triaged here, and blocking findings are resolved before V04-01 merges.
- Acceptance criteria: pure, deterministic, no network or provider transport imports; exactly two rosters, 1–2 players per side (1-for-1, 2-for-1, 1-for-2, 2-for-2), other shapes rejected with explicit codes; the existing basis check unchanged plus trade-local context validation (provider, league, season, week, roster/selected-roster identity, roster positions, scoring identity where available, model/feature versions) rejecting mismatches with `CONTEXT_MISMATCH`; validates the whole package before valuation; evaluates both rosters before/after with Hungarian lineups on canonicalized input; protection status consumed only from authoritative evidence produced by the `add-drop.js` helper on full inputs, never recomputed in `lib/trade/*` or derived from the decision-support subset, signals/attention never used as evidence, and an equivalence test showing the helper matches `transactionEvaluator`'s protections on the same inputs; automatic forced drops ranked lexicographically as in `docs/v0.4.md` (filled slots, starter total, bench VOR, canonical locale-independent dropped-id sequence), dropped players returned explicitly, `blocked`/`undetermined` exactly as defined there (no drop set, no after-state valuation, `null` deltas, diagnostics), package `blocked`/`withheld` accordingly, protected or insufficient-evidence players never dropped; `k > 2` ⇒ `UNSUPPORTED_DROP_COUNT`, never truncated; depth change from actual bench membership with same-player-only cancellation; reserve/taxi capacity used only when slot, eligibility and capability are all verified, allocated jointly when players compete for a slot, otherwise active capacity with the limitation exposed; results labeled conditionally legal under known rules; `next_game` only, other horizons `UNSUPPORTED_HORIZON`; unknowns `null` with reasons, never zero; picks/FAAB `UNSUPPORTED_ASSET`; `market_value: null`; no combined fairness score, winner/loser verdict or acceptance probability; `pickup_value` never used as trade value; stale basis rejected; no identity inference; core unit tests for each `docs/v0.4.md` matrix row marked V04-01; existing decision outputs unchanged (all existing tests pass unmodified); `pnpm test` and `pnpm build` pass with exact counts (`pnpm test:ui` not required unless routes/UI/loaders change, which is out of scope).
- Handoff requirements: completed work, files changed, contract changes since phase A (each needs reviewer notice), tests run with exact counts, known gaps, open questions.
- Blockers: V04-PLANNING merge; owner confirmation of the `add-drop.js` export (ADR 0001 open question 7).

### V04-02 — Trade legality and adversarial test suite
- Status: proposed (becomes `ready` after the V04-01 phase A contracts checkpoint is confirmed)
- Owner: Codex
- Reviewer: Claude Code (first pass), then repository owner
- Branch: `test/v04-02-trade-adversarial-suite`, created from the V04-01 phase A contracts commit; rebased on `main` after V04-01 merges
- Worktree: `C:\Users\kiera\Downloads\Fantasy-Dashboard-Codex` (`agent/codex-v04` was a bootstrap branch only; not the implementation branch)
- Dependencies: V04-01 phase A confirmed; merge only after V04-01 merges.
- Flow: V04-01 phase A contracts checkpoint → Codex begins adversarial tests against the agreed contracts → findings reported to Claude Code while V04-01 phase B proceeds → blocking findings resolved in V04-01 before V04-01 merges → V04-01 merges → V04-02 rebases on `main`, completes and merges.
- Allowed scope: new `test/trade-legality.test.js`, `test/trade-adversarial.test.js`, `test/trade-fixtures.js`; this entry. **No production-code edits** (`lib/`, `app/`, `scripts/`, config, docs other than this entry) unless explicitly reassigned by the owner.
- Acceptance criteria: covers every V04-02 row of the `docs/v0.4.md` test matrix, including synthetic fixtures modeled on 10-team Superflex/TE-premium and 12-team full-PPR structures (labeled synthetic; no private league data); includes the adversarial forced-drop case where one candidate yields a full legal lineup containing a negative-value starter and another leaves a starter slot empty, and the fully filled lineup must rank first despite its lower raw total; covers insufficient protection evidence (⇒ `undetermined`, never assumed unprotected), `blocked` vs `undetermined`, same-player unknown cancellation, `k > 2` non-truncation, context mismatches with an equal basis string, and two incoming players competing for one verified reserve slot; asserts contract behavior, not implementation details; no network; every failure is reported to the V04-01 owner as a finding (case, expected, observed, severity) while V04-01 is still open; blocking findings must be fixed in V04-01 before it merges and may **not** be made acceptable by converting the test to skipped/`todo`; a skipped/`todo` test is allowed only for behavior the repository owner has explicitly approved as deferred or unsupported, and names that approval; assertions are never weakened to pass; `pnpm test` pass/fail/skip counts reported.
- Handoff requirements: legality/edge-case findings list with severity, files changed, exact test counts, cases not yet covered, open questions.
- Blockers: V04-01 phase A.

### V04-03 — Counterparty fit / candidate-generation design
- Status: proposed (planning only)
- Owner: unassigned (repository owner to assign)
- Reviewer: unassigned
- Branch: not created
- Dependencies: V04-01 merged with stable contracts.
- Allowed scope: design notes in `docs/v0.4.md` and, if needed, a new ADR. No code.
- Acceptance criteria: to be set by the owner. Must address candidate-generation limits, search space and cost bounds, counterparty need/surplus fit without acceptance probabilities or Market Value, delivery (lazy endpoint, never inside decision-support 0.3), and remain within the evaluator's supported horizons.
- Handoff notes: —
- Blockers: V04-01.
