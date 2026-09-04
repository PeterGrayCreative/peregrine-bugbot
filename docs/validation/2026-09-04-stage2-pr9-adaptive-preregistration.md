# Stage 2 PR 9 Adaptive Diagnostic Preregistration

**Registered:** 2026-09-04, before execution of the revised provider comparison

**Evidence class:** post-hoc revised diagnostic on a preregistered visible
development/validation subset. This is not historical-gold, sealed-holdout,
release-checkpoint, or final non-inferiority evidence. The intervention and
case panel were selected after the original PR 9 diagnostic result was known;
this registration freezes the revised comparison before its provider run but
does not restore holdout status to any case.

**Primary intervention:** Replace the full validated breadth ledger passed to
the stable investigator method packet with an adaptive representation. The
adaptive serializer sends the full validated ledger unless a deterministic
structural representation is strictly smaller, or compaction is required to
fit the 24,000-character hard limit. It preserves every candidate, escalation,
covered file, unavailable item, and per-file/per-lane clear count, retains the
largest bounded clear-explanation sample that is strictly smaller, and fails
closed if preserved high-value content cannot fit. The provider-facing breadth
schema and prompt remain identical to control; only post-parse transmission
selection differs.

## Frozen protocol

- Config: `eval/matrix.codex.stage2-pr9-adaptive.json`
- Mode: `visible-checkpoint`
- Corpus: an explicit visible subset spanning development and validation
- Development cases: `case-13f0a2c1`, `case-a1c4e90d`, `case-d40b36f9`,
  `case-1ab7d3c9`, and `case-c39a25e8`
- Validation cases: `case-d3f8026e`, `case-b28e14d7`, `case-3ef9a502`,
  `case-f9b30d26`, and `case-c95a81e4`
- Frozen truth denominator: seven seeded bug observations in five root-cause
  groups, plus five clean controls
- Large-diff cases: `case-d3f8026e`, `case-3ef9a502`, and `case-f9b30d26`
- Repeats: three
- Review attempts: 60, randomized and position-balanced in paired blocks
- Seed: `202609042`
- Control: Luna high breadth to Sol high investigation with the stable method
  packet and `breadthLedgerMode: full`
- Treatment: the identical route and method packet with
  `breadthLedgerMode: adaptive-structural-compact`
- Judge: blinded Luna medium, `semantic-v1`
- Provider access: sanitized Codex CLI session
- Runtime image:
  `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`,
  pre-pulled and used with pull policy `never`
- Cache condition: uncontrolled because the Codex CLI exposes cache-read
  telemetry but no supported provider-cache reset or guaranteed warm-up control
- Monetary cost: best effort and expected to remain unavailable
- Primary efficiency metric: median paired case/repeat wall-time change,
  expressed as treatment relative to control
- Supporting efficiency metrics: paired total and investigator-stage input,
  uncached input, cache-read input, output and reasoning tokens, turns, tool
  calls, tool-output bytes, prompt bytes, stage duration, transmitted-ledger
  characters, and clear-explanation omission counts

The experiment manifest must bind both arms to
`investigationPromptMode: method-packet` and their exact breadth-ledger modes.
Both arms must record the same compiled method-core, canonical-source,
provider-schema, and breadth-prompt hashes. Model, effort, budget, routing,
containment, prompt, provider output contract, and judge are fixed. The only
registered intervention is the deterministic post-parse selection of the
ledger transmitted to investigation.

Treatment artifacts must authenticate the original provider output, exact
transmitted ledger, adaptive decision, counts, character sizes, omissions, and
original-content hash. Candidates, escalations, covered files, unavailable
items, and per-file/per-lane clear counts may not be omitted. Any preserved
high-value content that cannot fit under the hard limit fails before
investigation rather than being truncated.

## Activation sufficiency

The adaptive mechanism must be exercised enough for the efficiency comparison
to test the intervention rather than mostly reproduce control. Among the nine
large-diff treatment attempts, adaptive compaction must be selected in at least
six and in at least one repeat of each of the three large-diff cases. Selection
means the authenticated treatment artifact records `applied: true` and
transmits a structural-compact ledger that is strictly smaller than the full
validated provider ledger. If either activation condition fails, the run is
diagnostic only and cannot pass the PR 9 merge gate regardless of quality or
wall time.

Activation rates for all treatment attempts and separately for each large case
will be reported. No case may be replaced, added, or retried to satisfy the
activation threshold.

## Stopping rules

- At most 72 review-provider attempts for the 60-attempt schedule
- At most 72 judge-provider attempts for the expected 42 root-cause comparisons
- Six-hour review and judge wall-time ceilings
- Stop after three consecutive failures
- Stop above a 20% failure rate after at least 12 attempts, while completing the
  current paired block

The ceilings match the original PR 9 screen and include bounded headroom but
do not authorize retries, added cases, additional arms, or provider
substitution. Any retry requires a separately identified run under the
immutable retry-lineage rules.

## Acceptance and interpretation

A seeded root cause is reliably detected only when independently adjudicated
as found in at least two of three repeats. The adaptive revision may merge only
if all of these gates pass:

- both arms reliably detect all five seeded root causes and all seven seeded
  bug observations, and treatment loses none relative to control;
- treatment has no additional missed seeded observation in any paired repeat;
- treatment adds no blocking false positive on any clean case;
- treatment completion is not below control and every completed artifact
  passes ledger-evidence validation;
- treatment omits no candidate, escalation, covered file, unavailable item, or
  per-file/per-lane clear count;
- the activation-sufficiency threshold passes; and
- median paired wall time improves by at least 20% (a change of at most
  `-20%`), with the deterministic paired bootstrap 95% interval entirely below
  zero.

Failure of any quality, completion, losslessness, activation, or efficiency
condition rejects the adaptive revision as the accepted PR 9 intervention.
Token, cache, stage, and ledger-size changes remain supporting evidence because
cache state is uncontrolled. First-use and later-repeat strata are descriptive
only and will not be labeled causal cold or warm measurements.

This comparison is a deliberately revised, post-hoc diagnostic over cases
visible to the implementers. Including validation-corpus cases broadens the
observable size and change-shape range but does not make the selected subset a
holdout or gold checkpoint. The result may reject or provisionally support the
adaptive implementation; it cannot establish production routing, sealed
holdout performance, full visible-corpus efficacy, or final non-inferiority.
