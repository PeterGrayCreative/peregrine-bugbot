# R3 sealed semantic judge and discovery-root record

Date: 2026-09-08

## Outcome

R3 now has an append-only semantic-judge path for the four-arm historical
methodology experiment. Neutral judge inputs omit arm, route, timing, model,
and configuration identity. Every completed known-root finding pair is
scheduled and sealed; grades are rederived from those verdicts rather than
accepted from caller fields.

The derived grade, adjudication, report, and resource artifacts are joined to
the execution and judge bindings by a source-bound composite analysis seal.
Confirmed-new occurrences can be grouped into separate post-hoc discovery
roots without rewriting the frozen known-root scores. The curator packet omits
arm, route, and timing. Occurrence identifiers use an operator-held key whose
append-only artifact is mode 0600 beneath a required private 0700 directory.
A fresh Node process can reopen the key with a caller-held digest and reproduce
the exact sealed root summary.

## Verification

- Node 22.22.1 typecheck passed.
- The expanded methodology suite passed 155/155 before the final durable-key
  correction.
- Focused corrected discovery tests passed, including cross-process reopen.
- Diff checking passed.
- Independent review found and verified corrections for cross-run projection
  reuse, forged persisted grades, unauthenticated discovery derivation,
  reversible occurrence IDs, missing source binding, non-durable blinding
  state, and mutable receipt aliasing.
- No provider or historical reviewer experiment ran.

## Claim boundary

This is structural/mock evidence only. Provider identity, semantic correctness,
human calibration, curator independence, repository-scope completeness,
destination-restricted egress, and Peregrine efficacy remain unestablished.
Curator blindness is operator-mediated and explicitly not independently
attested. R3 remains in progress.
