# AI prediction registration validation

Status: implementation corrected and independently approved for registration
storage; not provider-ready.

The [new design](../plans/2026-09-13-ai-prediction-development-registration.md)
has a private deterministic registration implementation at
`ai-exploratory/prediction-development-v1/` in the evidence backup repository.
The implementation joins the full 36-case xhigh disposition ledger to the
hash-pinned FRAME, preserves all 11 retained losses, and includes exactly the
16 approved AI proposal contracts. It creates 64 A/B scheduled attempts and
contains no execution interface. Existing packets, human responses, admitted
corpus schemas and production defaults were not modified.

Under Node v22.22.1 after `nvm use 22`:

- Exclusive-write registration generation and exact reconstruction check passed.
- Synthetic dry run returned `registrationIntegrity: pass`, 64 scheduled
  attempts, zero actual provider attempts, null actual outcome metrics,
  `providerExecutionAuthorized: false`, and incomplete runner materialization.
- All 3 focused tests passed: full disposition/loss and duplicate preservation,
  label-invalidity sensitivity including an undefined all-invalid case, and
  uncertain matching plus malformed/duplicate observation rejection.
- Both repository diff whitespace checks passed.

No historical execution, behavioral grading, model comparison, confirmation,
source recovery or remote CI is established by these checks. Full mounted
review state, assembled prompts, route/cap enforcement and an actual
prediction-aware all-output execution adapter remain to be implemented and
gated. The sensitivity function is a deterministic analysis primitive, not
a calibrated label-error estimator. This record does not claim a passed
Section 4 freeze or completion through R8.

## Independent gate correction

The initial Astra medium gate found that splitting all Markdown pipe
characters truncated the exposed-11 contract at `transform || strip || reject`.
The original three tests passed without checking complete source contracts;
their success did not establish the previously claimed full preservation.

The rejected manifest is preserved without byte changes in private
`ai-exploratory/prediction-development-v1/registration.failed-lossy-v1.json`,
SHA-256 `35ec0f2f90b2855ad692ace8df372522094683ea4684c31d0848e39c52d6fea3`.
Its failure record is adjacent at `failed-lossy-v1.md`. The corrected
`registration.json` has SHA-256
`3f84c7250b6c6d3b70447deaa19ddc33998874ee304ee6c17440e6bf592062f0`
and identifies its failed predecessor explicitly.

The parser now preserves the first four metadata columns and the complete
remaining contract, including literal pipes and trailing qualifications.
A new regression compares all 36 contracts with an independent anchored
source-row extraction, asserts the full exposed-11 contract literally, and
verifies the rejected manifest's preserved hash. Node v22.22.1 build, exact
check, dry-run, 4/4 tests and both repository whitespace checks passed after
the correction. The dry-run boundaries and all remaining implementation
blockers above remain unchanged.

## Final gate

The independent Astra medium reviewer rechecked the corrected snapshot and
approved it for durable registration storage. It verified the preserved failed
manifest hash, corrected manifest hash, exact round-trip of all 36 contracts,
the complete exposed-11 literal and qualifications, and the unchanged
selection, dependence, sensitivity, adjudication, and execution boundaries.
The public design hash remains
`401a7e6c8ccdbe60474a5cbb05eb1feb4895c75715956d3040841486127f9e4e`.

The private implementation is stored on evidence `main` at commit `ca2d8e1`.
This gate permits only durable registration storage. It does not authorize
provider execution, establish Section 4 readiness, or complete the program.
