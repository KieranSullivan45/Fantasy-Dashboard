# 0005 — Local private mode for an ESPN league (saved Flaim bundle)

- Date: 2026-09-27
- Status: accepted (V05-ESPN-04; revised in the same PR after the Codex review: connection-level loopback proof, fail-closed pool, scoring-cache invalidation, segment-based path checks; second review: input-revision cache keys, content-digest file caching, unified private league-id validation, request-log redaction)
- Task: V05-ESPN-04
- Deciders: repository owner (design approved 2026-09-27); proposed and implemented by Claude Code
- Follows: ADR 0002–0004 (all remain in force)

## Context

The owner wants to use the dashboard with their private ESPN league. ESPN facts come through Flaim (ADR 0002), scoring from a user-authorized configuration (ADR 0003), and NFL state is verified from the schedule (ADR 0004).

The deployed app has several limits:
- no user authentication, hosted storage or writable filesystem on Vercel;
- public CDN caching on `/api/snapshot` and `/api/decision-support`;
- `CORS *` on the chat routes;
- a history workflow that publishes captures to Git.

Flaim OAuth for a custom client needs confirmation from Flaim first (owner decision), so this phase uses no network transport and no OAuth.

## Decision

1. **Local private mode, single user, local machine only.** It is enabled only when all of these hold:
   - `FANTASY_PRIVATE_MODE=local`;
   - `ESPN_PRIVATE_CONFIG` names an absolute path;
   - `VERCEL` is unset.

   - a valid per-process loopback token (`FANTASY_LOOPBACK_TOKEN`) set by the private launcher.

   `pnpm dev:private` (`scripts/dev-private.js`) runs Next through a Node HTTP server that listens on `127.0.0.1` only. It generates a fresh token per launch, and plain `next dev`/`next start` never enable private mode. Production is unsupported.

   Next's dev request log prints full URLs, and a custom server cannot disable it without a project `next.config`. Adding one would be a deployment-config change, so the launcher redacts query strings (which carry league IDs) from its own output instead.
2. **Private configuration outside the repository** (`lib/private/config.js`, `espn-private-1`):
   - It holds the league ID, season, optional team ID, the saved-bundle path, and an `espn-scoring-1` configuration bound to the same league and season.
   - The config and bundle paths must resolve outside the working tree (absolute, symlinks resolved). The check compares path segments, so `..private/` or `.private/` directories inside the repository are inside.
   - Files are size-limited and credential keys are rejected.
   - It is re-validated whenever its content changes. Cache identity is the SHA-256 of the bytes read, never mtime or size; the saved bundle is cached the same way.
   - Error messages never include paths or contents.
3. **Saved Flaim bundle as the only facts source** (`lib/providers/flaim/bundle-file.js`):
   - The bundle is a locally saved set of Flaim tool results, mapped by the existing `espnFactsFromFlaim` with `access: "flaim_saved_bundle"`, `visibility: "private"` and `captured_at`.
   - Snapshots disclose the capture time (`STALE_DATA_RISK`). Stale scoring periods fail NFL-week verification, so current-season statistics stay unloaded.
   - No Flaim network access happens in this phase.
4. **Request-scoped private provider** (`lib/providers/flaim/private-source.js`, the only Flaim-aware composition):
   - It combines the private config, the saved bundle, authorized scoring and the public ID crosswalk from the existing shared cache. If the crosswalk is unavailable, identities stay unresolved.
   - `ESPNProvider` gains async `loadFacts`/`loadCrosswalk` loaders and remains transport-agnostic.
   - It reports `privateLeagueAccess: available`; `publicLeagueAccess` stays unsupported.
   - Scored facts are cached per (facts, scoring-configuration content), so an edited scoring configuration is applied without a bundle change.
   - **Input revision:** the provider exposes `getInputRevision()`, the content digests of the config and the bundle. Computing it re-validates both. The decision and trade routes compute it before any cache lookup and add it to the decision-cache key, so a changed input is rebuilt and an invalid current input is refused instead of served from cache.
5. **Local request guard** (`lib/private/guard.js`, `lib/private/loopback.js`):
   - **Connection proof:** the launcher strips any client-supplied `x-fantasy-private-loopback` header and re-adds it with the token only when the socket's remote address is loopback. The guard requires that proof (constant-time comparison), so headers a remote client can forge are never sufficient.
   - **Defense in depth:** the `Host` header and request URL must be loopback, an `Origin` (when present) must be loopback, and browser cross-site requests are refused.
   - Otherwise requests behave exactly as today (ESPN → `UNSUPPORTED_FEATURE`), so the guard never reveals whether private mode exists.
   - The principal is `local-owner`. `user=` is refused for ESPN; the session team or an explicit `roster=` selects the roster.
6. **Routes:**
   - **Snapshot and decision support:** served for the configured league with `Cache-Control: private, no-store` on every private response, including validation and provider errors. Errors never echo internals.
   - **Trade:** uses the same private path and still refuses, because the pool is incomplete (ADR 0003).
   - **Chat:** chat and accounts never pass the guard result, so they refuse ESPN; chat also refuses any decision marked private.
   - **Decision cache key:** the key in `decision-service` gains the principal and, for private requests, the input revision.
   - **League IDs:** all private routes validate league IDs with one rule (`validPrivateLeagueId`).
7. **Private data boundary:**
   - Decisions built from private facts carry `visibility: "private"`.
   - `captureObservations`/`appendCapture` throw on them, so they never enter shared, immutable history.
   - **Owner's pending transactions:** the owner's own pending items (waiver claims and trade proposals naming exactly the session owner's team) appear only in private-mode snapshots, marked `visibility: "owner_private"`.
   - **Withheld pending items:** everything else stays withheld and counted, including other managers' items, multi-team items and cases with no session owner. `roster=` never unlocks pending items, and they never reach decision output.
8. **Injection point:** `setPrivateEspnProviderFactory` lets tests (and a later, separately approved transport) replace how the private provider is built.

## Alternatives considered

- **Store the league or config in `config/installation.json` or `.env`:** rejected. The installation file is committed and drives history capture, and `.env` cannot hold a structured scoring config cleanly.
- **Store under `.data/`:** rejected. `.data/` hosts the archive worktree in the main checkout.
- **New private routes instead of branching the existing ones:** rejected. It would duplicate the handlers and the loaders. The guard plus capability check keeps one code path.
- **Serve private data to chat for local assistants:** rejected. Chat routes are public by contract (`CORS *`, shared cache).
- **Show all pending transactions:** rejected. Only the owner's own actions are theirs to see.

## Consequences

- The owner can load their league locally through the API routes with real authorized scoring. Dashboard rendering of ESPN needs the UI task (V05-ESPN-07).
- Data freshness depends on recapturing the bundle. Live transport (V05-ESPN-05) and OAuth (V05-ESPN-06, after Flaim confirms permission) are separate, approved tasks.
- Waivers, Pickup Rating, add/drop, replacement levels, VOR and trades stay disabled until a complete pool exists. Pool completeness fails closed: any non-Sleeper snapshot must prove `available_players.complete === true`, and a bundle without available players reports an incomplete, empty pool.
