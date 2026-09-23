# Fantasy Command Center

A read-only Sleeper dashboard built for the two configured fantasy-football leagues. It gives a human dashboard plus a compact JSON endpoint that can be used as the current league source for ChatGPT analysis.

## Configured account

- Sleeper username: `Ksullz`
- League: `1401373864818192384`
- League: `1395493939665989632`

These are defaults in `lib/config.js`. They can be overridden with environment variables.

## What v0.1 does

- Resolves the configured Sleeper account.
- Loads each league's settings, users and every roster.
- Identifies your own roster automatically.
- Maps Sleeper player IDs to player names.
- Calculates the actual free-agent pool by subtracting every rostered player from the Sleeper player database.
- Shows standings, starters, bench/IR, available players and recent transactions.
- Pulls current-week matchups into the API snapshot.
- Includes Sleeper's 24-hour trending adds when those players are actually available in the league.
- Exposes `/api/snapshot?league=<league_id>&compact=1` as a read-only machine-readable endpoint.

## Why there is no database yet

Sleeper is already the source of truth. For the first version, adding a database would add complexity without improving the core workflow. Next.js caching keeps the large player-ID map from being requested more than once per day, consistent with Sleeper's API guidance.

A database can be added later for historical snapshots, custom rankings, notes, trade history and analytics.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

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
