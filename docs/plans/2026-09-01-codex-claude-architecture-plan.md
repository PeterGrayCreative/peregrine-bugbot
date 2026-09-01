# Peregrine Bugbot Codex and Claude Architecture Improvement Plan

**Status:** Implemented on `main` candidate; live Claude completion awaits local re-authentication
**Date:** 2026-09-01
**Scope:** `peregrine-bugbot`, `bugbot-codex-skills`, local skill installation, provider runners, GitHub Actions, evaluation, documentation, and release workflow
**Verdict:** **READY** for Codex after validation; Claude adapter compatibility is covered by automated tests and a zero-token live startup check, while the local Claude OAuth credential is expired

## Implementation update

The consolidation described below is implemented in this repository: one skill
tree, dual plugin manifests, strict provider-neutral contracts, real Claude and
Codex runners, isolated GitHub analysis/posting jobs, runner-neutral evaluation,
package/installer validation, and current documentation. The live Codex
acceptance test on Shack PR 3449 completed without modifying or posting to the
target. Claude passed CLI/plugin/schema startup after an adapter fix, then
stopped at the provider boundary because the local OAuth token requires
re-authentication.

## Outcome

Peregrine should have one versioned source of truth that installs the same invariant-first review behavior for Claude and Codex, runs either provider through a strict shared result contract, and makes the active code, skill version, runner, and reviewed commit unambiguous.

## Why the local skill appears out of sync

The current system has several separately managed locations that look like one product but do not update together.

| Location | Actual role | Git/update behavior | State verified on 2026-09-01 |
| --- | --- | --- | --- |
| `/Users/petergray/Documents/peregrine-bugbot` | Bot runtime, GitHub posting, workflows, and evaluation | Git checkout of `PeterGrayCreative/peregrine-bugbot` | Clean for tracked files and exactly even with `origin/main` at `3d11b866c1e5e80d90dcd328295d8dbef0a2bbf8`; three untracked `.DS_Store` files |
| `/Users/petergray/Documents/bugbot-codex-skills` | Canonical source for the two review skills | Separate Git checkout of `PeterGrayCreative/bugbot-codex-skills` | Clean and exactly even with `origin/main` at `0ac67b548d81d8b73d5d92390b214d1b675f59c8` |
| `~/.agents/skills/invariant-first-pr-review` | Installed Codex skill | Independent copied directory; not a Git checkout | Byte-for-byte equal to the source skill checkout |
| `~/.agents/skills/build-review-profile` | Installed Codex skill | Independent copied directory; not a Git checkout | Byte-for-byte equal to the source skill checkout |
| `~/.codex/skills/build-review-profile` | Legacy duplicate installation | Independent copied directory; not a Git checkout | Byte-for-byte equal to the source skill checkout, but redundant with the canonical `.agents` copy |
| CI `.peregrine-skills` and `.claude/skills/invariant-first-pr-review` | Transient Claude runtime copy | Fresh checkout and copy performed by the workflow | Version is selected independently from the bot checkout and is not visible in the bot repository's Git status |

There is therefore **no current content drift in the installed skills**. The apparent mismatch is provenance and architecture drift:

1. The repository named `peregrine-bugbot` does not contain the skills. It links to and downloads another repository.
2. Updating the bot repository cannot update the skills repository or a user's installed skill directories.
3. Installed skills are copies without their own remote, branch, commit, or automatic update mechanism.
4. CI creates another transient copy and currently installs it only for Claude.
5. The legacy `~/.codex/skills` copy overlaps the canonical Codex `.agents/skills` installation and makes it difficult to know which discovery root supplied a displayed skill.
6. The bot describes itself as provider-neutral, but its configuration, evaluator, setup action, and production workflows remain Claude-specific.

This is the central architectural problem to solve. Synchronizing `peregrine-bugbot` alone cannot synchronize the skill because the skill is not part of that repository.

## Current architecture findings

### [blocking] Codex is represented by a stub rather than a runner

`src/engines/openai.ts` always throws, and the corresponding configuration contains `TODO` model values. Selecting the advertised alternate engine cannot complete a review.

### [blocking] Provider-neutral output is not enforced at the trust boundary

Claude output is coercively parsed into findings. Required failure evidence, safe paths, valid line ranges, reviewed commit identity, and allowed enum values are not validated by one strict shared schema before posting.

### [blocking] Review posting can target stale code or lose a valid batch

The posting layer accepts the head SHA supplied at workflow start but does not refresh the PR immediately before posting. One invalid inline anchor can cause GitHub to reject the entire review without a body-only fallback.

