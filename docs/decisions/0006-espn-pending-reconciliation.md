# 0006 — Reconcile ESPN pending transactions against later records

- Date: 2026-09-29
- Status: accepted (ESPN-PENDING-01)
- Task: ESPN-PENDING-01
- Deciders: repository owner (start approved 2026-09-29); proposed and implemented by Claude Code
- Follows: ADR 0002 and ADR 0005 (both remain in force)

## Context

The first real ESPN load (ESPN-ACTIVATION) showed already-resolved waiver claims and trade proposals still listed as pending in local private mode.

The data flow that allows it:
1. `espnFactsFromFlaim` (`lib/providers/flaim/espn-map.js`) copies each Flaim row's `status` verbatim (`complete`, `pending`, `failed`, `unknown`) and marks every pending row and every trade proposal `private`.
2. `snapshotFromEspnFacts` (`lib/providers/espn-normalize.js`) then surfaces a private item as the owner's when it names exactly one team, the session owner's, and private mode is on.
3. Nothing compares one row with another. ESPN records the outcome of a claim or proposal as a separate row with its own transaction id, so the original row can stay `pending` indefinitely. This is inferred from the code path and the validation finding: the raw payloads are private and are not recorded.

Only the owner's own items are ever surfaced (ADR 0005), so the defect is a false "pending" shown to the right person, not a disclosure. The window is also bounded and possibly truncated, so absence of a resolving row is weak evidence.

## Decision

A pure function, `reconcilePendingTransactions` (`lib/providers/espn-transactions.js`), is applied in `snapshotFromEspnFacts` before any privacy filtering. A `pending` item is hidden when a record that is not pending exists, is not earlier than it, and can be its outcome. The link uses provider id, timestamps, team ids and ESPN player ids only, never names.

- **Waiver claim** (`waiver`, pending). Outcome rows are `waiver` or `add`. The rows must share an added ESPN player id. Same single team means `resolved`. Another team taking the player (`complete` or `unknown`, or a failure with no team identity) is `ambiguous`. A `failed` row that belongs only to another team is unrelated. If either side lacks player ids, a later row by the same team is `ambiguous`.
- **Trade proposal** (`trade_proposal`, pending). Outcome rows are `trade`, `trade_decline`, `trade_veto` or `trade_uphold`, between compatible teams (the same set, or one contained in the other). Identical player-id sets are `resolved`. Overlapping or missing player detail is `ambiguous`. Disjoint player sets are unrelated. A record's teams are its top-level team ids plus the stable team ids already normalized onto its player references (trade sides); when a side has no team identity at all, overlapping player ids are `ambiguous`, not unrelated.
- **Same provider id.** A strictly later, `complete` or `failed` row with the pending row's own id is `resolved`. An older row with that id is not an outcome; equal or missing timestamps and an `unknown` status are `ambiguous`.
- **Ordering.** Only a strictly later, `complete` or `failed` row can be `resolved`. Equal or missing timestamps and an `unknown` status make a matching row `ambiguous`.

Both `resolved` and `ambiguous` hide the item: what cannot be proven pending is not shown as pending. Items with no possibly related later row are kept, because the provider's own status stands when nothing contradicts it. Unrelated rows (other player, other team, a drop, an earlier row) never cancel anything.

Privacy is unchanged. Reconciliation runs on the same items and only removes some. Another manager's stale items stay inside the existing `withheld_private` count and are not itemised. In private mode the owner's own hidden items add an additive `coverage.transactions.owner_pending_reconciled_out` and a `STALE_DATA_RISK` warning; neither appears otherwise. Sleeper, the incomplete-pool gate, the loopback and cache guards, and Flaim transport are untouched.

## Alternatives considered

- **Trust the provider status.** This is the current behavior and produces the false pending items.
- **Link by player or team names.** Names never establish identity (`AGENTS.md`).
- **Hide every pending item while the window may be truncated.** The window is always possibly truncated, so this would remove genuine claims and change the ADR 0005 behavior.
- **Mark resolved items with a new status instead of hiding them.** This adds a status value to the facts contract for no consumer.

## Consequences

- A genuine pending item is hidden when a later row for the same team and player cannot be told apart from its outcome (for example a second claim on the same player). That is the intended fail-closed direction.
- Truncation is not compensated: a resolving row outside the returned window cannot be seen. The existing "may be truncated" warning still applies. Live transport (V05-ESPN-05) may expose a provider link between a row and its outcome, which would allow a stricter rule.
- Revisit if Flaim exposes a related-transaction id or a reliable proposal status.
