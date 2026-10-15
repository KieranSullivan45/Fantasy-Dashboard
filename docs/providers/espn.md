# ESPN access and limited implementation

Research checked 2026-09-24. No supported third-party ESPN fantasy API or OAuth integration contract was found in current official public documentation. This is not a claim that every private partner API has been ruled out.

## Evidence and decision

- [ESPN public viewing](https://support.espn.com/hc/en-us/articles/360000991871-Making-a-Private-League-Viewable-to-the-Public) describes public league viewing; it does not grant automated API permission.
- [League types](https://support.espn.com/hc/en-us/articles/360000069832-League-Types-in-ESPN-Fantasy) and [league ID](https://support.espn.com/hc/en-us/articles/360045861791-League-ID) describe league access/context.
- [Disney Terms](https://disneytermsofuse.com/english/), section 2.B.x, restrict automated extraction without written permission. We did not activate undocumented requests, scraping or cookie collection.
- Primary open-source implementation [espn-api](https://github.com/cwendt94/espn-api), especially requests/espn_requests.py and football/constant.py, demonstrates undocumented web requests and scoring/slot vocabulary. It is technical evidence, not ESPN authorization or an official stable contract.

That implementation uses espn_s2 and SWID cookies for private access, web view/filter parameters, and different historical routing before 2018. We did not verify a supported cookie lifetime, API rate limit, account league-discovery flow, token refresh or password-free delegated OAuth flow. No live ESPN request was made. Server-side Vercel reachability and private production access are unverified.

## Implemented

A pure normalizer and injectable offline provider accept authorized league JSON. More → Fantasy providers → ESPN offers a browser-memory preview with a 2 MB file limit. It makes no upload, persistent browser write, archive capture or public assistant exposure. Leave More or remove the preview to discard it. Authentication-bearing keys are rejected; imported raw errors are not displayed. Users must not include credentials or data they are not authorized to use.

Synthetic fixtures exercise standard/half/full reception scoring, custom passing and negative coefficients, OP, bench/IR, dual eligibility, unresolved IDs, unknown slots and malformed scoring. League season is input data (2010–2100), not a fixed year. Current NFL season is deliberately unverified for an offline file.

Supported coefficients: passing attempts/completions/incompletions/yards/TD/two-point/interceptions; rushing attempts/yards/TD/two-point; receptions/receiving yards/TD/two-point; fumbles/lost; basic field goal/extra-point made/missed. Downstream statistical coverage warnings still apply. Banded bonuses, positional overrides/TEP, unknown stat IDs and unverified aliases remain unsupported. No missing settings imply standard scoring.

Slots translate QB/RB/WR/TE, flex variants, OP→SUPER_FLEX, K/DEF, IDP, bench and IR. Unknown slots block legal-lineup evaluation. Multi-position eligibility remains separate from default football position. Exact one-to-one provider/GSIS mappings are required for canonical identity; no name guessing.

Single-week matchups require an explicit scheduleSettings.matchupPeriods mapping. Multiweek/unmapped totals are not claimed as weekly points. Standings, priority and FAAB are nullable source fields. No complete player pool, transactions, pick holdings, add interest, taxi, ownership feed or live historical access is implemented. Offline previews do not produce acquisition advice from an incomplete pool.

## ESPN facts via Flaim (offline mapping; ADR 0002)

Flaim (an MCP service holding the user's ESPN session on its side) was verified read-only on 2026-09-26. `lib/providers/flaim/espn-map.js` maps its tool payloads into the internal `espn-facts-1` contract. Authorized imports map into the same contract, and one builder produces snapshot 0.2 with `provider: "espn"` and `coverage.source_transport: "flaim"`.

- Player slots are translated labels. Only the nine observed labels map (QB, RB, WR, TE, FLEX, K, D/ST, Bench, IR); anything else is an unsupported slot that blocks lineup and decision evaluation.
- IR comes from the slot, never from injury status.
- Eligibility keeps QB/RB/WR/TE/K/DEF. Flex groupings and "Rookie" are ignored, and unverified IDP labels are ignored with a warning.
- The transport exposes no scoring coefficients, owners, waiver priority or FAAB. Without an authorized scoring configuration, scoring-dependent analysis is refused with `UNSUPPORTED_FEATURE`.
- An authorized scoring configuration (ADR 0003) transcribes the League Info scoring screen for one league and season, and custom values are kept exactly. It enables league-scored production, start values and legal lineups. It never enables Pickup Rating, add/drop, replacement levels or trades, which need a complete available pool. Team D/ST scoring and a few rare per-player rules stay unsupported.
- **Local private mode (ADR 0005)** serves one configured league from live Flaim (ADR 0013), a saved Flaim bundle or a sanitized league file (ADR 0012). It works only on loopback requests with `private, no-store`, never on chat routes or in history capture. The owner's own pending transactions are visible there only.
- NFL season state is verified, never inferred from the fantasy season phase (ADR 0004). The engine derives the current NFL regular-season week from nflverse schedule kickoffs and loads current-season statistics only when that week equals the ESPN scoring period. Mismatches, off-season dates and missing schedules leave the state unknown.
- Available players are a capped subset (never a complete pool) with free-agent/waiver state and waiver clear time. ESPN-wide rostered and started rates are discarded.
- Undecided matchup totals are withheld.
- Transactions are a bounded, possibly truncated window. The manager's pending claims and proposals are private and withheld from the snapshot. FAAB bids stay unknown. A pending claim or proposal is never trusted on the provider's status alone: it is shown to the owner (private mode) only when no later record resolves or may resolve it, using provider ids, timestamps, team ids and ESPN player ids (ADR 0006). Anything unprovable is hidden.
- Historical weekly rosters keep membership and slots only; their stats and rates are current-time values.
- Negative D/ST ids and unmapped ids stay unresolved.

Tests use synthetic fixtures only. Live Flaim exists for local private mode only (below, ADR 0013); hosted or production OAuth is not approved.

## Live ESPN via Flaim (local private mode; ADR 0013)

The dashboard can load the configured ESPN league live and read-only through Flaim. Fantasy Dashboard authenticates to Flaim only, using Flaim's published OAuth: dynamic public-client registration, Authorization Code + PKCE S256, a `http://127.0.0.1:<port>/oauth/callback` loopback redirect, 1-hour access tokens and rotating refresh tokens. It never receives, stores or sends ESPN credentials and makes no request to any ESPN host.

**One-time setup**

1. Connect your ESPN league to Flaim at flaim.app with Flaim's own Chrome extension flow. Nothing ESPN-related is entered into Fantasy Dashboard.
2. In your private config (outside the repository) set `"facts_source": { "kind": "flaim_live", "auth_path": "flaim-auth.json" }`. `auth_path` is absolute or relative to the config file and must be outside the repository. Keep `league_id`, `season`, the optional `team_id` and your `espn-scoring-1` configuration as before.
3. Run `pnpm --silent flaim:connect --config /absolute/path/espn-private.json` (`--silent`, because plain `pnpm` echoes the path). Approve Fantasy Dashboard in the browser tab it opens, or paste the printed URL, which carries only OAuth protocol parameters. The command saves the tokens to `auth_path` (owner-only permissions, atomic write) and verifies the league through Flaim, printing counts only.

**Normal use**: run `pnpm dev:private` with `FANTASY_PRIVATE_MODE=local` and `ESPN_PRIVATE_CONFIG` set, then open http://127.0.0.1:3000. The League picker offers "My ESPN league · ESPN (live via Flaim)" first and selects it. The header shows "Live via Flaim" with the last refresh time. No export, upload, DevTools or cookie step is involved.

**Refresh**: opening the dashboard loads current facts, which are reused in memory for 2 minutes. Refresh reloads through Flaim (10-second cooldown), and the visible-only automatic refresh reloads when due. Nothing is persisted, archived or placed in a shared cache.

**Reconnect**: access tokens refresh automatically, and each rotated refresh token is written atomically before the new access token is used. If Flaim rejects the stored authorization (revoked, a year without use, or a missing auth file), the dashboard shows `AUTH_REQUIRED` with the reconnect command: re-run `flaim:connect`.

**Data**: the authenticated session must list the configured league and season exactly, or the load fails. Every team's current roster is required. Standings, matchups, available players (up to 100 per position, never a complete pool) and recent transactions are optional; when Flaim cannot supply one it shows as unavailable with a warning. Your team comes only from the exact Flaim session entry for this league and season; without one the view is spectator (or `roster=`). Scoring still comes only from the authorized configuration. The saved-bundle and league-file sources remain as fallbacks.

## Sanitized ESPN league file (local private mode; ADR 0012)

`espn-league-file-1` is a versioned envelope around a strict allow-list of ESPN's own raw field names (binding, capture time, league settings, teams, rosters, schedule, optional observed available players). `lib/providers/espn-file/` validates and maps it to `espn-facts-1` with `source_transport: "league_file"`. Local private mode reads it when the private config's `facts_source.kind` is `espn_league_file`; `pnpm --silent espn:import <file> [--config <path>]` validates a file and only then installs it at that path. Use `--silent`: plain `pnpm espn:import` (and `pnpm -s` in pnpm 11) echo the command line, file paths included, before the script runs; the script itself prints no paths.

- Unknown keys anywhere, credential-like keys, GUID/SWID-shaped values anywhere inside a string, e-mail addresses, cookie or bearer text, over-long strings, deep nesting, files over 2 MB, future capture times and contradictory league data are refused without echoing values.
- Scoring stays with the authorized configuration (ADR 0003). File scoring items are corroboration only, cross-checked on the 20 rules both vocabularies map exactly. An omitted item has unknown meaning and is never read as zero: when the file has a scoring section, all 20 rules must be explicitly present and equal, or scoring is disabled (`incomplete`, or `mismatch`, which includes a positional override that differs from its base points). A file with no scoring section is not cross-checked, and the configuration applies with a provenance note. The verdict is bound to the facts it was computed for. Unverified identifiers are never mapped.
- No owner data is accepted: the roster is chosen with `roster=`; the configured `team_id` is validated only.
- Available players, when present, are an observed subset with a league free-agent/waiver status; never complete, so the pool gates stay closed.
- Transactions, acquisition metadata, waiver settings and FAAB are not accepted in v1. No collector exists, and no ESPN request is made.

## Private access and activation

No account password, cookie form, secret environment variable or hosted credential store is enabled; the only live authentication is the local-private Flaim OAuth above (ADR 0013). The disabled credential interface and normalized AUTH_REQUIRED/AUTH_EXPIRED/PRIVATE_LEAGUE/RATE_LIMITED errors establish a boundary only. No cookie values are returned/logged or included in URLs/bundles.

First required action for live access is provider permission or a supported authorized integration, not pasting cookies into chat. Only after access is permitted should a separately approved server-only credential implementation be activated: minimum scoped material, authenticated user isolation, no public/private cache mixing, redacted errors, rotation/removal, and documented expiration. Environment/local configuration may suit a single-user local deployment, but is not sufficient tenant isolation for a shared production app. No new hosted service is needed for this limited release.
