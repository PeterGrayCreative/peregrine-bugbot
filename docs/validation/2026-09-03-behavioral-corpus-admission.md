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
- Root-cause groups require at least two distinct observations.
- Every case passes the existing leakage and reproducible two-commit history
  verifier before it can contribute to readiness.
- Visible-baseline readiness is a separate exit-code gate with the preregistered
  36-case corpus quotas and cross-corpus lane/clean-control coverage. Final
  holdout readiness is reported independently and does not block this checkpoint.
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

Final local validation passed under Node 22: TypeScript compilation; 186/186
Node tests (including 8/8 focused corpus tests); the zero-provider corpus
integrity command; 26/26 skill tests; 9/9 packaging/install tests; 4/4 plugin
tests; and structural smoke with 8/8 attempts, 5/5 expected markers, and no
unexpected findings.

`npm run eval:validate-corpus` validates the currently empty behavioral corpus
and reports `visibleBaselineReady: false` without making provider calls. After
curated visible cases are supplied, `npm run eval:admit-corpus` is the strict
visible-baseline readiness gate. A real holdout commitment changes only the
separate `finalHoldoutReady` status.