### [discuss] The bot and skills should become one release unit

The current split allows the runtime, workflow, skill, and installed copies to select unrelated revisions. Consolidating them removes a checkout token, eliminates most version-drift cases, and makes a release independently reproducible. The trade-off is migrating the separate skills repository and its existing installation instructions.

### [discuss] The runner should be named `codex`, not `openai`

The planned implementation uses Codex CLI and the Codex GitHub Action. That is a host/runtime boundary, not a generic OpenAI API implementation. A future direct Responses API runner should be named separately, such as `openai-api`.

### [advisory] Installation and packaging can be much smaller

The skills repository contains a large transactional installer because it distributes loose skill directories to two hosts. Native Claude and Codex plugins can use the same canonical `skills/` tree. Standalone ZIP packaging is still useful for hosted Claude surfaces, but local installation should no longer require a bespoke installer.

### [advisory] Repository hygiene obscures status checks

The bot repository does not ignore `.DS_Store`, leaving three untracked files in the working tree. They are unrelated to product code but make a clean synchronization check look dirty.

## Architectural decisions

The implementation should proceed with these defaults unless a later evidence-backed spike disproves them.

1. **Use one canonical repository.** Move both skills into `peregrine-bugbot/skills/`. After migration and one stable release, archive `bugbot-codex-skills` or replace its README with a migration pointer.
2. **Keep two skills.** `invariant-first-pr-review` and `build-review-profile` have different triggers and outputs and should remain independently invocable.
3. **Ship two plugin manifests around one skill tree.** Add `.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`; do not fork the skill text by host.
4. **Keep methodology provider-neutral.** Shared review rules stay in `SKILL.md` and shared references. Host invocation details move to bounded Claude and Codex adapter references.
5. **Rename the alternate runner to `codex`.** Remove the unimplemented `openai` registry entry. Reserve `openai-api` for an actual direct API integration.
6. **Make the review result schema the trust boundary.** No provider output may reach deduplication or GitHub posting until it passes strict validation.
7. **Separate analysis from mutation.** Model execution gets read-only repository access. GitHub posting runs afterward with no model-provider secret and only the validated artifact.
8. **Use immutable releases in reusable workflows.** Examples and production callers must use a release tag or commit SHA, never `@main`.

## Proposed repository layout

```text
peregrine-bugbot/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   └── plugin.json
├── .github/
│   ├── actions/setup-peregrine/
│   └── workflows/
├── docs/
│   ├── architecture.md
│   ├── configuration.md
│   ├── providers/
│   │   ├── claude.md
│   │   └── codex.md
│   ├── releasing.md
│   └── security.md
├── eval/
├── schemas/
│   └── review-result.schema.json
├── skills/
│   ├── build-review-profile/
│   └── invariant-first-pr-review/
├── src/
│   ├── cli/
│   ├── core/
│   ├── engines/
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   └── mock.ts
│   └── github/
├── AGENTS.md
├── CLAUDE.md
├── peregrine.config.json
└── package.json
```

## Implementation plan

### Phase 0: Protect the known-good baselines

**Purpose:** Make the migration reversible and prevent existing copies from being mistaken for new sources of truth.

Tasks:

1. Record the two verified source commits in the migration PR description and release notes.
2. Tag the final pre-consolidation revisions of both repositories.
3. Add `.DS_Store` to `peregrine-bugbot/.gitignore`; remove the three untracked local files through a recoverable cleanup only after explicit authorization.
4. Add a temporary CI assertion that the imported skill directories match the recorded skills-source commit during the migration PR.
5. Inventory repository callers of `review.yml@main`, direct `bugbot-codex-skills` installation links, and private checkout-token dependencies.

Verification:

- Both tags resolve to the recorded commits.
- The migration inventory names every known workflow caller and installation surface.
- No runtime behavior changes in this phase.

### Phase 1: Consolidate the skill source into the bot repository

**Purpose:** Establish one Git revision containing the runtime, workflows, skills, tests, and documentation.

Tasks:

1. Copy `bugbot-codex-skills/skills/` into `peregrine-bugbot/skills/` without changing file contents.
2. Move skill validation and packaging tests into a repository-level `tests/skills/` area.
3. Retain only scripts required for runtime validation and hosted-surface archives.
4. Add a repository validation command that checks both skill structures, links, scripts, metadata, and release manifests.
5. Change every source link and CI checkout from `bugbot-codex-skills` to the local canonical `skills/` tree.
6. Keep the old repository active until the consolidated release passes both-host acceptance tests.

Verification:

