# Architecture (current as of v0.3.4)

This describes what exists in the code today. Planned work is listed only under **Future direction** and is not implemented. Detailed specifications: `docs/v0.3.md` … `docs/v0.3.4.md`, `docs/providers.md`, `docs/assistant-api.md`, `docs/data-sources.md`, `docs/market-intelligence.md`.

Stack: Next.js 15 (App Router), React 19, plain JavaScript ES modules, Node `node:test` unit tests, Playwright browser tests. No database, no auth system, no paid services.

## Layers

```
Presentation   app/dashboard/*, app/components/*          (client UI, browser-local account selection)
API            app/api/{snapshot,decision-support,accounts,chat/[resource]}/route.js  (GET-only)
Service        lib/snapshot-api.js, lib/decision-api.js, lib/chat-api.js, lib/decision-service.js (30 s bounded cache),
               lib/snapshot-loader.js, lib/decision-loader.js, lib/accounts/*
Provider       lib/providers/{index,contracts,sleeper,espn,espn-normalize,auth,domain}.js, types.d.ts
Sources        lib/sources/* (Sleeper, nflverse stats/schedules/usage/plays, ffopportunity; optional rankings/projections/ownership adapters)
Normalization  lib/normalize/{player-ids,positions,scoring,opportunity}.js
Decision       lib/decision/* (build-context → production, replacement, optimizer, add-drop, calibrated-waivers, team-strength-v2, matchups)
Signals/market lib/signals/engine.js, lib/market/observations.js
History        lib/history/* (contracts, stores, git-store, archive-reader, outcomes); scripts/capture-history.js
Backtest       lib/backtest/*, scripts/backtest.js → artifacts/backtests/v032-results.json
```

Dependency direction is top-down. Decision, signals and presentation code must not import provider transports or read raw provider objects.

## Providers

- **Registry** (`lib/providers/index.js`): `getProvider(id)` / `requestProvider(params)`; default provider is `sleeper`. `lib/decision/build-context.js` requests a provider context instead of importing Sleeper directly.
- **Interface** (`docs/providers.md`): resolveUser, discoverLeagues, getSnapshot/getDecisionContext, league/settings/rosters/matchups/transactions/waiver state/players/standings/draft picks/season state, `getProviderCapabilities`. Unsupported methods return normalized `ProviderError`s (e.g. `UNSUPPORTED_FEATURE`, `AUTH_REQUIRED`), never invented values.
- **SleeperProvider**: live, public, read-only. Builds the established snapshot shape via `lib/sleeper.js` / `lib/sources/sleeper/*` (daily player cache). Supplies Sleeper-specific add-interest through an optional attention hook.
- **ESPNProvider**: live transport **disabled**; public routes return JSON 422 `UNSUPPORTED_FEATURE` (model-meta still describes capabilities). `espn-normalize.js` converts authorized/synthetic league JSON offline; the More → Fantasy providers preview runs in browser memory only (2 MB limit, credential keys rejected, never uploaded or archived). An injected offline provider exercises the shared engine in tests.

## Provider-neutral domain and identity

- The engine consumes the established normalized snapshot/context vocabulary. Legacy Sleeper numeric player IDs and Sleeper-derived scoring coefficient names are retained as opaque compatibility keys, not as permission to reuse Sleeper raw objects.
- `lib/providers/domain.js` projects context into `fantasy-domain-1` (typed in `types.d.ts`): account, league, settings, scoring, roster/slots, player refs/eligibility, matchups, transactions/waivers, FAAB, standings, picks, season, capabilities. This is additive, not a destructive migration.
- Identity: provider → stable `provider_user_id` → season → `league_id` → optional `roster_id`; `user=spectator` assumes no owner. Browser selections are local; public username resolution is not authentication.
- Player identity: provider IDs, canonical IDs, statistical (GSIS) IDs and mapping confidence are separate. `lib/normalize/player-ids.js` joins statistics via the DynastyProcess crosswalk. New ESPN keys are `nfl:<GSIS>` only on an exact one-to-one match, else `unresolved:espn:<id>`. Names never establish identity. Fantasy eligibility (platform-authoritative, multi-position) is separate from football position.

## Decision engine (`decision-0.3.2`, features `weekly-features-2`)

`build-context.js` assembles provider context + nflverse stats/schedules/usage + ffopportunity xFP + precomputed high-value aggregates, applying league scoring (`normalize/scoring.js`, unsupported rules flagged). Components, all specified in `docs/v0.3.2.md`:

