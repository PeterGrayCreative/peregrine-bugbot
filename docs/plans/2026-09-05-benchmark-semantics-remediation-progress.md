# Benchmark semantics remediation: goal and progress

**Status:** Pull request open; CI and review pending

**Branch:** `fix/benchmark-semantics`

**Base:** `fa1ff4dc501f869730f88947ec3ef3cc5fa42037` (`origin/main` when work began)

**Pre-PR progress head:** `08cc4a0`

**Pull request:** [#30](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/30)

**Validation record:** [2026-09-05-benchmark-semantics-remediation.md](../validation/2026-09-05-benchmark-semantics-remediation.md)

## Goal

Complete and merge the benchmark-semantics remediation checkpoint from a clean
latest `origin/main` worktree. Add a separately sealed, append-only, run-bound
curator adjudication workflow that binds final classifications to the immutable
experiment, grading seal, exact attempt/finding digest, and reviewed committed
Git source while preserving original grades and funnel decisions. Apply
diagnostic-only restrictions consistently to JSON/HTML reporting and funnel
metrics. Report unexplained model misses as `unattributed` unless authenticated
stage evidence supports a more specific cause. Preserve backward readability
without strengthening old evidence, and add strict schemas, CLI documentation,
checklist updates, tamper tests, end-to-end tests, and validation evidence.

Verify under repository-pinned Node 22 with full validation, secret/diff hygiene,
and independent exact-head review. Open a new pull request, drive required CI and
review clean, merge it to remote `main`, and verify the merge.

Do not change review prompts, production models or routes, corpus labels,
benchmark panels, production behavior, or production posting behavior. Do not
run new live-model experiments as part of this checkpoint.

## Completed

- Implemented strict curator source and sealed adjudication-ledger schemas.
- Bound adjudication to the experiment manifest, terminal and grading seals,
  committed source blob and ancestry, exact attempt, finding index, and finding
  evidence digest.
- Preserved original grades and funnel decisions; derived adjudicated decisions
  are stored separately.
- Required a write-once source to cover every unresolved non-diagnostic finding,
  preventing partial-ledger dead ends.
- Excluded diagnostic-only findings consistently from precision, FDR,
  false-positive-per-case, blocking-clean-finding, and required-adjudication
  metrics.
- Replaced unauthenticated automatic infrastructure miss attribution with
  `unattributed`, while normalizing legacy evidence only in derived reporting.
- Added the `eval:adjudicate` command, schemas, documentation, compatibility,
  tamper, and end-to-end tests.
- Applied the workflow to the archived paired smoke without running providers.
  Its unsupported control finding now reports consistently as precision 0.8,
  FDR 0.2, one blocking unsupported finding, and FP/case 0.1667.
- Preserved the operator rejection of the Luna-max/Terra-xhigh route because its
  82.7% wall-time regression remains controlling; no fast-screen is authorized.

## Verification completed

- Repository-pinned Node `22.22.1` used for every Node command.
- Full `npm run validate` passed at exact implementation head `4e8df10`:
  254/254 Node tests, corpus validation, 26 skill tests, nine package/install
  tests, four plugin-manager tests, and 8/8 structural smoke attempts.
- Focused typecheck and 28 adjudication/funnel/grading tests passed after the
  independent review fixes.
- `git diff --check` passed.
- Independent exact-head review approved `4e8df10` after verifying the reporting
  overlay and complete one-shot adjudication requirements.
- Scope review confirmed no changes to production prompts, models, routes,
  benchmark panels, corpus labels, or posting behavior.
- No live-model experiment was run.

## Commit sequence

1. `d504664` — implement benchmark evidence semantics.
2. `4203370` — add the blinded smoke adjudication source.
3. `982d4bf` — record adjudicated smoke evidence.
4. `4e8df10` — fix adjudication completeness and reporting consistency.
5. `c6b338a` — record validation and checklist state.
6. `08cc4a0` — add this goal and progress record.

## Remaining delivery work

- Drive all required CI checks to a terminal passing state.
- Triage and resolve every actionable in-scope review comment.
- Merge the pull request and verify that remote `main` contains the merge.
- Update the checklist and this file with the final PR, merge SHA, and terminal
  CI/review evidence.

This progress record distinguishes completed local proof from pending remote PR,
CI, review, and merge proof. The checkpoint is not complete until the remaining
delivery work is verified.