- A recursive comparison shows the imported skill directories match the recorded source commit.
- Existing shell validation and all 31 current skill tests pass from the consolidated repository.
- CI no longer needs a token to fetch `bugbot-codex-skills`.

### Phase 2: Package the same skills for Claude and Codex

**Purpose:** Remove host-specific forks while using native discovery and packaging.

Tasks:

1. Add `.codex-plugin/plugin.json` for the repository-level Codex plugin.
2. Add `.claude-plugin/plugin.json` for the Claude plugin.
3. Preserve each skill's existing `agents/openai.yaml` metadata.
4. Move Claude-only and Codex-only invocation guidance from the main review skill into `references/hosts/claude.md` and `references/hosts/codex.md`.
5. Keep shared review rules, lane selection, finding criteria, and profile trust behavior identical across hosts.
6. Make native plugin installation the primary local path.
7. Retain a small deterministic archive command only for hosted Claude uploads.
8. Add an `npm run doctor` command that reports the Peregrine release, selected runner, discovered skill paths, duplicate skill names, and whether an installation is copied or plugin-managed.

Verification:

- Claude and Codex each discover exactly two Peregrine skills from a clean test home.
- Both hosts expose matching names, descriptions, references, and scripts.
- The doctor command identifies the current redundant `~/.codex/skills/build-review-profile` copy.
- Changing a shared skill file changes both host packages in the same release.

### Phase 3: Introduce a strict provider-neutral review contract

**Purpose:** Make provider output interchangeable and safe to post.

Tasks:

1. Add `schemas/review-result.schema.json` as the canonical external result contract.
2. Add shared runtime validation under `src/core/` without silently coercing invalid results.
3. Require `reviewedBaseSha`, `reviewedHeadSha`, runner/model identity, duration, usage, and an explicit terminal status.
4. Validate every finding for a repository-relative path, ordered positive line range, allowed severity/category, non-empty explanation, non-empty failure path, and confidence from zero to one.
5. Distinguish `completed`, `clean`, `skipped`, `superseded`, and `failed` instead of representing every non-finding outcome as an empty array.
6. Split provider invocation from normalization so Claude and Codex cannot acquire different posting semantics.
7. Add contract fixtures for valid, invalid, clean, skipped, and stale results.

Verification:

- Both provider adapters pass the same contract suite.
- Malformed model output fails before fingerprinting or GitHub API construction.
- Missing confidence or failure evidence is rejected rather than promoted to the posting threshold.

### Phase 4: Replace configuration placeholders with typed runner configuration

**Purpose:** Make the active host and its limits explicit.

Tasks:

1. Replace `engine`/`engines` with versioned `runner`/`runners` configuration.
2. Add separate Claude and Codex model, breadth-model, effort/turn, timeout, and skill settings.
3. Replace generic model environment variables with runner-scoped variables.
4. Validate each declared runner block and fail with field-specific errors.
5. Apply `filters.ignorePaths` before diff-size accounting and prompt construction, or remove the setting.
6. Enforce `maxEscalations` in orchestration rather than relying only on prompt text.
7. Emit a structured `skipped` result when the filtered diff exceeds its configured budget.

Verification:

- Config unit tests cover both runners, all environment overrides, unknown runners, placeholders, and invalid limits.
- Ignored lockfiles and generated files do not consume the review budget.
- The job summary explains every skipped review.

### Phase 5: Implement the Codex runner

**Purpose:** Deliver a real Codex review path with the same skill and result contract as Claude.

Tasks:

1. Replace `src/engines/openai.ts` with `src/engines/codex.ts` and update the registry.
2. Use noninteractive Codex execution with an ephemeral session, read-only sandbox, explicit output schema, and explicit output file.
3. Generate a bounded breadth packet from the shared core.
4. Route the breadth pass to the configured fast model when the host exposes safe model routing.
5. Run final investigation and finding adjudication on the configured strong model.
6. Preserve the separate breadth and investigation passes with the strong model when subagent routing is unavailable.
7. Record actual runner, models, effort, token usage, cost when available, and fallbacks in `EngineResult`.
8. Inject command execution behind a testable boundary so adapter tests use fake processes rather than paid calls.

Verification:

- Codex mock-process tests cover success, schema failure, timeout, nonzero exit, missing skill, unavailable breadth routing, and cost omission.
- One key-gated local smoke run reviews a fixed fixture in a read-only sandbox.
- The working tree is unchanged before and after the live smoke run.

### Phase 6: Separate GitHub analysis and posting

**Purpose:** Keep untrusted model execution away from write credentials and prevent stale reviews.

Tasks:

