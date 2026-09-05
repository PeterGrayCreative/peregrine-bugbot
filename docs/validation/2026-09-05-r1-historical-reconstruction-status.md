# R1 historical reconstruction completion status

Date: 2026-09-05
Research branch: `research/ts-js-evidence-r1`
Pull request: #31
Decision: R1 complete; stop before R2

## Outcome

R1 recovered five defensible public TypeScript/JavaScript review opportunities
from 2017–2020 across four repositories. The set includes two languages,
review-caught and post-merge defects, and one narrowly scoped reviewed
comparison. No reviewer model, judge, production route, installed skill, or
posting behavior was run or changed.

The authoritative evidence is packet `r1-case-evidence-v3`, SHA-256
`d96904edf56c5b8dac970f59fa95a14c495cde5bd22d50a805e6874df098c2fe`.
Every case has two independently authored confirmations from the packet-bound
curator roster, and the strict readiness gate passes.

| Case | Role | Authoritative review surface | Confirmation |
| --- | --- | --- | --- |
| `r1-vscode-73801` | TS review-caught | Parent to original reviewed head; 4 files | 2/2 confirm |
| `r1-typescript-37467` | TS post-merge | Authentic merge base to reviewed head; 10 files | 2/2 confirm |
| `r1-karma-2846` | JS review-caught | Local refresh-loaded file-type omission; 5 files | 2/2 confirm |
| `r1-karma-2714` | JS reviewed comparison | Callback-selection scope only; 2 files | 2/2 confirm |
| `r1-webpack-8233` | JS post-merge | Unknown runtime `typeof` folding; 3 files | 2/2 confirm |

## Why three evidence versions exist

The version history is intentional evidence, not cleanup debt:

1. V1 preserved the initial reconstruction. Both curators rejected the
   TypeScript case's non-ancestor base and the overbroad Karma #2846 trace.
2. V2 corrected those two defects and preserved every v1 rejection. Both
   corrected cases were independently confirmed.
3. Integrity review found the old patch hashes relied on repository-dependent
   abbreviated blob IDs. V3 stores the exact canonical diff bytes for all five
   cases, records a deterministic full-index command, binds every confirmation
   to the packet hash and case bundle, and restricts confirmations to a frozen
   two-curator roster.

V1 therefore remains `failed`, V2 remains `ready`, and authoritative V3 is
`ready`. No unfavorable record was deleted or rewritten.

## Verification

Executed under Node `v22.22.1`:

```text
node scripts/evidence/validate-r1-curation.mjs --require-complete
  R1 v1 curator readiness: failed
  R1 v2 curator readiness: ready
  R1 v3: 2/2 confirmations for all five cases
  R1 v3 curator readiness: ready

node --import tsx --test tests/evidence-r1-curation.test.ts
  4/4 passed

npm run typecheck
  passed
```

The full repository suite completed 249/252 while the branch had uncommitted
evidence. The three failures are existing clean-worktree guards in
`tests/eval-experiment.test.ts`, not behavioral failures. After committing the
R1 implementation, that exact suite passed 12/12 under Node 22 from a clean
worktree. The earlier three failures were therefore confirmed as guard-state
artifacts rather than behavioral regressions.

Independent final review approved the v3 evidence and validation path with no
blocking findings. Its remaining hardening note was implemented: symlinked
curator confirmation files now fail closed, and the focused integrity suite was
rerun successfully afterward.

## Claims this supports

- Authentic historical TS/JS review opportunities can be recovered with exact
  commits, trees, stored diffs, source provenance, narrow truth, and accountable
  review.
- The bounded five-case feasibility batch is ready to inform R2 collection.

It does not establish that Peregrine improves bug finding, recall, precision,
noise, token use, wall time, or monetary cost. Those questions remain for R4–R8
after corpus and harness prerequisites.

## Stop boundary

R2 and later stages have not started. No provider authorization has been used.
Resume only through the linked
[handoff](../plans/2026-09-05-typescript-javascript-evidence-ablation-r1-handoff.md).
