# 0001 — Trade engine architecture (first wave)

- Date: 2026-09-25
- Status: proposed (repository-owner decisions of 2026-09-25 recorded below; becomes accepted when the planning PR merges)
- Task: V04-PLANNING (implementation: V04-01, V04-02; design follow-up: V04-03)
- Deciders: repository owner (arbitration); proposed by Claude Code; review by Codex

## Context

v0.4 adds trade evaluation (`PROJECT_SPEC.md`). The engine today (`decision-0.3.2`) has calibrated per-player weekly Start Value, a three-week football acquisition estimate calibrated on waiver-candidate populations, descriptive quality `Q` with replacement/VOR, a Hungarian legal-lineup optimizer and conservative add/drop protections. It has no ROS/dynasty projection, no Market Value, and no trade logic. Draft-pick data from Sleeper is transaction-history only (`getDraftPicks` → `transaction_history_only`), although the capability map lists `draftPickTrading: available`. No normalized context carries verified reserve/taxi eligibility. ESPN live access is disabled. The full decision-support response is already several megabytes (v0.3.4 validation measured ~5.75–5.96 MB). Two agents (Claude Code, Codex) will work concurrently in separate worktrees.

## Decision

1. **Package evaluator first, search later.** Build a pure function that evaluates one explicit proposal as a whole: validate ownership/uniqueness/asset support, apply the package to both rosters, resolve forced drops, re-optimize both legal lineups, and report before/after per side. Candidate generation is deferred to V04-03 design.
2. **Package scope (owner decision).** Exactly two rosters; each side sends 1 or 2 players (1-for-1, 2-for-1, 1-for-2, 2-for-2). Three or more assets from one side, empty-side transfers and three-team/multi-team trades are out of scope and return explicit errors. Candidate-generation limits are decided separately in V04-03.
3. **New isolated module `lib/trade/`.** It reuses `optimizeLineup`, `valueOverReplacement`, position helpers and the existing drop-protection logic by import. It does not change calibrated weights, `model-config.js`, add/drop policy, signals or providers. The only permitted touch to existing decision code is a behavior-preserving export of the drop-protection predicate from `add-drop.js`, subject to owner confirmation in V04-01.
4. **Input is a `TradeContext` built from the normalized snapshot plus decision-support 0.3 output with a matching `basis`.** The evaluator never reads raw provider responses. Capabilities are an explicit input; absent means unsupported.
5. **Horizon (owner decision): `next_game` only.** Lineup values come from calibrated Start Value; depth uses Q-based VOR labeled descriptive quality. All other horizons return `UNSUPPORTED_HORIZON`. The three-week acquisition estimate is not repurposed as trade or ROS value.
6. **No combined score (owner decision).** Starter change, depth change, forced drops, reserve placement and positional context are reported separately per roster. No fairness score, winner/loser verdict, acceptance probability or Market Value (`null`). A future combined policy requires separate design and validation.
7. **Forced drops (owner decision): automatic, no new weights.** Candidates are legally droppable, non-protected post-trade active players. All legal `k`-combinations are evaluated; the preferred one preserves the strongest post-trade legal starting lineup, with preserved bench VOR as the secondary criterion (existing lineup/VOR semantics) and a stable player-id order only as a final determinism tiebreak. Dropped players are returned explicitly. Insufficient legal drops ⇒ that side is `blocked`; protected players are never silently dropped. If unknown values make the comparison undefined, the side is `undetermined` rather than silently resolved. Caller-selected overrides are a future extension.
8. **Reserve placement (owner decision): never inferred.** An acquired player uses IR/taxi/reserve capacity only when normalized provider data verifies slot availability, player eligibility and the provider capability. Otherwise it counts against active capacity and the limitation is exposed. Injury status never implies IR placement.
9. **Player assets only (owner decision).** Draft picks and FAAB return `UNSUPPORTED_ASSET`. Pick ownership is not inferred from transaction history and no pick values are invented.
10. **No new public payload yet.** Nothing is added to snapshot 0.2, decision-support 0.3 or chat-1. A later lazy endpoint needs its own task and schema.
11. **Agent split and branches (owner decision).** Claude Code owns `lib/trade/*` and its core unit tests on `feat/v04-01-trade-evaluator-core` in `C:\Users\kiera\Downloads\Fantasy-Dashboard-Claude`. Codex owns a separate adversarial/legality test suite and synthetic format fixtures, with no production-code edits, on `test/v04-02-trade-adversarial-suite` in `C:\Users\kiera\Downloads\Fantasy-Dashboard-Codex`. `agent/claude-v04` and `agent/codex-v04` were bootstrap branches only. A contracts checkpoint (V04-01 phase A) gates V04-02.

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

## Consequences

- Early output is narrow: a single-week lineup horizon undervalues players on bye or injured this week and says nothing about the rest of the season. This is disclosed in every result.
- No single "who wins" number; consumers read per-roster components.
- Because reserve placement is rarely verifiable today, acquired injured players will usually count against active capacity, which can create forced drops or `blocked` sides. This is truthful, not a bug.
- With the 1–2 player cap and over-capacity rosters withheld, at most two forced drops per side are needed (only when a sent reserve/taxi player frees no active slot), keeping evaluation cheap.
- `TradeContext` depends on the current Sleeper-origin vocabulary carried by the normalized snapshot, like the rest of the engine.
- Merge order is fixed: V04-01 merges before V04-02.

## Open questions (not decided)

1. Which multi-week/ROS horizon should eventually exist, and what model and validation it requires (a separate, later task).
2. What design and validation evidence a future combined trade policy would need.
3. Which provider fields could verify reserve/taxi eligibility, and in what normalized form (provider-scope work).
4. Whether to add a provider capability such as `draftPickHoldings: complete | transaction_history_only | unsupported` before any pick support (provider-scope work).
5. Candidate-generation search space, cost bounds and counterparty fit (V04-03).
6. Endpoint shape and schema name for a later lazy trade route (`trade-1` is provisional).
7. Whether the owner approves the behavior-preserving export of the drop-protection predicate from `add-drop.js` (confirmed at V04-01 assignment).

## Revisit when

- A validated ROS/multi-week projection or permitted Market Value source exists.
- Prospective observations allow validating a trade composite or the add/drop net weights.
- A provider exposes complete, verified draft-pick holdings or reserve/taxi eligibility rules.
- The engine migrates its input to `fantasy-domain-1`.
- Evaluator cost or payload needs change the delivery model (e.g. search requires precomputation).