1. Replace duplicated automatic and mention setup with one reusable core workflow and thin trigger workflows.
2. Add a required `runner: claude|codex` workflow input and conditionally require only the selected provider secret.
3. Check the target PR into `target/` and Peregrine into a sibling directory so tooling never dirties the reviewed checkout.
4. Run analysis in a read-only job that has no pull-request write permission.
5. Serialize, cap, and clearly mark title, body, comments, and diff text as untrusted data.
6. Transfer only a validated result artifact to the posting job.
7. Refresh the current PR head immediately before posting and mark a mismatched result `superseded`.
8. Validate inline paths and lines against the diff.
9. If GitHub rejects inline anchoring, retry once with all eligible findings in the review body.
10. Emit summaries for clean, skipped, superseded, failed, and posted results.
11. Pin external actions and reusable Peregrine callers to reviewed immutable versions.

Verification:

- Workflow tests prove the model job has read-only GitHub permissions and the posting job has no model secret.
- A simulated head change posts nothing.
- A simulated inline `422` produces one body-only review without losing findings.
- Fork PRs receive no provider secrets and execute no privileged review path.

### Phase 7: Make evaluation runner-neutral

**Purpose:** Measure Claude and Codex using the same behavioral standard.

Tasks:

1. Replace the hardcoded Claude judge with `exact`, `claude`, and `codex` judge adapters.
2. Add mock, Claude, and Codex matrix configurations.
3. Add cases for clean changes, seeded bugs, affected surfaces outside the diff, duplicated root causes, invalid output, stale heads, and oversized diffs.
4. Add blind historical PR cases without exposing expected findings or existing comments during review.
5. Report root-cause recall, false positives, duplicate rate, invalid-output rate, cost, and duration by runner.
6. Define a parity gate for conclusions and evidence quality rather than identical wording.

Verification:

- Exact/mock CI remains keyless and deterministic.
- Key-gated provider matrices use the same cases and grading contract.
- Static skill validation and behavioral forward tests both pass; neither substitutes for the other.

### Phase 8: Rewrite documentation and release as one product

**Purpose:** Make the source of truth, installation mode, runner selection, and security boundary obvious.

Tasks:

1. Rewrite `README.md` around four explicit surfaces: skills, local CLI, GitHub automation, and evaluation.
2. Replace `docs/design.md` with `docs/architecture.md` describing current boundaries and the implemented data flow.
3. Add `docs/configuration.md`, `docs/providers/claude.md`, `docs/providers/codex.md`, `docs/security.md`, and `docs/releasing.md`.
4. Add `AGENTS.md` for shared repository-development rules and a minimal `CLAUDE.md` that points Claude to the same canonical rules.
5. Document how to read `npm run doctor`, upgrade a plugin, detect duplicates, and verify the installed release.
6. Remove claims that are not yet true, including generic engine neutrality before the Codex acceptance gate passes.
7. Replace every mutable `@main` rollout example with a release tag or commit SHA.
8. Decide the public license before promoting third-party installation.
9. Publish a migration release, then archive or redirect `bugbot-codex-skills`.
10. Remove redundant legacy installations only after the plugin-managed installation is verified and with explicit user authorization.

Verification:

- Every documented command is tested from a clean clone with the pinned Node version.
- Every documentation link resolves.
- A new user can identify the canonical repository, installed version, selected runner, and upgrade path without inspecting source code.
- The old skills repository directs users to the exact consolidated release.

## Do's and don'ts

### Do

- Keep one canonical copy of shared skill behavior.
- Keep host differences at provider and packaging boundaries.
- Treat model output as untrusted input.
- Pin the reviewed base, head, skill release, and bot release in every result.
- Preserve read-only analysis and explicit mutation boundaries.
- Validate behavior with blind forward tests in both Claude and Codex.
- Make duplicate or stale installations visible through the doctor command.

### Don't

- Do not keep separate Claude and Codex forks of `SKILL.md`.
- Do not call a Codex CLI adapter a generic OpenAI engine.
- Do not copy tools into the checkout being reviewed.
- Do not allow installed skill directories to become editable sources of truth.
- Do not publish reviews against a head SHA that has not just been refreshed.
- Do not use mutable workflow references for organization rollout.
- Do not delete the legacy repository or installed copies until migration verification is complete.

## Rollout and rollback

