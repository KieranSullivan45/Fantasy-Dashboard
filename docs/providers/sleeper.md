# Sleeper provider

`SleeperProvider` wraps the existing snapshot/account implementations. Production loading retains the exact snapshot shape, full eligible waiver pool, roster ownership, scoring, Superflex/TEP, transactions/picks and source warnings. Formula inputs and outputs are unchanged. All existing friend, spectator and season flows remain.

Public API documentation: https://docs.sleeper.com/

The engine requests one normalized context; this wrapper adds no provider HTTP requests. Existing Sleeper endpoint caching remains. Decision results retain the bounded 30-second cache, now additionally namespaced by provider. FAAB spent and total budget are distinct nullable fields. Draft-pick access represents picks in fetched transactions, not complete pick holdings. Historical-roster retrieval and authenticated private access are not implemented by this adapter.

Exact fixture snapshot and full decision-output comparisons cover both configured formats. Live validation reports are recorded in v0.3.4.md. No user/league/season constants were introduced.
