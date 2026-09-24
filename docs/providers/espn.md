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

## Private access and activation

No account password, cookie form, secret environment variable, hosted credential store or live authentication transport is enabled. The disabled credential interface and normalized AUTH_REQUIRED/AUTH_EXPIRED/PRIVATE_LEAGUE/RATE_LIMITED errors establish a boundary only. No cookie values are returned/logged or included in URLs/bundles.

First required action for live access is provider permission or a supported authorized integration, not pasting cookies into chat. Only after access is permitted should a separately approved server-only credential implementation be activated: minimum scoped material, authenticated user isolation, no public/private cache mixing, redacted errors, rotation/removal, and documented expiration. Environment/local configuration may suit a single-user local deployment, but is not sufficient tenant isolation for a shared production app. No new hosted service is needed for this limited release.
