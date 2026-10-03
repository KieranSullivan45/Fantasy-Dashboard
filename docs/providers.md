# Fantasy providers

## Boundary

Registry → provider adapter → normalized engine context → unchanged decision engine.

Methods: resolveUser, discoverLeagues, getSnapshot/getDecisionContext, getLeague, getLeagueSettings, getRosters, getMatchups, getTransactions, getWaiverState, getPlayers, getUserRoster, getSeasonState, getStandings, getDraftPicks, getProviderCapabilities. Identity and optional attention hooks keep statistical joins and provider interest outside the model. Unsupported methods return normalized errors, not invented values.

`types.d.ts` names account, league, settings, scoring, roster/slot, player reference/eligibility, matchup, transaction/waiver, FAAB, standings, draft pick, member, season and capability contracts. `domain.js` projects the established context into fantasy-domain-1. Existing engine context aliases remain the compatibility boundary; public Sleeper IDs are retained as opaque compatibility keys. Raw provider objects are interpreted by adapters, not scoring formulas.

New ESPN player keys are nfl:GSIS when an exact unambiguous crosswalk exists, otherwise unresolved:espn:ID. Provider IDs, canonical IDs, statistical IDs and mapping confidence remain separate. Names never establish identity. Fantasy eligibility is separate from provider football position. No historical records are renamed.

## Capability matrix

| Feature | Sleeper live | ESPN live | ESPN authorized import | ESPN facts via Flaim (offline mapping only) || ESPN saved league file (local private, ADR 0012) |
|---|---|---|---|---|---|
| Username/discovery | Yes | Disabled | No | Session team for the exact league/season | No; roster only by explicit `roster=` (config `team_id` validated only) |
| League/settings/rosters | Yes | Disabled | Parsed when present | Rosters and slot counts; no owners, playoff size, waiver type or FAAB budget | All teams' rosters, slot counts, matchup periods; no owners, playoff size, waiver type or FAAB budget |
| Scoring | Existing rules/warnings | Disabled | Verified basic coefficients; unknown rules flagged | Unavailable from the transport; a user-authorized league/season-bound configuration (ADR 0003) enables league scoring; otherwise refused | Authorized configuration (ADR 0003) only; file scoring items are cross-check evidence, and a mismatch disables scoring |
| Bench/IR/dual eligibility | Yes | Disabled | Yes | Yes (IR from lineup slot only) | Yes (IR from lineup slot only) |
| OP/Superflex | Yes | Disabled | Slot translation | Slot counts; OP never an eligibility | Slot translation; OP never an eligibility |
| Taxi | Yes | Disabled | Unsupported | Unsupported | Unsupported |
| Matchups | Yes | Disabled | Only explicitly mapped single-week periods | Single-week periods; undecided totals withheld | Single-week periods; undecided totals withheld |
| Standings/FAAB/priority | Yes | Disabled | Nullable source fields | Records only; FAAB/priority unavailable | Records only; FAAB/priority not accepted in v1 |
| Transactions | Yes | Disabled | Unsupported | Bounded, possibly truncated window; private pending items withheld | Not accepted in v1 |
| Draft picks | Transaction history | Disabled | Unsupported | Completed selections; no ownership ledger | Not accepted in v1 |
| Complete waiver pool | Yes | Disabled | Unsupported | No (capped subset; free agent/waiver state and clear time). Replacement levels, VOR, add/drop, Pickup Rating and trades stay disabled even with scoring | No (optional observed subset with league free-agent/waiver status; never complete). Same gates as Flaim |
| Add interest | Yes | Disabled | Unsupported | No | No |
| Private auth | Not collected | Disabled | Not accepted | Local private mode only: saved bundle, no transport/OAuth (ADR 0005) | Local private mode only: sanitized file installed by `pnpm espn:import`; credential-like content rejected; no ESPN request |

Capability availability describes adapter support, not a guarantee that every field exists in every league. Missing fields remain null. ESPN public API requests fail closed; model-meta still describes capabilities.

## Cache and history

Decision cache keys include provider, league, season, user and roster. Existing 30-second bounded decision cache and source caches remain. Engine loading uses one context request; calling individual provider convenience methods separately can repeat context assembly. There is no ESPN network transport or provider rate-limit claim.

Observation records use their existing provider field. Sleeper archive paths stay observations/season/league; future permitted non-Sleeper captures use observations/provider/season/league. History queries filter provider and treat old missing index provider fields as Sleeper. Retention and immutability stay unchanged. Offline UI imports are never archived or exposed by GET endpoints.

## Add another provider

1. Verify permitted access, source fields and security constraints first.
2. Implement the interface and explicit capability/error model; register the provider and validator.
3. Translate raw objects to the existing normalized engine context. Never translate unknown scoring/slots to guessed defaults.
4. Supply exact identity crosswalks, provider eligibility, source warnings, complete-pool/current-season coverage and optional interest hooks.
5. Prove fixture parity, legal lineup/scoring behavior, namespace isolation, safe errors and live access before enabling routes/onboarding.
6. Implement approved authentication separately; never put private league data into shared public caches or machine routes.

Facts from any ESPN source map into the internal `espn-facts-1` contract and one snapshot builder (ADR 0002); Flaim and the saved league file (ADR 0012) are transport/provenance, never provider ids. Future live ESPN activation still needs a complete transport/onboarding/security implementation; changing a capability flag alone is insufficient.
