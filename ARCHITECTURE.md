# Architecture (current as of v0.3.4)

This describes what exists in the code today. Rules live in `AGENTS.md`; planned work only under **Future direction**. Detailed specifications: `docs/v0.3.md` … `docs/v0.3.4.md`, `docs/providers.md`, `docs/assistant-api.md`, `docs/data-sources.md`, `docs/market-intelligence.md`.

Stack: Next.js 15 (App Router), React 19, plain JavaScript ES modules, Node `node:test` unit tests, Playwright browser tests. No database, no auth system, no paid services.

## Module areas

```
Presentation   app/dashboard/*, app/components/*          (client UI, browser-local account selection)
API            app/api/{snapshot,decision-support,accounts,chat/[resource]}/route.js  (GET-only)
Service        lib/snapshot-api.js, lib/decision-api.js, lib/chat-api.js, lib/decision-service.js (30 s bounded cache),
               lib/snapshot-loader.js, lib/decision-loader.js (client loaders), lib/compact.js
Platform       lib/providers/{index,contracts,sleeper,espn,espn-normalize,auth,domain}.js, types.d.ts;
               Sleeper-specific: lib/sleeper.js, lib/derive.js, lib/accounts/{sleeper,query}.js, lib/sources/sleeper/*
Stat sources   lib/sources/* (nflverse stats/schedules/usage/plays, ffopportunity; optional rankings/projections/ownership adapters)
Normalization  lib/normalize/{player-ids,positions,scoring,opportunity}.js
Decision       lib/decision/* (build-context → production, replacement, optimizer, add-drop, calibrated-waivers, team-strength-v2, matchups)
Signals/market lib/signals/engine.js, lib/market/observations.js
History        lib/history/* (contracts, stores, git-store, archive-reader, outcomes); scripts/capture-history.js
Backtest       lib/backtest/*, scripts/backtest.js → artifacts/backtests/v032-results.json
```

**Intended boundaries (not a strict layering).** The import graph is not purely top-down. For example, `lib/decision/build-context.js` imports signals, market and archive-reader modules, and `lib/signals/engine.js` imports helpers from `lib/decision/features.js`. What must hold is narrower: decision, signals and presentation code do not call fantasy-platform transports or parse raw platform responses; they go through the provider registry and normalized context.

## Fantasy-platform providers

- **Registry** (`lib/providers/index.js`): `getProvider(id)` / `requestProvider(params)`; default `sleeper`. `build-context.js` requests a provider context instead of importing Sleeper directly.
- **Interface** (`docs/providers.md`): resolveUser, discoverLeagues, getSnapshot/getDecisionContext, league/settings/rosters/matchups/transactions/waiver state/players/standings/draft picks/season state, `getProviderCapabilities`, `getIdentityRows`. Unsupported methods return normalized `ProviderError`s (e.g. `UNSUPPORTED_FEATURE`, `AUTH_REQUIRED`), never invented values.
- **SleeperProvider** (`lib/providers/sleeper.js`): live, public, read-only. A thin adapter. The Sleeper snapshot is still built by `lib/sleeper.js` (with `lib/derive.js` operating on raw Sleeper player/roster objects), account discovery lives in `lib/accounts/sleeper.js`, and the daily player cache lives in `lib/sources/sleeper/*`. Supplies Sleeper add-interest through an optional attention hook.
- **ESPNProvider**: live transport **disabled**; public routes return JSON 422 `UNSUPPORTED_FEATURE` (model-meta still describes capabilities). `espn-normalize.js` converts authorized/synthetic league JSON offline. The More → Fantasy providers preview runs in browser memory only (2 MB limit, credential keys rejected, never uploaded or archived). An injected offline provider exercises the shared engine in tests.

## Domain and identity

- The engine consumes the established normalized snapshot/context vocabulary. Legacy Sleeper numeric player IDs and Sleeper-derived scoring coefficient names are retained as opaque compatibility keys.
- `lib/providers/domain.js` projects context into `fantasy-domain-1` (typed in `types.d.ts`). This is an additive parallel projection; it is not yet the engine's input.
- Account identity: provider → stable `provider_user_id` → season → `league_id` → optional `roster_id`. `user=spectator` has no owned roster; an explicit `roster=` yields `identity.mode = "selected_roster"`. Browser selections are local; public username resolution is not authentication.
- Player identity: provider IDs, canonical IDs, statistical (GSIS) IDs and mapping confidence are separate. Each provider's `getIdentityRows` names the `idColumn` that `lib/normalize/player-ids.js` (`playerIdMap`) and `lib/decision/analytics.js` join on: Sleeper uses `sleeper_id` from the DynastyProcess crosswalk; ESPN uses `canonical_id` (`nfl:<GSIS>`), assigned only on an exact one-to-one match. Otherwise `canonical_id` is `null` (mapping status `ambiguous` or `unresolved`) and `unresolved:espn:<id>` is used only as the fallback `player_id`; it is never a canonical ID. Names never establish identity. Fantasy eligibility (platform-authoritative, multi-position) is separate from football position.

## Decision engine (`decision-0.3.2`, features `weekly-features-2`)

`build-context.js` assembles provider context, nflverse stats/schedules/usage, ffopportunity xFP and precomputed high-value aggregates, then applies league scoring (`normalize/scoring.js`, which flags unsupported rules). Full specification: `docs/v0.3.2.md`.

