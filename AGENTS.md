# AGENTS.md — rules for every coding agent

Applies to Claude Code, Codex, ChatGPT, human contributors and future orchestrators. Read this file and `TASKS.md` before any implementation work. A task prompt may narrow scope; it may never weaken these rules. When a prompt conflicts with this file, stop and ask the human owner.

This file holds mandatory rules only. Current implementation facts: `ARCHITECTURE.md`. Product intent and roadmap: `PROJECT_SPEC.md`. Coordination state: `TASKS.md`. Detail: `docs/v0.3.2.md` (model), `docs/v0.3.3.md` (signals/history), `docs/data-sources.md`, `docs/providers.md`, `docs/assistant-api.md`, `docs/decisions/`.

## Environment and commands

- Node `>=22.13`, pnpm `11.19.0` (pinned in `package.json`). Use `corepack enable`.
- Install: `pnpm install --frozen-lockfile`. Do not change the lockfile unless the task is a dependency change approved by a human.
- Dev: `pnpm dev` (http://localhost:3000).
- Unit/API tests: `pnpm test` (`node --test test/*.test.js`).
- Build: `pnpm build`.
- Browser tests: `pnpm exec playwright install chromium` once, then `pnpm test:ui` (production build on port 3100, deterministic Sleeper fixtures).
- Other: `pnpm backtest` (downloads to ignored `.data/`; `--write-calibration` is forbidden without recalibration scope), `pnpm smoke:live` (hits live Sleeper, read-only).
- Validation before handoff: `pnpm test` and `pnpm build` for any executable change; add `pnpm test:ui` when UI, routes, APIs or loaders are touched. Report exact pass/fail counts. Documentation-only changes may skip these when no executable behavior changed; the handoff must say so explicitly. Never claim a check you did not run.

## Protected contracts (compatibility — do not break)

Everything below stays additive and backward-compatible unless a separately approved migration says otherwise.

- `/api/snapshot` schema **0.2** — field shapes, default Sleeper response bodies, and `compact` behavior (compact by default; `compact=0` returns the full snapshot).
- `/api/decision-support` schema **0.3** and `/api/chat/*` schema **chat-1**.
- Record schemas `observation-1`, `capture-1`, `archive-index-1`, `market-1`, `signals-1`, `outcome-1`, `high-value-1`, `fantasy-domain-1` — changes need a new version, never an in-place redefinition.
- Identity semantics: `user=spectator` means no owned roster; a roster is "mine" only through a resolved owner or an explicit `roster=` selection (`selected_roster` mode). Never infer ownership.
- UI consistency guards: decision data is shown only when its `basis` matches the current snapshot (`lib/decision/basis.js`). Snapshot and decision loaders discard stale responses (generation counter + abort). Keep both.

## Football model safeguards

Model `decision-0.3.2` / `weekly-features-2` is specified in `docs/v0.3.2.md`; do not duplicate or reinterpret it here. Calibrated weights (`lib/decision/calibration/weights.js`) and `lib/decision/model-config.js` weights, scales and policy thresholds (Pickup Rating, immediate-upgrade gates, add/drop net formula, drop protections, replacement formula) change only under an explicitly scoped task with backtest evidence and human approval. In all work:

- Use only evidence available as of the evaluated week; no future-data leakage. Do not tune against the held-out evaluation seasons without explicit recalibration scope.
- Missing evidence stays missing. Do not invent zero-game appearances (see `docs/v0.3.md`, `docs/data-sources.md`). Do not redistribute missing Pickup Rating weights; the calibrated implementation does not.
- Lineups: optimize legal slot filling first, then value; one player occupies one slot; dual-position players get one assignment and their best single VOR, never summed.
- Ambiguous scoring premiums (e.g. reception premiums) stay unknown, not guessed. Unsupported scoring rules are flagged, not approximated.
- Keep existing drop protections, including unknown-value, injured/reserve, unestablished-asset and Superflex-QB protections (`lib/decision/add-drop.js`).
- Do not assume IR/taxi capacity, reserve eligibility or platform transaction locks/deadlines that are not verified from provider data.
- Matchup, efficiency and team-strength evidence is context only; it gets no new direct scoring weight without an approved validation.

## Signals and market attention

- Sleeper available-player add-interest percentile is an **existing calibrated 5% Pickup Rating component**. It stays exactly as implemented unless approved recalibration changes it. It does not license any other attention-derived scoring.
- Everything else in the Signal Engine (`lib/signals/engine.js`, `signals-1`) and market-attention layer (`lib/market/observations.js`, `market-1`) is informational and must not feed model scores unless a validated, approved task says so.
- Signal thresholds and caps change only with a task, rationale, tests and an ADR.
- Model recalibration, policy validation and signal-policy changes are distinct activities with separate scopes; approval for one is not approval for another.

## Data-integrity invariants

- Missing data stays `null`/unknown with a warning. Never coerce to zero, generic PPR, standard scoring or a default assumption.
- No player identity guessing. Names never establish identity; only exact, unambiguous crosswalks. Unresolved IDs stay explicitly unresolved.
- Football Value, Roster Value and Market Value are distinct. **Market Value does not exist yet** and stays `null`. Sleeper trending adds, attention or buzz are not Market Value and must not be converted into it (including for trades).
- No sportsbook, betting or odds-derived data. No HTML scraping, unofficial endpoints or bot-protection bypass.
- Preserve Superflex, TE premium, dual-position eligibility, Hungarian legal-lineup optimization and add/drop safeguards.
- Never fabricate test results, backtest metrics, prospective outcomes, live-validation claims, source data, fixtures presented as real, or API capabilities.

## Provider boundaries

- Core decision logic must stay provider-independent: it consumes normalized provider/domain context (via `lib/providers/index.js`), not raw fantasy-platform responses. New provider-specific parsing goes in provider adapters, not in decision, signals or UI code. (Existing Sleeper code also lives in `lib/sleeper.js`, `lib/accounts/sleeper.js` and `lib/derive.js`; see `ARCHITECTURE.md`.)
- Statistical-source ingestion (`lib/sources/*`) is separate from fantasy-platform normalization.
- Sleeper remains live and **read-only**. Provider write calls (trades, roster edits, waiver claims) require explicit human approval and a separately approved design.
- ESPN live synchronization remains **disabled**. Do not activate undocumented ESPN endpoints, collect cookies (`espn_s2`, `SWID`) or flip a capability flag to enable it. Activation requires permitted access plus a separately approved secure credential design (`docs/providers/espn.md`).
- ESPN import preview stays in browser memory: never uploaded, archived or exposed on public routes.

## History, cache and GET rules

- Public GET routes must not create persistent domain/history mutations or recommendation records. Ordinary in-memory caching is allowed.
- Immutable records (`observation-1` inside `capture-1` files) are never overwritten, deleted or renamed. Published Git history on `data-archive` is never rewritten or force-pushed.
- Rolling indexes (`archive-index-1` newest-1000 index, 14-day market comparison index) and derived aggregates (e.g. `high-value-1`) may be refreshed or replaced, but only by approved workflows. Only the `Capture prospective history` workflow writes to `data-archive`.
- Personalized decision caches must key on enough identity (provider, league, season, user, roster) to prevent cross-context contamination. Shared public-source caches (e.g. player lists, nflverse data) may use broader keys when that is logically correct. Never place private data in a shared cache.

## Security

- Never commit, log, print, echo into URLs or expose credentials, secrets, cookies, tokens or `.env*` contents. `.env.example` holds placeholders only.
- Do not paste private league data or credentials into prompts, issues, PRs or artifacts.
- No paid service, hosted database, new external account, new secret or dependency change without explicit human approval; keep the lockfile frozen.

## Git rules

- `main` is the integration/production branch (Vercel deploys from it; history capture runs from it). It is never an agent workspace. Do not commit directly to `main`.
- `data-archive` is written only by CI. Agents must not commit to it.
- One branch per task, named `<type>/<task-id>-<slug>` (e.g. `feat/v04-trade-engine-core`). Use separate worktrees for concurrent agents.
- Never force-push shared branches, rewrite published history, skip hooks or bypass signing.
- Commit, push, open PRs, merge or deploy only when the human owner asks. A major feature is not merged or deployed until its acceptance checks pass, including CI on the release branch.

## Task ownership and multi-agent coordination

`TASKS.md` is a coordination record, not a real-time lock: separate worktrees cannot see each other's uncommitted edits. Therefore:

- The repository owner (or a designated orchestrator) assigns or confirms each task's owner, reviewer, branch and allowed scope **before** implementation begins. Once coordinated, the `TASKS.md` entry is authoritative.
- A task's scope stays reserved while it is `in-progress`, `in-review` or `blocked`, unless explicitly released. Do not start overlapping work; ask the owner/orchestrator instead.
- Never overwrite another active task's ownership or status. Updating your own task's ledger entry is always allowed, even though `TASKS.md` sits outside your feature scope.
- Stay within your task's scope. To touch other files, record it in the task and get agreement first. Do not use another agent's branch as scratch space or push to it.
- Reviewer and implementer are different agents/people for the first review pass. That pass reports findings (correctness, architecture, tests, security, regressions, invariant violations); it does not silently rewrite the implementation. Fixes go back to the owner or are made only with the owner's agreement.
- Handoff notes in `TASKS.md` record: work completed, files changed, tests run with results (or why none were needed), remaining work, blockers and open questions.
- Record significant architectural choices as ADRs in `docs/decisions/` (see its README).

## Requires human approval

Schema/contract changes beyond additive fields; model weight, threshold or policy changes; signal threshold changes; enabling any provider, provider write or live source (ESPN, Reddit, X, rankings feeds); authentication or credential handling; new dependencies, paid services or hosted storage; CI/workflow, `vercel.json` or deployment config changes; archive format/retention changes; merging to `main`; deploying; deleting data or branches.
