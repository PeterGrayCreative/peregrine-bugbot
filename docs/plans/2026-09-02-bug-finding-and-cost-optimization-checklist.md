# Peregrine Bug-Finding and Cost Optimization Implementation Checklist

**Companion plan:** [2026-09-02-bug-finding-and-cost-optimization-plan.md](./2026-09-02-bug-finding-and-cost-optimization-plan.md)
**Status:** Active
**Last updated:** 2026-09-04

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
| P0 | Publish the approved plan | - | Merged | [#1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) |
| P0 follow-up | Add this implementation checklist | P0 | Merged | [#3](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/3) |
| P1 / Plan PR 1 | Persist and report every matrix attempt | - | Merged | [#2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2) |
| Plan PR 2 | Blind and isolate case materialization | PR 1 | Merged | [#5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5) |
| Safety PR 2A.1 | Bootstrap and attest the provider runtime image | PR 2 | Merged; accepted digest available | [#9](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/9) |
| Safety PR 2A.2 | Pin the accepted digest and enforce live filesystem containment | PR 2A.1 | Merged | [#15](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/15) |
| Plan PR 3 | Reproduce base/head history and production manifest path | PR 2 | Merged | [#7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7) |
| Plan PR 4 | Root-cause grading, adjudication, and miss stages | PRs 3, 6 | Merged | [#17](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/17), [#18](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/18), [#19](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/19) |
| Plan PR 5A | Provider-correct usage, cost, and observed work | PR 1 | Merged | [#11](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/11) |
| Plan PR 5B | Immutable experiment scheduling, resume, and ceilings | PR 5A | Merged | [#13](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/13), [#14](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/14) |
| Plan PR 6 | Typed manifest shadow/parity mode | PR 3 | Merged | [#16](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/16) |
| Plan PR 7 | Seeded visible corpus and diagnostic baseline | PRs 4-6 | Seeded corpus merged; historical gold and holdout remain pending | [#21](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/21) |
| Benchmark capability checkpoint | Reproducible Codex screening, contained judge, grading, and report | PRs 1-7 | Merged | [#21](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/21) |
| Stage 2 variance baseline | Three-repeat strong-control versus Luna-medium screening | Benchmark checkpoint | Complete; Luna-medium replacement rejected | Pending |
| Plan PR 8 | Stable investigator core and variable appendix | PR 7 | Merged; screening accepted | [#24](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/24), [results](../validation/2026-09-04-stage2-pr8-results.md) |
| Plan PR 9 | Structural breadth compaction and schema bounds | PR 8 | Implementation and preregistration complete; validation and screening pending | [preregistration](../validation/2026-09-04-stage2-pr9-preregistration.md) |
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
- [x] Record the terminal PR #1 checks: `check` passed, `analyze` failed because Anthropic authentication was unavailable, and `post` was skipped.
- [x] Merge PR #1 as `74a0f6872359e388b1083a190d847c27435550f9`.
- [x] Add this implementation checklist in a docs-only follow-up branch based on the latest `origin/main`.
- [x] Confirm the follow-up docs-only diff passes `git diff --check`.
- [x] Merge PR #3 as `7556a8dfe0300a076cdc2671bea0c92fed69a79f`.

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
- [x] Record the terminal PR #2 checks for `d685b3a`: `check` passed, `analyze` failed because Anthropic authentication was unavailable, and `post` was skipped.
- [x] Merge PR #2 as `e1e747a9ad54c4f99a14bbad0bf952cd229dd10d`.

Rollback boundary: revert PR #2; model prompts, routing, topology, posting behavior, and fixture materialization remain unchanged.

## Plan PR 2 - Blind and isolate case materialization

- [x] Use opaque IDs in case directories, temporary paths, logs, and model-visible metadata.
- [x] Create a fresh materialized repository for every case/configuration/repeat attempt.
- [x] Keep ground truth, later fixes, review threads, issue text, and curator notes outside the model-visible checkout.
- [x] Remove remotes, credentialed Git configuration, and commits newer than the reviewed head.
- [x] Separate structural-smoke fixtures from live-model development and validation cases.
- [x] Scan prompt text, checkout paths, repository files, and accessible history for answer leakage.
- [x] Reject undocumented answer markers such as `BUG`, `FIXME`, expected outcomes, and ground-truth IDs.
- [x] Record provider-host network-isolation capability or limitation.
- [x] Add negative tests demonstrating that descriptive paths and accessible answer material fail validation.
- [x] Run `npm run validate` under Node `22.22.1` on final rebased head `64ad038edddffd343631325030c7f4fcf783c0be`.
- [x] Record a zero-provider-cost structural screening result: 8/8 attempts completed, all 5 expected seeded markers transported and graded, and 0 findings on 3 clean controls. This is structural evidence only, not model-recall or provider-cost evidence.
- [x] Open, independently review, and merge [PR #5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5) as `4e99748ba57208c86976a632ad4efb85011f7e7a` before starting PR 3.

Evidence: [Plan PR 2 validation record](../validation/2026-09-02-eval-case-isolation.md) and [PR #5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5). Three independent adversarial reviews found no remaining code blocker before the branch was rebased and revalidated. On the final ready head, `check`, `analyze`, and `post` passed; earlier draft-triggered review jobs were skipped.

Must stay untouched: production prompts, routing, posting, and model selection.

Integration note: this slice establishes isolation, opaque identities, containment, cleanup, and leakage gates. Deterministic ancestry, exact `merge-base...head` equivalence, and production-manifest parity close in Plan PR 3.

## Safety PR 2A - OCI filesystem containment for live evaluation

Plan PR 2 proves that isolated homes, opaque paths, CLI flags, and read-only tool modes do not create a host-filesystem confidentiality boundary. Until this prerequisite lands, Claude and Codex live matrix attempts fail as configuration outcomes before either provider process starts.

### Safety PR 2A.1 - Image bootstrap

- [x] Pin the Node base image, Claude CLI, Codex CLI, package lock, workflow actions, and build helpers.
- [x] Restrict the build context and run the image as a non-root user.
- [x] Add one executable, strictly parsed Docker probe contract with negative mutation tests.
- [x] Dynamically probe read-only root and input mounts, writable output, tmpfs state, loopback-only networking, provider versions, and absence of credentials.
- [x] Keep pull-request verification read-only and credential-free.
- [x] Restrict GHCR publication to manual dispatch from `main` with job-scoped permissions.
- [x] Probe the exact pushed digest on both amd64 and arm64 before attesting that digest.
- [x] Run `npm run validate`, independent security/supply-chain reviews, and open [PR #9](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/9).
- [x] Require the pull-request image build and zero-credential container smoke to pass before merge.
- [x] After merge, manually publish and verify an attested candidate before accepting its digest for Safety PR 2A.2.

Evidence: [Safety PR 2A.1 validation record](../validation/2026-09-03-eval-runtime-image-bootstrap.md) and [PR #9](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/9), merged as `cfe9282158c9663f7bd0f40bf85a92f83076af2a`. Repository CI and the actual zero-credential image build/containment smoke passed. The manual publish job correctly skipped on the PR. The optional self-review could not authenticate because `ANTHROPIC_API_KEY` was empty, so `post` skipped. This bootstrap creates a quarantined candidate only; it does not open live evaluation.

### Safety PR 2A.2 - Runtime containment

- [x] Require a Linux OCI image pinned by immutable digest; never auto-pull during an experiment.
- [x] Mount only the sanitized checkout read-only, sanitized Peregrine assets read-only, and one attempt-owned output directory read-write.
- [x] Use container-only tmpfs mounts for provider state and scratch data.
- [x] Exclude the host home, source corpus, host temporary directories, Docker socket, SSH agent, Git credentials, and unrelated environment variables.
- [x] Pass provider secrets by allowlisted environment-variable name without placing values in argv, logs, manifests, or diagnostics.
- [x] Mount only the explicitly selected provider-specific CLI session when `providerAccess` is `cli-session`; never expose an ambient user home or fall back to an API key.
- [x] Disable repository-controlled instructions, rules, hooks, MCP servers, plugins, skills, agents, and inherited shell environment inside both provider CLIs.
- [x] Probe checkout/assets/output permissions, sibling-host-file denial, provider CLI versions, daemon availability, image digest, mounts, and cleanup before live attempts.
- [x] Fail closed on unsupported platforms, missing or inaccessible runtimes, mutable image tags, digest mismatch, failed probes, or unknown provider flags.
- [x] Force-remove timed-out containers by opaque name and prove no process or container survives.
- [x] Record filesystem containment separately from network isolation; outbound provider access remains `limited` unless an egress allowlist is independently attested.
- [x] Reuse the pure argv contract and add a fake-provider containment smoke test that incurs no model cost.
- [x] Run `npm run validate`, open, review, and merge [PR #15](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/15) before any live-model benchmark or Plan PR 7 baseline.

Evidence: PR #15 merged as `a83de1a`. The accepted private image is
`ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`.
The host authenticates and pre-pulls that exact digest; runtime containers retain
`--pull never` and never receive Docker or registry credentials.

Must stay untouched: model prompts, model selection, routing, grading policy, and production review execution.

Decision gate: accept the attested `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:<digest>` candidate before Safety PR 2A.2 can be accepted. Do not substitute deprecated macOS `sandbox-exec` or an inner CLI read-only mode for the outer mount boundary.

## Plan PR 3 - Reproducible base/head history and production manifest path

- [x] Materialize deterministic base and head commits with preserved ancestry.
- [x] Ensure the reviewed working tree matches the head commit.
- [x] Verify the checked-in diff equals the materialized `merge-base...head` diff after documented normalization only.
- [x] Exercise the same manifest entry point used by production reviews.
- [x] Cover additions, deletions, renames, binaries, and profile changes.
- [x] Record base, head, merge base, and provenance in run artifacts.
- [x] Fail closed when history, diff, or manifest provenance cannot be reproduced.
- [x] Add tests proving no future fixing commit or remote remains accessible.
- [x] Run `npm run validate` and the structural screening corpus.
- [x] Open and independently review [PR #7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7).
- [x] Merge PR #7 as `8edcc9f573e4e8186d1ec504329e58a4818aeba9` before Plan PR 6. Plan PR 4 follows Plan PR 6 so routing-versus-breadth misses use typed manifest evidence.

Evidence: [Plan PR 3 validation record](../validation/2026-09-02-eval-reproducible-history.md) and [PR #7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7). Two independent exact-head reviews found no remaining blocker before publication. On the final ready head, `check`, `analyze`, and `post` passed; earlier draft-triggered review jobs were skipped.

Must stay untouched: grading policy, prompts, budgets, and routing.

## Plan PR 4 - Root-cause grading, adjudication, and miss stages

- [x] Establish one canonical built-in lane registry and explicit lane-to-finding-category mapping.
- [x] Extend ground truth with lane, expected severity, expected disposition, reachable preconditions, observable impact, provenance, and root-cause group.
- [x] Credit one finding for multiple observations only inside the same root-cause group.
- [x] Keep bug-instance and root-cause recall as separate metrics.
- [x] Record semantic-judge failures as outcomes instead of aborting or dropping attempts.
- [x] Blind the semantic judge to engine, route, and treatment.
- [x] Classify unmatched findings as `confirmed-new`, `unsupported`, or `unresolved`.
- [x] Classify misses as routing, breadth, investigation, budget, presentation, or infrastructure failures.
- [x] Add deterministic many-to-one, cross-group, disagreement, clean-control, and judge-failure tests.
- [x] Freeze and hash judge behavior before comparisons.
- [x] Run `npm run validate` and contained semantic-judge comparisons.
- [x] Open, review, and merge [PR #17](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/17), [PR #18](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/18), and [PR #19](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/19).

Must stay untouched: provider prompts and production posting thresholds.

## Plan PR 5 - Provider-correct usage, cost, work, and experiment metadata

### Plan PR 5A - Provider-correct usage, cost, and observed work

- [x] Preserve provider-specific base, uncached, cache-write, cache-read, output, and reasoning-output fields without flattening semantics.
- [x] Record turns, tool calls, tool-output bytes, prompt bytes, stage duration, total duration, and provider-reported cost when exposed.
- [x] Keep missing usage, work, or price data unavailable rather than free.
- [x] Version price tables with `pricingAsOf`, service-tier, context-tier, cache, and reasoning assumptions.
- [x] Preserve completed-stage work and partial incurred cost on provider, timeout, parse, artifact-construction, and cleanup failures.
- [x] Record an explicit unavailable reason when provider failure telemetry was not observed or had to be secret-redacted.
- [x] Keep immutable schema-v1 isolation evidence readable independently of later runtime capability changes.
- [x] Add captured Claude and Codex provider-envelope fixtures plus aggregation, malformed-stream, cleanup, pricing, and reader/writer tests.
- [x] Run `npm run validate` under Node `22.22.1`: 115/115 Node tests, all skill/package checks, and 8/8 zero-cost structural smoke attempts passed.
- [x] Open and independently review [PR #11](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/11).
- [x] Merge PR #11 as `5588bf0a80e613c714ff3289bc7ac273d1a7dc9b`.

Evidence: [Plan PR 5A validation record](../validation/2026-09-03-provider-usage-cost-metadata.md). No live provider was invoked, so this is implementation and structural evidence rather than a measured provider-cost comparison.

### Plan PR 5B - Immutable experiment scheduling, resume, and ceilings

- [x] Record repository, corpus, prompt, method, schema, profile, judge, and configuration hashes.
- [x] Record exact model identifiers, CLI versions, run order, random seed, timestamps, cache condition, and provider availability.
- [x] Define and persist explicit `api-key` and `cli-session` access modes, including Codex subscription-backed runs, without inferring an ambient login or silently changing access mode. Operational session mounting remains a Safety PR 2A.2 gate.
- [x] Keep monetary cost best-effort for session-backed runs: record `n/a` rather than zero when unavailable, preserve observed token/work telemetry, and enforce a hard provider-attempt ceiling.
- [x] Randomize and interleave contemporaneous control/treatment attempts.
- [x] Represent retries as new attempts linked to the original attempt.
- [x] Add spend, wall-clock, failure-rate, and early-stop ceilings.
- [x] Add resume behavior that never overwrites failed evidence.
- [x] Add deterministic schedule, retry-lineage, resume, ceiling, immutable-manifest, lock, evidence-binding, schema-parity, and symlink-safe-write tests.
- [x] Run `npm run validate` under Node `22.22.1`: 138/138 Node tests, all skill/package checks, and 8/8 zero-cost structural smoke attempts passed with 5/5 expected markers.
- [x] Open, review, and merge [PR #13](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/13); merge the multi-platform probe repair in [PR #14](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/14).

Must stay untouched: model behavior and routing.

Integration note: this slice must preserve the telemetry needed for cost per reliably found root cause. The derived metric is added after Plan PR 4 supplies root-cause-aware grading rather than using a temporary proxy.

## Plan PR 6 - Typed manifest shadow/parity mode

- [x] Add JSON output to the canonical manifest producer without removing human-readable output.
- [x] Define and version the manifest schema.
- [x] Strictly parse root fields, file entries, lane activations, profile provenance, warnings, and safe repository-relative paths.
- [x] Preserve base/head/merge-base provenance, rename statistics, binary metadata, and activation reasons.
- [x] Read repository profiles and custom lanes only from the merge base unless an explicit trusted external profile is supplied.
- [x] Treat head-authored profile changes as reviewed code, not active policy.
- [x] Run text and JSON manifest paths together in shadow mode.
- [x] Prove parity across the representative fixture matrix before changing prompt or routing consumers.
- [x] Add macOS realpath/symlink-path regression coverage.
- [x] Run `npm run validate` and manifest parity tests.
- [x] Open, review, and merge [PR #16](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/16).

Must stay untouched: prompt content and route selection.

## Plan PR 7 - Curated gold set v1 and unmodified baseline

- [ ] Select repository and architecture families for development, validation, and holdout cases.
- [ ] Assign a holdout steward who is not tuning the implementation.
- [x] Decide that reduced, authenticated fixtures may be checked in; private historical cases must remain curator inputs until separately sanitized and approved.
- [x] Curate at least 30 independently confirmed visible seeded cases.
- [x] Cover all twelve built-in lanes in both visible corpora.
- [x] Keep at least 25% clean controls on surfaces comparable to bug cases.
- [x] Include direct, seam, multi-observation, and representative large-diff cases.
- [x] Separate visible development and validation sets.
- [ ] Store the sealed holdout outside implementer and model access.
- [x] Validate reachability, expected severity/disposition, root cause, line range, and provenance for every visible bug.
- [ ] Run and record the unmodified production baseline before prompt optimization.
- [ ] Report repository, language, size, lane, severity, root cause, failures, precision, recall, cost, and clean-case strata.
- [ ] Open, review, and merge the corpus/baseline PR without exposing sealed holdout material.

Seeded-corpus checkpoint: 36 admitted cases (20 development, 16 validation;
24 bug, 12 clean) cover all 12 lanes, three languages, six architecture
families, four multi-observation cases, and three large-diff cases. Two fresh
independent reviewers confirmed every repaired case. This is sufficient to run
diagnostic experiments, but it deliberately does not claim historical-gold or
sealed-holdout readiness.

Checkpoint 1: the baseline is reviewable and the holdout remains unopened.

## Plan PR 8 - Stable investigator core and variable appendix

- [x] Build a stable prefix containing role/trust rules, investigator workflow, finding contract, all built-in lane summaries, and output rules.
- [x] Build a variable appendix containing activated lane details, trusted profile/custom lanes, PR metadata, typed manifest, frozen breadth ledger, optional bounded context, and diff.
- [x] Add required-heading checks and fail closed when canonical source sections move.
- [x] Snapshot and hash the compiled method packet.
- [x] Keep repository-controlled profile/custom-lane content outside trusted method tags.
- [x] Tell the investigator not to reread coordinator-only orchestration files.
- [x] Preserve interactive skill behavior and lane text.
- [x] Record actual cache reads by arm and repeat. The Codex CLI exposed no cache writes or supported reset, so the preregistered cache condition is uncontrolled and the report makes no causal cold/warm claim.
- [x] Run `npm run validate` on the implementation commit.
- [x] Run a randomized paired eight-case, three-repeat screening comparison.
- [x] Pass the preregistered cost-change non-inferiority gate before opening the PR.

Rollback boundary: revert PR 8; no other intervention depends on its measured benefit yet.

## Plan PR 9 - Structural breadth compaction and schema bounds

- [x] Add output-schema item and string-length bounds.
- [x] Preserve every candidate, escalation, unavailable file, covered file, and per-file/per-lane clear count.
- [x] Preserve a bounded sample of clear explanations, allowing zero only when required to fit all high-value content.
- [x] Record original, compacted, and omitted counts with recomputable provider/transmitted evidence.
- [x] Fail closed only when preserved high-value content exceeds the hard limit.
- [x] Keep binary changes visible as structured metadata.
- [x] Add clear-heavy compaction, high-value overflow, no-loss, artifact-tamper, and failure-accounting tests.
- [x] Run `npm run validate` under Node `22.22.1`: 240/240 Node tests,
  36/36 admitted corpus cases, all skill/package/plugin checks, and the 8/8
  zero-cost structural smoke passed with 5/5 expected markers.
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

- [x] PRs 1-6 merged.
- [x] Failed and missing work cannot disappear from reports.
- [x] Every live case is blind and isolated.
- [x] Base/head history and production manifest behavior are reproducible.
- [x] Typed-manifest shadow output matches the canonical manifest.
- [x] Grading failures and unmatched findings remain visible.
- [x] Provider usage and experiment provenance are complete enough for comparison.

### Checkpoint 1 - Gold set and baseline

- [ ] PR 7 merged.
- [x] At least 30 curated seeded cases exist across development and validation sets.
- [x] All twelve built-in lanes and at least 25% clean controls are represented.
- [ ] The sealed holdout remains inaccessible and unopened.
- [ ] The unmodified baseline report is committed or linked as validation evidence.

Diagnostic capability is complete before Checkpoint 1: the checked-in screening
configuration can run real Codex control/treatment attempts, contained semantic
judging, grading, and reporting. Checkpoint 1 remains open until historical
families, a steward-controlled holdout, and the full unmodified baseline exist.

### Checkpoint 2 - Cost intervention

- [x] Run and record the preregistered three-repeat Stage 2 variance baseline.
- [x] Reject Luna-medium-only as a production replacement after one reliable
  high-severity seeded regression despite a 25.7% median paired wall-time gain.
- [ ] PRs 8-9 merged.
- [ ] No reliably detected high-severity root cause regresses.
- [ ] No more than one total visible seeded bug regresses from detection in at
  least two of three runs.
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
- [x] Decide private-case storage and sanitization policy for the seeded corpus.
- [x] Set per-screening provider-attempt ceiling; monetary spend remains `n/a` for CLI-session runs.
- [ ] Set per-checkpoint provider-spend ceiling.
- [x] Set wall-clock and failure-rate stopping rules for the diagnostic screening.
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
| 2026-09-02 | P0 | `a9f76aa` / [#1](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/1) / merge `74a0f68` | `git diff --check origin/main...HEAD`; final GitHub checks | Docs diff passed; `check` passed, `analyze` failed because Anthropic authentication was unavailable, and `post` was skipped. PR merged. |
| 2026-09-02 | P0 follow-up | `da657c7` / [#3](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/3) / merge `7556a8d` | `git diff --check origin/main...HEAD`; final GitHub checks | Docs diff passed; `check` passed, `analyze` failed because Anthropic authentication was unavailable, and `post` was skipped. PR merged. |
| 2026-09-02 | P1 / Plan PR 1 | `d685b3a` / [#2](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/2) / merge `e1e747a` | Node 22 focused gate; `npm run validate`; independent diff review; final GitHub checks | Passed locally: 31 Node tests, 25 skill checks, 9 packaging/install checks, 4 plugin-manager checks, and eight-case smoke benchmark. Remotely, `check` passed, `analyze` failed because Anthropic authentication was unavailable, and `post` was skipped. PR merged. |
| 2026-09-02 | Plan PR 2 | [#5](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/5) / merge `4e99748` | Isolation validation record; `npm run validate`; independent adversarial reviews | Live case materialization is opaque, isolated, leakage-scanned, and separated from truth. |
| 2026-09-02 | Plan PR 3 | [#7](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/7) / merge `8edcc9f` | Reproducible-history validation; production manifest parity | Base/head ancestry and reviewed diff reproduce exactly without future commits or remotes. |
| 2026-09-03 | Safety PR 2A | [#9](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/9), [#14](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/14), [#15](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/15) / merge `a83de1a` | Multi-platform image probes; containment mutation tests; `npm run validate` | Accepted private, digest-pinned runtime is pre-pulled by the authenticated host and run with `--pull never`; provider containers receive no registry credentials. |
| 2026-09-03 | Plan PR 5A | [#11](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/11) / merge `5588bf0` | 115 Node tests; all repository gates; structural smoke | Provider-correct usage/work telemetry merged; unavailable monetary cost remains `n/a`. |
| 2026-09-03 | Plan PR 5B | [#13](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/13) / merge `fb29c6b` | 138 Node tests; immutable schedule/resume/ceiling tests; structural smoke | Immutable, interleaved experiments and explicit CLI-session access merged. |
| 2026-09-03 | Plan PR 6 | [#16](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/16) / merge `616ef0f` | Typed-manifest schema and shadow parity; `npm run validate` | Canonical text and typed JSON manifest paths agree across representative fixtures. |
| 2026-09-03 | Plan PR 4 | [#17](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/17), [#18](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/18), [#19](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/19) / merge `06ccc43` | Root-cause grading tests; contained judge mutation tests; accepted runtime | Blinded semantic decisions, unmatched-finding dispositions, miss stages, judge failures, and root-cause recall remain explicit evidence. |
| 2026-09-03 | Corpus admission | [#20](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/20) / merge `3695bbd` | Strict source authentication and independent-review policy tests | Behavioral cases cannot become admitted without authenticated source, proof, and registered independent confirmations. |
| 2026-09-03 | Seeded corpus and live screening | aggregate head `64818f6`; [#21](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/21) / merge `f8d430e` | 36/36 cases admitted; 222/222 Node tests; all repository gates; 16/16 review attempts and 16/16 blinded judge decisions; two independent exact-head reviews | Diagnostic Luna-medium treatment preserved 100% measured recall/precision with 43.47% lower mean wall time and 59.72% lower mean input tokens than the control. See [validation record](../validation/2026-09-03-luna-medium-screening.md). Historical gold and sealed holdout remain explicitly pending. |
