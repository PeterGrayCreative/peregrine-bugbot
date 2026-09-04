# Stage 2 PR 8 Preregistration

**Registered:** 2026-09-03, before provider execution

**Primary intervention:** Replace runtime investigator skill traversal with a
hash-addressed stable method core followed by a variable appendix. The breadth
prompt, model route, efforts, schemas, candidate budget, and corpus stay fixed.

## Frozen protocol

- Config: `eval/matrix.codex.stage2-pr8.json`
- Corpus: visible admitted development cases only
- Cases: the eight-case initial Stage 2 panel, including six seeded bugs and two
  clean controls
- Repeats: three
- Review attempts: 48, randomized and position-balanced in paired blocks
- Control: Luna high breadth to Sol high investigation with the legacy prompt
- Treatment: the identical route with the stable method packet enabled
- Judge: blinded Luna medium, `semantic-v1`
- Cache condition: uncontrolled because the Codex CLI exposes cache-read
  telemetry but no supported provider-cache reset or guaranteed warm-up control
- Provider access: sanitized Codex CLI session
- Monetary cost: best effort and expected to remain unavailable
- Primary efficiency metric: median paired wall-time change
- Supporting efficiency metrics: paired input, uncached input, cached input,
  output and reasoning tokens, turns, tool calls, tool-output bytes, and prompt
  bytes

The experiment manifest must record `investigationPromptMode` for both arms,
and treatment artifacts must record the compiled method-core and source hashes.
Cache reads and writes will be reported by arm and repeat. First-use and later-
repeat strata are descriptive observations only; they will not be labeled
causal cold or warm measurements.

## Stopping rules

- At most 48 review-provider attempts
- At most 72 judge-provider attempts
- Six-hour review and judge wall-time ceilings
- Stop after three consecutive failures
- Stop above a 20% failure rate after at least 12 attempts, while completing the
  current paired block

## Acceptance and interpretation

A seeded bug is reliably detected only when its root cause is independently
adjudicated as found in at least two of three repeats. PR 8 may merge only if:

- no reliably detected high-severity root cause is lost;
- no more than one total visible seeded bug regresses under the reliability
  rule;
- blocking false positives do not increase;
- completion does not decline; and
- median wall time improves by at least 20%, with the paired case-level interval
  supporting the same direction.

If the quality conditions pass but the 20% efficiency threshold does not, the
intervention is rejected or revised rather than merged as an accepted Stage 2
cost change. Token/cache changes remain supporting evidence because cache state
is uncontrolled.

This screening is diagnostic seeded-corpus evidence. It cannot establish
historical-gold, sealed-holdout, production-routing, or final non-inferiority
approval.

## Pre-execution amendment

An initial launch from `3cb554ff3c7ed9c1daeb599db3b2fd9f6b3a8d6c` was
interrupted after two terminal attempts and one started attempt when independent
review found that the new method hashes were not accepted by strict artifact
ingestion and that pre-provider compilation happened after provider-started
accounting. The unsealed local directory is
`eval/runs/2026-09-04T01-42-48-423Z`; it is invalid evidence and will not be
resumed, graded, or used for decisions.

Commit `067e51c` admits and validates the paired hashes and moves the durable
provider-started boundary to the first actual contained provider invocation.
The case panel, schedule seed, arms, stopping rules, metrics, and acceptance
criteria above remain unchanged. A fresh experiment directory and experiment
identity will be used after this amendment is committed, validated, reviewed,
and pushed. No partial finding result was used to change the protocol or
implementation.
