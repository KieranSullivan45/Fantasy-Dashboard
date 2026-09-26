# 0003 — User-authorized ESPN scoring configuration

- Date: 2026-09-26
- Status: accepted for the scoring framework (V05-ESPN-02). Production configuration delivery, live transport and UI management are not approved by this ADR.
- Task: V05-ESPN-02
- Deciders: repository owner (task prompt of 2026-09-26); proposed and implemented by Claude Code
- Follows: ADR 0002 (ESPN facts via Flaim), which stays in force

## Context

Flaim supplies ESPN league facts but not scoring coefficients (ADR 0002). Scoring-dependent engines therefore refuse ESPN-via-Flaim leagues. A league member can read the league's rules on ESPN's League Info scoring screen and supply them explicitly. Those rules may be unusual; the owner's league, for example, gives +4 for 35–45 and for 46+ points allowed. They must be used exactly, never "corrected" to ESPN defaults.

Scoring is only one prerequisite. The available pool from Flaim remains a capped subset, and replacement levels use the best available players (`lib/decision/replacement.js`: 70% best-three-available mean). VOR, need/surplus, add/drop, Pickup Rating and trade depth all depend on that pool.

## Decision

1. **Scoring is a separate, authorized source.** `lib/providers/espn-scoring.js` defines `espn-scoring-1`: `provider: "espn"`, `league_id`, `season`, `schema_version` and `scoring_source: "user_authorized"`, plus `offense`, `kicking` (flat rules plus `field_goals_made` distance bands) and `team_defense` (flat rules plus `points_allowed` bands).
   - The config must attest `unlisted_rules_score_zero: true`, meaning every rule on the screen was transcribed and unlisted rules score 0 (ESPN shows only non-zero rules).
   - Nine core offensive rules must be declared explicitly (a declared 0 is allowed).
   - Unknown keys, malformed or overlapping bands, non-finite values and credential-like keys fail closed with `INVALID_SCORING_CONFIG`.
2. **Bound and never borrowed.** `applyAuthorizedEspnScoring(facts, config)` applies a config to ESPN facts only when provider, league and season match exactly (else `SCORING_CONFIG_MISMATCH`). It never overrides provider-supplied scoring (`SCORING_CONFIG_CONFLICT`). It leaves transport provenance untouched: a scored Flaim league reports `source_transport: "flaim"` and `scoring_source: "user_authorized"` with `scoring_binding` as separate facts. The Flaim mapper stays scoring-agnostic; transport-supplied scoring items are still ignored.
3. **Exact mapping or explicit unsupported.** Rules map only onto the existing internal vocabulary of `lib/normalize/scoring.js`:
   - **Passing, rushing and receiving** (yards, TDs, receptions/PPR, interceptions, two-point conversions), fumbles lost and fumble-recovery TDs map exactly.
   - **Kickoff and punt return TDs** share the existing `st_td` rule (special-teams TDs, as for Sleeper), and only when their coefficients are equal.
   - **Field-goal bands** map to the nflverse 0–19/20–29/30–39/40–49/50–59/60+ statistics only when every distance inside a statistical band scores the same. Otherwise that band is unsupported and kicker totals are partial.
   - **Offensive-player interception, fumble or blocked-kick return TDs, two-point returns and one-point safeties** have no verified per-player statistic. They are listed as unsupported, and affected totals are supported-rule partial (the existing `st_ff` convention).
   - **All team D/ST rules and points-allowed bands** are validated and preserved exactly, but are unsupported for scoring: there is no team-defense statistics source, and D/ST stays outside Football Value as before.
4. **Availability reflects coverage.** `coverage.scoring_available` becomes true only after validation, binding and an exact mapping of every required offensive rule; a config existing is not enough. `coverage.scoring_status` (`complete` or `partial`) and `unsupported_scoring` disclose the rest. With no config, ESPN-via-Flaim keeps `UNSUPPORTED_FEATURE`.
5. **Engines are gated on their own prerequisites.**
   - **Decision support** (start values, legal lineups) needs scoring, roster, schedule and statistics. It is enabled when scoring is available.
   - **When a snapshot reports an incomplete available subset** (`coverage.available_players.complete === false`), `buildDecisionState` withholds everything pool-dependent. Replacement levels (`coverage: "unsupported"`), VOR, need/surplus, add/drop and Pickup Rating are all set to null. `waivers.status` is `unsupported`, no weights are redistributed, and decision coverage lists `withheld`. Rule-derived slot demand is kept. Nothing is estimated from rostered players.
   - **Trade Analyzer** refuses with `UNSUPPORTED_FEATURE`: its depth, VOR and forced-drop logic need replacement levels.
   - **Capabilities** report `decisionSupport`, `pickupRating` and `tradeAnalysis` separately.
   - Sleeper and the authorized raw import are unaffected (no incomplete-subset marker).
6. **Delivery boundary.** `createEspnScoringResolver(configs)` resolves the single config for a `(provider, league, season)` binding, or returns null. `ESPNProvider` accepts `scoringConfig` or `resolveScoringConfig`. The module is server-only; `espn-normalize.js`, which the browser preview imports, never imports it. League-specific configurations are supplied at runtime and are not committed; tests use a synthetic config bound to a synthetic league.

## Alternatives considered

- **Infer coefficients** from season points, matchup totals, projections or ESPN-wide averages: rejected. That is fitting, not evidence.
- **Assume ESPN default scoring** for unlisted rules: rejected. The attested transcription is the only source, and unlisted means 0.
- **"Correct" unusual values:** rejected. Authorized values are preserved exactly.
- **Enable all ESPN engines once scoring exists:** rejected. Pool-dependent sections would silently use a popularity-ordered, capped subset as the replacement pool.
- **Estimate replacement from rostered players only:** rejected. The demand cutoff falls into the unknown pool, and the existing formula would clamp to the worst rostered player, which is a hidden bias.
- **Store the owner's config in the repository:** rejected. It is private league configuration, and it would bind code to one league.

## Consequences

- With an authorized config, ESPN-via-Flaim leagues can receive league-scored production, start values and legal lineups. Waiver rankings, Pickup Rating, add/drop and trades remain unavailable until a verifiably complete pool exists. Add interest, waiver priority and FAAB remain unavailable regardless.
- `nfl_state.season_type` is null for ESPN facts, so the engine loads current-season statistics only once an NFL season-state source verifies the current regular-season week. That needs a separate task; the fantasy "regular season" phase must not be conflated with the NFL season type.
- Config delivery (server config, secure storage, UI management), live transport and route enablement each need their own approval.
- Revisit this ADR when a team-defense statistics source, per-player return statistics or a complete-pool source becomes available.
