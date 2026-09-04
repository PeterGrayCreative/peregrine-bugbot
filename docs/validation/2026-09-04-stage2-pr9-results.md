# Stage 2 PR 9 Results

**Protocol:**
[2026-09-04-stage2-pr9-preregistration.md](./2026-09-04-stage2-pr9-preregistration.md)

**Run:** `2026-09-04T04-51-24-918Z`

**Experiment ID:**
`86e55ba73404bf9f5d761f96bb99b76f0dafed42b7c2331c55188dd7aae48a2b`

**Implementation commit:** `f36c0fbd0ea5de829f0a616e692e107c659cf185`

**Evidence class:** diagnostic, visible seeded development corpus

## Result

The first structural-compaction design is rejected under its preregistered
gate. It preserved recall, completion, blocking-false-positive behavior, and
all high-value ledger content, but it did not reduce wall time. The treatment
was 12.85% slower at the median paired case/repeat level, and its paired
interval did not support an improvement.

| Measure | Full ledger | Structural compact | Comparison |
| --- | ---: | ---: | ---: |
| Completed attempts | 30/30 | 30/30 | no change |
| Attempt-level recall | 100% | 100% | no change |
| Attempt-level root-cause recall | 100% | 100% | no change |
| Reliably detected seeded cases | 6/6 | 6/6 | no change |
| Reliably detected seeded bug instances | 8/8 | 8/8 | no change |
| Reliably detected seeded root causes | 6/6 | 6/6 | no change |
| Blocking false positives on clean cases | 0 | 0 | no change |
| Unresolved clean-case findings | 3 | 3 | no change |
| Median wall time | 70.841 s | 80.0065 s | +12.94% marginal |
| Median paired wall-time change | - | - | +12.85% |
| Median input tokens | 95,612 | 106,517 | +6.82% paired |
| Median uncached input tokens | 35,523.5 | 36,493 | +11.15% paired |
| Median cache-read tokens | 66,752 | 73,664 | +1.33% paired |
| Median output tokens | 2,681 | 2,939.5 | +13.78% paired |
| Median reasoning tokens | 1,587 | 1,890.5 | +18.91% paired |
| Median tool calls | 3 | 3 | no paired change |
| Median tool-output bytes | 621 | 621 | no paired change |
| Median prompt bytes | 34,701 | 35,539 | +3.24% paired |
| Median transmitted-ledger characters | 1,371 | 2,061.5 | +89.76% paired |

The treatment was faster in 12 of 30 paired case/repeat blocks and slower in
18. A deterministic 10,000-resample paired bootstrap using seed `202609041`
produced a 95% interval of approximately -7.08% to +24.09% for the median
paired wall-time change. The interval crosses zero and does not support an
improvement.

## Ledger behavior

All 30 treatment artifacts bound `breadthLedgerMode: structural-compact` to the
immutable experiment identity. Compaction was applied in eight attempts and
omitted 15 sampled clear explanations. It omitted zero candidates, clear-count
groups, escalations, covered files, or unavailable items.

The compact envelope was counterproductive on this small-case panel. Mean
transmitted-ledger size rose from about 1,451 characters in the control to
2,360 in the treatment. The representation's grouping and accounting envelope
cost more than it saved when breadth emitted only a few clear explanations.
The treatment's bounded provider schema also produced somewhat different
original ledgers, so the result applies to the complete registered compact-mode
package rather than serializer overhead in isolation.

No dollar cost was available, and no API billing estimate is inferred from
subscription-backed Codex execution. Token, cache, tool, ledger-size, and
duration values are observed work indicators.

## Integrity and limitations

- Both arms used Luna high breadth to Sol high investigation with identical
  efforts, method packet, corpus, randomized schedule, candidate budget, and
  containment. Only the complete registered breadth-ledger mode changed.
- The contained Luna-medium semantic judge completed all 48 adjudications.
- All 60 review attempts completed. No retry, resume, protocol amendment, or
  provider substitution occurred.
- Three independent implementation reviews completed before provider work. A
  cleanup-accounting blocker found during review was fixed and covered by a
  contained full/compact regression test before the run.
- This small development screen makes no large-diff claim and cannot establish
  historical-gold, sealed-holdout, production-routing, or final
  non-inferiority approval.

## Artifact integrity

- matrix config: `b9f400db8c077f038e20461368d0dabe27ac85c7153110c1f69e1163389f1b47`
- preregistration: `ce07689ee0415159d385b0acf4d9f19854aeb99417824fa2ae7c7d5058c23e83`
- experiment manifest: `9e514747e7289c32e46f73ce425018c5931d946b62d6ca4573f0ac31150843ed`
- experiment terminal seal: `cc8f413b8d77b516043ce83df7d0fe931032cecbf3876a797eebdae9aa7a11c5`
- judge manifest: `80623d19463bdd677f9777daca9b70b43d998cdfd239e3f55abde6aa7b0ddbfc`
- judge terminal seal: `e39cabf3abfe538cd3735746e43c6b78038e46b6ba2d8680a6ba1ce503eb7e71`
- grading seal: `0507f89bc619ef9ee40042dc61fa465a174a9a720c0b5740e41c6bc2016bc279`
- benchmark JSON: `32dc0b1d39d348224ef008f37e28a55b033c8d394550cbd0cdc07de7bcae1c69`
- benchmark HTML: `47118211afc004420196b3df21959eb55d3e0e407d823e17bfdbcc93e906f84a`

The raw run remains local and gitignored at
`/private/tmp/peregrine-pr9-ledger-compaction/eval/runs/2026-09-04T04-51-24-918Z`.
The committed record contains aggregate results and content hashes, not raw
provider transcripts.

## Decision

Do not merge this implementation as the accepted Plan PR 9 intervention. It
passes the registered quality, completion, false-positive, and losslessness
conditions but fails the mandatory efficiency condition.

The next revision must be a new preregistered treatment, not a retry or
reinterpretation of this sealed run. A reasonable revision is an adaptive,
deterministic serializer that transmits the compact representation only when
it is strictly smaller than the validated full ledger, retaining full-ledger
output otherwise. That revision must preserve the same no-loss and evidence
contracts and earn its own paired result before merge.
