# 0012 — Sanitized ESPN league file as a local private facts source

- Date: 2026-10-03
- Status: accepted (receiving side only; collector and network behavior are not decided here)
- Task: ESPN-FILE-01
- Deciders: repository owner / PM (design and binding decisions of 2026-10-03); implemented by Claude Code
- Follows: ADR 0002–0006 (all remain in force)

## Context

Local private mode (ADR 0005) can only read a saved Flaim bundle. Flaim exposes no scoring coefficients, owners, FAAB or waiver priority, and its available-player list can never be proven complete. Issue #18 researched alternatives. Then the owner inspected, passively, the responses that ESPN's normal web UI loads, without exporting any authentication material and without making custom or replayed requests. Those responses carry the core league facts as structured JSON: scoring settings, lineup-slot settings, all teams and rosters, exact ESPN player IDs, lineup slot IDs, eligibility, completed matchups and the week mapping. Individual player projections were not established. A broad Players response contained many irrelevant players and is not an authoritative available-player list.

The repository already treats one numeric ESPN vocabulary as verified (`ESPN_SLOTS`, positions, pro teams and the basic scoring statistic table in `lib/providers/espn-normalize.js`). Every other numeric ID stays unverified.

## Decision

1. **A versioned, allow-listed input file: `espn-league-file-1`** (`lib/providers/espn-file/schema.js`).
   - It is an envelope (`schema_version`, `provider`, `binding {league_id, season}`, `captured_at`, `capture {method, tool, tool_version}`, `league`, optional `available`) around a strict subset of ESPN's own raw field names.
   - Every unlisted key is rejected at every level. That covers headers, cookies, URLs, member/owner data, stats, projections, ownership rates, transactions, messages and draft data, so "sanitized" has an enforceable definition.
   - Also rejected:
     - credential-like keys at any depth (the existing `rejectCredentials`);
     - GUID/SWID-shaped strings (this also catches member IDs) and e-mail addresses;
     - `espn_s2=` / `SWID=` / bearer / cookie header text;
     - strings over 128 characters;
     - nesting over 12;
     - files over 2 MB.
   - Bounded counts apply to teams, entries, schedule, scoring items and available players.
   - A `captured_at` more than five minutes in the future is refused.
   - Contradictions fail closed:
     - binding vs league ID/season;
     - league size vs team count;
     - duplicate team IDs;
     - a player twice on a roster or on two rosters;
     - an entry in a slot the league does not have;
     - a starting or IR slot over capacity;
     - a matchup with an unknown team or the same team on both sides;
     - duplicate scoring identifiers.
   - Messages never echo values or paths.
2. **One new mapper: `espnFactsFromLeagueFile`** (`lib/providers/espn-file/espn-map.js`). It maps the file → `espn-facts-1` with `source_transport: "league_file"`, `access: "saved_league_file"`, `visibility: "private"` and `captured_at`.
   - Raw codes are translated only with the existing verified tables; the raw player mapper is shared with `espnFactsFromImport` (`espnRawPlayer`), and its output is unchanged.
   - Unknown slots become `UNSUPPORTED_ESPN_SLOT_<n>` and block legal-lineup evaluation, as before.
   - IR comes from the slot only.
   - Undecided matchups carry no points.
   - `snapshotFromEspnFacts`, `ESPNProvider` and every engine are unchanged apart from two additive generalizations:
     - the absent-pool disclosure applies to any private facts (`visibility: "private"`), not only Flaim facts;
     - a saved league file always requests the existing NFL week verification (ADR 0004).

     Flaim and raw-import snapshots were confirmed byte-identical to `main`.
3. **Scoring authority stays the user-authorized configuration (ADR 0003).**
   - File facts always carry `scoring.available: false`. The file's scoring items are returned beside the facts and used only by `crossCheckEspnScoring` (`lib/providers/espn-file/scoring-check.js`).
   - The check compares only the 20 internal rules that both the verified table and the authorized translation produce exactly. An absent rule counts as 0 on either side. Base points are always compared, and a positional override that differs from its base points counts as a mismatch, because the authorized configuration cannot express positional premiums.
   - Verdicts:
     - `consistent` / `not_comparable` / `unavailable`: the configuration is applied as today, with a provenance warning.
     - `mismatch`: the configuration is not applied, so scoring is unavailable and scoring-dependent analysis refuses. Rosters still load.
   - The verdict is tied to the exact facts object it was computed for, and scoring is resolved from that object, so a file replaced mid-request can never have its scoring applied on another file's verdict.
   - Unverified identifiers are counted, never mapped. File scoring is never promoted to a source, and no ESPN default is ever assumed.