- League-scored production and sample-blended quality `Q`; Start Value and football acquisition blends from calibrated weights (`calibration/weights.js`).
- Position opportunity scores (`model-config.js` weights/scales).
- Replacement/VOR with Superflex and FLEX demand; dual eligibility takes best single VOR.
- Legal add/drop: Hungarian lineup optimizer (`optimizer.js`), conservative drop protections, `net = starter Δ + 0.25·bench VOR Δ + 0.10·(VOR_cand − VOR_drop)`.
- Pickup Rating and immediate-upgrade gates (`calibrated-waivers.js`); v0.3.1 heuristic kept for comparison.
- Context only (not in the forecast): adjusted matchup difficulty, team strength v2, weekly matchup.
- Market Value is `null` everywhere.

## Signals and market attention

`lib/signals/engine.js` (`signals-1`) is a pure function over as-of weekly evidence and independent market observations, with fixed conservative thresholds and caps (5/player, 100/feed). UI Signal Feed and `/api/chat/signals` share the same records. Market attention (`market-1`) is Sleeper 24 h trending adds compared with archived windows; absent top-100 entries are unknown, not zero. Reddit/X adapters are disabled. Signals never alter model scores.

## History / archive

- `observation-1` records (full decision evidence, versions, source digests, identity) batched as `capture-1` gzip files plus `archive-index-1`, deterministic IDs, six-hour dedup bucket.
- Durable store: separate `data-archive` git branch, written only by `.github/workflows/capture-history.yml` (every 6 h, manual, or after a successful `Validate` on main) for leagues in `config/installation.json`. Sleeper paths `observations/<season>/<league>`; future non-Sleeper `observations/<provider>/<season>/<league>`.
- Append-only, no deletion, no force-push. Public GET routes only read (`archive-reader.js`, `/api/chat/history`). Browser-selected friend leagues and ESPN previews are never archived. Outcome joins (`outcomes.js`) use strictly post-observation games.

## Assistant APIs

`/api/chat/{leagues,league-summary,waivers,signals,player,matchup,model-meta,history}`, schema `chat-1`, GET-only, compact projections of the same decision/signal outputs (no separate scoring). Public cache `s-maxage=30, stale-while-revalidate=30`; errors `no-store`; strict query validation (400/404/409/422/502). `/api/snapshot` (0.2) and `/api/decision-support` (0.3) remain supported. Optional `provider=` parameter; default Sleeper bodies unchanged.

## Deployment and CI

- `Validate` workflow (`ci.yml`): every push (except `data-archive`) and PR → `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`, Playwright Chromium, `pnpm test:ui`.
- Vercel (free tier) builds from git; `scripts/vercel-ignore.cjs` skips `data-archive` builds. Production follows `main`. Release practice: validate CI on a release branch, then fast-forward `main`, then verify production commit and routes.
- Configuration: `config/installation.json` (installation defaults, not an allowlist) with optional env overrides (`.env.example`). No secrets are required.

## Known limitations and architectural debt

- Snapshot/decision contracts still carry Sleeper-origin vocabulary (numeric player IDs, coefficient names); canonical domain is a parallel projection, not the engine's input.
- `normalize/player-ids.js` and analytics join through `sleeper_id`; ESPN statistical joins depend on external crosswalks.
- Calling individual provider convenience methods can repeat context assembly; only the engine path uses a single context request.
- Full `/api/decision-support` JSON is ~6 MB; chat routes are the preferred compact interface.
- Unsupported: `st_ff`/`st_fum_rec`, DEF/IDP scoring models, banded bonuses; seven unmatched stat identities; red-zone/QB team-play model inputs missing; no rankings/projections/ownership feeds; K/DST/IDP have no acquisition model.
- Add/drop net weights (0.25/0.10) and signal thresholds are transparent policy, not transaction-level calibrated.
- No commissioner locks, deadlines, multi-move transactions, trade generation or notifications.
- Archive covers configured leagues only; not a complete historical waiver universe. Git-branch storage has growth limits documented in `docs/data-sources.md`.
- No private-user authentication or per-tenant storage.

## Future direction (not implemented)

Planned milestones are in `PROJECT_SPEC.md`. Any live ESPN transport, credential flow, market value source or social ingestion must enter behind the provider/source boundary with its own approved design and ADR.
