# 0008 — Sleeper self-service refresh: process-local coordinator and input revisions

- Date: 2026-09-30 (revised the same day after the first-pass review: atomic per-league core, capacity admission, pins
  outside the bound, unresolved refresh status, client revision guard)
- Status: proposed (accepted on merge of the SLEEPER-REFRESH-01 pull request)
- Task: SLEEPER-REFRESH-01 (M2 of the approved research plan)
- Deciders: ChatGPT PM execution contract of 2026-09-30 (architecture decisions 1–17); implemented by Claude Code

## Context

Before this change the dashboard's Refresh button repeated the snapshot GET. It did not reach Sleeper through Next's fetch
cache or the CDN, cleared same-league data while reloading, and a transient optional failure replaced useful data with an
empty list. There was no committed resource bundle, no per-resource freshness, and nothing tied a decision or trade result
to the exact league inputs it was computed from beyond the roster-shaped `decisionBasis`. Local private ESPN already keys
its decision cache on a content revision (ADR 0005); Sleeper had no equivalent.

## Decision

1. **Process-local guarantee.** A coordinator (`lib/sources/sleeper/inputs.js`) sits beneath snapshot assembly. It keeps,
   per league, the committed ("last-known-good") resources, per-resource attempt/freshness metadata and one in-flight
   refresh. Every guarantee (single flight, last-known-good, cooldowns, revision continuity) holds within one warm server
   instance only. There is no database, hosted cache, cross-instance lock or new dependency; a cold or different instance
   starts empty and fetches on first use.
2. **Resources and cadence.** Dynamic (stale after 5 min): rosters, current-week matchups, current and previous transaction
   rounds, and NFL state (it selects those weeks). Slow (15 min): league, members, trending adds. Catalog (24 h): the player
   catalog. Standings and the available pool are derived from rosters, members and catalog, so they follow roster
   promotion. League, members and rosters are per league; NFL state, catalog and trending are process-wide with their own
   single flight.
3. **Validate before promote.** Core resources (league, members, rosters, plus NFL state and catalog) are promoted together
   or not at all, atomically per league: each is first a validated *candidate*, and a league's committed core advances only
   when every core candidate is valid and none has an unresolved failed attempt. If any fails, the league keeps exactly
   its previous committed core and revision; a candidate that was fetched but held back reports `last_attempt_status:
   "not_promoted"`. Shared candidates (NFL state, catalog) are refreshed once for all leagues (shared single flight) but
   never change an already committed league's core by themselves. The activity week and transaction rounds are chosen
   from the committed NFL state, never from an unpromoted candidate. Checks: league id, NFL sport, season present and unchanged for the same league id, roster positions,
   member list shape and uniqueness, roster ids unique, player-id lists well formed, no player on two rosters, a roster's
   own `league_id` (when present) matching. Optional activity (matchups, transactions, trending) is validated and promoted
   individually; matchups must reference committed rosters. Empty activity lists are valid.
4. **Last-known-good.** A failed or invalid refresh never replaces committed data. Optional resources keep their own prior
   valid value. A resource that never loaded stays missing (`null`) and the snapshot keeps the existing
   `UPSTREAM_UNAVAILABLE` warning; nothing is fabricated. With no committed core, a failure is an error (no empty league), and
   the league entry is not retained. Failure metadata never advances `last_success_at`.
5. **Input revision.** Each committed bundle has `sleeper:<sha256>` over the per-resource content digests (canonical JSON,
   sorted keys, array order kept) of exactly the committed values, including `null` for missing optional ones. Identical
   evidence gives the same revision in any process; timestamps, statuses and errors are not revision material. No
   credentials or private data exist in Sleeper's public responses or enter the material.
6. **Pinned builds.** `SleeperProvider.pinInputs(league)` returns the revision and an adapter bound to that immutable bundle.
   The shared `decisionStateService` pins before cache lookup when a request brings no revision/adapter of its own, so the
   revision joins the existing cache key (no second cache) and the build reads only that bundle. An R1 build finishing
   after R2 is promoted stays under the R1 key and cannot satisfy or mix into R2. Private ESPN keeps its own revision path
   untouched.
7. **Basis.** `decisionBasis(snapshot)` appends `["input_revision", <revision>]` when `coverage.input_revision` is present;
   other snapshots keep the exact previous basis. The trade request keeps its `basis` field, so a refreshed revision makes
   an old proposal `STALE_BASIS` without a new request field.
8. **Manual refresh.** `POST /api/refresh` (`refresh-1` response, `no-store`) accepts `provider, league, user, roster,
   season, mode` only. `mode: "manual"` forces dynamic resources, bounded by a 10 s per-resource cooldown and any
   `Retry-After`; `mode: "due"` (automatic) refreshes only resources past their window. Slow and catalog resources are
   refreshed only when due or missing. Validation of provider, league and identity is server-side; ESPN (including private
   mode) is refused with `UNSUPPORTED_FEATURE`. The response carries the display-limited full snapshot derived from the
   committed bundle, the revision, previous revision, attempted/failed resources and `status` (`ok`, `partial`, or
   `failed` = last-known-good served). `status` follows every *unresolved* resource of the committed bundle (latest attempt
   failed or not promoted), not only this call's attempts, so an immediate retry that the cooldown, backoff or
   `Retry-After` deferred still reads `failed`/`partial` with the error kept. Additive fields: `unresolved`, `deferred`
   (unresolved and not re-attempted by this call) and `retry_after_seconds`. The hint comes from the same eligibility rule
   the coordinator uses to decide a fetch (Retry-After, then the manual cooldown for forced dynamic resources, or the
   freshness window and 30 s failure backoff otherwise), evaluated for a retry in the same mode. Only failed sources set
   it (a `not_promoted` candidate needs no fetch of its own): with failed core sources it is the time until the last of
   them is eligible, otherwise until the next failed optional source is. It is `null` when nothing failed or a blocking
   source is in flight, and never reports ready before the source can actually be attempted. When every tracked arbitrary league is busy,
   the request is refused with `503 CAPACITY` (`Retry-After`) before any upstream work. It never writes history or the archive, never creates an observation or
   prediction of record, never builds a decision and never runs a trade. There is no GET form; ordinary GETs refresh only
   due resources in memory (non-forced).
