# R3 operator truth/severity binding checkpoint

Date: 2026-09-09

## Outcome

Implemented an operator-only, append-only truth/severity binding for a complete
R2 partition. This closes the gap between authenticated case admission and the
future truth-aware inference protocol without exposing answer-bearing material
to any reviewer arm.

## Contract

- Reads the exact R2 partition by SHA-256 and requires `admitted` with no
  deficits.
- Re-authenticates every admitted case from its durable directory and trusted
  sole-human policy.
- Derives case class, partition, repository/duplicate families, canonical truth
  digest, causal-root identity, and severity; none are accepted from a caller.
- Uses the grading contract's canonical `bug`/`group` root namespace and rejects
  conflicting severity within a grouped root.
- Requires exact 36-case coverage, the 12/24 split, 8/4 and 16/8 class balance,
  no duplicate family across partitions, and at most nine cases per repository
  family.
- Stores `binding.vNNNNNN.json` with strict predecessor, timestamp, filename,
  ordering, count, claim, and digest verification.
- Claims one accountable human only; independent verification remains false.
- The binding is operator-only and absent from all assembled reviewer prompts.

## Verification

Run under the repository-pinned Node 22 runtime:

```text
npm run typecheck
node --import tsx --test tests/eval-methodology-r2-partition.test.ts tests/eval-methodology-prompt-isolation.test.ts tests/eval-methodology-grading-contract.test.ts tests/eval-historical-truth.test.ts
```

Full `npm run validate` passed: 295 core tests, 23 evidence-capture tests, 44
historical-truth tests, 219 methodology tests, 13 methodology HTTP tests,
corpus validation, 26 skill tests, nine packaging/install tests, four plugin
management tests, and the eight-attempt structural smoke. Truth, grading,
partition, append-only storage, source-drift, coverage, forged-field, and
prompt-isolation checks are included. One malformed neutral handoff test
fixture was corrected before the clean full run.

## Remaining boundary

This checkpoint does not execute providers, produce a real binding from the
currently unreviewed durable packet, or make inference decisions truth-aware.
Inference v2 and its seal remain the next R3 slice. Legacy inference continues
to fail closed with severe-regression status unknown.
