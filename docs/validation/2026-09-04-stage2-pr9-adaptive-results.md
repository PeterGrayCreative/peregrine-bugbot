# Stage 2 PR 9 Adaptive Results

**Protocol:**
[2026-09-04-stage2-pr9-adaptive-preregistration.md](./2026-09-04-stage2-pr9-adaptive-preregistration.md)

**Run:** `2026-09-04T07-08-31-725Z`

**Experiment ID:**
`e5b22d8a211c3375e96a938cc23b843264655d349cff230abe24cf0635389907`

**Implementation commit:** `2b3764b`

**Frozen experiment commit:** `c4776ff03d7c6c2017c4d076e44410e0961d47cc`

**Evidence class:** diagnostic visible subset of the development and validation
corpora

## Result

The adaptive structural-compaction revision is rejected under its
preregistered gate. It preserved recall, root-cause recall, completion,
blocking-false-positive behavior, and high-value ledger content. It also met
the activation gate. It did not improve efficiency: median paired wall time
was 8.85% slower, and the uncertainty interval did not support an improvement.

| Measure | Full ledger | Adaptive structural compact | Comparison |
| --- | ---: | ---: | ---: |
| Completed attempts | 30/30 | 30/30 | no change |
| Attempt-level bug-instance recall | 100% | 100% | no change |
| Attempt-level root-cause recall | 100% | 100% | no change |
| Blocking false positives on clean cases | 0 | 0 | no change |
| Median wall time | 79.9225 s | 102.1855 s | treatment higher |
| Median paired wall-time change | - | - | **+8.85%** |
| Faster paired attempts | - | 12/30 | 18/30 slower |
| Median breadth duration | 48.445 s | 61.932 s | +15.62% paired |
| Median investigation duration | 31.1775 s | 35.298 s | -4.31% paired |
| Median input tokens | 102,025 | 106,017 | -0.60% paired |
| Median uncached input tokens | 36,128.5 | 36,669 | +1.44% paired |
| Median cache-read tokens | 69,504 | 77,568 | +4.18% paired |
| Median output tokens | 3,043.5 | 4,012 | +8.20% paired |
| Median reasoning tokens | 1,880.5 | 2,701 | -0.04% paired |
| Median prompt bytes | 36,183 | 36,399 | +0.55% paired |
| Median transmitted-ledger characters | 1,754.5 | 2,130.5 | +21.44% paired |

A deterministic 10,000-resample paired bootstrap using seed `202609042`
produced an approximate 95% interval of -2.81% to +18.90% for median paired
wall-time change. The interval crosses zero and excludes the required 20%
improvement.

No dollar cost was available. Subscription-backed Codex execution is reported
through observed token, cache, prompt, ledger, tool-work, and duration
indicators without inferring API billing.

## Activation and losslessness

Adaptive compaction activated in 16 of 30 treatment attempts. It activated in
eight of the nine preregistered large-case attempts and at least once for every
large case, satisfying the activation gate:

| Large case | Activated repeats |
| --- | ---: |
| `validation/case-d3f8026e` | 3/3 |
| `validation/case-3ef9a502` | 2/3 |
| `validation/case-f9b30d26` | 3/3 |

Across treatment attempts, original ledgers contained 104,158 characters and
the transmitted representations contained 100,628 characters, a reduction of
only about 3.4%. The serializer omitted 189 sampled clear explanations while
retaining candidates, escalations, unavailable-file coverage, and grouped
clear accounting. This small representation reduction did not translate into
a material investigation-time gain.

The breadth provider received the same prompt, schema, and parser in both
arms; adaptive selection happens only after the breadth response validates.
Observed breadth-time and breadth-token differences therefore reflect
provider/run-order variation rather than work saved by the serializer. The
only downstream signal attributable to the intervention is the selected
ledger representation, and its median investigation-time improvement was only
4.31%.

## Integrity and limitations

- Both arms used Luna high for breadth and Sol high for investigation with the
  same method packet, corpus cases, randomized schedule, candidate budget,
  containment, and provider access. Only the post-validation ledger selection
  changed.
- The panel contained ten cases: five development, five validation, five
  seeded, five clean, seven bug observations, five root causes, and three
  large cases. Each arm ran every case three times.
- All 60 review attempts completed without a failed, missing, retried, or
  resumed attempt.
- The contained Luna-medium semantic judge completed and sealed all 67
  decisions: 42 same-root-cause and 25 different-root-cause.
- This was an explicitly post-hoc revised diagnostic after the first PR 9
  rejection. It is not historical-gold, sealed-holdout, production-routing,
  or final non-inferiority evidence.

## Artifact integrity

- matrix config: `8d1dc12a35fa09b2deae6b5f77a42a4ddb26aad471b3853d6c6a0fea3e601d1b`
- preregistration: `00ea9e0d9ce51c125aed64d381cefe6229834bb57b7d03d4fce15e17f98ac010`
- experiment manifest: `adf7f495b5569571a87164369926273c9f4de9b4c560ff890db4ae9e1706323b`
- experiment terminal seal: `70870a8e7a66febce3b0105ab96385300ac5b42ddd2d821cc2921719248067a0`
- matrix manifest: `73cb732c801f05a6600a45769a76da0dbc98e154862594e6ae9afef03610d1f5`
- judge manifest: `19e50c17ab8de94e9d58b337cec1250f3007ddda86091e56f1f91e8fd88f869b`
- judge terminal seal: `5e10e022ff23e76b61216b128805dfe42f455953bd6125ce9b4f37ff5a26281e`
- grading seal: `debb92f4707818b83580a1bf46749b2bf17cb3b8c1e63fe66815b55e9b798d35`
- benchmark JSON: `ae915da3288219cda2d9278c075d5ab8ed6909fa3140c0395c69caac4dabe35e`
- benchmark HTML: `d49352025214e6ddfa02e17e7aa4cb46140ba60f21cd47412021a3edfffaa5ba`

The raw run remains local and gitignored at
`/private/tmp/peregrine-pr9-ledger-compaction/eval/runs/2026-09-04T07-08-31-725Z`.
The committed record contains aggregate results and content hashes, not raw
provider transcripts.

## Decision

Do not merge this implementation. Together with the first structural-compact
screen, this result shows that the tested PR 9 ledger representations preserve
quality but do not meet the efficiency objective. PR 9 remains rejected rather
than being merged to satisfy a delivery sequence mechanically.

The accepted Stage 2 stack is therefore PR 8's method packet with the existing
full ledger. The full visible Checkpoint 2 comparison must test that accepted
stack contemporaneously against the legacy investigator prompt. The plan and
checklist must record this evidence-driven substitution before the final
provider run is frozen.
