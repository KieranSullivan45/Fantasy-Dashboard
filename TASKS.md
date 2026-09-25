# TASKS.md — shared task ledger

Coordination rules: `AGENTS.md` → *Task ownership and multi-agent coordination*. In short:

- The repository owner or designated orchestrator assigns/confirms owner, reviewer, branch and scope before implementation starts; this ledger then records the authoritative assignment.
- This file is not a real-time lock across worktrees. Do not self-assign overlapping work; ask first.
- Scopes of `in-progress`, `in-review` and `blocked` tasks stay reserved until explicitly released.
- Edit only your own task's entry. Ledger updates for your task are always in scope.
- Placeholders for approved roadmap milestones are allowed (status `proposed`, planning-only scope). Do not add speculative implementation tasks.

Status values: `proposed` · `ready` · `in-progress` · `in-review` · `blocked` · `done` · `cancelled`.

## Template

```
### <TASK-ID> — <title>
- Status:
- Owner:                 (one agent or person, assigned/confirmed by owner or orchestrator)
- Reviewer:              (different from owner)
- Branch:
- Dependencies:
- Allowed scope:         (files/modules the owner may change; TASKS.md entry implied)
- Acceptance criteria:
- Handoff notes:         (completed work, files changed, tests run + results or why none, remaining work, open questions)
- Blockers:
```

## Active tasks

### AGENT-SETUP — Shared multi-agent documentation
- Status: in-review
- Owner: Claude Code
- Reviewer: Codex (independent review), then repository owner (human)
- Branch: `chore/agent-workflow-setup` (pushed; PR #1 open)
- Dependencies: none
- Allowed scope: `AGENTS.md`, `ARCHITECTURE.md`, `PROJECT_SPEC.md`, `TASKS.md`, `docs/decisions/README.md`. No application code, tests, dependencies, workflows, config, `README.md`, `.gitignore` or `package.json`.
- Acceptance criteria: the five documents are concise, accurate against the repository at v0.3.4, preserve every invariant in `AGENTS.md`, and do not duplicate one another; no other files changed.
- Handoff notes: initial drafts committed (`0f838cf`) and pushed; PR #1 opened. Revision pass addressing the Codex review, with every finding verified against the code: Pickup Rating add-interest vs informational attention; archive mutability (rolling index, refreshed aggregates); actual Sleeper code locations; per-provider `idColumn` joins; concrete model safeguards; compatibility/UI-state guards; cache/GET wording; claim policy; v0.4 planning constraints; dated measurements. The unsourced "~6 MB" payload figure was removed. No tests or build run: documentation only, no executable behavior changed. Revision committed (`5595d6d`) and pushed to PR #1; Codex's second review returned PASS. Known stale metadata (README, `package.json` version, `.gitignore`) deliberately left for a separate task.
- Blockers: repository-owner approval and merge of PR #1.

### V04-PLANNING — v0.4 Trade Engine planning (roadmap placeholder)
- Status: proposed
- Owner: unassigned
- Reviewer: unassigned
- Branch: not created
- Dependencies: AGENT-SETUP
- Allowed scope: planning documents only (spec/ADR drafts) until a human approves implementation tasks.
- Acceptance criteria: to be defined by the repository owner; must honor `PROJECT_SPEC.md` → *v0.4 planning constraints*.
- Handoff notes: —
- Blockers: scope not yet defined.
