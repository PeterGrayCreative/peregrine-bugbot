# Original Optimization Plan: Implementation Status

This record compares `docs/plans/2026-09-02-bug-finding-and-cost-optimization-plan.md` with the current repository history. It reports implementation status, not production efficacy. No provider call was made for this assessment.

## Plan PR status

| Plan item | Status | Evidence and limits |
| --- | --- | --- |
| PR 1: attempt accounting | Implemented and merged | [PR #2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2); scheduled attempts and failures remain identifiable. |
| PR 2: blinding/isolation | Implemented and merged | [PR #5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5); opaque materialization and isolation gates. |
| Safety PR 2A.1: runtime image bootstrap | Implemented and merged | [PR #9](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/9); accepted digest workflow exists. |
| Safety PR 2A.2: filesystem containment | Implemented and merged | [PR #15](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/15); digest-pinned runtime/mount boundary exists. |
| PR 3: reproducible history and manifest path | Implemented and merged | [PR #7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7); base/head ancestry and production-manifest parity are covered. |
| PR 4: root grading and miss stages | Implemented and merged | [PRs #17](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/17), [#18](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/18), [#19](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/19); root-cause grading and miss evidence exist, with later adjudication/completeness caveats. |
| PR 5A: usage/cost/work telemetry | Implemented and merged | [PR #11](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/11); provider-reported usage and observed work are recorded. Monetary cost is unavailable for CLI-session runs. |
| PR 5B: immutable schedules/resume/ceilings | Implemented and merged | [PRs #13](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/13), [#14](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/14). |
| PR 6: typed manifest shadow/parity | Implemented and merged | [PR #16](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/16); typed and canonical manifest paths are checked for parity. |
| PR 7: corpus and baseline | Partial | [PR #21](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/21) merged a seeded visible corpus and diagnostic baseline. Historical gold, a full unmodified baseline, independent repository families, and a steward-controlled holdout are not established. |
| PR 8: stable investigator method packet | Implemented and merged; bounded acceptance | [PR #24](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/24). The visible-seeded screen supports an efficiency improvement for the tested condition; it does not prove general bug-finding or production value. |
| PR 9: breadth compaction | Tested and rejected; not merged | [Decision record](../validation/2026-09-04-stage2-pr9-decision.md). Structural and adaptive variants were measured and rejected; both remain unmerged. |
| PR 10: lane counterexamples/seam checklist | Pending | Not implemented in the original plan sequence. |
| PR 11: investigation coverage/completeness | Pending | Not implemented; incomplete exploration can still appear clean. |
| PR 12: risk-sensitive candidate budgets | Pending | Not implemented. |
| PR 13: trusted repository profile | Pending | Not implemented and not benchmarked. |
| PR 14: hunk-safe large-diff pilot | Pending | Not implemented; large-diff handling remains open. |
| PR 15: approximately 50 cases and opt-in routing | Pending | Not implemented; no production routing authorization exists. |

PRs [#30](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/30) and [#32](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/32) are later research-branch work, not merged origin/main implementation of the original PR 1–15 sequence. They add measurement/neutral-arm infrastructure for the TypeScript/JavaScript evidence program and do not change the original PR 10–15 status.

## Checkpoint status

- **Checkpoint 0 — benchmark integrity:** structurally implemented: schedules, isolation, containment, manifests, telemetry, grading, and sealed artifacts exist. It is not equivalent to proven behavioral validity; durable adjudication, honest miss attribution, consistent quarantine, and completeness remain bounded/open in the later evidence work.
- **Checkpoint 1 — gold set and baseline:** **open**. The seeded diagnostic capability exists, but historical gold, a complete unmodified comparator, independent corpus validation, and a sealed holdout do not.
- **Checkpoint 2 — cost intervention:** **bounded visible-seeded evidence**. PR 8 was accepted for the tested method-packet efficiency comparison; PR 9 was rejected. Corpus contamination and unresolved findings prevent truth-complete precision/FDR or broad quality claims.
- **Checkpoints 3–5 — recall/completeness, profile, large diffs/routing:** **open**. Their required PRs, evidence, and final holdout/routing gates are not complete.

## Bottom line

The original plan delivered a substantial measurement and isolation foundation through PR 8, plus negative evidence against PR 9. It has not delivered historical proof that Peregrine improves bug finding, nor the later completeness, profile, large-diff, routing, or sealed-holdout program. The current TypeScript/JavaScript evidence plan appropriately treats this as infrastructure to reuse while requiring neutral arms and independently curated historical evidence before behavioral conclusions.
