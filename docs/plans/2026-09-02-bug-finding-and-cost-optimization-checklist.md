# Peregrine Bug-Finding and Cost Optimization Implementation Checklist

**Companion plan:** [2026-09-02-bug-finding-and-cost-optimization-plan.md](./2026-09-02-bug-finding-and-cost-optimization-plan.md)
**Status:** Active
**Last updated:** 2026-09-02

This checklist tracks delivery of the plan without replacing its rationale, risk analysis, or acceptance criteria. Update the status table and the relevant PR section whenever a branch is opened, validation evidence changes, a decision is made, or a PR merges.

## Tracking rules

- One implementation concern per PR. Do not combine independent prompt, routing, corpus, reporting, or posting interventions.
- A checked box means there is committed evidence on the linked branch or PR; an open PR is not the same as a merged PR.
- Record exact validation commands and evidence paths. Do not mark CI green while required checks are pending, skipped unexpectedly, or failing.
- Run Node commands only after activating the repository-pinned Node version.
- Keep structural smoke, development, validation, and sealed-holdout results separate.
- Do not use the deterministic mock engine as evidence of model recall or provider cost.
- Do not expose or tune against sealed holdout cases.
- Preserve coordinator -> one breadth worker -> frozen ledger -> one fresh investigation worker.
- Failed, incomplete, skipped, or partially covered reviews must never become `clean` or postable.
- Do not apply the `peregrine-0.7.0-direct-main-handoff` snapshot wholesale. It is reference material only.

## Status overview

