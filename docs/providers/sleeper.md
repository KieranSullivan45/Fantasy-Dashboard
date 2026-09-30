# Sleeper provider

`SleeperProvider` wraps the existing snapshot/account implementations. Production loading retains the exact snapshot shape, full eligible waiver pool, roster ownership, scoring, Superflex/TEP, transactions/picks and source warnings. Formula inputs and outputs are unchanged. All existing friend, spectator and season flows remain.

Public API documentation: https://docs.sleeper.com/

The engine requests one normalized context; this wrapper adds no provider HTTP requests. League resources come from the process-local refresh coordinator (`lib/sources/sleeper/inputs.js`, ADR 0008): validate-before-promote, last-known-good per resource, per-resource freshness, single flight, and a deterministic `input_revision` for each committed bundle. `refreshInputs(league, { force })` backs `POST /api/refresh`; `pinInputs(league)` gives the revision plus an adapter bound to exactly that bundle, which the shared decision state uses before its cache lookup. Decision results retain the bounded 30-second cache, namespaced by provider and, for Sleeper, by input revision. FAAB spent and total budget are distinct nullable fields. Draft-pick access represents picks in fetched transactions, not complete pick holdings. Historical-roster retrieval and authenticated private access are not implemented by this adapter.

Exact fixture snapshot and full decision-output comparisons cover both configured formats. Live validation reports are recorded in v0.3.4.md. No user/league/season constants were introduced.

## Refresh cadence (SLEEPER-REFRESH-01)

| Class | Resources | Stale after | Manual refresh |
|---|---|---|---|
| dynamic | rosters, current-week matchups, current and previous transaction rounds, NFL state | 5 min | forced (10 s per-resource cooldown, `Retry-After` honoured) |
| slow | league, members, trending adds | 15 min | only when due or missing |
| catalog | player catalog | 24 h | only when due or missing |

Ordinary GETs refresh only due resources (never forced) and back off 30 s after a failed attempt. The dashboard refreshes due resources every 5 minutes while visible. All guarantees are per warm server instance.
