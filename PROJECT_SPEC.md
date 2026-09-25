# Fantasy Command Center — product specification

## Vision

A transparent, evidence-first assistant for fantasy football managers: one place to understand a league, make weekly start/sit and waiver decisions, and (later) evaluate trades and season strategy — with every recommendation explained, every missing input disclosed, and no fabricated certainty. It serves both a human dashboard and compact machine-readable routes for AI assistants.

## Core principles

- **Football Value, Roster Value and Market Value are distinct.** Football Value is what a player produces under league scoring; Roster Value is what the player is worth to a specific roster's legal lineup and depth; Market Value is what other managers would pay. They are never merged or substituted for one another.
- **Market Value does not exist yet.** It is `null` until a permitted, validated source exists. Sleeper trending adds and other attention data are informational only.
- Unknown stays unknown: missing data is null with a warning, never zero or a generic assumption.
- Calibrated models change only through explicit, validated recalibration.
- Read-only, free, and privacy-preserving: no writes to fantasy platforms, no paid services, no scraping, no betting data.

## Supported use cases (today)

- Look up any public Sleeper account by username, discover its NFL leagues by season, or open any league in spectator mode.
- View standings, rosters (starters/bench/IR/taxi), weekly matchup, recent transactions and the available player pool.
- Get weekly start value, legal add/drop recommendations, Pickup Ratings and immediate-upgrade flags for a selected roster.
- Review player usage trends, expected opportunity (xFP), schedule difficulty and evidence-backed signals.
- Query the same analysis through `/api/chat/*` from ChatGPT, Claude or other assistants.
- Inspect archived prospective recommendations for configured leagues.
- Preview an authorized ESPN league export offline (browser memory only).

## Current capabilities (v0.3.4)

- Sleeper: live, read-only, any public account/league/season; Superflex, TE premium, dual eligibility, IR/taxi.
- Decision engine `decision-0.3.2`: backtested Start Value and acquisition blends, replacement/VOR, Hungarian legal-lineup optimizer, conservative add/drop protections, Pickup Rating.
- Signal Engine `signals-1` with conservative role/usage/schedule/attention flags.
- Prospective history: immutable captures on the `data-archive` branch every six hours.
- Provider boundary with a provider-neutral domain projection; ESPN offline normalizer and disabled live adapter.
- Responsive dashboard (home, lineup, waivers, players, signals, league, more).

## Current limitations

- **Live ESPN synchronization is disabled** pending permitted access and an approved secure credential design. ESPN previews do not produce acquisition advice.
- No Market Value, trade engine, rankings/projection consensus feed, ownership data, news/injury intelligence or notifications.
- Unsupported scoring rules (e.g. `st_ff`, `st_fum_rec`, DEF/IDP models, banded bonuses) are flagged, not approximated.
- Add/drop policy weights and signal thresholds are transparent heuristics, not prospectively calibrated.
- No commissioner lock/deadline handling or multi-move transactions; no private-user authentication.
- History covers configured installation leagues only.

## Roadmap

Each milestone requires its own scoped tasks in `TASKS.md`, acceptance criteria and passing validation before merge. Scope below is intent, not commitment.

| Version | Theme | Intent |
|---|---|---|
| v0.4 | Trade Engine | Trade evaluation on Football Value and Roster Value (lineup-aware, Superflex/TEP-aware). Market Value remains null unless a permitted source is approved. |
| v0.5 | News + Injury Intelligence | Permitted, sourced injury/news status with provenance; no scraping. |
| v0.6 | Rankings / Projection Consensus | Wire the existing `robustConsensus` contract to permitted feeds with redistribution rights. |
| v0.7 | Alerts + Automation | Deliver existing alert candidates; no platform write actions without explicit approval. |
| v0.8 | ROS + Playoff Strategy | Rest-of-season and playoff-schedule planning. |
| v0.9 | Calibration / Learning | Use accumulated prospective observations to evaluate and recalibrate policies and signals. |
| v1.0 | Fantasy Command Center | Integrated, validated multi-provider experience. |
