# 0001 — Trade engine architecture (first wave)

- Date: 2026-09-25
- Status: proposed (repository-owner decisions of 2026-09-25 recorded below; revised after the Codex review of PR #2; becomes accepted when the planning PR merges)
- Task: V04-PLANNING (implementation: V04-01, V04-02; design follow-up: V04-03)
- Deciders: repository owner (arbitration); proposed by Claude Code; review by Codex

## Context

v0.4 adds trade evaluation (`PROJECT_SPEC.md`). The engine today (`decision-0.3.2`) has calibrated per-player weekly Start Value, a three-week football acquisition estimate calibrated on waiver-candidate populations, descriptive quality `Q` with replacement/VOR, a Hungarian legal-lineup optimizer and conservative add/drop protections. It has no ROS/dynasty projection, no Market Value, and no trade logic. Draft-pick data from Sleeper is transaction-history only (`getDraftPicks` → `transaction_history_only`), although the capability map lists `draftPickTrading: available`. No normalized context carries verified reserve/taxi eligibility. Existing drop protections are computed inside `transactionEvaluator` from the full internal decision `contexts` map (model features, legacy analytics role labels, player and schedule status, and an upper-tier percentile over the whole map); decision-support 0.3 exposes only a selected `player_context` subset of that map. ESPN live access is disabled. The full decision-support response is already several megabytes (v0.3.4 validation measured ~5.75–5.96 MB). Two agents (Claude Code, Codex) will work concurrently in separate worktrees.

## Decision

1. **Package evaluator first, search later.** Build a pure function that evaluates one explicit proposal as a whole: validate ownership/uniqueness/asset support, apply the package to both rosters, resolve forced drops, re-optimize both legal lineups, and report before/after per side. Candidate generation is deferred to V04-03 design.
2. **Package scope (owner decision).** Exactly two rosters; each side sends 1 or 2 players (1-for-1, 2-for-1, 1-for-2, 2-for-2). Three or more assets from one side, empty-side transfers and three-team/multi-team trades are out of scope and return explicit errors. Candidate-generation limits are decided separately in V04-03.
3. **New isolated module `lib/trade/`.** It reuses `optimizeLineup`, `valueOverReplacement`, position helpers and the existing drop-protection logic by import. It does not change calibrated weights, `model-config.js`, add/drop policy, signals or providers. The only permitted touch to existing decision code is a behavior-preserving exported helper in `add-drop.js` that exposes the existing protection results from the existing full inputs (no change to reasons, thresholds, ordering, outputs or `transactionEvaluator` behavior), subject to owner confirmation in V04-01.
4. **Input is a `TradeContext` built from the normalized snapshot, the decision/value source with a matching `basis`, and authoritative drop-protection evidence.** The existing basis check (`lib/decision/basis.js`) stays unchanged, but basis-string equality is not treated as sufficient: an additional trade-local validation compares provider, league, season, week/as-of week, roster/team and selected-roster identity, normalized roster positions, scoring identity where available, and consumed model/feature versions across all inputs, and rejects mismatches (`CONTEXT_MISMATCH`) without changing any public schema. The evaluator never reads raw provider responses. Capabilities are an explicit input; absent means unsupported.
5. **Protection evidence is authoritative, never reconstructed.** Per-player protection evidence (sufficient/insufficient, protected, droppable, reasons, provenance) comes from the existing add/drop protection logic run on the same full internal inputs it uses today. `lib/trade/*` never recomputes protection and never derives it from the decision-support subset. Signals, market attention and Sleeper popularity are not protection evidence. Insufficient evidence is never assumed unprotected; a side needing a forced drop with insufficient evidence is `undetermined`. Production wiring of this evidence from the server's internal contexts is a later task (V04-01 scope excludes `build-context.js`); the contract requires it regardless.
6. **Horizon (owner decision): `next_game` only.** Lineup values come from calibrated Start Value; depth uses Q-based VOR labeled descriptive quality. All other horizons return `UNSUPPORTED_HORIZON`. The three-week acquisition estimate is not repurposed as trade or ROS value.
7. **No combined score (owner decision).** Starter change, depth change, forced drops, reserve placement and positional context are reported separately per roster. No fairness score, winner/loser verdict, acceptance probability or Market Value (`null`). A future combined policy requires separate design and validation.
8. **Forced drops (owner decision): automatic, no new weights.** Candidates are post-trade active players with sufficient authoritative evidence that they are droppable and not protected. All `k`-combinations are ranked lexicographically: filled legal starter-slot count (desc), legal starter-value total (desc), preserved positive bench VOR (desc), canonical dropped-player-id sequence (asc; locale-independent UTF-16 code-unit order; final determinism tiebreak only). Optimizer input is canonicalized so equal-value solutions cannot vary bench membership. Dropped players are returned explicitly; protected players are never dropped. `blocked` = evidence is sufficient but there are not enough legal non-protected drops; `undetermined` = protection evidence or values are insufficient to choose a deterministic legal combination. Either way no drop set and no final after-state valuation is returned for that side, affected deltas are `null`, and diagnostics explain why; the package is `blocked` if either side is blocked, else `withheld` if either side is undetermined, with both rosters' diagnostics preserved. `k ≤ 2` is a derived invariant of the first-wave package cap and the no-over-capacity start; a context requiring more returns `UNSUPPORTED_DROP_COUNT` and is never truncated. Caller-selected overrides are a future extension.
9. **Unknowns (planner semantics, reviewed).** An unknown value that could change a lineup assignment or a combination ordering makes that result undetermined rather than guessed. Depth change uses actual before/after bench membership; an unknown contribution cancels only when the same player is on the bench on both sides of the delta. Unknown absolute totals are reported separately from deltas known through such cancellation. Missing values are never zero.
10. **Reserve placement (owner decision): never inferred.** An acquired player uses IR/taxi/reserve capacity only when normalized provider data verifies slot availability, player eligibility and the provider capability. Otherwise it counts against active capacity and the limitation is exposed. Injury status never implies IR placement. Incoming players competing for the same verified slot are allocated jointly (each allocation is a candidate after-state), never each assumed to fit. Without verified platform locks/deadlines, results are conditionally legal under known roster rules, not verified executable on the platform.
11. **Player assets only (owner decision).** Draft picks and FAAB return `UNSUPPORTED_ASSET`. Pick ownership is not inferred from transaction history and no pick values are invented.
12. **No new public payload yet.** Nothing is added to snapshot 0.2, decision-support 0.3 or chat-1. A later lazy endpoint needs its own task and schema.
13. **Agent split and branches (owner decision).** Claude Code owns `lib/trade/*` and its core unit tests on `feat/v04-01-trade-evaluator-core` in `C:\Users\kiera\Downloads\Fantasy-Dashboard-Claude`. Codex owns a separate adversarial/legality test suite and synthetic format fixtures, with no production-code edits, on `test/v04-02-trade-adversarial-suite` in `C:\Users\kiera\Downloads\Fantasy-Dashboard-Codex`. `agent/claude-v04` and `agent/codex-v04` were bootstrap branches only. A contracts checkpoint (V04-01 phase A) gates V04-02; V04-02 then runs adversarial tests against the agreed contracts while V04-01 phase B proceeds, reporting findings to Claude Code so blocking findings are resolved in V04-01 before it merges.

## Alternatives considered

- **Player-for-player value arithmetic** (sum of player values per side): rejected; ignores lineup legality, slot competition, forced drops, Superflex/TE structure and dual eligibility.
- **Reuse the add/drop net formula (`starter + 0.25·depth + 0.10·ΔVOR`) as a trade score**: rejected for the first wave. Those weights are transparent add/drop policy, not calibrated for trades.
- **Use `pickup_value` (three-week acquisition estimate) as the trade horizon**: rejected. It was calibrated on acquisition candidates, not rostered starters, and has no per-week availability/bye modeling.
- **Caller-selected forced drops**: deferred; automatic selection with explicit output covers the first wave.
- **Assume injured acquired players go to IR**: rejected; reserve eligibility and slot availability are not verified.
- **Build on `fantasy-domain-1` directly**: not yet; it is a parallel projection without model values and is not the engine's input.
- **Embed trade results in `/api/decision-support`**: rejected; payload size and cross-contract coupling.
- **Generate trades (search) in the first wave**: rejected until evaluator contracts are stable.
- **Reimplement drop protections inside `lib/trade/`**: rejected; duplicate policy would drift.
- **Derive protection status from the decision-support `player_context` subset**: rejected; the subset is not the population the upper-tier percentile and other protections use, so results could silently differ from add/drop.
- **Rank forced-drop combinations by starter total alone**: rejected; a lineup leaving a slot empty could outrank a fully filled legal lineup that contains a negative-value starter.
- **Truncate forced-drop search to two drops**: rejected; `k ≤ 2` is a derived invariant, and a larger requirement signals an unsupported context.

## Consequences

- Early output is narrow: a single-week lineup horizon undervalues players on bye or injured this week and says nothing about the rest of the season. This is disclosed in every result.
- No single "who wins" number; consumers read per-roster components.
- Because reserve placement is rarely verifiable today, acquired injured players will usually count against active capacity, which can create forced drops or `blocked` sides. This is truthful, not a bug.
- With the 1–2 player cap and over-capacity rosters withheld, at most two forced drops per side are needed (only when a sent reserve/taxi player frees no active slot). Cost is two baseline before-solves per evaluation plus `C(n, k)` after-solves per side and reserve allocation, which stays small.
- Until a later task wires authoritative protection evidence from the server's internal contexts, the evaluator has no production caller; forced drops without that evidence are `undetermined`, which is truthful.
- Unknown values will often make lineups, forced drops or deltas `null`/`undetermined`; this is disclosure, not a defect.
- `TradeContext` depends on the current Sleeper-origin vocabulary carried by the normalized snapshot, like the rest of the engine.
- Merge order is fixed: V04-01 merges before V04-02. Blocking V04-02 findings are resolved in V04-01 before its merge; converting a blocking regression test to skipped/TODO does not make it acceptable.

## Open questions (not decided)

1. Which multi-week/ROS horizon should eventually exist, and what model and validation it requires (a separate, later task).
2. What design and validation evidence a future combined trade policy would need.
3. Which provider fields could verify reserve/taxi eligibility, and in what normalized form (provider-scope work).
4. Whether to add a provider capability such as `draftPickHoldings: complete | transaction_history_only | unsupported` before any pick support (provider-scope work).
5. Candidate-generation search space, cost bounds and counterparty fit (V04-03).
6. Endpoint shape and schema name for a later lazy trade route (`trade-1` is provisional).
7. Whether the owner approves the behavior-preserving protection-evidence helper export from `add-drop.js` (confirmed at V04-01 assignment). Without it the contract still requires authoritative evidence, and forced drops remain `undetermined`.
8. Which later task wires authoritative protection evidence from the `build-context.js` internal contexts to a trade caller (expected: the lazy trade endpoint task).

## Revisit when

- A validated ROS/multi-week projection or permitted Market Value source exists.
- Prospective observations allow validating a trade composite or the add/drop net weights.
- A provider exposes complete, verified draft-pick holdings or reserve/taxi eligibility rules.
- The engine migrates its input to `fantasy-domain-1`.
- Evaluator cost or payload needs change the delivery model (e.g. search requires precomputation).