9. **Cache consistency.** The coordinator's transport is `no-store`, so a forced refresh really reaches Sleeper. The
   dashboard uses the POST response itself, then names the revision it holds in later reads (`rev=` on snapshot and
   decision GETs). A matching revision keeps the existing public cache headers (each revision has its own URL); a snapshot
   for another revision is served `no-store`; a decision for another revision is `409 STALE_REVISION`, `no-store`. The
   client never accepts a snapshot whose `coverage.input_revision` differs from the `rev` it named (revisions are not
   ordered, so older and newer are treated alike): it does not publish it or overwrite the remembered revision, keeps any
   same-selection data, and shows an explicit sync mismatch. The same rule covers automatic (`due`) refreshes: with a held
   revision H, the client accepts a result only when `input_revision` is H or `previous_input_revision` is H (the serving
   instance advanced from exactly H); any other result is kept out and H stays remembered. Only an explicit manual sync
   may switch to the serving instance's committed revision, which resolves a mismatch. With no held revision, a result is
   accepted normally. Existing
   URLs without `rev` keep their headers (chat stays `s-maxage=30`).
10. **Abuse and memory bounds.** Refresh stays unauthenticated. Bounds: per-league single flight, cooldown, 30 s failure
    backoff for non-forced reads, `Retry-After` honoured, a fixed request envelope (2 KB, two modes), at most 16 arbitrary
    (unpinned) leagues retained, first-load failures not retained. Installation (configured) leagues are pinned: they sit
    outside that bound and are never evicted. Admission happens before any upstream work; only an idle unpinned entry
    (least recently used first) is evicted, never one with a refresh in flight or a caller waiting on it. When all 16 are
    busy, a new arbitrary league is refused (`CAPACITY`) rather than tracked beyond the bound or left untracked.
11. **Client.** Same selection: data stays visible while refreshing, the button is disabled and `aria-busy`, a failure keeps
    the last good data with a retry, and the header shows last league sync plus stale or failed resources from
    `coverage.freshness`. Different selection: data is cleared as before. The existing generation counters and
    AbortControllers cover refresh too. Automatic refresh uses one timer set for the moment the last sync becomes due (5
    min), pauses while the document is hidden, refreshes once on return when due, and removes its listener and timer on
    selection change or unmount. The decision loader reloads only when the basis (and so the revision) changes; the trade
    view abandons in-flight evaluations of an old basis and already drops picks no longer on the roster.
12. **Snapshot contract.** Schema stays `0.2`. `coverage.input_revision` and `coverage.freshness` (`guarantee`,
    `checked_at`, per-resource `class`, `stale_after_seconds`, `status` fresh/stale/missing, `age_seconds`,
    `last_success_at`, `last_attempt_at`, `last_attempt_status`, sanitized `error`) are additive and identical in compact
    and full views. `generated_at` is unchanged and is not a sync time. Snapshots built from an injected transport (tests,
    scripts) carry the revision but no freshness claim.

## Alternatives considered

- **Keep Next's fetch revalidation and add a force flag.** Rejected: revalidation windows and the data cache sit outside
  the app's control, cannot express last-known-good or per-resource status, and a force flag on GET would be a GET mutation.
- **Revision from timestamps or a counter.** Rejected: a counter differs across instances and changes without content
  change; the contract requires identical evidence to keep its revision.
- **`no-store` on every snapshot/decision response.** Rejected: it removes useful caching globally. Revision-qualified URLs
  keep caching for correct content only.
- **Persisted or shared state (KV/Redis/DB).** Out of scope for M2 and requires owner approval.

## Consequences and known limitations

- Guarantees are per warm instance. On a multi-instance deployment a GET can reach an instance holding an older or newer
  revision; `rev` reads then answer `no-store` (snapshot) or `409` (decision) instead of caching the wrong content, and the
  user may see an older last-sync on that instance. Cold instances re-download the catalog, as before.
- Evicted arbitrary leagues (beyond 16 unpinned) lose their last-known-good and start over. Pinned leagues add to that
  bound; their number is fixed by configuration.
- A failing shared core resource (NFL state or catalog) holds every league's core at its last committed revision until it
  recovers (retried after the 30 s backoff); rosters stay at their last committed value meanwhile.
- Chat routes still serve public `s-maxage=30` responses; their server state follows the new revision immediately, the CDN
  copy within that window.
- Server staleness for GET readers is now bounded by the cadence (rosters up to 5 min) rather than the former 30 s upstream
  revalidate; the dashboard refreshes due resources every 5 min while visible, and manual refresh forces them.
- Validation is structural. It cannot detect an upstream record that is wrong but well formed.
- `lib/sources/sleeper/player-cache.js` is no longer on the snapshot path (the coordinator owns the catalog); it is kept
  with its tests pending a separate cleanup.