- League-scored production and sample-blended quality `Q`; Start Value and football acquisition blends from calibrated weights (`calibration/weights.js`).
- Position opportunity scores (`model-config.js`).
- Replacement/VOR with Superflex and FLEX demand; dual eligibility takes best single VOR.
- Legal add/drop: Hungarian optimizer (`optimizer.js`, fills legal slots first, then maximizes value, one player once), drop protections (`add-drop.js`), reserve/taxi players excluded from active capacity.
- Pickup Rating and immediate-upgrade gates (`calibrated-waivers.js`): 40% acquisition percentile, 15% opportunity, 35% legal net, 5% role evidence, 5% Sleeper add-interest percentile; missing components are not redistributed. v0.3.1 heuristic kept for comparison.
- Context only (not in the forecast): adjusted matchup difficulty, team strength v2, weekly matchup.
- Market Value is `null` everywhere.

## Signals and market attention

`lib/signals/engine.js` (`signals-1`) is a pure function over as-of weekly evidence and independent market observations, with fixed conservative thresholds and caps (5/player, 100/feed). The UI Signal Feed and `/api/chat/signals` share the same records. Market attention (`market-1`) is Sleeper 24 h trending adds compared with archived windows; absent top-100 entries are unknown, not zero. Reddit/X adapters are disabled. Signal and market-attention output does not alter model scores. This is separate from the add-interest percentile already inside Pickup Rating.

## History / archive

- `observation-1` records (full decision evidence, versions, source digests, identity) are batched into immutable `capture-1` gzip files with deterministic IDs and a six-hour dedup bucket. `outcome-1` joins (`outcomes.js`) use strictly post-observation games.
- Durable store: the separate `data-archive` git branch, written only by `.github/workflows/capture-history.yml` (every 6 h, manual, or after a successful `Validate` on main) for leagues in `config/installation.json`. Sleeper paths are `observations/<season>/<league>`; future non-Sleeper paths will be `observations/<provider>/<season>/<league>`.
- Mutable by design: `index.json` (`archive-index-1`) is a rolling index of the newest 1000 captures, rewritten on each capture (`git-store.js`). The market comparison index is a rolling 14-day window. `high-value-1` season aggregates are refreshed each run (`scripts/refresh-high-value.js`). Capture files and Git history are never deleted or rewritten.
- Public GET routes only read (`archive-reader.js`, `/api/chat/history`). Browser-selected friend leagues and ESPN previews are never archived.

## APIs and client state

- `/api/chat/{leagues,league-summary,waivers,signals,player,matchup,model-meta,history}`, schema `chat-1`, GET-only, compact projections of the same decision/signal outputs (no separate scoring). Public cache `s-maxage=30, stale-while-revalidate=30`; errors `no-store`; strict query validation (400/404/409/422/502).
- `/api/snapshot` (0.2) is compact by default; `compact=0` returns the full snapshot (the dashboard uses full). `/api/decision-support` (0.3). Optional `provider=`; default Sleeper bodies unchanged.
- Caching: `decision-service.js` keys its 30 s in-memory cache on provider, league, user identity, roster and season. Shared public-source caches use broader keys: one daily Sleeper player catalog (`lib/sources/sleeper/player-cache.js`) and request-keyed in-memory downloads (`lib/sources/http.js`).
- Client guards: `snapshot-loader.js` and `decision-loader.js` use a generation counter plus `AbortController` to drop stale responses. The dashboard shows decision data only when `decisionBasis(snapshot)` matches the decision response's `basis`, and the loader reports a mismatch as an error.

## Deployment and CI

- `Validate` workflow (`ci.yml`): every push (except `data-archive`) and PR → `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`, Playwright Chromium, `pnpm test:ui`.
- Vercel (free tier) builds from git; `scripts/vercel-ignore.cjs` skips `data-archive` builds. Production follows `main`. Release practice: validate CI on a release branch, fast-forward `main`, then verify the production commit and routes.
- Configuration: `config/installation.json` (installation defaults, not an allowlist) with optional env overrides (`.env.example`). No secrets are required.

## Known limitations and architectural debt

- Sleeper-specific code is spread across `lib/sleeper.js`, `lib/derive.js`, `lib/accounts/*` and `lib/providers/sleeper.js`, not consolidated behind the provider adapter.
- Snapshot/decision contracts still carry Sleeper-origin vocabulary (numeric player IDs, coefficient names). The canonical domain is a parallel projection.
- ESPN statistical joins depend on the external crosswalk's GSIS coverage.
- Calling individual provider convenience methods can repeat context assembly; only the engine path uses a single context request.
- Full `/api/decision-support` responses are large; chat routes are the preferred compact interface.
- Unsupported: `st_ff`/`st_fum_rec`, DEF/IDP scoring models and banded bonuses. v0.3.4 validation recorded seven unmatched statistical identities (a dated measurement; see `docs/v0.3.4.md`). Red-zone/QB team-play model inputs are missing, there are no rankings/projections/ownership feeds, and K/DST/IDP have no acquisition model.
- Add/drop net weights (0.25/0.10) and signal thresholds are transparent policy, not transaction-level calibrated.
- No commissioner locks, deadlines, multi-move transactions, trade generation or notifications.
- The archive covers configured leagues only, not a complete historical waiver universe. Git-branch storage has growth limits (`docs/data-sources.md`).
- No private-user authentication or per-tenant storage.

## Future direction (not implemented)

Planned milestones are in `PROJECT_SPEC.md`. Any live ESPN transport, credential flow, Market Value source or social ingestion must enter behind the provider/source boundary with its own approved design and ADR.
