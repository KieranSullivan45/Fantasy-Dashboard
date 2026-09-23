# Fantasy Command Center

## v0.3.1 football judgment

Adds multi-position eligibility, lineup-aware replacement value, separate pickup categories, sourced usage history and league-scored expected opportunity. Player cards show concise role trends with deeper evidence on demand. Early-season safeguards keep two-game samples from becoming strong role claims. See [v0.3.1 sources, contracts, weights and limitations](docs/v0.3.1.md).

## v0.3 weekly decision support

Adds actual weekly matchups, league-specific historical production, schedules, position-specific points allowed, and explainable waiver candidates evaluated across the full eligible pool. Rankings, projections and ownership remain optional/unavailable. The original `/api/snapshot` schema stays **0.2**; new metrics use `/api/decision-support` schema **0.3**.

See [v0.3 contracts, sources, scoring limitations and model details](docs/v0.3.md). In particular, historical PPG is labeled partial when special-teams rules cannot be supported; it is never silently replaced with generic PPR.

A read-only Sleeper dashboard built for the two configured fantasy-football leagues. It gives a human dashboard plus a compact JSON endpoint that can be used as the current league source for ChatGPT analysis.

## Configured account

- Sleeper username: `Ksullz`
- League: `1401373864818192384`
- League: `1395493939665989632`

These are defaults in `lib/config.js`. They can be overridden with environment variables.

## What v0.2 does

- Resolves the configured Sleeper account.
- Loads each league's settings, users and every roster.
- Identifies your own roster automatically.
- Maps Sleeper player IDs to player names.
- Filters current fantasy assets and subtracts all roster holdings, including IR/taxi.
- Shows standings, ordered starter slots, separate bench/IR/taxi sections, available players and recent transactions.
- Preserves draft picks, FAAB transfers, zero-dollar waiver bids and pending transaction status.
- Prevents stale requests from overwriting the selected league or a newer refresh.
- Pulls current-week matchups into the API snapshot.
- Includes Sleeper's 24-hour trending adds when those players are actually available in the league.
- Exposes `/api/snapshot?league=<league_id>&compact=1` as a versioned compact endpoint, with explicit coverage, truncation and partial-data warnings.

## Why there is no database yet

Sleeper is already the source of truth. For the first version, adding a database would add complexity without improving the core workflow. Next.js caching keeps the large player-ID map from being requested more than once per day, consistent with Sleeper's API guidance.

A database can be added later for historical snapshots, custom rankings, notes, trade history and analytics.

## Run locally

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Then open `http://localhost:3000`.

Use Node.js 22.13 or newer and pnpm 11.19.0 (pinned in `package.json`). The committed lockfile pins dependencies. `pnpm-workspace.yaml` records the pinned Next.js packages accepted by pnpm's release-age policy during installation.

## Snapshot contract (schema 0.2)

`compact=1` (the default) returns `view: "compact"` and `schema_version: "0.2"`. `compact=0` returns the detailed dashboard view. `league=all` returns a versioned `leagues` array. Consumers of the v0.1 compact response must migrate to the fields below or request `compact=0`.

- `league`: format/rules in raw Sleeper `settings`, complete `scoring_settings`, ordered `roster_positions`, season/type and identifiers. Roster limits and the league FAAB budget remain available here.
- `my_roster_id`: identifies your roster without duplicating it; null when no owned/co-owned roster is found.
- `players`: one dictionary keyed by player ID, retaining name, position/eligibility, team, injury/status and Sleeper search rank. IDs stay strings. Unresolved identities retain their IDs and produce a warning.
- `rosters`: every team, with raw roster settings, waiver priority and FAAB used (null means unavailable; zero is preserved). `starters` is an ordered list of `{slot, player_id}` with null IDs for empty slots. `bench`, `ir`, and `taxi` contain player IDs. No roster is truncated. No remaining-FAAB figure is inferred from incomplete transfer history.
- `free_agents`: positional lists of player IDs and 24-hour trending counts; 35 per position in compact mode, 100 in full mode. Ranking uses Sleeper search rank, then trending adds, then player ID; this is not a projection or recommendation score.
- `standings`, `recent_transactions`, `current_matchups`: preserve records/points, transaction assets/status, and matchup IDs, player/start order, scores and commissioner overrides. Transaction picks retain original roster, previous owner and new owner; FAAB transfers retain sender, receiver and amount. `matchup_week` identifies the requested week.
- `coverage`: the current and previous transaction weeks, included statuses (complete/pending), trending upstream limit (100), daily player-cache interval, and waiver-policy identifier. This is recent activity, not full league history or a complete future-pick inventory.
- `truncation`: total, returned, omitted and limit for each waiver position, recent transactions (40), and trending available (25). Totals describe the fetched coverage after filtering/deduplication; they do not claim unseen history. UI lists show 20 free agents and 12 transactions; the snapshot includes the documented larger limits.
- `partial` and `warnings`: failures of trending, weekly transactions or matchups are visible rather than silently reported as empty activity. Missing metadata and season mismatches also warn. Essential league/roster/player failures return HTTP 502. An older league does not receive current-season matchup/transaction claims.

The full view retains expanded player objects, `my_roster`, `all_players`, and `reserve` (the compact name is `ir`). Both views include the same coverage/warning semantics. `generated_at` is assembly time, not proof every upstream record changed then; Sleeper responses are cached independently.

## Waiver eligibility

The default pool covers QB/RB/WR/TE/K and current NFL defenses. Explicit retired/deceased records are excluded. Players with a current NFL team remain eligible when active or when injury/reserve/suspension metadata explains inactivity. IR, PUP, out, questionable and doubtful are not exclusion reasons. An `NA` injury marker does not revive an otherwise inactive historical record. Teamless players require an explicit active flag and current trending-add evidence; unknown-team historical records are excluded. Every roster's players, starters, IR and taxi are subtracted using normalized IDs.

This policy relies on Sleeper's team/status metadata and its daily player cache; it cannot independently certify an inaccurate upstream record. Injured players already on a roster are always retained in that roster regardless of waiver eligibility. Currently only the six listed position groups are supported, not IDP leagues.

## Validation

```bash
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:ui
```

Browser tests run against the production build on port 3100 with deterministic Sleeper fixtures. They cover league switching, stale errors, roster sections, empty slots, transaction assets, pending status and partial-data warnings. To use an installed Chrome locally, set `PLAYWRIGHT_CHANNEL=chrome`. CI runs the unit/API suite, build and browser checks on pull requests and pushes. Tests never mutate Sleeper data.

## Deploy free on Vercel

1. Put this folder in a GitHub repository.
2. Sign in to Vercel and choose **Add New → Project**.
3. Import the repository.
4. Leave the framework detection as **Next.js**.
5. Deploy.

No Sleeper API key is required. No paid database is required.

Optional environment variables:

```text
SLEEPER_USERNAME=Ksullz
SLEEPER_LEAGUE_IDS=1401373864818192384,1395493939665989632
```

## After deployment

Your dashboard will be at your Vercel URL. The useful analysis URL will be:

```text
https://YOUR-PROJECT.vercel.app/api/snapshot?league=1401373864818192384&compact=1
```

and likewise for the second league.

When that URL is public, ChatGPT can use it as a live source whenever you ask for roster, waiver or trade analysis.

## Next planned additions

1. League-name labels in the selector immediately after first load.
2. A trade-partner matrix based on roster construction and positional depth.
3. A waiver comparison view that highlights available players versus your weakest bench assets.
4. Historical snapshots for "what changed since yesterday/last week?"
5. Optional custom player notes / convictions from this fantasy project.