| Slice | Deliverable | Depends on | Status | Pull request |
| --- | --- | --- | --- | --- |
| P0 | Publish the approved plan and this checklist | - | Open | [#1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) |
| P1 / Plan PR 1 | Persist and report every matrix attempt | - | Open | [#2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2) |
| Plan PR 2 | Blind and isolate case materialization | PR 1 | Not started | - |
| Plan PR 3 | Reproduce base/head history and production manifest path | PR 2 | Not started | - |
| Plan PR 4 | Root-cause grading, adjudication, and miss stages | PR 3 | Not started | - |
| Plan PR 5 | Provider-correct usage, cost, work, and experiment metadata | PR 1 | Not started | - |
| Plan PR 6 | Typed manifest shadow/parity mode | PR 3 | Not started | - |
| Plan PR 7 | Curated gold set v1 and unmodified baseline | PRs 4-6 | Not started | - |
| Plan PR 8 | Stable investigator core and variable appendix | PR 7 | Not started | - |
| Plan PR 9 | Structural breadth compaction and schema bounds | PR 8 | Not started | - |
| Plan PR 10 | Activated-lane counterexamples and seam checklist | PR 9 | Not started | - |
| Plan PR 11 | Investigation coverage and runner-owned completeness | PR 10 | Not started | - |
| Plan PR 12 | Bounded risk-sensitive candidate budgets | PR 11 | Not started | - |
| Plan PR 13 | First trusted repository profile and benchmark | PRs 7, 12 | Not started | - |
| Plan PR 14 | Hunk-safe large-diff pilot | PR 12 | Not started | - |
| Plan PR 15 | Approximately 50 cases and opt-in routing pilot | PRs 13, 14 | Not started | - |

## P0 - Publish the plan and checklist

- [x] Add the approved implementation plan under `docs/plans/`.
- [x] Push `docs/bug-finding-cost-plan`.
- [x] Open [PR #1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) against `main`.
- [x] Confirm the original plan-only diff passes `git diff --check`.
- [x] Add this implementation checklist to the same branch.
- [x] Confirm the updated docs-only diff passes `git diff --check`.
- [ ] Record a terminal CI assessment. The initial `check` passed; `analyze` failed because Anthropic authentication was unavailable.
- [ ] Merge PR #1.

Rollback boundary: revert the documentation commit; no runtime behavior changes.

## P1 / Plan PR 1 - Persist and report every matrix attempt

- [x] Write an expected-attempt manifest before model execution.
- [x] Use generated collision-safe attempt IDs.
- [x] Persist completed and failed outcomes.
- [x] Represent timeout, provider, parse, configuration, and unknown failures with stable codes.
- [x] Sanitize persisted diagnostic messages.
- [x] Validate effective configuration after matrix overrides.
- [x] Report expected, completed, failed, and missing attempts.
- [x] Report completion and per-kind failure rates.
- [x] Separate conditional recall from failure-inclusive recall.
- [x] Treat unavailable cost and unavailable denominators as `n/a`, never zero.
- [x] Label manifest-less historical result folders `legacy/incomplete`.
- [x] Add deterministic tests for failures, interruption, sanitization, cost, and legacy handling.
- [x] Run focused typecheck and tests under Node 22.
- [x] Run `npm run validate` successfully.
- [x] Complete an independent diff review.
- [x] Push `feat/eval-run-outcome-accounting` and open [PR #2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2).
- [ ] Record terminal required-check results for the final head.
- [ ] Merge PR #2.

Rollback boundary: revert PR #2; model prompts, routing, topology, posting behavior, and fixture materialization remain unchanged.

## Plan PR 2 - Blind and isolate case materialization

- [ ] Use opaque IDs in case directories, temporary paths, logs, and model-visible metadata.
- [ ] Create a fresh materialized repository for every case/configuration/repeat attempt.
- [ ] Keep ground truth, later fixes, review threads, issue text, and curator notes outside the model-visible checkout.
- [ ] Remove remotes, credentialed Git configuration, and commits newer than the reviewed head.
- [ ] Separate structural-smoke fixtures from live-model development and validation cases.
- [ ] Scan prompt text, checkout paths, repository files, and accessible history for answer leakage.
- [ ] Reject undocumented answer markers such as `BUG`, `FIXME`, expected outcomes, and ground-truth IDs.
- [ ] Record provider-host network-isolation capability or limitation.
- [ ] Add negative tests demonstrating that descriptive paths and accessible answer material fail validation.
- [ ] Run `npm run validate`.
- [ ] Record a zero-provider-cost structural screening result.
- [ ] Open, review, and merge the PR before starting PR 3.

Must stay untouched: production prompts, routing, posting, and model selection.

## Plan PR 3 - Reproducible base/head history and production manifest path

- [ ] Materialize deterministic base and head commits with preserved ancestry.
- [ ] Ensure the reviewed working tree matches the head commit.
- [ ] Verify the checked-in diff equals the materialized `merge-base...head` diff after documented normalization only.
- [ ] Exercise the same manifest entry point used by production reviews.
- [ ] Cover additions, deletions, renames, binaries, and profile changes.
- [ ] Record base, head, merge base, and provenance in run artifacts.
- [ ] Fail closed when history, diff, or manifest provenance cannot be reproduced.
- [ ] Add tests proving no future fixing commit or remote remains accessible.
- [ ] Run `npm run validate` and the structural screening corpus.
- [ ] Open, review, and merge the PR before starting PR 4 or PR 6.

Must stay untouched: grading policy, prompts, budgets, and routing.

## Plan PR 4 - Root-cause grading, adjudication, and miss stages

- [ ] Establish one canonical built-in lane registry and explicit lane-to-finding-category mapping.
- [ ] Extend ground truth with lane, expected severity, expected disposition, reachable preconditions, observable impact, provenance, and root-cause group.
- [ ] Credit one finding for multiple observations only inside the same root-cause group.
- [ ] Keep bug-instance and root-cause recall as separate metrics.
- [ ] Record semantic-judge failures as outcomes instead of aborting or dropping attempts.
- [ ] Blind the semantic judge to engine, route, and treatment.
- [ ] Classify unmatched findings as `confirmed-new`, `unsupported`, or `unresolved`.
- [ ] Classify misses as routing, breadth, investigation, budget, presentation, or infrastructure failures.
- [ ] Add deterministic many-to-one, cross-group, disagreement, clean-control, and judge-failure tests.
- [ ] Freeze and hash judge behavior before comparisons.
- [ ] Run `npm run validate` and a structural screening comparison.
- [ ] Open, review, and merge the PR.

Must stay untouched: provider prompts and production posting thresholds.

## Plan PR 5 - Provider-correct usage, cost, work, and experiment metadata

- [ ] Preserve provider-specific base, uncached, cache-write, cache-read, output, and reasoning-output fields without flattening semantics.
- [ ] Record turns, tool calls, stage duration, total duration, and provider-reported cost.
- [ ] Keep missing usage or price data unavailable rather than free.
- [ ] Version price tables with `pricingAsOf` and tier assumptions.
- [ ] Record repository, corpus, prompt, method, schema, profile, judge, and configuration hashes.
- [ ] Record exact model identifiers, CLI versions, run order, random seed, timestamps, cache condition, and provider availability.
- [ ] Randomize and interleave contemporaneous control/treatment attempts.
- [ ] Represent retries as new attempts linked to the original attempt.
- [ ] Add spend, wall-clock, failure-rate, and early-stop ceilings.
- [ ] Add resume behavior that never overwrites failed evidence.
- [ ] Add provider-envelope fixtures and aggregation tests.
- [ ] Run `npm run validate` and a zero-cost metadata smoke test.
- [ ] Open, review, and merge the PR.

Must stay untouched: model behavior and routing.

## Plan PR 6 - Typed manifest shadow/parity mode

- [ ] Add JSON output to the canonical manifest producer without removing human-readable output.
- [ ] Define and version the manifest schema.
- [ ] Strictly parse root fields, file entries, lane activations, profile provenance, warnings, and safe repository-relative paths.
- [ ] Preserve base/head/merge-base provenance, rename statistics, binary metadata, and activation reasons.
- [ ] Read repository profiles and custom lanes only from the merge base unless an explicit trusted external profile is supplied.
- [ ] Treat head-authored profile changes as reviewed code, not active policy.
- [ ] Run text and JSON manifest paths together in shadow mode.
- [ ] Prove parity across the representative fixture matrix before changing prompt or routing consumers.
- [ ] Add macOS realpath/symlink-path regression coverage.
- [ ] Run `npm run validate` and manifest parity tests.
- [ ] Open, review, and merge the PR.

Must stay untouched: prompt content and route selection.

## Plan PR 7 - Curated gold set v1 and unmodified baseline

- [ ] Select repository and architecture families for development, validation, and holdout cases.
- [ ] Assign a holdout steward who is not tuning the implementation.
- [ ] Decide whether private cases may be reduced and checked in or must remain curator inputs.
- [ ] Curate at least 30 independently confirmed cases.
- [ ] Cover all twelve built-in lanes.
- [ ] Keep at least 25% clean controls on surfaces comparable to bug cases.
- [ ] Include direct, seam, multi-observation, and representative large-diff cases.
- [ ] Separate visible development and validation sets.
- [ ] Store the sealed holdout outside implementer and model access.
- [ ] Validate reachability, expected severity/disposition, root cause, line range, and provenance for every bug.
- [ ] Run and record the unmodified production baseline before prompt optimization.
- [ ] Report repository, language, size, lane, severity, root cause, failures, precision, recall, cost, and clean-case strata.
- [ ] Open, review, and merge the corpus/baseline PR without exposing sealed holdout material.

Checkpoint 1: the baseline is reviewable and the holdout remains unopened.

## Plan PR 8 - Stable investigator core and variable appendix

- [ ] Build a stable prefix containing role/trust rules, investigator workflow, finding contract, all built-in lane summaries, and output rules.
- [ ] Build a variable appendix containing activated lane details, trusted profile/custom lanes, PR metadata, typed manifest, frozen breadth ledger, optional bounded context, and diff.
- [ ] Add required-heading checks and fail closed when canonical source sections move.
- [ ] Snapshot and hash the compiled method packet.
- [ ] Keep repository-controlled profile/custom-lane content outside trusted method tags.
- [ ] Tell the investigator not to reread coordinator-only orchestration files.
- [ ] Preserve interactive skill behavior and lane text.
- [ ] Measure actual cold/warm cache reads and writes rather than assuming provider reuse.
- [ ] Run `npm run validate`.
- [ ] Run a randomized paired 8-12 case screening comparison.
- [ ] Pass the cost-change non-inferiority gate before merging.

Rollback boundary: revert PR 8; no other intervention depends on its measured benefit yet.

## Plan PR 9 - Structural breadth compaction and schema bounds

- [ ] Add output-schema item and string-length bounds.
- [ ] Preserve every candidate, escalation, unavailable file, covered file, and per-file/per-lane clear count.
- [ ] Preserve a bounded sample of clear explanations.
- [ ] Record original, compacted, and omitted counts.
- [ ] Fail closed only when preserved high-value content exceeds the hard limit.
- [ ] Keep binary changes visible as structured metadata.
- [ ] Add clear-heavy compaction, high-value overflow, and no-loss tests.
- [ ] Run `npm run validate`.
- [ ] Run a randomized paired 8-12 case screening comparison.
- [ ] Pass the cost-change non-inferiority gate before merging.

Rollback boundary: revert PR 9 independently of PR 8.

## Plan PR 10 - Activated-lane counterexamples and seam checklist

- [ ] Give breadth only the lane summary and `Counterexamples` section for activated lanes.
- [ ] Add the compact seam checklist from the plan.
- [ ] Keep breadth from reading lane files itself.
- [ ] Keep severity, final disposition, consolidation, and comment drafting with investigation.
- [ ] Replace verbose branch-by-branch clear prose with compact coverage counts.
- [ ] Snapshot prompt changes and measure added context.
- [ ] Add activation, inactive-lane exclusion, custom-lane trust, and output-bound tests.
- [ ] Run `npm run validate`.
- [ ] Run a randomized paired 8-12 case screening comparison.
- [ ] Pass the recall-change gate before merging.

Must stay untouched: the breadth/investigation authority split.

## Plan PR 11 - Investigation coverage and runner-owned completeness

- [ ] Track deterministic transport coverage for every changed hunk.
- [ ] Validate ledger coverage for every reviewable file and activated lane.
- [ ] Add bounded diagnostic analysis coverage for candidates and lanes inspected.
- [ ] Keep model-attested analysis coverage from authorizing `clean` or cheaper routing.
- [ ] Add versioned `completed`, `clean`, `incomplete`, `skipped`, and `failed` states.
- [ ] Require successful stages, complete transport/ledger coverage, no unresolved unavailable surface, and zero confirmed findings before `clean`.
- [ ] Reparse artifacts before posting and reject incomplete, skipped, or failed results.
- [ ] Audit ignored paths and define deterministic substitutes for specialized file classes.
- [ ] Add missing-hunk, unavailable-file, empty-finding, artifact-version, and posting-refusal tests.
- [ ] Run `npm run validate`.
- [ ] Run a randomized paired 8-12 case screening comparison.
- [ ] Pass the recall-change gate before merging.

Rollback boundary: revert PR 11 while preserving or deliberately migrating artifact compatibility.

## Plan PR 12 - Bounded risk-sensitive candidate budgets

- [ ] Introduce `investigationCandidateBudget` and retain `maxEscalations` as a documented compatibility alias.
- [ ] Scale from actual high-risk candidates, explicit escalations, and unavailable coverage.
- [ ] Cap the normal budget at 8 and deep-review budget at 14 without multiplying the computed budget.
- [ ] Record requested budget, applied budget, exhaustion, and the inputs that changed it.
- [ ] Keep the strongest investigation route for high-risk or incomplete work.
- [ ] Add zero-candidate, high-risk, escalation, unavailable, cap, alias, and deep-review tests.
- [ ] Run `npm run validate`.
- [ ] Run a randomized paired 8-12 case screening comparison.
- [ ] Pass the recall-change gate before merging.

Checkpoint 3: PRs 10-12 improve recall within the cost, completion, and false-positive limits.

## Plan PR 13 - First trusted repository profile and benchmark

- [ ] Select the first target repository.
- [ ] Build its profile from canonical policies, identifier rules, runtime modes, harnesses, and known defect classes.
- [ ] Store repository-controlled policy at the merge base or use an explicitly trusted external profile.
- [ ] Keep profile/custom-lane changes in the reviewed head inactive until merged.
- [ ] Run paired profile-off/profile-on comparisons.
- [ ] Record false-positive and recall changes by lane.
- [ ] Keep automatic route downgrades disabled.
- [ ] Add profile trust, provenance, custom-lane, secret, and symlink tests.
- [ ] Run `npm run validate` and the full development/validation corpus.
- [ ] Merge only if the profile improves recall without increasing blocking false positives.

Rollback boundary: disable or revert profile use without changing core review behavior.

## Plan PR 14 - Hunk-safe large-diff pilot

- [ ] Group ordinary file blocks by top-level directory and pack within configured limits.
- [ ] Split oversized files only at hunk boundaries.
- [ ] Prove every original hunk occurs exactly once in transport accounting.
- [ ] Include overlap or a file summary when one file spans chunks.
- [ ] Prefix merged candidate and escalation IDs by chunk without losing references.
- [ ] Select investigation context by candidate/escalation hunk and line, not only by filename.
- [ ] Feed every chunk into runner-owned transport and ledger coverage.
- [ ] Mark any risk-bearing omission or ceiling breach incomplete, never clean.
- [ ] Preserve binary and generated-file metadata.
- [ ] Keep chunking feature-flagged.
- [ ] Add cross-chunk, oversized-file, cross-directory, binary, quoted-path, no-loss, and ceiling tests.
- [ ] Run `npm run validate` and the full large-diff development/validation stratum.
- [ ] Merge only after the large-diff gate passes.

Rollback boundary: disable chunking and retain the transparent hard ceiling.

## Plan PR 15 - Approximately 50 cases and opt-in routing pilot

- [ ] Expand the visible corpus to at least five cases in every high-risk lane.
- [ ] Grow the total corpus to approximately 50 cases.
- [ ] Keep approximately 20% sealed holdout, excluded from visible quotas.
- [ ] Add comparable clean, profiled/unprofiled, large-diff, and contract-bearing documentation cases.
- [ ] Implement deterministic policy tiers with explicit reason codes.
- [ ] Consider lanes, custom lanes, contract-bearing files, profile provenance, breadth escalation, coverage gaps, diff size, and change type.
- [ ] Require trusted profile, successful manifest, no high-risk/custom lane, complete breadth coverage, and no escalation before downgrade.
- [ ] Preserve independent investigation for standard empty-ledger reviews.
- [ ] Treat docs-only policy stops as skipped/not-applicable, never automatically clean.
- [ ] Record requested and actual routes, reason codes, and fallbacks.
- [ ] Keep routing repository-opt-in.
- [ ] Freeze design, thresholds, route policy, corpus, and analysis code before the final holdout.
- [ ] Obtain holdout-steward approval and run the sealed holdout once.
- [ ] Pass the routing non-inferiority, completion, high-risk, false-positive, and provider-cost gates.
- [ ] Run `npm run validate` and record the final release evidence.

Rollback boundary: route every class through the strong path and retire the opened holdout.

## Checkpoint gates

### Checkpoint 0 - Benchmark integrity

- [ ] PRs 1-6 merged.
- [ ] Failed and missing work cannot disappear from reports.
- [ ] Every live case is blind and isolated.
- [ ] Base/head history and production manifest behavior are reproducible.
- [ ] Typed-manifest shadow output matches the canonical manifest.
- [ ] Grading failures and unmatched findings remain visible.
- [ ] Provider usage and experiment provenance are complete enough for comparison.

### Checkpoint 1 - Gold set and baseline

- [ ] PR 7 merged.
- [ ] At least 30 curated cases exist across development and validation sets.
- [ ] All twelve built-in lanes and at least 25% clean controls are represented.
- [ ] The sealed holdout remains inaccessible and unopened.
- [ ] The unmodified baseline report is committed or linked as validation evidence.

### Checkpoint 2 - Cost intervention

- [ ] PRs 8-9 merged.
- [ ] No reliably detected high-severity root cause regresses.
- [ ] No more than one total gold bug regresses from detection in at least two of three runs.
- [ ] Blocking false positives and completion do not regress.
- [ ] Effective cost or median wall time improves by at least 20%.
- [ ] Paired case-level deltas and uncertainty support the aggregate result.

### Checkpoint 3 - Recall and completeness intervention

- [ ] PRs 10-12 merged.
- [ ] At least two additional historical bugs are reliably detected, or an equivalent pre-registered lane gain is achieved.
- [ ] No high-severity development or validation root cause regresses.
- [ ] Additional blocking false positives across clean repeats are at most one.
- [ ] False-discovery rate remains inside the pre-registered margin.
- [ ] Effective cost increases by no more than approximately 10-15%.
- [ ] Completion rate does not regress.

### Checkpoint 4 - Trusted profile

- [ ] PR 13 merged.
- [ ] The selected profile is trusted from the correct provenance.
- [ ] Profile-on recall improves without increased blocking false positives.
- [ ] Routing remains disabled until Checkpoint 5.

### Checkpoint 5 - Large diffs and routing

- [ ] PRs 14-15 merged.
- [ ] Every consequential reviewable hunk is transported or explicitly marked unavailable.
- [ ] High-risk and incomplete cases always retain the strong route.
- [ ] Standard-risk non-inferiority is supported by enough cases.
- [ ] Provider-correct cost improves by the pre-registered material threshold.
- [ ] The one-time sealed-holdout gate passes.
- [ ] The opened holdout is retired and replacement holdout planning is recorded.

## Decisions and budgets

- [ ] Select corpus repositories and architecture families.
- [ ] Select the first profiled repository.
- [ ] Name the sealed-holdout steward.
- [ ] Decide private-case storage and sanitization policy.
- [ ] Set per-screening provider-spend ceiling.
- [ ] Set per-checkpoint provider-spend ceiling.
- [ ] Set wall-clock and failure-rate stopping rules.
- [ ] Pre-register the production cold/warm-cache mix.
- [ ] Approve provider price tables, tier rules, and `pricingAsOf` values.
- [ ] Decide whether medium/follow-up findings may receive a later opt-in PR-body experiment.
- [ ] Decide whether policy-skipped docs-only reviews should post or remain silent.

## Explicitly deferred work

- [ ] Caller precomputation may be reconsidered only after search/tool telemetry demonstrates likely net savings.
- [ ] Runner-controlled verification requires a separate security design and approval.
- [ ] Outcome weak-label collection requires sufficient production volume and must remain human-curated.
- [ ] No deferred item may be folded into PRs 1-15 without updating the plan and obtaining explicit approval.

## Final definition of done

- [ ] PRs 1-15 are independently reviewable, validated, merged, and linked above.
- [ ] Every checkpoint has an evidence-backed validation record.
- [ ] The benchmark cannot improve by losing failed, missing, ungraded, or incomplete work.
- [ ] Live cases are blind, reproducible, isolated, and representative.
- [ ] Reports cover recall, adjudicated precision, calibration, clean-case blocking false positives, failure-inclusive metrics, miss stages, provider-correct cost, work, and duration.
- [ ] Prompt/cost work passes the 20% improvement gate without material recall loss.
- [ ] Recall work passes the historical-bug, false-positive, completion, and cost gates.
- [ ] Runner-owned completeness prevents partial reviews from becoming clean or postable.
- [ ] Profile and routing behavior remain opt-in until their final gates pass.
- [ ] Large-diff handling preserves every changed hunk or reports explicit incompleteness.
- [ ] Deferred verification and outcome automation remain out of scope unless separately approved.

## Evidence log

| Date | Slice | Commit / PR | Validation | Result / notes |
| --- | --- | --- | --- | --- |
| 2026-09-02 | P0 | `a9f76aa` / [#1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) | `git diff --check origin/main...HEAD` | Passed for the original plan-only commit; `check` passed and `analyze` lacked Anthropic authentication. |
| 2026-09-02 | P1 / Plan PR 1 | `d685b3a` / [#2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2) | Node 22 focused gate; `npm run validate`; independent diff review | Passed locally: 31 Node tests, 25 skill checks, 9 packaging/install checks, 4 plugin-manager checks, and eight-case smoke benchmark. Initial remote checks were pending. |
