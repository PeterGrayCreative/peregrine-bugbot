# Stage 2 PR 9 Preregistration

**Registered:** 2026-09-04, before provider execution

**Primary intervention:** Replace the full breadth ledger passed to the stable
investigator method packet with the `structural-compact` representation. The
treatment's bounded breadth schema and deterministic serializer preserve every
candidate, escalation, covered file, unavailable item, and per-file/per-lane
clear count while retaining a bounded sample of clear explanations. The model
route, efforts, investigator method packet, candidate budget, corpus, and
containment stay fixed.

## Frozen protocol

- Config: `eval/matrix.codex.stage2-pr9.json`
- Corpus: visible admitted development cases only
- Cases: ten preregistered cases: six seeded bugs and four clean controls
- Case IDs: `case-13f0a2c1`, `case-17ac84e2`, `case-6c19f4ab`,
  `case-a1c4e90d`, `case-d40b36f9`, `case-a17c4e92`, `case-1ab7d3c9`,
  `case-39e6a1c4`, `case-c39a25e8`, and `case-2cd8e4a1`
- Repeats: three
- Review attempts: 60, randomized and position-balanced in paired blocks
- Control: Luna high breadth to Sol high investigation with the stable method
  packet and `breadthLedgerMode: full`
- Treatment: the identical route and method packet with only
  `breadthLedgerMode: structural-compact`
- Judge: blinded Luna medium, `semantic-v1`
- Cache condition: uncontrolled because the Codex CLI exposes cache-read
  telemetry but no supported provider-cache reset or guaranteed warm-up control
- Provider access: sanitized Codex CLI session
- Monetary cost: best effort and expected to remain unavailable
- Primary efficiency metric: median paired wall-time change
- Supporting efficiency metrics: paired total and investigator-stage input,
  uncached input, cache-read input, output and reasoning tokens, turns, tool
  calls, tool-output bytes, prompt bytes, stage duration, transmitted-ledger
  characters, and clear-explanation omission counts

The experiment manifest must record `investigationPromptMode: method-packet`
for both arms and the exact `breadthLedgerMode` for each arm. Both arms must
record the same compiled method-core and canonical-source hashes. The paired
breadth prompt hashes must differ only where the registered ledger mode changes
the treatment's bounded-output instruction; no other prompt, model, effort,
budget, routing, or containment change is allowed.

Treatment artifacts must preserve and authenticate the structural-compaction
metadata. Candidates, escalations, covered files, unavailable items, and clear
count groups may not be omitted. Any preserved high-value content that cannot
fit under the hard ledger limit fails the attempt before investigation rather
than being truncated.

Cache reads and unavailable cache writes will be reported by arm, repeat, and
stage. First-use and later-repeat strata are descriptive observations only;
they will not be labeled causal cold or warm measurements.

## Stopping rules

- At most 72 review-provider attempts for the 60-attempt schedule
- At most 72 judge-provider attempts for the expected 48 root-cause comparisons
- Six-hour review and judge wall-time ceilings
- Stop after three consecutive failures
- Stop above a 20% failure rate after at least 12 attempts, while completing the
  current paired block

The ceilings include bounded headroom but do not authorize retries, added
cases, or additional arms. Any retry requires a separately identified run under
the immutable retry-lineage rules.

## Acceptance and interpretation

A seeded bug is reliably detected only when its root cause is independently
adjudicated as found in at least two of three repeats. PR 9 may merge only if:

- no reliably detected high-severity root cause is lost;
- no more than one total visible seeded bug regresses under the reliability
  rule;
- blocking false positives do not increase;
- completion does not decline;
- treatment artifacts show no loss of candidates, escalations, covered files,
  unavailable items, or per-file/per-lane clear counts; and
- median wall time improves by at least 20%, with the paired case-level interval
  supporting the same direction.

If the quality and no-loss conditions pass but the 20% efficiency threshold
does not, the intervention is rejected or revised rather than merged as an
accepted Stage 2 cost change. Token, cache, stage, and ledger-size changes remain
supporting evidence because cache state is uncontrolled.

This experiment measures the complete registered `structural-compact` mode,
including its bounded breadth-output contract and deterministic transmitted
ledger. It does not separately attribute effects between those two internal
parts. No Plan PR 10 lane guidance, seam checklist, model or effort change,
timeout change, candidate-budget change, or large-diff behavior is included.

The selected development cases are all small. This screening therefore makes no
large-diff claim. It is diagnostic seeded-corpus evidence and cannot establish
historical-gold, sealed-holdout, production-routing, or final non-inferiority
approval.
