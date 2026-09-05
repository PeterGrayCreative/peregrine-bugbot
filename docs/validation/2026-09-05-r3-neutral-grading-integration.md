# R3 neutral grading and schedule-order integration

Date: 2026-09-05. Evidence class: structural only.

## Scope

The historical runner requires caller-held lifecycle receipts for exactly the
preceding frozen schedule prefix. An attempt cannot skip an earlier scheduled
review or reorder the arms by later sorting the evidence. A missing, reordered,
or stale prefix fails before start or provider attachment.

The new neutral grading contract checks caller-authenticated projection hashes,
truth and reviewed-output hashes, complete external pair verdicts, and neutral
comparison identifiers. Multiple observations may share one registered root;
one finding cannot receive positive matches across distinct roots. Every unused
finding stays unresolved and every missed root stays unattributed. Partial truth
does not permit total recall or globally clean specificity. Failed, missing,
and incomplete attempts receive no root credit and retain the scheduled
denominator.

The caller must still authenticate execution-to-projection origin and retain
the expected digests. This pure function is not a provider runner, semantic
judge, durable adjudication ledger, or a full report consumer. A completed
projection is not itself proof of complete review coverage. Existing production
and legacy seeded behavior are unchanged.

## Verification contract

Eight new grading tests cover grouped observations, cross-root ambiguity,
incomplete pair sets, stale projection/truth/finding hashes, failed judges,
behavioral misses, scheduled failures, incomplete outputs, scoped comparisons,
and neutral comparison hashing. Existing four-arm integration now checks
schedule-prefix rejection and executes in actual frozen order.

Required command under `.nvmrc` Node 22:

```sh
npm run typecheck && npm run test:methodology
```

Result: Node v22.22.1, no-emit typecheck passed; methodology suite passed
86/86 with zero failures, skips, or cancellations (33.41 seconds). Independent
bounded code review approved the grading contract and schedule-order guard.
This is focused local verification, not a new full-repository or remote-CI claim.

`test:methodology` includes the new grading tests, so the existing `validate`
command and CI require them. Tests use synthetic truth and injected review
outputs only. They cannot prove human independence, source validity, provider
contact, or Peregrine efficacy. No truth labels, business thresholds, or
historical outcomes were adjusted to make these checks pass.

## R2 preparation carried with this change

Two new defect drafts and two comparison drafts have source-bound decision
cards in the local curator preparation store. Tracked batch reports retain
counts, hashes, and limitations. No human decision, case admission, protected
partition, or remote durability of the local source stores is claimed.
The first comparison summary exposes scoped hypotheses to the instruction
author; those two slots must be treated as visible development material.
Subsequent tracked preparation summaries must omit causal answers.

The user will receive one consolidated human-review packet, not piecemeal
approval requests. A sole-human admission policy still requires an explicit
versioned boundary; the existing two-confirmation reader has not been weakened.
