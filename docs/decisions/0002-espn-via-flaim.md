# 0002 — ESPN league facts via the Flaim transport

- Date: 2026-09-26
- Status: accepted for the offline facts-mapping layer (V05-FLAIM-01). Live transport, OAuth and production use are not approved by this ADR.
- Task: V05-FLAIM-01
- Deciders: repository owner (architecture approved 2026-09-26 with one modification: no Flaim-to-snapshot mapper); proposed and implemented by Claude Code

## Context

Private ESPN leagues need authenticated access. ESPN publishes no supported third-party API or OAuth contract (`docs/providers/espn.md`). We will not collect or store ESPN credentials or cookies (`espn_s2`, `SWID`), scrape ESPN or call undocumented endpoints.

Flaim (flaim.app) is an MCP service that holds the user's ESPN session on its side and exposes read-only tools. A live, read-only verification on 2026-09-26 against the owner's private league, run through the owner's own Flaim connection, established these facts:

- every roster and available-player entry has a stable ESPN `playerId`. D/ST ids are negative; kickers are ordinary ids.
- player `lineupSlot` values are translated labels (QB, RB, WR, TE, FLEX, K, D/ST, Bench, IR). IR comes from the slot, not from `injuryStatus`.
- `eligiblePositions` are labels, including flex groupings (RB/WR, WR/TE, FLEX, OP), a "Rookie" pseudo-label and IDP labels.
- league settings expose raw `lineupSlotCounts` and single-week `matchupPeriods`, but **no scoring coefficients** (`scoringItems`): only a scoring type.
- there is **no owner information**, **no waiver priority** and **no FAAB balance or budget**.
- available players are capped at 100, have no pagination and no total, so the pool can never be proven complete. `acquisitionState` distinguishes free agents from waivers, and waiver rows carry `waiverClearsAt`.
- weekly historical rosters give membership and slots, but their stats and rates are current-time values (leakage).
- in-progress matchup `totalPoints` is 0 while the week is live.
- transactions are a bounded, possibly truncated window. They include the authenticated manager's own pending waiver claims and trade proposals, which are private.
- responses mix facts with projections, rankings, keeper values and playoff predictions.
- under the exact crosswalk, rostered and available non-D/ST players mapped 100% to GSIS. D/ST has no GSIS mapping.

## Decision

1. **ESPN is the provider identity; Flaim is transport and provenance only.** Every normalized object keeps `provider: "espn"`. Provenance is `coverage.source_transport: "flaim"` and `coverage.access: "flaim_live"`. There is no `flaim` provider id, cache namespace or archive path.
2. **One internal ESPN facts contract.** `espn-facts-1` (`lib/providers/espn-normalize.js`, typed in `types.d.ts`) is an in-memory, provider-normalized representation in our vocabulary (slots, positions, team codes, ESPN ids). Every ESPN source maps into it:
   - `espnFactsFromImport` (authorized raw ESPN JSON; the existing offline path, refactored)
   - `espnFactsFromFlaim` (`lib/providers/flaim/espn-map.js`, validated by `lib/providers/flaim/schema.js`)

   One source-agnostic builder, `snapshotFromEspnFacts`, produces snapshot 0.2. `ESPNProvider` accepts `authorizedImport` or `espnFacts`. Flaim code knows nothing about snapshot, decision-support or trade schemas. Snapshot, decision, trade and UI code know nothing about Flaim. The authorized-import output is unchanged apart from additive coverage and capability fields (verified by a parity check against the previous normalizer).
3. **Only verified labels map.** The Flaim slot labels in `FLAIM_SLOT_LABELS` are the nine observed live. Any other label becomes `UNSUPPORTED_ESPN_LABEL_*`, which is recorded in `coverage.unsupported_slots` and blocks legal-lineup and decision evaluation.
   - Eligibility keeps QB, RB, WR, TE, K and D/ST→DEF.
   - Flex groupings and "Rookie" carry no position (the import path ignores the same slot codes).
   - Unverified labels (for example CB, DB, DP) are ignored with a warning, never inferred.
