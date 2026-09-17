# R2 corpus-completion checkpoint and handoff

Date: 2026-09-16. State: paused at the user's requested checkpoint.

## Completed at this checkpoint

- Added the additive `historical-oracle-v1` schema, compiler, CLI and tests. It
  leaves the human-admission readers and production review path unchanged.
- Independently authenticated the private three-part source archive: 4,442 safe
  members, 3,725 inventoried source files, 39 complete diffs and 142/142 source
  checks. All 16 existing development mounts were rebound to authenticated
  source evidence; 14 use the original archive and two use later corrections.
- Froze a 12-case visible-development roster with 8 proposed bug cases and 4
  proposed comparison cases before running oracles.
- Reproduced one RxJS regression on authentic source: base and repair emit
  `[1,2]`; the review head emits `[1]` and then a scalar `TypeError`.
- Preserved two incomplete oracle attempts. Axios and Next base/head witnesses
  ran, but their repair attempts failed for environmental/source reasons. They
  remain unadmitted and must be rerun through per-role wrappers.
- Froze a fresh private 100-candidate reserved frame across 12 repository
  families. Collection stopped with 24 complete six-resource captures and 180
  successful request records. The initial failed request is retained.
- A privacy gate found six candidate identities had appeared in older public
  evidence. They are excluded from withheld selection, leaving 94 provisionally
  withheld candidates and 23 of the 24 captures provisionally eligible. One
  initial prefix match was proved false and remains recorded as withdrawn.

Fresh Astra-medium gates passed the source-recovery, development-oracle
checkpoint, reserved collection and public oracle implementation. No provider
review experiment ran.

## Current truth

- Admitted historical cases: **0**.
- Protected selection cases: **0**.
- Successful executable bug reproductions awaiting two semantic reviews: **1**.
- Fresh reserved candidates captured, not admitted: **24**.
- Peregrine efficacy conclusion: **none**.

## Durable private evidence

The private evidence repository contains the answer-bearing artifacts:

- `recovery-audits/2026-09-16-source-restore-v1/`
- `corpus-completion/development-oracles-v1/`
- `reserved-collection/r2-reserved-2026-09-16/`

The private checkpoint is committed and pushed to the designated evidence
store. Do not copy reserved identities, truth or repair material into this
public repository.

## Resume order

1. For the development roster, authenticate repair bindings and create new
   per-role observations with genuine assertion exit codes. Never relabel the
   existing combined-driver receipts.
2. Obtain two distinct, explicitly AI-labeled semantic reviews for each
   otherwise complete oracle record; compile only records that pass.
3. Continue the frozen reserved collection without exposing identities to
   prompt authors. Oracle-admit enough unexposed cases to reach the registered
   16 bug / 8 comparison selection target, reporting every loss.
4. Only after the 12/24 corpus is complete and independently gated, build the
   separate reserved-selection partition adapter and resume R4. Provider
   experiments still require separate authorization.

The public implementation commit is independently reviewed but still requires
the repository's full integration validation on the current mainline before
publication.
