# Shortened benchmark funnel validation

Date: 2026-09-04

## Scope

This change adds deterministic smoke, fast-screen, confirmation, and
full-checkpoint benchmark categories without running a new prompt/model
optimization experiment. It also adds diagnostic-only treatment execution and
write-once sequential stage decisions.

## Corpus correction

The category registry records the five cases identified by Checkpoint 2
independent adjudication:

- Four invalid clean controls are excluded from every category.
- `case-d3f8026e` is not treated as truth-complete. It appears only in
  confirmation and full-checkpoint as a diagnostic large-diff transport and
  registered-root sentinel. Its unmatched findings must not contribute to
  acceptance precision, false-discovery, or required-adjudication counts.

The frozen panels retain at least 25% valid clean controls. Confirmation and
full-checkpoint cover all twelve built-in lanes and include large-diff
execution. The excluded exact logging-constants case is not silently replaced:
the registry names smaller compatibility contract proxies, and documentation
states that they cannot prove the exact sensitivity.

## Evidence rules

- Panel choice replaces caller-provided repeat/corpus/case selection and is
  bound into the experiment manifest by definition hash.
- Paired runs are classified `paired-acceptance`.
- `--treatment-only` is limited to smoke and fast-screen and is classified
  `treatment-only-diagnostic`; it cannot advance or complete the funnel.
- Stopped or unpaired evidence, missing terminal work, treatment completion
  degradation, reliable high-severity regression, additional blocking
  unsupported treatment findings, and unattainable efficiency reject.
- Unresolved required adjudication and weak confirmation remain inconclusive.
- The final decision is write-once and binds the experiment, its frozen panel
  and gate policy, terminal/grading seals, mechanically derived metrics and
  completion counts, and its own content. It accepts no post-run summary input.

## Validation

All Node commands use the repository-pinned Node 22 runtime.

```sh
source /Users/petergray/.nvm/nvm.sh
nvm use 22
npm run validate
git diff --check
```

The first full validation from the intentionally dirty implementation worktree
reported 244/247 tests passing. The three expected failures were the tests that
deliberately require a clean Peregrine worktree before simulating a
provider-enabled experiment. The authoritative clean-commit rerun and remote
CI result are recorded below before merge.

## Final result

Clean-commit `npm run validate` passed again after the independent-review fixes:

- 248/248 Node tests passed, including sealed-artifact metric derivation,
  frozen gate binding, diagnostic exclusion, and decision tamper rejection.
- All 36 admitted visible cases revalidated; seeded-visible readiness remained
  true while historical-gold and sealed-holdout readiness remained false.
- 26/26 skill checks, 9/9 packaging/install checks, and 4/4 plugin-manager
  checks passed.
- Structural smoke completed 8/8 attempts, transported 5/5 expected markers,
  and produced zero unexpected findings.

No live model benchmark or optimization experiment was run for this change.
Three independent final reviews approved commit `f93e8da`. On PR #28, CI,
CodeQL/review analysis, review posting, and credential-free build/smoke
passed. The image publication job correctly skipped for the pull request. This
record merged with PR #28.
