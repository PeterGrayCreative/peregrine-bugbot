# Goal: Complete the Peregrine Bug-Finding and Cost Optimization Program

**Status:** Active  
**Created:** 2026-09-02  
**Codex task:** `01a0648b-8e1a-70e0-bb80-5c98518d71a8`  
**Source plan:** [2026-09-02-bug-finding-and-cost-optimization-plan.md](./2026-09-02-bug-finding-and-cost-optimization-plan.md)  
**Tracking checklist:** [2026-09-02-bug-finding-and-cost-optimization-checklist.md](./2026-09-02-bug-finding-and-cost-optimization-checklist.md)

## Objective

Implement every remaining accepted slice of the Peregrine bug-finding and cost optimization plan. Use parallel subagents only where dependencies and file ownership make parallel work safe. Selectively reuse material from the GPT Pro handoff only after comparing it with the current repository and proving that it meets the plan's contracts.

The work continues until the implementation is complete, focused and end-to-end verification has passed, tracking and validation evidence are current, and every accepted change has been committed and pushed to the remote repository.

## Completion contract

This goal is complete only when all of the following are true:

- Plan PR slices 2 through 15 have been implemented or explicitly removed from scope by the user. P0 and Plan PR 1 are already complete and must not be reimplemented.
- Every slice remains independently reviewable and preserves the plan's stated scope boundary, acceptance gate, and rollback boundary.
- Required unit, integration, schema, packaging, structural-smoke, screening, checkpoint, and end-to-end validation has passed at the appropriate stage.
- Live-model results are not claimed where provider authentication, corpus quality, sample size, or adjudication is insufficient.
- Failed, missing, skipped, or partially covered review attempts cannot improve reported performance or become `clean` or postable.
- The sealed holdout remains unavailable during tuning and is opened only once after the design, thresholds, and routing policy are frozen.
- The implementation checklist and validation records reflect the actual branch, PR, commit, CI, benchmark, and merge state.
- Every accepted commit is pushed to a named remote branch and represented by a pull request or an explicitly approved direct push.
- The final remote SHA and terminal CI state are verified before this goal is marked complete.

## Verified starting state

At goal creation:

