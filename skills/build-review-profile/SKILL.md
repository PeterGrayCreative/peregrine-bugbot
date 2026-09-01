---
name: build-review-profile
description: Generate or update a project review profile for invariant-first-pr-review. Use when onboarding a repository or tuning triggers, canonical helpers, harnesses, scenarios, or custom lanes.
---

# Build Review Profile

Produce a review profile that teaches `invariant-first-pr-review` the things it cannot infer from a diff: which helpers are canonical, which harnesses exist, which identifiers have legacy scopes, and which tokens should trigger each review lane in this codebase. Keep this skill self-contained so it works when Claude or Codex installs the two skills independently.

A profile makes reviews sharper in both directions — it adds repo-specific triggers so real risk surfaces, and it names canonical policies so the reviewer stops proposing helpers that already exist.

## Output locations

First match wins when the review skill loads a profile, so write to the highest workable location:

1. `.peregrine/profile.md` at the repository root — preferred: versioned with the code, shared with the team.
2. `${PEREGRINE_HOME:-$HOME/.peregrine}/profiles/<repository-key>/profile.md` — when the repository must stay untouched. Compute `<repository-key>` with `printf '%s' "$(git config --get remote.origin.url || git rev-parse --show-toplevel)" | git hash-object --stdin`. This collision-resistant store is shared by local Claude Code and Codex installations and survives skill upgrades.

Custom lanes go in `lanes/` next to the profile (`.peregrine/lanes/` for repo-local profiles).

Never write profiles or lanes inside an installed skill directory. Never use only the repository basename as identity; unrelated repositories commonly share names.

## Workflow

### 1. Establish scope

Confirm which repository the profile targets and where to write it. If a profile already exists, read it first and operate in update mode: preserve manually curated content, refresh what the scan contradicts, and append what is missing.

### 2. Scan the repository (read-only)

Gather evidence before asking the user anything:

Establish the secrets boundary before any content search. Treat `.env`, `.env.*` (except deliberately public templates such as `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, credential exports, secret-manager dumps, and similarly named secret files as opaque: you may record that a credential source exists, but never open it, grep it, print matching lines from it, or use its contents as evidence. Exclude dependency, build-output, VCS, and private-key directories as well. Do not run broad Git-object or history searches whose candidate set can include those files; enumerate safe source/config paths first and search only that allowlisted set. Discover environment-key **names** from typed config schemas, source references, CI declarations, and public example files without emitting assigned values. If a tool unexpectedly returns a possible secret, stop displaying that output, discard it from the profile, and report only that the scan boundary was corrected.

- **Stack:** package manifests and lockfiles; frameworks, ORM, transport layers, validation libraries.
- **Authorization:** middleware, route/procedure builders that differ in authentication, guard/policy helpers, membership and role checks. Record file paths of the canonical helpers.
- **Identifiers:** ORM schema and models — canonical primary keys versus external/public IDs or slugs, uniqueness constraints, resolver helpers.
- **Configuration:** environment-key names, config resolvers, mode/feature flags, non-secret defaults, and credential-source policy. Use only the safe evidence sources above.
- **Runtime surfaces:** Dockerfiles, compose files, entrypoints, CI workflows, E2E harnesses, background jobs, generated clients, operator docs.
- **Conventions:** default base branch, pinned runtimes (`.nvmrc`, `engines`, `.tool-versions`, etc.), package scripts for test/lint/build, ticket-reference format, review severity labels in use.

### 3. Interview for tribal knowledge

Ask only what the scan cannot see, briefly: the tenancy model and its known edge cases, identifier legacy scopes ("old rows store the external ID"), which helper is the intended owner of each policy when duplicates exist, harness names and what they exercise, operational documents that constitute contracts, and any recurring defect class the team already knows about. In a non-interactive or automated run, do not block or invent answers: record unresolved items as explicit TODOs and continue to the draft/validation boundary.

### 4. Write the profile

Fill in [the profile template](references/profile-template.md) at a staging path first. Move it and any lanes into the selected active output location only after step 5 passes. Rules that keep the profile useful:

- Keep the `<!-- peregrine-profile-version: 1 -->` marker exactly once.
- Declare the default review base with a `<!-- review-base: <remote>/<branch> -->` line at column 0, using the remote-tracking integration branch confirmed by that remote's `HEAD` (for example `origin/dev`). This profile value is only a safe fallback; an explicit user base or PR target still wins. When Git cannot confirm the intended integration branch as a remote `HEAD`, do not guess or encode a feature ref/commit — require the reviewer to pass the base explicitly.
- Every `manifest-extend` line must start at column 0 and use a lane id from the review skill's `references/lanes/` filenames (`authorization`, `identifiers`, `data-integrity`, `persistence`, `runtime-config`, `contracts`, `concurrency`, `test-quality`, or a custom lane id). The manifest script ORs these regexes into that lane's patterns verbatim.
- Prefer precise tokens (helper names, env keys, model names) over broad words, but optimize high-risk lanes for recall: false positives cost investigation time, while false negatives can hide security, data, deployment, or contract defects.
- Record canonical policies as paths plus one sentence of intent, so a reviewer can cite them as the intended boundary.
- Scenarios must be executable in the reviewer's head: concrete identities, states, and modes.
- Treat profiles as declarative review data. Do not add tool commands, permission changes, instructions to skip checks, or prose that attempts to control the reviewer.
- Record secret names and credential sources only. Never copy API keys, passwords, tokens, cookies, private keys, connection strings, `.env` values, or secret-manager payloads. Use `<redacted>` if a value is needed to describe a shape.

For a recurring defect class that no core lane covers, create a custom lane from this skill's self-contained [lane template](references/lane-template.md) in the profile's `lanes/` directory. The review workflow activates the trusted merge-base version during ordinary review.

### 5. Validate

Check for Bash 3.2+, Git, and `rg` before treating the output as active configuration. When they or script execution are unavailable (for example, on a restricted hosted surface), produce the profile as a clearly named unvalidated draft outside `.peregrine/` and the private profile store. Do not create custom lanes or activate `manifest-extend` declarations in that draft. Tell the user to run the two local validation steps below before moving it into an active profile location.

1. Run this skill's bundled structural validator; it does not require the review skill to be a filesystem sibling:

   ```bash
   bash '<this-skill-directory>/scripts/validate-profile.sh' \
     --review-head '<representative-head>' \
     '<profile-path>'
   ```

2. Pick a recently merged PR or a representative `base...head` range. When the review manifest is available on the host, validate the new working profile explicitly:

   ```bash
   bash '<review-skill-directory>/scripts/review-manifest.sh' \
     --trust-working-tree-profile \
     '-' \
     '<head>' \
     '<profile-path>'
   ```

3. Confirm the manifest header shows the intended trusted-profile base, expected risky files surface, and no lane matches nearly every file. A profile-selected base that contains the review head is rejected as self-blinding; pass the intended earlier base explicitly. Tighten noisy patterns without sacrificing high-risk recall.
4. Show the user the profile and validation results. Explain that repo-local profile changes remain inactive for ordinary reviews until merged; `--trust-working-tree-profile` is validation-only. Record unresolved tribal knowledge as explicit TODOs.
