# 0005 — Local private mode for an ESPN league (saved Flaim bundle)

- Date: 2026-09-27
- Status: accepted (V05-ESPN-04)
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

   Production is unsupported. `pnpm dev:private` binds Next to `127.0.0.1`.
2. **Private configuration outside the repository** (`lib/private/config.js`, `espn-private-1`):
   - It holds the league ID, season, optional team ID, the saved-bundle path, and an `espn-scoring-1` configuration bound to the same league and season.
   - The config and bundle paths must resolve outside the working tree (symlinks resolved).
   - Files are size-limited and credential keys are rejected.
   - It is re-validated whenever the file changes.
   - Error messages never include paths or contents.
3. **Saved Flaim bundle as the only facts source** (`lib/providers/flaim/bundle-file.js`):
   - The bundle is a locally saved set of Flaim tool results, mapped by the existing `espnFactsFromFlaim` with `access: "flaim_saved_bundle"`, `visibility: "private"` and `captured_at`.
   - Snapshots disclose the capture time (`STALE_DATA_RISK`). Stale scoring periods fail NFL-week verification, so current-season statistics stay unloaded.
   - No Flaim network access happens in this phase.
4. **Request-scoped private provider** (`lib/providers/flaim/private-source.js`, the only Flaim-aware composition):
   - It combines the private config, the saved bundle, authorized scoring and the public ID crosswalk from the existing shared cache. If the crosswalk is unavailable, identities stay unresolved.
   - `ESPNProvider` gains async `loadFacts`/`loadCrosswalk` loaders and remains transport-agnostic.
   - It reports `privateLeagueAccess: available`; `publicLeagueAccess` stays unsupported.
5. **Local request guard** (`lib/private/guard.js`):
   - Private data is served only when private mode is on, both the `Host` header and the request URL are loopback, and the request is not a browser cross-site request.
   - Otherwise requests behave exactly as today (ESPN → `UNSUPPORTED_FEATURE`), so the guard never reveals whether private mode exists.
   - The principal is `local-owner`. `user=` is refused for ESPN; the session team or an explicit `roster=` selects the roster.
6. **Routes:**
   - **Snapshot and decision support:** served for the configured league with `Cache-Control: private, no-store`. Errors never echo internals.
   - **Trade:** uses the same private path and still refuses, because the pool is incomplete (ADR 0003).
   - **Chat:** chat and accounts never pass the guard result, so they refuse ESPN; chat also refuses any decision marked private.
   - **Decision cache key:** the key in `decision-service` gains the principal.
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
- Waivers, Pickup Rating, add/drop, replacement levels, VOR and trades stay disabled until a complete pool exists.
