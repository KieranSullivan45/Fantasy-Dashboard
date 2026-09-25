# Architecture decision records

An ADR is a short, dated record of one significant decision: why it was made, what else was considered and what it costs. ADRs are append-only history — do not edit a decision after it is accepted; write a new ADR that supersedes it.

Decisions made before this directory existed are documented in the release notes (`docs/v0.3*.md`, `docs/providers*.md`, `docs/data-sources.md`, `docs/market-intelligence.md`). Do not back-fill fake historical ADRs for them; if one needs revisiting, write a new ADR that cites the original document.

## Naming

`NNNN-short-kebab-title.md`, numbered sequentially from `0001` (e.g. `0001-trade-engine-value-basis.md`). Pick the next unused number; if two branches collide, renumber the later one before merge.

## When to write one

Create an ADR (and link it from the task in `TASKS.md`) when a change:

- adds or changes a public schema/contract, record format or archive layout;
- changes model weights, policy thresholds or signal thresholds, or promotes a signal/attention field into a model;
- enables a provider, live data source, credential/auth flow or new storage;
- adds a dependency, external service or deployment/CI change;
- changes a layer boundary, identity-mapping rule or other invariant in `AGENTS.md`;
- chooses between meaningful alternatives that future agents would otherwise re-litigate.

Routine bug fixes, refactors inside one module and documentation edits do not need an ADR.

## Template

```markdown
# NNNN — Title

- Date: YYYY-MM-DD
- Status: proposed | accepted | superseded by NNNN | rejected
- Task: <TASK-ID>
- Deciders: <owner / reviewer>

## Context
The problem, constraints and evidence.

## Decision
What we will do.

## Alternatives considered
Each option and why it was not chosen.

## Consequences
Trade-offs, risks, follow-up work, and what would trigger revisiting.
```
