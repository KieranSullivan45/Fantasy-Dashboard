# 0010 — Controlled betting/odds-derived predictive inputs

- Date: 2026-10-02
- Status: proposed
- Task: POLICY-BETTING-01
- Deciders: repository owner / ChatGPT PM

## Context

`AGENTS.md` previously imposed a blanket rule: "No sportsbook, betting or odds-derived data." That rule is broader than the owner's intended product policy and conflicts with the project's evidence-first objective.

The project is for fantasy-football forecasting and decision support, not wagering. Betting/odds-derived information can contain predictive signal that may improve fantasy forecasts. The owner has explicitly authorized researching and evaluating such information when it is useful for fantasy-football prediction.

Separately, the current production decision model consumes ffopportunity v1.0.0 xFP. The M4/xFP provenance work recorded in PR #17 established that those saved models use betting-derived predictors. This ADR does not change xFP, model weights, or production behavior; it corrects the governing policy so future work can evaluate predictive value directly instead of being blocked by a categorical prohibition.

## Decision

Betting/odds-derived information is permitted as a research candidate and may be evaluated as an input to fantasy-football forecasting and decision support.

It is **not** automatically approved for production merely because it exists or appears predictive. Before a new betting/odds-derived input, feature, model, or changed weight can materially affect production recommendations, a separately scoped task must evaluate, as applicable:

- predictive accuracy against realised fantasy outcomes;
- incremental value versus relevant non-betting and frozen-production baselines;
- robustness and stability across appropriate seasons/cohorts/formats;
- future-leakage and as-of-time correctness;
- source provenance, permitted usage, and reliable data availability;
- operational dependence and failure/missingness behaviour;
- decision-level impact where the change affects lineup, waiver, trade, or other recommendations.

Any production model/policy/weight change still requires explicit owner approval and the existing model-governance evidence gates.

This policy does **not** authorize sportsbook or wagering functionality, bet recommendations, bet placement, gambling-product integrations, or automatic production weight changes.

Existing prohibitions on HTML scraping, unofficial endpoints, bot-protection bypass, credential misuse, provider writes without approval, player-identity guessing, future leakage, and fabricated/missing evidence remain unchanged.

## Scope

This ADR changes the repository-level eligibility policy for predictive research. It does not:

- change production code or model weights;
- add an odds or sportsbook data source;
- change Football Value, Roster Value, or Market Value semantics;
- authorize any provider write;
- change protected schemas;
- approve a particular betting-derived feature for production;
- remove or replace the current xFP dependency.

## Relationship to Evaluation Protocol v1

`docs/evaluation-protocol-v1.md` is a registered historical protocol and is not amended by this ADR. Its D4 statement that betting/odds-derived data stays excluded remains part of Protocol v1 and continues to govern claims made under that protocol.

Future confirmatory work that needs betting/odds-derived candidates must use a separately approved protocol version/specification rather than silently treating Protocol v1 as changed. Exploratory or decision-support research may proceed under an explicitly scoped task, but it must not be mislabeled as Protocol-v1 confirmatory evidence.

## Current xFP

The current production xFP dependency is unchanged by this decision. The correct next question is empirical: how well the current production forecast predicts realised fantasy scoring, and whether alternative or additional inputs improve that performance under fair as-of evaluation.

The xFP provenance question is considered settled; repeated provenance investigation is not required unless the upstream model/version changes.

## Alternatives considered

- **Keep the blanket prohibition.** Rejected because it blocks potentially useful predictive evidence without testing decision value and conflicts with the owner's explicit direction.
- **Automatically allow any odds-derived feature into production.** Rejected because source availability, leakage, robustness, and incremental predictive value must be demonstrated before changing user-facing recommendations.
- **Rewrite Evaluation Protocol v1.** Rejected because v1 is registered history. Future protocol-governed work should create a new version rather than retroactively changing the rules.
- **Remove all governance around betting-derived inputs.** Rejected. The useful distinction is research eligibility versus production promotion, not unrestricted ingestion.

## Consequences

- Future agents must no longer treat betting/odds provenance by itself as a reason to stop fantasy-model research.
- New betting/odds-derived candidates can be compared empirically with non-betting alternatives.
- Production remains frozen until an explicit evidence-backed owner decision changes it.
- Documentation that claimed no betting-derived feature entered the engine is corrected for current xFP.
- Protocol v1 remains unchanged and historically auditable.