1. **Consolidation shadow:** import skills and dual manifests while production workflows continue using the old Claude path.
2. **Claude equivalence:** run the consolidated Claude plugin against fixed fixtures and blind historical PRs. If behavior differs, revert workflow selection to the pre-consolidation tag.
3. **Codex shadow:** run Codex without posting and retain validated result artifacts for comparison.
4. **Opt-in active Codex:** enable posting in one repository after precision, stale-head, and security gates pass.
5. **Default selection:** choose the default runner from evaluation evidence, not vendor preference.
6. **Repository retirement:** archive the old skills repository only after all callers and installations have migrated.

Every rollout phase should be reversible by changing one pinned release reference. Do not require rewriting consumer workflows to roll back.

## Completion criteria

The architecture work is complete only when:

- One Git revision contains the bot, both skills, both plugin manifests, schema, workflows, documentation, and tests.
- Claude and Codex load the same skill release without modifying the target checkout.
- `npm run doctor` reports no ambiguous duplicate installation in the validated environment.
- Both provider adapters emit the same strictly validated result contract.
- Invalid, stale, skipped, and clean outcomes are explicit and tested.
- Analysis runs without GitHub write permission; posting runs without provider secrets.
- Stale-head and inline-comment failure tests prove that no misleading or lost review is posted.
- Keyless CI passes typecheck, unit tests, skill validation, workflow validation, and the mock evaluation pipeline.
- One blind Claude and one blind Codex forward test meet the agreed precision and recall gates.
- Production callers use an immutable Peregrine release.
- The old skills repository and legacy copied installations have a documented, verified migration outcome.

## Risks and external decisions

- **License:** Plugin distribution should not be promoted until the intended license is explicit.
- **Historical consumers:** Private callers of `review.yml@main` may not be discoverable from this repository alone.
- **Model churn:** Model identifiers and pricing will change; configuration and benchmark results must record the evaluated release and date.
- **Hosted-surface limitations:** Claude.ai/Cowork and local CLI installations may need different packaging even though skill content stays canonical.
- **Plugin discovery behavior:** The implementation must verify the exact Claude and Codex CI installation mechanism in isolated test homes before removing the fallback archive/install path.
- **Paid evaluation:** Live parity cannot be proven with mock fixtures alone and requires explicit provider credentials and a bounded budget.

## Verification commands for implementation

Run Node commands only after activating the repository's pinned version:

```bash
nvm use '22'
npm ci
npm run typecheck
npm test
npm run validate:skills
npm run eval:matrix -- --config 'eval/matrix.smoke.json'
JUDGE='exact' npm run eval:grade
npm run eval:report
```

Exact script names that do not exist yet are deliverables of the corresponding phase and must be added to `package.json` before these completion commands become binding.

## Coverage Confirmation

### Evaluated

- **Repositories:** `peregrine-bugbot` and `bugbot-codex-skills`, including live remotes and current heads.
- **Installed copies:** `~/.agents/skills/invariant-first-pr-review`, `~/.agents/skills/build-review-profile`, and `~/.codex/skills/build-review-profile`.
- **Files:** All 36 tracked bot files; both skill directories; repository README/design/configuration; TypeScript engine and posting boundaries; GitHub actions/workflows; evaluation configuration and grader; installer, packaging, and validation scripts.
- **Rules applied:** Architecture separation, provider portability, configuration ownership, skill discovery, output validation, secret boundaries, immutable release selection, duplicate installation behavior, and smallest-testable task breakdown.
- **Checks:** [x] fetched both remotes [x] compared ahead/behind [x] checked tracked/untracked state [x] recursively compared installed skills [x] reviewed architecture/docs/config [x] reused prior typecheck and keyless baseline evidence [ ] live Claude run [ ] live Codex run [ ] GitHub posting integration

### Not evaluated

- **Missing context:** Organization-wide caller inventory, provider budget, and desired public license.
- **Out of scope:** Implementing the plan, deleting duplicate installations, changing either remote repository, or posting a live review.
- **Skipped:** Paid provider evaluations and destructive cleanup because neither was authorized by this planning request.

### Confidence

| Area | Level | Rationale |
| --- | --- | --- |
| Current Git synchronization | High | Both repositories were fetched and compared directly with their upstream branches |
| Installed skill equality | High | Recursive comparisons found no content differences from the current skills source checkout |
| Drift root cause | High | Repository links, workflow checkout/copy behavior, and local discovery locations were inspected directly |
| Target boundaries | High | The plan centralizes existing contracts and isolates provider and mutation boundaries |
| Claude behavioral equivalence | Medium | Static structure and previous keyless checks passed, but no paid live run was performed for this plan |
| Codex behavioral equivalence | Low | The Codex runner is currently a stub and must be implemented and forward-tested |
| Organization migration effort | Low | External workflow callers and private installations have not yet been inventoried |
