# 0013 — Live Flaim transport for local private ESPN mode

- Date: 2026-10-15
- Status: accepted (local private mode only; hosted, multi-user or Vercel private ESPN access is not decided here)
- Task: ESPN-LIVE-01
- Deciders: repository owner / PM (task contract and Phase 0 gate of 2026-10-15); implemented by Claude Code
- Follows: ADR 0002–0006 and 0012 (all remain in force)

## Context

Local private mode (ADR 0005) could only read saved data: a captured Flaim bundle or a sanitized league file (ADR 0012). Each refresh needed a manual export, which blocked normal use. Flaim publishes an OAuth/MCP contract for custom connectors: authorization-server metadata, a registration endpoint, OAuth 2.1 with PKCE S256, loopback redirects on the `/oauth/callback` path, 1-hour access tokens with rotating refresh tokens, and one MCP endpoint (`https://api.flaim.app/mcp`).

A Phase 0 proof on the owner's machine (2026-10-15) ran a plain Node client, separate from Claude's own connector, through that contract. It passed 14/14 checks: discovery, dynamic public-client registration, a 127.0.0.1 callback, Authorization Code + PKCE S256 with no client secret, token exchange, refresh with rotation, MCP `initialize` and `tools/list`, `get_user_session` with an exact match on the configured league, season and team, `get_league_info`, and revocation. Flaim returned no MCP session id and answered over `text/event-stream`.

## Decision

1. **Local private mode only.** Live Flaim is a third `espn-private-1` facts source, `facts_source: { kind: "flaim_live", auth_path }`. Every ADR 0005 condition still applies: `FANTASY_PRIVATE_MODE=local`, the loopback-only `pnpm dev:private` server with its connection proof, never Vercel, and guarded requests only. Public routes, chat, accounts, history capture and shared caches never see it.
2. **ESPN stays the provider identity; Flaim is transport and provenance.** Facts go through the existing schema checks and `espnFactsFromFlaim(..., { access: "flaim_live" })`. They carry `provider: "espn"`, `source_transport: "flaim"`, `private_live: true` and an additive `fetched_at`. No `flaim` provider exists.
3. **OAuth is with Flaim only, as a public client.** `pnpm --silent flaim:connect --config <path>` works as follows:
   - It discovers metadata. Endpoints must be HTTPS on Flaim's origin and advertise S256 and registration.
   - It registers a client with `token_endpoint_auth_method: "none"` and a `http://127.0.0.1:<ephemeral>/oauth/callback` redirect. A returned client secret is refused.
   - It generates a 256-bit verifier and state, opens or prints the authorization URL, and accepts only the callback whose state matches (constant-time comparison).
   - It exchanges the code and then verifies by loading the league once.

   Fantasy Dashboard never receives, stores or sends ESPN credentials, and makes no ESPN request.
4. **Auth material lives outside the repository.** `flaim-auth-1` holds the client id, Flaim's token endpoint and the current tokens. It is checked to be absolute and outside the repository (through real existing ancestors), not a link, bounded in size and written atomically (temp file with mode 0600, fsync, rename). An additive, non-secret `authorization_generation` (128-bit random hex) is created by every `flaim:connect` and kept across token rotations, so a reconnect (possibly another Flaim account) is distinguishable from a rotation. Files written before the field existed read as generation `legacy`; the next connect writes a fresh one, so no reconnect is needed for existing files. It is never logged or printed, never in errors, cache keys or responses, and never in browser storage.
5. **Refresh.** The server-only client refreshes an access token within 60 seconds of expiry and retries a 401 once after refreshing. Refreshes are serialized per canonical auth-file path across every client in the process (a process-global map whose entry is removed when the grant settles; never keyed by a token), so a second client created after a config change joins the grant in flight instead of spending the rotating refresh token twice. Each grant starts from the file on disk and uses a newer valid token there instead of refreshing again. The lock key is the file's OS-native real path, so filename-case aliases of one file on a case-insensitive filesystem (Windows) share a lock while distinct files elsewhere stay distinct. When a grant returns, the stored authorization is re-read: if a reconnect replaced it meanwhile (different client id or authorization generation), the rotated tokens are discarded, the newer authorization is left untouched and the load fails (`AUTH_FAILED`, not retried). The rotated refresh token is persisted before the new access token is used. A rejected grant becomes `AUTH_REQUIRED` with the reconnect command.
6. **Bounded MCP client.** Calls are Streamable HTTP POSTs with JSON or SSE parsing and no session state. Only these read-only tools can be called: `get_user_session`, `get_league_info`, `get_roster`, `get_standings`, `get_matchups`, `get_free_agents` and `get_transactions`. `refresh_leagues` and any generic tool route are excluded, and nothing is reachable from the browser. Errors are normalized to fixed messages: `AUTH_REQUIRED`, `AUTH_FAILED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` and `UNSUPPORTED_FEATURE`.
7. **Core resources fail closed; optional resources degrade.** A load fails when:
   - the session does not list the configured league and season exactly once;
   - the league info names another league or season;
   - any team's current roster is missing or answers for another team;
   - the configured `team_id` differs from the session team;
   - the combined data contradicts itself.

   Standings, matchups, available players and recent transactions are optional. Each is fetched and structurally validated (the existing schema checks, per free-agent page) inside its own boundary: when one fails or is malformed, it is absent with a warning and never fabricated. A well-formed optional resource that contradicts the core league state (for example an available player who is rostered, or a matchup naming a team outside the league) still fails the whole load.
