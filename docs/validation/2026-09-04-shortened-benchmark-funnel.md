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
- The final decision is write-once and binds the experiment, terminal/grading
  seals, strict assessment, derived completion counts, and its own content.

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

Pending clean-commit validation and pull-request review.
