# Stage 2 PR 8 Results

**Protocol:**
[2026-09-03-stage2-pr8-preregistration.md](./2026-09-03-stage2-pr8-preregistration.md)

**Run:** `2026-09-04T01-53-58-179Z`

**Experiment ID:**
`13cc52ee1d17542d9f7463ae4b5220ce5ec52df4d63afb963e9692b2b02d4cf2`

**Implementation commit:** `365b9d034b42cd1b82449ccf02bfd5c7d920105e`

**Evidence class:** diagnostic, visible seeded development corpus

## Result

The stable method packet passes the preregistered PR 8 screening gate. It kept
all adjudicated root causes and clean controls while reducing median paired wall
time by 24.70%. The paired bootstrap interval supports an improvement, although
it does not show that every plausible effect exceeds the 20% point threshold.

| Measure | Legacy investigator prompt | Stable method packet | Comparison |
| --- | ---: | ---: | ---: |
| Completed attempts | 24/24 | 24/24 | no change |
| Attempt-level recall | 100% | 100% | no change |
| Attempt-level root-cause recall | 100% | 100% | no change |
| Reliably detected seeded bug cases | 6/6 | 6/6 | no change |
| Blocking false positives on clean cases | 0 | 0 | no change |
| Median wall time | 104.112 s | 72.235 s | -30.62% marginal |
| Median paired wall-time change | - | - | -24.70% |
| Median input tokens | 223,696 | 89,855 | -59.83% marginal |
| Median uncached input tokens | 45,421 | 26,976 | -40.61% marginal |
| Median cache-read tokens | 180,672 | 64,768 | -64.15% marginal |
| Median output tokens | 3,796 | 2,665 | -29.79% marginal |
| Median reasoning tokens | 2,297 | 1,427 | -37.90% marginal |
| Median tool calls | 6 | 3 | -50.00% marginal |
| Median tool-output bytes | 11,398 | 621 | -94.55% marginal |
| Median prompt bytes | 8,963 | 34,503 | +284.97% marginal |

The treatment was faster in 21 of 24 paired case/repeat blocks. A deterministic
10,000-resample paired bootstrap using seed `202609032` produced a 95% interval
of approximately -42.46% to -13.45% for the median paired wall-time change.
This satisfies the registered rule: the point estimate exceeds a 20% reduction,
and the paired interval supports the same direction.

The larger direct prompt is intentional: the investigator receives the trusted
method inline instead of spending tool calls and model context traversing the
installed skill. The investigator-only medians moved as follows:

| Investigator measure | Legacy | Method packet | Median paired change |
| --- | ---: | ---: | ---: |
| Duration | 45.578 s | 23.196 s | -38.71% |
| Input tokens | 155,160 | 40,877 | -66.87% |
| Uncached input tokens | 27,285 | 20,328 | -42.16% |
| Cache-read tokens | 131,520 | 30,144 | -78.13% |
| Tool calls | 3.5 | 1 | -66.67% |

## Cache observations

The Codex CLI reported cache reads but no cache writes and provides no supported
cache reset. The registered cache condition therefore remained uncontrolled.
These descriptive repeat strata must not be interpreted as causal cold/warm
blocks:

| Repeat | Legacy median wall | Packet median wall | Median paired change | Legacy investigator cache reads | Packet investigator cache reads |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 131.072 s | 65.087 s | -43.21% | 209,920 | 30,080 |
| 2 | 102.573 s | 81.059 s | -8.59% | 131,520 | 30,592 |
| 3 | 99.069 s | 76.003 s | -18.56% | 82,688 | 25,216 |

No dollar cost was available, and no API billing estimate is inferred from
subscription-backed Codex execution. Token, cache, tool, and duration fields are
reported as observed work indicators.

## Integrity and limitations

- Both arms used Luna high breadth to Sol high investigation with identical
  efforts, corpus, randomized schedule, containment, schema, and candidate
  budget. Only `investigationPromptMode` changed.
- Treatment artifacts recorded method-core SHA-256
  `4ebaf0b75a9afcf06b5396499b8c9b653ced97cd93cc73dab335465751b20899`
  and canonical-source SHA-256
  `a2525e27ffcad95f8efbf8bb74052ce7b97079ffe6150a89bd54a5e6af1d3db5`.
- A blinded contained Luna-medium semantic judge completed all 48 adjudications.
- The provider's nested command sandbox was unavailable in 39 of 48 breadth
  attempts; 25 attempts emitted an escalation. Both arms used the same runtime,
  and the manifest, frozen ledger, and diff remained embedded in the
  investigator prompt. The result measures the prompt intervention under that
  shared contained condition, not unrestricted repository exploration.
- The invalid, unsealed pre-amendment launch at
  `eval/runs/2026-09-04T01-42-48-423Z` was not resumed, judged, graded, or used.
  Its exclusion and the unchanged protocol are recorded in the preregistration.
- Two independent reviews found and then verified fixes for strict artifact
  hash ingestion and the provider-started accounting boundary before this run.

## Artifact integrity

- matrix config: `d94cbd4dc6c0046ca776ecd94b8e7b370b6f19c8456adf653a6f8a8a75526771`
- preregistration: `2dacfdaa69b725439fb768726ff545980611945cbff36417873024e4dad1d319`
- experiment manifest: `365721fc22f48198a7cb73b1767d88b9332fe15051a3cdd6ab269a91eac4415f`
- experiment terminal seal: `f0208b908ad3243c28ad34caaee51ccf445398df80228d851ae62588b40b71f1`
- judge manifest: `31501972e81a0d4dc7576cfded87630846cd8222e4c92d665d2dac4615b6a1f4`
- judge terminal seal: `6719bd3b145a5ba91d1b964bbd0a113016c12c9292dc4f97b222068c859b46d0`
- grading seal: `59b2624b4a0a60e220fcf7a0c6e72de62a94c88dcccef39d59fb2b87dc3ce815`
- benchmark JSON: `551d33dbcd8fd46da951cbaff7759e6ad757c22be9eaec1af010d79800acd039`
- benchmark HTML: `43389dbfc9029638b777f58105773037994e935309f985b4876628fdeb24a339`

The raw run remains local and gitignored at
`/private/tmp/peregrine-pr8-method-packet/eval/runs/2026-09-04T01-53-58-179Z`.
The committed record contains aggregate results and content hashes, not raw
provider transcripts.

## Decision

PR 8 is eligible to open and proceed through final validation, remote CI, and
review. The checked-in runner defaults remain on `legacy`; this diagnostic Codex
screen does not authorize a Claude default or production-routing change. PR 9
must remain a separate intervention and benchmark on top of the accepted PR 8
state.

This result does not establish historical-gold, sealed-holdout,
production-routing, or final non-inferiority approval.
