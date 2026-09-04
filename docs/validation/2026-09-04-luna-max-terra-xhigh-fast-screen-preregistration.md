# Luna Max / Terra Xhigh Shortened-Funnel Preregistration

**Date:** 2026-09-04  
**Base:** `origin/main` at merge `0f98cb81002ba7e98a8b75c2393fcd3720c5994c`  
**Configuration:**
[`eval/matrix.codex.luna-max-terra-xhigh-fast-screen.json`](../../eval/matrix.codex.luna-max-terra-xhigh-fast-screen.json)

## Question

Does increasing the breadth stage from Luna high to Luna max while replacing
the Sol high investigator with Terra xhigh preserve the shortened panel's
measured bug-finding behavior and reduce paired wall time enough to justify a
larger confirmation run?

This cycle is development screening. It cannot establish historical-gold,
sealed-holdout, release, or production-routing efficacy.

## Frozen routes

| Arm | Breadth | Investigation | Prompt mode |
| --- | --- | --- | --- |
| Control | `gpt-5.6-luna` high | `gpt-5.6-sol` high | `method-packet` |
| Treatment | `gpt-5.6-luna` max | `gpt-5.6-terra` xhigh | `method-packet` |

Both arms use contained Codex CLI-session access, uncontrolled cache state, and
best-effort cost accounting. The blinded semantic judge remains Luna medium
`semantic-v1`. Missing monetary cost is `n/a`, never zero. Provider-reported
tokens, cache reads, reasoning, tool work, failures, and wall time remain
evidence when available.

## Ordered execution and stopping boundary

1. Run the six-case, one-repeat `smoke` panel as treatment-only diagnostic
   evidence. Judge, grade, report, and persist its diagnostic funnel decision.
2. Run the contemporaneous paired `smoke` panel. Judge, grade, report, and
   derive its authenticated gate decision.
3. Run the 12-case, two-repeat paired `fast-screen` panel only if the paired
   smoke decision permits promotion.
4. Stop after the fast-screen promotion or rejection recommendation.
   `confirmation` and `full-checkpoint` are outside this experiment goal.

Treatment-only output cannot promote the intervention. It exists only to catch
operational incompatibility before spending the paired-control attempts.

Panel membership, repeats, roles, restricted-case policy, reliable-detection
minimum, bootstrap seed, and efficiency target are inherited without amendment
from the authenticated `eval/benchmark-panels.json` snapshot. Cases and labels
will not be changed after observing output.

## Ceilings

- Review runner: at most 48 reviewer attempts, six persisted execution hours,
  20% failure rate after 12 attempts and a complete paired block, or three
  consecutive failures.
- Semantic judge: at most 192 decisions, six persisted execution hours, the
  same 20% failure rule after 12 decisions, or three consecutive failures.
- No dollar ceiling is asserted for subscription-backed execution because the
  CLI does not expose complete monetary charges.
- Runs are sequential and control/treatment order stays paired, seeded,
  adjacent, and balanced.

Any stopped, incomplete, unpaired, corpus-mismatched, seal-invalid, or grading-
invalid experiment is rejection evidence, not a clean result. High-severity
reliable-detection regression, additional blocking unsupported findings on
declared clean controls, treatment completion degradation, and an unattainable
registered efficiency target reject at the applicable gate. Unresolved
adjudication or weak evidence remains inconclusive.

## Pre-provider checks

Before this registration was written:

- Node `v22.22.1` was selected from `.nvmrc`.
- The accepted private runtime image digest
  `sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`
  was present locally.
- The zero-provider containment and one-file sanitized Codex-session mount
  preflight passed.
- Strict corpus admission reported 36/36 visible seeded cases admitted, 12
  clean controls, all 12 lanes in both visible corpora, and no historical-gold
  or sealed-holdout claim.

The committed clean repository state containing this registration will be the
input to every run. Each experiment manifest will independently authenticate
the exact repository, configuration, corpus, panel, runner, judge, prompt,
method, schema, runtime-image, containment, schedule, and model identities.

## Evidence retention

Every terminal attempt and failure remains in its immutable local run
directory. Repository evidence will include the registration, exact experiment
and seal identifiers, complete sanitized attempt/grade summaries, benchmark
reports, funnel decisions, and explicit references to any stopped precursor.
Diagnostic and paired acceptance evidence will be labeled separately. No prior
result will be overwritten or silently omitted.
