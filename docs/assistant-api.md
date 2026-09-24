# Read-only assistant API

Base: `https://fantasy-dashboard-zeta.vercel.app`. Pure JSON, no browser rendering or authentication required for public league data. Schema `chat-1`; existing `/api/snapshot` **0.2** and `/api/decision-support` **0.3** remain supported. All routes are GET-only; no trades or writes.

| Route | Purpose |
| --- | --- |
| `/api/chat/leagues?username=NAME&season=YEAR` | Resolve stable provider user ID and discover public NFL leagues. `user=ID` works after a username changes; `league=ID` opens spectator discovery. |
| `/api/chat/league-summary?league=ID&user=USER_ID` | Identity/scoring, team strength summary, pool and signal coverage. |
| `/api/chat/waivers?league=ID&user=USER_ID&limit=10` | Pickup components, evidence, legal drop, starter/depth/net delta, VOR, opportunity, attention and warnings. |
| `/api/chat/signals?league=ID&user=USER_ID&limit=15` | Same records/evidence as Signal Feed; optional exact `type`. |
| `/api/chat/player?league=ID&user=USER_ID&player=PLAYER_ID` | Compact available context and four recent usage/high-value games. |
| `/api/chat/matchup?league=ID&user=USER_ID` | Actual weekly opponent/lineups; unavailable projections remain null. |
| `/api/chat/model-meta` | Calibrated versions/weights, policy and signal thresholds without loading a league. |
| `/api/chat/history?league=ID&user=USER_ID` | Durable capture metadata, paths, timestamps, versions and actual archive status. |

Common envelope: schema/model/feature/signal version, generated_at, season, week, data_through_week, league and scoring context, warnings/evidence. Values that do not apply to discovery/model metadata are explicitly null. League results include implementation revision and selected identity/roster. `user=spectator` means no assumed owner; `roster=N` explicitly selects a league roster. Foreign leagues default to spectator; installation leagues retain configured defaults for backward compatibility. `season=YEAR` validates league identity. Weekly decision routes reject a requested week other than the current decision week; use archived evidence for historical recommendations.

Pagination: limit 1–30 (default15), offset0–1000. Waivers page the returned recommendation list, **not** the entire scored pool; total/evaluated/returned-pool limit are distinct. Signals are capped at5/player and100/feed. Player route returns404 when the player is outside returned contexts rather than pretending a full-pool lookup occurred. Error JSON uses400 for invalid queries,404 for missing context/resource,409 for unavailable historical-week queries and502 for source/build failures. Unknown query fields are rejected. Error responses use no-store.

Example shell request:

```sh
curl --fail --compressed 'https://fantasy-dashboard-zeta.vercel.app/api/chat/leagues?username=YOUR_USERNAME&season=2027'
curl --fail --compressed 'https://fantasy-dashboard-zeta.vercel.app/api/chat/signals?league=YOUR_LEAGUE_ID&user=spectator&limit=10'
```

Cache: public s-maxage30/stale-while-revalidate30, no cookies or credentials, JSON content type, nosniff and read-only CORS. Cache/service keys include league, stable user, selected roster and season. Data-source caches have their own documented ages; generated_at does not mean every source is equally fresh. Inspect source digests, through-week, coverage and warnings before drawing conclusions.

To retrieve an indexed capture, use the returned path under `https://raw.githubusercontent.com/KieranSullivan45/Fantasy-Dashboard/data-archive/data/`; gzip-decode the capture. This is explicit bulk evidence, not automatically embedded into small chat responses. The SHA256 field hashes canonical observation JSON; source hashes separately identify downloaded source bytes. No giant historical dataset is served by default.

No bot protection is bypassed. Normal HTTP access is validated after deployment; any machine-specific access limitation should be reported separately from API correctness. Public account resolution is not authentication and grants no roster editing rights.
