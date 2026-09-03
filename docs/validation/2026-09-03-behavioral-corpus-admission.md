# Behavioral corpus admission validation

**Scope:** Strict, zero-provider admission for visible development and
validation benchmark cases. This slice adds no behavioral cases and does not
change prompts, engines, routing, semantic judge execution, or reports.

## Contract

- Behavioral truth has no legacy defaults and rejects missing or unknown fields.
- Opaque bug and root-cause IDs reduce answer leakage from curator inputs.
- Curation binds the exact diff, a non-executed proof artifact, source identity,
  repository/language/architecture/size/change-shape/lane strata, and two
  independent confirmations before admission.
- Each confirmation authenticates one immutable digest over exact case, truth,
  diff, and proof bytes plus normalized curation source/strata/proof metadata.
- Root-cause groups require at least two distinct observations.
- Every case passes the existing leakage and reproducible two-commit history
  verifier before it can contribute to readiness.
- Seeded visible-benchmark readiness is a separate exit-code gate with the
  preregistered 36-case corpus quotas, cross-corpus lane/clean-control coverage,
  and at least three authenticated fixture families. Historical gold-set and
  final holdout readiness are reported independently and do not block this
  seeded checkpoint.
- Historical repository identities must equal materialized source provenance;
  seeded and clean fixture families are reported separately and never count as
  independent historical repositories. Language is derived from Git paths and
  architecture is closed and consistent per source or fixture family.
- Size strata are derived from the normalized diff, with large beginning at
  1,501 lines to match the production schema-v1 diff limit; readiness requires
  at least three realistic admitted large-diff cases.
- The sealed holdout remains external. Its optional repository artifact contains
  only a steward hash, corpus commitment hash, case count, timestamp, and
  unopened/access-controlled assertions.

## Validation commands

Run under the repository-pinned Node 22 runtime:

```sh
npm run typecheck
node --import tsx --test tests/eval-corpus.test.ts
npm run eval:validate-corpus
npm run validate
```

Final local validation passed under Node 22: TypeScript compilation; 195/195
Node tests (including 17/17 focused corpus tests); the zero-provider corpus
integrity command; 26/26 skill tests; 9/9 packaging/install tests; 4/4 plugin
tests; and structural smoke with 8/8 attempts, 5/5 expected markers, and no
unexpected findings.

`npm run eval:validate-corpus` validates the behavioral corpus without making
provider calls and reports `visibleSeededBenchmarkReady`, `goldSetReady`, and
`finalHoldoutReady` independently. `npm run eval:admit-corpus` gates the seeded
visible benchmark; `npm run eval:admit-gold-corpus` gates the historical gold
set. A real steward-held commitment changes only the separate final holdout
status, and must never be fabricated to enable visible experiments.
