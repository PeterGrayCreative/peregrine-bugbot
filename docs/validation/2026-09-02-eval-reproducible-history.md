# Plan PR 3 Validation: Reproducible Evaluation History and Manifest Provenance

**Date:** 2026-09-02

**Pull request:** [#7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7)

**Branch:** `feat/eval-reproducible-history`

**Base:** `2e4ae2ad5deb34aba8b91cde78d8e4662dcf109d`

**Validated head:** `7e4d65f72b31896814ccc582800a54266aff1cb8`

**Node:** `v22.22.1`

**Provider calls:** none

## Scope proved

- Fixture cases produce deterministic base and head commits, including a real empty base for addition-only changes.
- Historical cases preserve SHA-1 or SHA-256 object format and require the sanitized base and head tree IDs to equal the source tree IDs.
- The checked-in patch must equal the exact byte output of the canonical binary, full-index, rename-aware `merge-base...head` diff with production-default context.
- The reviewed working tree equals the head commit and the base is the unique merge base.
- Sanitized histories contain no remotes, alternates, grafts, shallow boundaries, replace refs, unexpected refs or reflogs, unreachable future objects, or curator clone remnants.
- Every attempt calls the exported production `prepareReviewManifest` entry point before engine invocation.
- Successful attempts persist the exact bounded manifest text, its UTF-8 SHA-256, refs, and profile provenance. Missing, empty, oversized, secret-bearing, leakage-bearing, or ref-mismatched output fails closed.
- Repository profiles and custom lanes remain merge-base policy. Head-authored policy is inactive, and symlinked repository profile paths cannot be reclassified as trusted external policy.

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
- TypeScript tests: 64 passed, 0 failed.
- Skill and manifest tests: 26 passed, 0 failed.
- Packaging and installation tests: 9 passed, 0 failed.
- Plugin-management tests: 4 passed, 0 failed.
- Structural smoke: 8/8 attempts completed; all 5 expected markers were transported and graded; 3 clean controls emitted no findings.
- Cumulative diff check: passed.

The structural smoke result proves history construction, manifest preflight, transport, grading, and accounting only. It is not evidence of model recall or provider cost.

## Independent review

Two independent read-only reviewers approved exact commit `7e4d65f72b31896814ccc582800a54266aff1cb8`:

- History integrity reproduced additions, deletions, R100 renames, binary and mode-only changes, profile changes, tracked ignored files, CRLF content, SHA-1, and SHA-256 histories. It also proved that unchanged gitlinks fail closed rather than disappearing silently.
- Manifest and trust review verified the production entry point, exact text/hash preservation, output bounds, merge-base custom lanes, head-only and deleted profiles, and repository-profile symlink rejection through both the TypeScript wrapper and direct shell producer.

The reviewers independently reran the focused history/isolation/manifest suite (29/29 and 14/14 respective selections), the full repository validation gate, and the cumulative diff check. No blocking finding remained.

## Compatibility and boundaries

Plan PR 2's unique attempt isolation, leakage scanning, provider-home isolation, cleanup, and live-provider containment refusal remain intact. History and manifest provenance fields are additive and optional when reading older artifacts.

The preserved manifest remains human-readable text. Plan PR 6 owns the typed shadow representation and must land before Plan PR 4 emits definitive routing-versus-breadth miss classifications. Live model evaluation remains disabled until Safety PR 2A provides an attested outer filesystem boundary.

Production prompts, grading, budgets, routing, posting, model choice, and worker topology are unchanged.

Rollback boundary: revert Plan PR 3. Plan PR 2 isolation and Plan PR 1 accounting remain independently usable.
