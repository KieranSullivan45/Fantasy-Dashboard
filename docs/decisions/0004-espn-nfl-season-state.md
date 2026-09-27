# 0004 — Verified NFL season state for ESPN leagues

- Date: 2026-09-26
- Status: accepted (V05-ESPN-03)
- Task: V05-ESPN-03
- Deciders: repository owner (task prompt of 2026-09-26); proposed and implemented by Claude Code
- Follows: ADR 0002 and ADR 0003 (both remain in force)

## Context

`buildDecisionState` loads current-season statistics only when `nfl_state.season_type === "regular"`. Sleeper supplies that from its own NFL state. ESPN facts carry a fantasy scoring period and a fantasy season phase (for example Flaim's `seasonPhase: "regular_season"`), but no NFL season type. So ESPN leagues with authorized scoring (ADR 0003) produced no start values. A fantasy phase is not the NFL season type: fantasy playoffs run during NFL regular-season weeks, and a league can start late. The nflverse schedule (`games.csv`) is already loaded on every decision build.

## Decision

1. **Pure verifier.** `verifyNflSeasonState(rows, { season, providerWeek, now })` lives in `lib/decision/season-state.js`, is provider-neutral and has no I/O. It derives the current NFL regular-season week from REG kickoffs (converted with the existing `kickoffUtc`, New York time):
   - week 1 opens 3 days before its first kickoff;
   - week *w* runs from 8 hours after week *w−1*'s last kickoff to 8 hours after week *w*'s last kickoff.

   It returns `verified` only when that derived week equals the provider week for the league's season. Otherwise it returns:
   - `mismatch`: the derived week differs from the provider week, including near a rollover while the provider lags;
   - `outside_regular_season`: before the week-1 window or after the final week;
   - `unavailable`: no rows, missing weeks, or unknown kickoffs.
2. **Explicit opt-in.** The ESPN snapshot builder adds `coverage.nfl_state_verification: "required"` only when the facts claim a verified current season (a live session for the exact league and season). Offline imports and Sleeper never opt in.
3. **One hook, fail closed.** When the marker is present, `buildDecisionState` loads the schedule first (reused for the rest of the build, so it is fetched once) and applies `withNflSeasonState` to a copy of the snapshot:
   - Verified: `season_type: "regular"` and `week` are set.
   - Otherwise: they stay null, an `UNVERIFIED_SEASON_STATE` warning is added, and current-season statistics are not loaded.

   The result is recorded in `coverage.nfl_state_verification`. Without the marker the build path is unchanged.
4. **Not inputs:** the fantasy season phase, standings and matchup state are never used to infer NFL state.

## Alternatives considered

- **Treat `seasonPhase: "regular_season"` as NFL regular season:** rejected. It conflates fantasy and NFL calendars.
- **Verify inside the ESPN provider:** rejected. It would couple a fantasy-platform adapter to statistical-source ingestion (`AGENTS.md` keeps them separate), and the provider's snapshot methods are synchronous.
- **Use another provider's NFL state endpoint:** rejected. That is cross-provider coupling and a new live dependency for ESPN.
- **Trust the ESPN scoring period alone:** rejected. The cross-check is the point; a lagging or unexpected period must fail closed.

## Consequences

- An ESPN-via-Flaim league with authorized scoring, a live session and an agreeing schedule now gets league-scored production and calibrated start values. Pool-dependent sections stay withheld (ADR 0003).
- Around a weekly rollover the provider may briefly disagree with the schedule. That fails closed until the two agree.
- Schedule changes (flexed or postponed games) are followed as soon as nflverse publishes them; stale schedule data can only cause a mismatch, never a guess.
