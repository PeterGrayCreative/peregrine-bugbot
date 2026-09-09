# R3 truth-aware inference v2 and seal checkpoint

Date: 2026-09-09

## Outcome

Implemented a versioned inference protocol and append-only decision seal that
consume the exact operator-only R2 truth binding. This removes caller-supplied
duplicate-family and severity claims from the inference path while preserving
all legacy inference readers and artifacts.

## Contract

- The preregistration derives its exact 12-case development or 24-case selection
  roster from an authenticated R2 binding.
- Development requires two repeats; selection requires three.
- Every case binds repository and duplicate families plus registration,
  curation, bundle, truth-scope, and canonical-truth identities.
- Review grades must match the bound case registration and truth identities.
- Clustered intervals use only the authenticated duplicate-family structure.
- High-severity root counts use only the authenticated operator truth binding.
- Development severity evidence is descriptive; selection evidence is
  exploratory. Formal regression remains unavailable until confirmation.
- The append-only seal rederives the result from sealed analysis, effective
  adjudication, grouped unmatched roots, resource evidence, truth binding, and
  an explicit source manifest.
- Stored plans and seals reject source drift, wrong digests, cross-run joins,
  stale predecessors, and non-contiguous history.
- Root and severity answers are not serialized into reviewer input plans.

## Verification

Run under the repository-pinned Node 22 runtime:

```text
npm run typecheck
node --import tsx --test tests/eval-methodology-inference.test.ts tests/eval-methodology-r2-partition.test.ts tests/eval-methodology-inference-seal.test.ts
```

The focused suite passed 31/31. It covers the existing v1 append-only seal,
authenticated R2 partition and truth binding, v2 plan derivation without root
serialization, v2 clustered inference, descriptive high-severity counts,
tamper rejection, and source/run/truth joins.

## Evidence boundary

No provider or historical reviewer run occurred. The current durable packet
still has zero human admissions, so this checkpoint cannot produce a real v2
plan or infer that Peregrine improves bug finding. The next evidence gate is the
sole-human R2 review and admitted split, followed by the R4 frozen experiment
package and zero-provider dry run.