4. **Scoring-dependent engines stay disabled.** Facts from Flaim always carry `scoring.available: false`, even if the transport someday adds scoring items (that needs its own verification). The snapshot records `coverage.scoring_available: false`, empty rules and a warning. Empty rules would score every stat line as a "complete" 0. So `ESPNProvider.getDecisionContext` and `buildDecisionState` both refuse with `UNSUPPORTED_FEATURE` before any stat source or scoring step runs. That also disables Pickup Rating and the trade engine. `/api/decision-support` now returns normalized `ProviderError`s (422, `no-store`) instead of a generic 502, matching `/api/trade`. Coefficients are never inferred from matchup totals, season points or projections.
5. **The available pool is incomplete by construction.** `available.complete` is always `false`, and so is `capabilities.completePlayerPool`. `coverage.available_players` records what was returned. Players are exposed with ESPN id, eligibility, team, `acquisition_state` and `waiver_clears_at` only. ESPN-wide rostered and started rates are discarded: they are not league data, add interest or Market Value.
6. **Private-data boundary.** Pending transactions and trade proposals are marked `private` in facts and are never placed in the snapshot. `coverage.transactions.withheld_private` counts them. FAAB bids stay `null` without a verified budget. Nothing in this layer persists, archives or serves data. Public GET and chat routes still reject ESPN (`publicLeagueAccess` stays unsupported).
7. **Discarded fields.** Projections, projected and actual ranks, keeper values, `madePlayoffs`, rates, season points and raw stats are never copied (allow-list construction; `DISCARDED_FIELDS` is asserted by tests). Historical rosters keep only membership, slot and eligibility; injury status, pro team and acquisition are dropped unless Flaim marks them available.
8. **Identity is unchanged.** It is resolved with `playerReference` (exact one-to-one ESPN↔GSIS) and never by name. Unmapped ids, including all negative D/ST ids, stay `unresolved:espn:<id>` with `MAPPING_INCOMPLETE` warnings. No D/ST canonical rule is introduced.
9. **Ownership.** No owner ids exist. A roster is the user's only through the authenticated session's team for the exact league, platform and season (`identity.mode: "account"`), or through an explicit `roster=` selection.

## Alternatives considered

- **Collect ESPN cookies ourselves** (the espn-api approach): rejected. It means credential handling, undocumented endpoints and Disney terms risk (`docs/providers/espn.md`).
- **A separate `flaim` provider id:** rejected. It would leak the transport into cache keys, archive paths, capabilities and UI, and make replacing Flaim a migration.
- **Flaim → snapshot 0.2 directly:** rejected by the owner. It couples the transport to the public snapshot contract.
- **Rebuild raw ESPN JSON from Flaim labels so the old normalizer could consume it:** rejected. Reverse label→code translation would be an unverified guess presented as raw provider data.
- **Treat missing scoring as standard/PPR, or fit coefficients from totals:** rejected. It violates "missing stays missing".

## Consequences

- The dashboard can later show ESPN-via-Flaim facts (rosters, standings, current matchups, public recent transactions, available subset, draft) without any engine change. Decision support, Pickup Rating, waiver recommendations and trades stay unavailable for it until a verified scoring source exists: Flaim exposing `scoringItems` (then a verification task), or an approved pairing with an authorized scoring import.
- Replacing Flaim needs only a new `espnFactsFrom…` mapper. The builder, provider and engines are untouched.
- The facts contract is internal and unversioned in public schemas. Changing it needs a new `version` string and matching builder support.
- **Not decided here (each needs separate approval):**
  - a live Flaim transport
  - OAuth / PKCE / token storage
  - Vercel deployment of any authenticated flow
  - public or assistant exposure of private league data
  - archive capture of Flaim leagues
  - use of historical rosters in backtests
  - any D/ST identity rule
- **Production OAuth remains blocked and unapproved.** As of 2026-09-26, Flaim's documented redirect allowlist does not accept arbitrary web-app callbacks, and its terms describe personal use. Permission must be confirmed with Flaim first.
