# Stage 2 Checkpoint 2 Visible-Corpus Preregistration

**Registered:** 2026-09-04, before provider execution

**Primary comparison:** Test the accepted Stage 2 intervention, PR 8's stable
investigator method packet, against the contemporaneous legacy investigator
prompt. Both arms retain the existing full breadth ledger. The rejected PR 9
compaction implementations are not part of either arm.

## Why this is the accepted Stage 2 comparison

PR 8 passed its attributable development screen with unchanged adjudicated
quality and a 24.70% median paired wall-time improvement. Both PR 9 designs
preserved quality but failed their efficiency gates, at 12.85% and 8.85%
slower median paired wall time. Merging either failed design would make the
accepted stack less representative of the evidence.

The plan therefore records an evidence-driven substitution: Checkpoint 2 tests
the accepted PR 8 stack, while the two PR 9 results remain attributable
negative evidence. This does not erase PR 9 or reinterpret either sealed run.

## Frozen protocol

- Config: `eval/matrix.codex.stage2-checkpoint2-visible.json`
- Mode: `visible-checkpoint`
- Evidence class: `visible-seeded-checkpoint`
- Corpus: every admitted visible development and validation case, without a
  `caseIds` allowlist
- Corpus inventory: 36 cases, including 20 development, 16 validation, 24
  seeded, 12 clean, 28 bug observations, and 24 root-cause groups
- Repeats: three
- Review attempts: 216, randomized and position-balanced in paired blocks
- Control: Luna high breadth to Sol high investigation with the legacy
  investigator prompt and full validated breadth ledger
- Treatment: the identical route with PR 8's stable method packet and full
  validated breadth ledger
- Sole behavioral knob: `investigationPromptMode`, from `legacy` to
  `method-packet`
- Judge: blinded Luna medium, `semantic-v1`
- Expected seeded semantic comparisons: 168, plus bounded adjudication for
  unmatched findings or candidate new defects
- Cache condition: uncontrolled; cache-read values and repeat strata are
  descriptive only
- Provider access: sanitized Codex CLI session
- Monetary cost: best effort; unavailable dollar cost remains `n/a`
- Primary efficiency metric: median paired case/repeat wall-time change
- Supporting efficiency metrics: input, uncached input, cached input, output
  and reasoning tokens; turns; tool calls; tool-output bytes; prompt bytes; and
  breadth/investigation duration

All attempts use the same repository commit, case snapshots, runtime image,
Codex CLI version, permissions, timeout policy, candidate budget, schemas,
profile provenance, containment, and provider window. The immutable manifest
must bind the repository, corpus, schedule, prompt/method, schema, model, CLI,
judge, runtime-image, and containment hashes.

## Reliability, adjudication, and reporting

A seeded bug or root cause is reliably detected only when the blinded semantic
judge independently matches it in at least two of three repeats. The report
must present development, validation, and combined results separately and must
include:

- bug-instance and root-cause recall;
- reliable detections and regressions;
- high-severity root-cause outcomes;
- blocking false positives on clean cases;
- completed, failed, and missing attempts;
- paired duration and work-indicator deltas; and
- a deterministic 10,000-resample paired bootstrap interval using seed
  `202609043`.

Every arm disagreement, unmatched High finding, and candidate new defect must
receive a blind semantic decision and independent evidence review. As an
agreement calibration sample, independently audit the lexicographically first
same-disposition case/repeat block available for each represented invariant
lane. Record absent lane samples rather than substituting a different rule.

## Stopping rules

- At most 216 scheduled review-provider attempts; no within-identity retries
- At most 216 judge-provider decisions
- Thirty-six-hour review and twelve-hour judge wall-time ceilings
- Stop after three consecutive failures
- Stop above a 20% failure rate after at least 12 attempts, while completing
  the current paired block
- A resumed command may complete the immutable remaining schedule but may not
  replace or erase an existing failed attempt

## Acceptance gate

The visible Stage 2 cost checkpoint passes only if all of the following hold:

- no reliably detected high-severity root cause is lost;
- no more than one total visible seeded bug regresses under the two-of-three
  reliability rule;
- blocking false positives on clean cases do not increase;
- completion does not decline;
- median paired wall time improves by at least 20%; and
- the paired bootstrap interval supports improvement by remaining below zero.

The point estimate must independently meet the 20% threshold. The interval is
used to establish direction and uncertainty; it is not weakened into a
mean-only or standard-deviation rule. If quality passes but efficiency does
not, Checkpoint 2 remains open and another independently preregistered
intervention is required.

This is full visible seeded-corpus checkpoint evidence. It completes only the
visible Stage 2 cost checkpoint defined above. It is not historical-gold,
sealed-holdout, production-routing, or final non-inferiority approval, and it
cannot satisfy those later gates.
