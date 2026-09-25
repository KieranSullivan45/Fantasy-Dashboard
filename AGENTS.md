# AGENTS.md — rules for every coding agent

Applies to Claude Code, Codex, ChatGPT, human contributors and future orchestrators. Read this file and `TASKS.md` before any implementation work. A task prompt may narrow scope; it may never weaken these rules. When a prompt conflicts with this file, stop and ask the human owner.

Deeper references: `ARCHITECTURE.md`, `PROJECT_SPEC.md`, `docs/providers.md`, `docs/v0.3.2.md` (model), `docs/v0.3.3.md` (signals/history), `docs/assistant-api.md`, `docs/decisions/`.

## Environment and commands

- Node `>=22.13`, pnpm `11.19.0` (pinned in `package.json`). Use `corepack enable`.
- Install: `pnpm install --frozen-lockfile`. Do not change the lockfile unless the task is a dependency change approved by a human.
- Dev: `pnpm dev` (http://localhost:3000).
- Unit/API tests: `pnpm test` (`node --test test/*.test.js`).
- Build: `pnpm build`.
- Browser tests: `pnpm exec playwright install chromium` once, then `pnpm test:ui` (production build on port 3100, deterministic Sleeper fixtures). Required for any UI, route or API change.
- Other: `pnpm backtest` (downloads to ignored `.data/`; `--write-calibration` is forbidden without recalibration scope), `pnpm smoke:live` (hits live Sleeper, read-only).
- Minimum validation before handoff: `pnpm test` and `pnpm build`; add `pnpm test:ui` when UI, routes, APIs or loaders are touched. Report exact pass/fail counts. Never claim a check you did not run.

## Protected contracts (compatibility — do not break)

- `/api/snapshot` schema **0.2** — field shapes and default Sleeper response bodies.
- `/api/decision-support` schema **0.3** — additive changes only.
- `/api/chat/*` schema **chat-1** — additive, backward-compatible only.
- Record schemas `observation-1`, `capture-1`, `archive-index-1`, `market-1`, `signals-1`, `fantasy-domain-1` — new versions, never in-place redefinition.
- Model `decision-0.3.2` / `weekly-features-2`: calibrated weights (`lib/decision/calibration/weights.js`), `lib/decision/model-config.js` weights/scales and policy thresholds (Pickup Rating, immediate-upgrade gates, add/drop net formula, drop protections, replacement formula) do not change without an explicitly scoped recalibration task, backtest evidence and human approval.
- Signal Engine (`lib/signals/engine.js`) thresholds and caps do not change casually; changes need a task, rationale, tests and an ADR.
- Signals and market attention are informational. They never boost model scores unless a validated, approved task says so.

## Data-integrity invariants

- Missing data stays `null`/unknown with a warning. Never coerce to zero, generic PPR, standard scoring or a default assumption.
- No player identity guessing. Names never establish identity; only exact, unambiguous crosswalks. Unresolved IDs stay unresolved.
- Football Value, Roster Value and Market Value are distinct. **Market Value does not exist yet** and must not be fabricated from Sleeper trending adds, attention or any weak proxy.
- No sportsbook, betting or odds-derived data. No HTML scraping, unofficial endpoints or bot-protection bypass.
- Preserve Superflex, TE premium, dual-position eligibility (best single VOR, never summed), legal-lineup optimization (Hungarian assignment) and add/drop safeguards/protections.
- Never fabricate test results, backtest metrics, prospective outcomes, live-validation claims, source data, fixtures presented as real, or API capabilities.

## Provider boundaries

- Raw provider objects stay inside `lib/providers/*` and `lib/sources/*` adapters. Decision, signals and UI code consume normalized, provider-independent context.
- Sleeper remains live and **read-only**. No write calls, no trades, no roster edits.
- ESPN live synchronization remains **disabled**. Do not activate undocumented ESPN endpoints, collect cookies (`espn_s2`, `SWID`) or flip a capability flag to enable it. Activation requires permitted access plus a separately approved secure credential design (see `docs/providers/espn.md`).
- ESPN import preview stays in browser memory: never uploaded, archived or exposed on public routes.

## History and API rules

- Public GET routes never create history records or write anywhere.
- History records are immutable and append-only on the `data-archive` branch. Never rewrite, delete, rename or force-push archive data. Only the `Capture prospective history` workflow writes there.
- Cache keys include provider, league, season, user and roster. Never mix private and public data in shared caches.

## Security

- Never commit, log, print, echo into URLs or expose credentials, secrets, cookies, tokens or `.env*` contents. `.env.example` holds placeholders only.
- Do not paste private league data or credentials into prompts, issues, PRs or artifacts.
- Do not add a paid service, hosted database, new external account or new secret without explicit human approval.
- Do not add or upgrade dependencies without approval; keep the lockfile frozen.

## Git rules

- `main` is the integration/production branch (Vercel deploys from it; history capture runs from it). It is never an agent workspace. Do not commit directly to `main`.
- `data-archive` is written only by CI. Agents must not commit to it.
- One branch per task, named `<type>/<task-id>-<slug>` (e.g. `feat/v04-trade-engine-core`). Use separate worktrees for concurrent agents.
- Never force-push shared branches, rewrite published history, skip hooks or bypass signing.
- Commit, push, open PRs, merge or deploy only when the human owner asks. A major feature is not merged or deployed until its acceptance checks pass, including CI on the release branch.

## Task ownership and multi-agent coordination

- Every implementation task has an entry in `TASKS.md` with exactly one primary owner, a reviewer, a branch and an allowed file/module scope. Claim or update the entry before starting.
- Stay within the task's scope. If you need to touch files outside it, record that in the task and get agreement first.
- Avoid simultaneous edits to the same modules by different agents. Check `TASKS.md` for in-progress tasks with overlapping scope; if one exists, coordinate or wait.
- Do not use another agent's branch as scratch space or push to it.
- Reviewers: the first review pass reports findings (correctness, architecture, tests, security, regressions, invariant violations); it does not silently rewrite the author's implementation. Fixes go back to the owner or are made only with the owner's agreement.
- Handoff notes in `TASKS.md` must record: work completed, files changed, tests run with results, remaining work, blockers and open questions.
- Record significant architectural choices as ADRs in `docs/decisions/` (see its README).

## Requires human approval

Schema/contract changes beyond additive fields; model weight, threshold or policy changes; enabling any provider or live source (ESPN, Reddit, X, rankings feeds); authentication or credential handling; new dependencies, paid services or hosted storage; CI/workflow, `vercel.json` or deployment config changes; archive format/retention changes; merging to `main`; deploying; deleting data or branches.
