# Stage 2 Baseline Variance Preregistration

**Registered:** 2026-09-03, before provider execution

**Purpose:** Confirm whether the initial Luna-medium diagnostic remains stable
across repeated, randomized runs before changing prompts or breadth output.

## Frozen protocol

- Config: `eval/matrix.codex.stage2-baseline.json`
- Corpus: visible admitted development cases only
- Cases: 12 opaque case IDs selected before this experiment
- Repeats: three
- Review attempts: 72, randomized and interleaved in paired blocks
- Control: Luna high breadth to Sol high investigation
- Treatment: Luna medium breadth and investigation
- Judge: blinded Luna medium, `semantic-v1`
- Cache condition: uncontrolled
- Provider access: sanitized Codex CLI session
- Monetary cost: best effort and expected to remain unavailable
- Primary efficiency metric: median wall time
- Supporting efficiency metrics: uncached and cached input, output and reasoning
  tokens, turns, tool calls, tool-output bytes, and prompt bytes

The 12-case panel retains all eight cases from the first diagnostic and adds one
error-handling bug, one runtime-configuration bug, and two comparable clean
controls. Across the panel it contains eight bug cases and four clean controls,
eight defect lanes, all three language families, seam cases, and
multi-observation cases. Large-diff and all-lane coverage are reserved for the
full visible development/validation checkpoint rather than inferred from this
screening panel.

## Stopping rules

- At most 72 review-provider attempts
- At most 100 judge-provider attempts
- Six-hour review and judge wall-time ceilings
- Stop after three consecutive failures
- Stop above a 20% failure rate after at least 12 attempts, while completing the
  current paired block

## Interpretation rules

A bug is reliably detected only when its root cause is adjudicated as found in
at least two of three repeats. The treatment is promising only if:

- no reliably detected high-severity root cause is lost;
- no more than one total visible seeded bug regresses under the reliability
  rule;
- blocking false positives do not increase;
- completion does not decline; and
- median wall time improves by at least 20%, with paired case-level evidence
  supporting the aggregate direction.

This is diagnostic seeded-corpus evidence. It cannot establish historical-gold,
sealed-holdout, production-routing, or final non-inferiority approval.
