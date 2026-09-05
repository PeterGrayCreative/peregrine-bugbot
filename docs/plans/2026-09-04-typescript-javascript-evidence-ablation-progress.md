# TypeScript and JavaScript evidence and ablation progress

Updated: 2026-09-05
Active branch: `research/ts-js-evidence-r2`

## Active objective

Determine whether any Peregrine component improves consequential TS/JS bug
finding, unsupported-finding behavior, or measured work relative to a competent
minimal reviewer. Production routing remains frozen.

## Progress

| Step | State | Evidence / remaining gate |
| --- | --- | --- |
| R1: collection feasibility | Complete | Five public review opportunities are archived in canonical, packet-bound form. Every v3 case has 2/2 rostered independent confirmations and the strict readiness gate passes. |
| R2: gather and partition | In progress | Frozen 100 attempted candidate slots across eight repository families. Twelve exposed leads checked: twelve recoverable opportunities from eleven PRs, plus one unrecoverable lead. Two heads from one PR are not independent cases. Zero new admitted cases. Human curation and protected partitioning remain open. |
| R3: neutral and truthful harness | In progress | Integrated audited PR30 adjudication/reporting and attribution. Partial truth, source, scope, curation, metric policy, and leakage contracts have 40 passing tests. Historical admission binds declared curator confirmations but does not prove human independence. New protocol scheduling still fails closed; runner/report integration, neutral arms, and runtime boundary probes remain open. |
| R4: register four-arm comparison | Not started | Requires R2 and R3. This is the next provider-authorization checkpoint. |
| R5: methodology measurement | Not authorized | Planned maximum 96 initial attempts plus at most three registered component screens. |
| R6: select and confirm | Not started | Requires frozen candidate and new powered confirmation corpus. |
| R7: deployment bridge and prospective discovery | Not started | No automatic posting or production route change. |
| R8: component decision | Not started | Positive, negative, simplified, or inconclusive outcomes are all valid. |

## R1 artifacts

Active full-program goal: [goal and completion contract](2026-09-05-typescript-javascript-evidence-full-program-goal.md).

- [Feasibility report](../validation/2026-09-04-r1-historical-reconstruction-feasibility.md)
- [Machine-readable manifest](../validation/artifacts/2026-09-04-r1-historical-reconstructions/manifest.json)
- [Source response hashes](../validation/artifacts/2026-09-04-r1-historical-reconstructions/source-hashes.md)
- Per-case proof bundles under
  `docs/validation/artifacts/2026-09-04-r1-historical-reconstructions/cases/`
- [Independent curation protocol](../validation/artifacts/2026-09-04-r1-historical-reconstructions/curation/review-protocol.md)
- [R1 completion status](../validation/2026-09-05-r1-historical-reconstruction-status.md)
- [Resume handoff](2026-09-05-typescript-javascript-evidence-ablation-r1-handoff.md)
- Authoritative v3 curator packet SHA-256:
  `d96904edf56c5b8dac970f59fa95a14c495cde5bd22d50a805e6874df098c2fe`

## R1 correction and verification history

- V1 remains immutable and failed. Two curators independently rejected the
  TypeScript base/diff and the breadth of the Karma #2846 claim while
  confirming the other three cases.
- V2 corrected the TypeScript merge base and narrowed the Karma claim. It is
  retained as ready intermediate evidence, including the original rejections.
- A separate integrity review found that the old raw patch hashes depended on
  repository-specific abbreviated blob IDs. V3 stores canonical full-index
  diff bytes for all five cases and supersedes every old diff-hash claim.
- V3 confirmations bind the exact packet hash, case bundle, rostered curator
  identity, directory, and filename. Both curators authored their own five
  confirmation files. The validator reports 2/2 for every case and `ready`.
- Focused integrity tests, TypeScript checking, and the strict zero-provider
  gate pass under Node 22. The full suite reached 249/252 while the worktree was
  dirty because three provider-enabled fixtures enforce a clean-worktree guard.
  After the R1 implementation commit, the exact `tests/eval-experiment.test.ts`
  suite passed 12/12 from a clean worktree, confirming those failures were guard
  state rather than behavioral regressions.

## Frozen constraints

- No historical provider runs before R4 review and explicit authorization.
- Do not use visible seeded panels as historical efficacy evidence.
- Do not call comparisons globally clean or infer complete truth from one fix.
- Do not expose later fixes, comments, issues, or curator answers to reviewers.
- Do not change production prompts, topology, route, skill, or posting behavior
  as part of this research program.