8. **Identity.** "My roster" comes only from the exact authenticated session entry for provider ESPN, the configured league and season, and Flaim's team id, as `espnFactsFromFlaim` already does. Without that entry the view is spectator or uses `roster=`.
9. **Scoring is unchanged.** The user-authorized `espn-scoring-1` configuration (ADR 0003) remains the only scoring source. Flaim scoring items stay unused. A live config may omit scoring, in which case scoring is unavailable.
10. **The available pool stays incomplete.** Up to 100 players per position (QB, RB, WR, TE, K, D/ST) are fetched, their union is `complete: false`, and every pool gate (replacement levels, VOR, Pickup Rating, add/drop, ESPN trades) stays closed.
11. **Refresh behavior.** Facts are cached in process memory for 2 minutes per (config revision, auth file, authorization generation) and never persisted; a reconnect therefore never reuses the previous authorization's facts, and facts loaded while the authorization was replaced are discarded. Each committed live fact set carries an input revision, `espn-live:` + SHA-256 over (config revision, auth file, generation, facts digest), in `provenance.input_revision` and so in the snapshot's `coverage.input_revision`. The decision basis, decision cache and refresh response (`input_revision`, `previous_input_revision`) use that same value, so refreshed live evidence (eligibility, available players, matchups, …) invalidates older decisions through the existing basis mechanism. The revision contains no token, auth-file bytes or payload content. `POST /api/refresh` gains a guarded private path: a manual reload after a 10-second cooldown, or a `due` reload past the TTL, answered `private, no-store` with no history or recommendation write.
12. **Dashboard.** `GET /api/private-league` returns the configured league binding to a guarded request. Every other request gets the same `available: false`, so public mode reveals nothing. The dashboard offers that league first, addresses it by `provider=espn` (never `user=`), keeps it out of `localStorage`, and shows "Live via Flaim" with the last fetch time. There is no redesign.
13. **The file importer remains.** `flaim_bundle_file` and `espn_league_file` stay supported as fallback, debugging and offline-test sources. Provider-independent decision logic is unchanged.

## Alternatives considered

- **A `flaim` provider identity.** Rejected: Flaim is transport; ESPN facts and invariants stay one provider (ADR 0002).
- **Tokens in environment variables or the private config.** Rejected: rotation needs atomic rewrites, and `rejectCredentials` keeps credential material out of configs.
- **A new OAuth or MCP dependency.** Rejected: Node 22 built-ins (`fetch`, `crypto`, `http`) cover the verified contract.
- **A second polling loop.** Rejected: the existing visible-only auto-refresh and `POST /api/refresh` are reused.

## Consequences

- One-time setup is the Flaim extension connection, the config entry and `flaim:connect`. After that, `pnpm dev:private` loads the league with no file workflow.
- A refresh token lost in a crash between Flaim's rotation and the local write requires a reconnect. The window is small because the write happens immediately.
- Each load makes one Flaim call per resource (session, league info, one roster per team, standings, matchups, 6 available-player lists, transactions), bounded by the cache and the cooldown.
- Hosted or multi-user private ESPN, token revocation on disconnect, and complete-pool proofs remain separate decisions.
