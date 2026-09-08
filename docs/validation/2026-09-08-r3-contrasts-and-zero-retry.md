# R3 registered contrasts and zero-retry policy

Date: 2026-09-08. Evidence class: deterministic structural validation. No
provider or historical reviewer invocation occurred.

## Implemented

- New methodology registrations use schema v2 and bind the exact policy
  `{"mode":"none","maxDiagnosticChildren":0}`. Legacy schema-v1
  registrations remain readable with their original digest but cannot append
  new invocation records.
- A descriptive contrast calculator derives D-versus-C, B-versus-A, and
  D-versus-A results plus their interaction from the frozen schedule, complete
  grade set, all-findings adjudication ledger, and resource set.
- Registered-root recall is failure-inclusive. Every arm and repeat must bind
  the same case registration, truth, truth scope, and root roster. Grade status,
  lifecycle/review terminal digests, and resource outcomes are cross-checked.
- Paired wall time uses only pairs whose reviews are grading-complete and whose
  observed durations are positive. Missing or ineligible pairs remain unknown.
- Confirmed-new finding occurrences remain visible, but the artifact states
  that root-level deduplication is still required before discovery claims.
- Contrasts are exclusive-write, rederived on read, and joined to the unchanged
  v1 analysis binding by a separate derived source binding. Caller-held base,
  contrast, and derived-binding digests are required.

## Review corrections

Independent Luna review found and the implementation corrected:

1. missing grade/resource terminal and outcome cross-binding;
2. missing truth/catalog identity equality across arms and repeats;
3. legacy registrations being usable for new dispatches;
4. absent immutable persistence and analysis-source binding;
5. zero-duration acceptance in paired wall time;
6. incomplete reviews entering complete-pair wall-time comparisons; and
7. confirmed-new findings being absent from the derived comparison.

Final rereview reported no remaining actionable finding in this slice.

## Verification

- Node 22 focused tests: 17 passed, 0 failed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

The full repository validation and remote CI status are recorded after the
commit is sealed and pushed.

## Remaining boundary

This slice does not produce confidence intervals, a promotion decision, or an
efficacy result. Known-root pair verdicts are still caller-authenticated rather
than derived from a separately sealed arm-blind semantic-judge execution. The
next measurement-integrity slice must add that judge provenance. Root-level
deduplication for confirmed-new/unsupported discoveries, runner-owned scope
completeness, the credential-bearing Sol canary, and destination-restricted
provider egress also remain open before R4.