4. **Roster selection is explicit.** A league file carries no owner data, so `user_team_id` is null and `identity.mode` is `spectator` unless the request passes `roster=` (`selected_roster`). The private config's `team_id` is validated against the file's teams and selects nothing. The Flaim source keeps its session-resolved owner.
5. **Available players are an observed subset.**
   - Optional `available.coverage` must be `observed_subset`.
   - Every entry needs a league-scoped `FREEAGENT` or `WAIVERS` status, so a broad player list cannot pass as availability.
   - No field can claim completeness; facts `available.complete` is always `false`.
   - Without the section, the snapshot reports an incomplete empty pool.
   - Replacement levels, VOR, need/surplus, add/drop, Pickup Rating and trades stay withheld (`availablePoolComplete` unchanged).
6. **Private configuration stays `espn-private-1`, extended additively.**
   - `facts_source.kind` accepts `espn_league_file` beside `flaim_bundle_file`.
   - `scoring` is optional for the league-file kind only; without it, scoring is unavailable.
   - Existing Flaim configurations validate byte-for-byte as before.
   - `lib/providers/flaim/private-source.js` remains the single private composition point: it dispatches on the kind and runs the cross-check. The input revision is `config:<digest>;league_file:<digest>`, so the existing decision cache rebuilds on any byte change and refuses invalid inputs.
7. **Local import command.** `pnpm espn:import <file> [--config <path>]` (`scripts/espn-file-import.js`):
   - It validates the file against the private configuration (binding, team, cross-check).
   - Only on success does it install the exact validated bytes at the configured path, outside the repository: a temporary file is written and flushed, the current file is kept as `.prev`, then the temporary file is renamed into place.
   - It prints a redacted summary (counts, verdicts, warning codes); refusals print only normalized messages.
   - An invalid file never replaces the installed one.
   - The server never falls back to an older file.
8. **Unchanged boundaries.** Loopback guard, `private, no-store`, chat refusal, history-capture refusal, public ESPN refusal and Vercel exclusion all apply exactly as in ADR 0005. The new modules contain no network code.

## Alternatives considered

- **Reuse `espnFactsFromImport` for private files:** rejected. It is the browser preview's tolerant contract. It reads a member GUID, treats file scoring as the scoring source and treats every schedule total as a score; changing its trust semantics would change the preview.
- **Extend the Flaim saved-bundle loader:** rejected. That would put two vocabularies (Flaim labels and raw ESPN codes) behind one reader, which ADR 0002 avoided.
- **Make `espn-facts-1` the file format:** rejected. It is internal and translated; the collector would then have to interpret numeric IDs.
- **Promote file scoring when it agrees:** rejected for v1 by PM decision; promotion would be a later, evidence-backed task.
- **Treat the configured `team_id` as a standing roster selection:** rejected for v1 by PM decision; it would change the identity invariant.
- **A browser upload route:** rejected for v1. It adds a write endpoint to a read-only local server for little gain over a local command.
- **Bump the private config to `espn-private-2`:** not needed; the change is additive.

## Consequences

- With a sanitized file and the existing authorized transcription, local private mode serves rosters, slots, eligibility, records, current matchups, league-scored start values and legal lineups, all without manual roster or score entry. Waivers, Pickup Rating, add/drop, replacement levels and trades stay withheld.
- Transactions, acquisition metadata, waiver settings and FAAB are not accepted in v1; they need `espn-league-file-2`.
- **Not decided here (each needs separate approval):**
  - the collector that produces the file (browser companion, extension, automation);
  - the "unofficial endpoint" policy question it raises;
  - any ESPN request, credential handling or OAuth;
  - dashboard rendering (V05-ESPN-07);
  - file-sourced scoring;
  - a standing roster selection;
  - any pool-completeness certificate.
- Revisit when a collector is approved, when the verified identifier table is extended with recorded cross-check evidence, or when a complete-pool source exists.
