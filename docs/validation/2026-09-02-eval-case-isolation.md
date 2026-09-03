# Plan PR 2 Validation: Blind and Isolated Evaluation Cases

**Date:** 2026-09-02

**Pull request:** [#5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5)

**Base:** `65b373cdf8099ac77b82466a44c90073f63a4704`

**Validated head:** `64ad038edddffd343631325030c7f4fcf783c0be`

**Node:** `v22.22.1`

**Provider calls:** none

## Scope proved

- Every configuration, case, and repeat receives a fresh opaque checkout, provider home, provider-assets copy, and attempt-owned diff.
- Source fixtures, checked-in diffs, ground truth, and curator artifacts remain outside the checkout and unchanged by attempted reviews.
- Structural-smoke, development, and validation cases are separated and reported independently. Live runners cannot consume structural-smoke cases.
- Remotes, hooks, credential configuration, future commits, nested Git metadata, symlinks, gitlinks, special files, and answer artifacts are rejected or removed before an engine can run.
- Prompt text, metadata, paths, working-tree files, and every reachable Git blob are checked for case-specific answer terms and undocumented answer markers, including UTF-16LE/BE content.
- Leakage diagnostics do not echo answer-bearing identifiers or paths into stdout or persisted failures.
- Cleanup covers setup, provider, parse, and transient removal failures.
- Existing Plan PR 1 artifacts using the former descriptive case names remain gradeable and reportable through an explicit curator alias map.
- Ordinary production engine invocations retain their prior prompts, asset locations, arguments, and environment. The additional provider hardening is evaluation-gated.

## Verification

The final rebased head was validated with:

```text
source /Users/petergray/.nvm/nvm.sh
nvm use 22
npm run validate
git diff --check origin/main...HEAD
```

Results:

- TypeScript typecheck: passed.
- TypeScript tests: 50 passed, 0 failed.
- Skill and manifest tests: 25 passed, 0 failed.
- Packaging and installation tests: 9 passed, 0 failed.
- Plugin-management tests: 4 passed, 0 failed.
- Structural smoke: 8/8 attempts completed; all 5 expected seeded markers were transported and graded; 3 clean controls emitted no findings.
- Cumulative diff check: passed.
- Default development/validation matrix with no curated cases: wrote an empty expected-attempt manifest and started no provider process.

The mock structural result validates materialization, isolation, transport, grading, and accounting. It is not evidence that a model finds bugs, and `$0.000` is not a provider-cost measurement.

## Independent review

Three independent read-only review lanes exercised the branch before publication:

- Security and trust: poisoned project instructions, reachable deleted binary history, base-only symlinks and answer artifacts, encoded answer material, prompt-boundary injection, non-echoing diagnostics, and cleanup failures.
- Evaluation integrity: malformed cases and truth, manifest/record identity, source mutation, corpus separation, empty selections, live-run refusal, and Plan PR 1 compatibility.
- Scope and regression: production-path compatibility, documentation truthfulness, PR 2/PR 3 boundary, and the must-stay-untouched behavior.

All confirmed findings were converted to regression tests or fail-closed behavior. The final targeted reviews found no remaining code blocker before the branch was rebased; the complete repository gate was then rerun on the rebased head.

## Handoff reuse decision

The GPT Pro handoff was used only as a design parts bin. Deterministic fixture commits, checked-in-diff verification, and bounded fixture traversal informed the implementation and were rewritten against the current repository contracts.

The branch rejected the handoff's shared checkout, descriptive model-visible paths, retained historical remotes and later objects, skipped symlinks, ambient user Git configuration, marker-only leakage check, mock recall/cost claims, and unsafe live-provider assumptions.

## Limitations and rollback

Live Claude and Codex matrix attempts currently fail closed as configuration outcomes before process launch. The installed CLIs can disable repository customizations, but neither their permission flags nor read-only modes prove that a process cannot read the source corpus elsewhere on the host. A separately tracked OCI containment prerequisite must provide an attested mount boundary before live evaluation.

Plan PR 3 still owns exact normalized textual diff equivalence, addition-only empty-base handling, proof of original ancestry and merge-base provenance, and full production-manifest parity.

Rollback boundary: revert PR #5. Production prompts, routing, posting, model selection, and the two-worker topology are unchanged.
