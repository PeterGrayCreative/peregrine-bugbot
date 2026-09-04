# Stage 2 Baseline Variance Results

**Protocol:**
[2026-09-03-stage2-baseline-preregistration.md](./2026-09-03-stage2-baseline-preregistration.md)

**Run:** `2026-09-03T23-16-02-990Z`

**Evidence class:** diagnostic, visible seeded development corpus

## Result

The Luna-medium-only route is materially faster and uses materially less model
work, but it is not eligible to replace the strong production control. It lost
one reliably detected high-severity root cause under the preregistered two-of-
three rule.

| Measure | Production Luna high to Sol high | Luna medium only | Comparison |
| --- | ---: | ---: | ---: |
| Completed attempts | 36/36 | 36/36 | no change |
| Attempt-level root-cause recall | 100% | 87.5% | -12.5 points |
| Reliably detected seeded bug cases | 8/8 | 7/8 | -1 case |
| Blocking false positives on clean cases | 0 | 0 | no change |
| Median wall time | 83.289 s | 63.066 s | -24.3% marginal |
| Median paired wall-time change | - | - | -25.7% |
| Median input tokens | 237,939 | 83,287 | -65.0% marginal |
| Median uncached input tokens | 44,612 | 27,681 | -37.9% marginal |
| Median cached input tokens | 188,416 | 71,680 | -62.0% marginal |
| Median output tokens | 2,854 | 2,133 | -25.3% marginal |
| Median reasoning tokens | 1,712 | 935 | -45.4% marginal |
| Median tool calls | 5.5 | 4 | -27.3% marginal |

Across the 36 matched case/repeat blocks, Luna medium was faster in 31 and
slower in five. The median paired wall-time change was -25.67%. A deterministic
10,000-resample paired bootstrap using seed `202609031` produced a 95% interval
of -38.96% to -19.37%. Cache state was uncontrolled, so token and cache fields
are supporting work indicators rather than causal cache evidence.

## Reliable regression

`development/case-17ac84e2` contains a high-severity contracts root cause: the
published pagination response key changes from `next_cursor` to `cursor`
without a versioned contract change. The control found the adjudicated root
cause in 3/3 repeats. Luna medium found it in 1/3 repeats. This is a reliable
high-severity loss and fails the preregistered quality gate.

Luna medium also missed `development/case-d0629f8b` in one repeat, but found it
in the other two, so that case remains reliably detected and is variance rather
than a reliability-rule regression.

## Execution and artifact integrity

- Review attempts: 72/72 completed; zero failed or missing.
- Semantic judge: blinded Luna medium using `semantic-v1`; completed.
- Clean controls: 4 cases x 3 repeats x 2 configurations; zero blocking false
  positives.
- Review runtime: accepted private GHCR image by immutable digest, sanitized
  Codex CLI session, read-only checkout, ephemeral contained invocations.
- Monetary cost: unavailable; no dollar estimate is inferred from subscription
  usage.

Artifact hashes:

- matrix config: `43cf2ec58f6cd5ea5ab2a785ece2c1105f392e6fb6e69f2bcbed17f56261e779`
- preregistration before provider output: `9458e8cf8f09866548850a6cc676cccaad02ea390f0fda295545be7980053122`
- experiment manifest: `91a2813377ab47192bac3c5ae225cc28e9ca4df7a676defbc085b4ffcfc22345`
- terminal seal: `d56e99d39ac062a18d0879c0e2e59231a7fb48869625fe59588a2b4799919296`
- grading seal: `ca8ca8c8ac145d3e1d0749dab73d926c234ebc119d8a7d16c4fe47dda879ecc9`
- benchmark JSON: `cefd30ae5b7211ba9ca2354f51585a1e1ad170be1c79017fc78f880825892ac5`
- benchmark HTML: `454ab55fe4e0ab7cf984b45fdd9ef181321f901c6e33d4441f91f8fd7dc27cc2`

The raw run remains local and gitignored at
`/private/tmp/peregrine-stage2-baseline/eval/runs/2026-09-03T23-16-02-990Z`.
The committed record contains aggregate results and content hashes, not raw
provider transcripts.

## Decision for Plan PR 8

Do not treat Luna medium as a production-routing change. Plan PR 8 will keep
the strong production model route on both sides of its paired experiment and
change only investigator prompt construction: a cache-stable trusted method
core plus a variable untrusted appendix. Plan PR 9 will then be evaluated as a
separate intervention on top of the accepted PR 8 state.

This result does not establish historical-gold, sealed-holdout,
production-routing, or final non-inferiority approval.
