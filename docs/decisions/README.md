# Architecture decision records

This file describes the ADR process only; rules live in `AGENTS.md`.

An ADR is a short, dated record of one significant decision: why it was made, what else was considered and what it costs. ADRs are append-only history — do not edit a decision after it is accepted; write a new ADR that supersedes it.

Decisions made before this directory existed are documented in the release notes (`docs/v0.3*.md`, `docs/providers*.md`, `docs/data-sources.md`, `docs/market-intelligence.md`). Do not back-fill fake historical ADRs for them; if one needs revisiting, write a new ADR that cites the original document.

## Naming

`NNNN-short-kebab-title.md`, numbered sequentially from `0001` (e.g. `0001-trade-engine-value-basis.md`). Pick the next unused number; if two branches collide, renumber the later one before merge.

## When to write one

Create an ADR (and link it from the task in `TASKS.md`) when a change:

- adds or changes a public schema/contract, record format, archive layout, or which archive artifacts are immutable vs. rolling/refreshed;
- recalibrates model weights, changes a policy threshold, or changes signal thresholds (record each as its own decision: these are distinct activities);
- promotes a signal or attention field into a model, or changes the existing Pickup Rating add-interest component;
- enables a provider, live data source, credential/auth flow or new storage;
- adds a dependency, external service or deployment/CI change;
- changes an intended module boundary, identity-mapping rule or other invariant in `AGENTS.md`;
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