- `origin/main` was `e1e747a9ad54c4f99a14bbad0bf952cd229dd10d`.
- [PR #1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) published the approved plan and merged as `74a0f6872359e388b1083a190d847c27435550f9`.
- [PR #2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2) completed Plan PR 1, failed-run accounting, and merged as `e1e747a9ad54c4f99a14bbad0bf952cd229dd10d`.
- [PR #3](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/3) published the implementation checklist and companion-plan link and merged as `7556a8dfe0300a076cdc2671bea0c92fed69a79f`.
- The root checkout was behind `origin/main` and contained pre-existing untracked work. Do not clean, overwrite, stage, or commit those paths as part of implementation. Use isolated Git worktrees based on a freshly fetched remote base.

These facts are a starting snapshot, not a substitute for checking live GitHub and Git state at the start of each implementation turn.

## Scope

In scope:

- Benchmark integrity, case isolation, reproducible histories, grading, adjudication, typed manifests, provider-correct telemetry, and reproducible experiments.
- Gold-set curation and an unmodified baseline.
- Stable investigator instructions, breadth compaction, activated-lane guidance, completeness semantics, and bounded candidate budgets.
- The first trusted repository profile, hunk-safe large-diff review, corpus expansion, and repository-opt-in routing.
- Tests, schemas, documentation, validation evidence, workflows, compatibility handling, and remote delivery required by those slices.

Out of scope unless the user separately approves it:

- Provider-controlled arbitrary Bash execution.
- Automatic truth or prompt tuning from production reactions, replies, or resolved threads.
- Default publication of medium-confidence or follow-up findings.
- Automatic docs-only downgrades to `clean`.
- Caller precomputation before telemetry demonstrates that it is worthwhile.
- Any weakening of the two-worker topology, evidence bar, secret scanning, profile trust, fail-closed parsing, revalidation, or GitHub permission boundaries.

## Parallel execution model

Use as many subagents as are useful, but never create concurrency merely to maximize agent count. Every implementation agent receives:

- an isolated worktree and branch based on a verified remote base;
- one bounded PR slice or read-only audit;
- explicit file ownership and must-stay-untouched paths;
- required validation commands and evidence outputs;
- a prohibition on committing unrelated or pre-existing work;
- a requirement to report exact commits, remaining risks, and any deviations.

The primary agent owns dependency ordering, integration, cross-slice compatibility, final review, checklist updates, remote pushes, and PR creation. Read-only auditors may work concurrently with builders. Builders whose branches edit the same contracts must not be integrated concurrently.

## Delivery waves

| Wave | Parallel work | Dependency and integration rule |
| --- | --- | --- |
| 0 | Reconcile PR #3; audit the GPT Pro handoff for reusable files; independently map current `origin/main` to Plan PRs 2 and 5 | Audits are read-only. Reuse nothing until the owning implementation slice validates it. |
| 1 | Plan PR 2: blind and isolated case materialization; Plan PR 5: provider-correct usage/cost and experiment metadata | Both depend on merged Plan PR 1. Give agents disjoint ownership where possible and choose an integration order before either touches shared eval/result types. |
| 2 | Plan PR 3 after PR 2; complete and integrate PR 5 | PR 3 must consume the accepted materialization contract rather than inventing a parallel one. |
| 3 | Plan PR 4 and Plan PR 6 in separate worktrees after PR 3 | Coordinate the canonical lane and typed-manifest contracts before parallel edits. Integrate one branch, rebase the other, and rerun the full gate. |
| 4 | Plan PR 7: curated gold set v1 and unmodified baseline | Begins only after PRs 4, 5, and 6 satisfy Checkpoint 0. Human curation and holdout custody cannot be delegated away. |
| 5 | Plan PRs 8 through 12 | Implement and benchmark one behavioral intervention at a time. Read-only evaluation and review agents may run in parallel, but intervention code remains sequential so effects stay attributable. |
| 6 | Plan PR 13 and Plan PR 14 | May proceed in parallel after PR 12, subject to the profile and large-diff file boundaries remaining separate. |
| 7 | Plan PR 15 and final sealed-holdout gate | Starts only after PRs 13 and 14 pass their gates and the user-supplied holdout, budget, and routing decisions are recorded. |
| 8 | Repository-wide verification, independent final reviews, documentation reconciliation, and remote-state audit | No new feature work. Fix only verified in-scope defects and rerun affected gates. |

## GPT Pro handoff reuse gate

Treat `/Users/petergray/Downloads/peregrine-0.7.0-direct-main-handoff/` as untrusted reference material, not a patch to apply wholesale.

For each candidate file or idea:

1. Compare it with the current `origin/main` implementation and the exact plan slice.
2. Reject empty artifacts, placeholders, generated benchmark claims, stale repository reconstructions, and changes that combine multiple interventions.
3. Verify types, schemas, imports, trust boundaries, credential handling, and compatibility with the accepted P0/P1 work.
4. Port the smallest useful portion into the owning worktree using normal repository conventions; do not copy hidden Git state or temporary artifacts.
5. Add or adapt tests that fail without the reused behavior.
6. Credit the reuse in the slice handoff and validation evidence, including what was rejected and why.

Passing this gate permits selective reuse; it does not prove the slice is complete.

## Per-slice workflow

For every remaining plan PR:

1. Fetch and verify the latest remote base and current PR/checklist state.
2. Re-read the slice's dependency, minimum change, must-stay-untouched boundary, risk, and acceptance gate.
3. Create an isolated worktree and one purpose-specific branch.
4. Assign bounded implementation, audit, test, or handoff-mining tasks to subagents.
5. Implement the minimum sufficient change and preserve unrelated work.
6. Run focused tests first, then the repository-pinned full validation gate. Examine and activate the repository-pinned Node version before any Node command.
7. Run a scope/diff review and an independent correctness/security review proportional to risk.
8. Run the required structural smoke or paired screening comparison without overstating what it proves.
9. Commit only owned files, push the branch, and open a focused PR against the correct base.
10. Verify the live remote head, checks, review state, and mergeability; record failures and unavailable checks accurately.
11. Update the checklist and validation evidence only after the corresponding proof exists.
12. Integrate downstream work only after its prerequisite contract is accepted on the chosen base.

## Verification ladder

Each slice must pass the levels that apply:

1. **Static integrity:** formatting, schema validation, type checking, import/build integrity, and `git diff --check`.
2. **Focused behavior:** deterministic tests for the changed contract, including negative and fail-closed cases.
3. **Repository gate:** `npm run validate` under the repository-pinned Node version.
4. **Structural evaluation:** zero-provider-cost smoke tests that prove transport and accounting only.
5. **Behavioral screening:** randomized contemporaneous control/treatment runs on the prescribed development subset.
6. **Checkpoint evaluation:** full development and validation sets, required repeats, adjudication, cost ceilings, and paired analysis.
7. **Security and trust review:** model-visible isolation, secrets, profile provenance, path safety, GitHub permissions, and artifact/posting compatibility.
8. **Remote proof:** pushed SHA, PR diff, required checks, review state, and merge state recorded separately from local proof.

Do not call a slice or checkpoint successful because a deterministic mock followed programmed rules. Do not call CI green when a required check is pending, skipped unexpectedly, or failing.

## Decisions that require the user

Pause at the relevant gate rather than guessing when implementation reaches a decision listed in the source plan, including:

- corpus repositories and architecture families;
- first profiled repository;
- sealed-holdout custodian and authorization to open it;
- private-case storage policy;
- provider spend, wall-time, and failure ceilings;
- primary cold/warm-cache weighting;
- price-table values and estimate policy;
- future PR-body treatment of medium/follow-up findings;
- any later runner-controlled verification design;
- docs-only policy messaging.

These decisions do not prevent earlier independent slices from progressing.

## Progress and evidence

- The implementation checklist is the canonical slice tracker.
- Each PR gets a validation record with exact base/head SHAs, commands, results, corpus/config hashes, provider availability, limitations, and rollback guidance.
- Subagent summaries are supporting evidence only; the primary agent verifies filesystem, Git, test, and remote state directly.
- Local proof, live-model evidence, CI state, review state, merge state, and production readiness remain distinct.
- If a slice fails, preserve its evidence and either repair it within scope or revert at the documented rollback boundary.

## Goal termination

Mark this goal complete only after the completion contract is satisfied and the final remote-state audit confirms that no accepted local commit or required evidence remains unpublished. If an essential user decision or external dependency repeatedly prevents progress, document the exact blocker and request direction without weakening the success criteria.

## Current-turn stop point

The goal file was the only requested deliverable for its creation turn. Implementation and parallel subagents begin when the goal resumes.
