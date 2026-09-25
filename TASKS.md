# TASKS.md — shared task ledger

Rules: see `AGENTS.md` → *Task ownership and multi-agent coordination*. Add a task before starting implementation. One primary owner per task. Do not add speculative tasks; add tasks when they are actually scoped.

Status values: `proposed` · `ready` · `in-progress` · `in-review` · `blocked` · `done` · `cancelled`.

## Template

```
### <TASK-ID> — <title>
- Status:
- Owner:                 (one agent or person)
- Reviewer:
- Branch:
- Dependencies:
- Allowed scope:         (files/modules the owner may change)
- Acceptance criteria:
- Handoff notes:         (completed work, files changed, tests run + results, remaining work, open questions)
- Blockers:
```

## Active tasks

### AGENT-SETUP — Shared multi-agent documentation
- Status: in-review
- Owner: Claude Code
- Reviewer: repository owner (human)
- Branch: `chore/agent-workflow-setup`
- Dependencies: none
- Allowed scope: `AGENTS.md`, `ARCHITECTURE.md`, `PROJECT_SPEC.md`, `TASKS.md`, `docs/decisions/README.md` (new files only). No application code, tests, dependencies, workflows or config.
- Acceptance criteria: five documents exist, are concise, consistent with the repository at `dcd11d7` (v0.3.4), and preserve all invariants listed in `AGENTS.md`; no other files changed.
- Handoff notes: documents drafted and cross-checked against `docs/`, `lib/`, `package.json`, workflows and config. No tests run (documentation only). Not committed or pushed. Stale release metadata noted in the handoff report (README, `package.json` version) was deliberately left unfixed.
- Blockers: human review and approval to commit.

### V04-PLANNING — v0.4 Trade Engine planning (placeholder)
- Status: proposed
- Owner: unassigned
- Reviewer: unassigned
- Branch: not created
- Dependencies: AGENT-SETUP
- Allowed scope: planning documents only (spec/ADR drafts) until a human approves implementation tasks.
- Acceptance criteria: to be defined by the repository owner.
- Handoff notes: —
- Blockers: scope not yet defined.
