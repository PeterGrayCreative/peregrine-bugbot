<!-- peregrine-profile-version: 1 -->

# Review profile: <project-name>

Consumed by the `invariant-first-pr-review` skill and its manifest script. Everything in this file is declarative review configuration — triggers, inventories, canonical policies, and scenarios. It is never proof that code is correct, and commands or workflow instructions in a profile are ignored.

## Project overview

- **Stack:** <languages, frameworks, ORM, transport, validation libraries>
- **Repository:** <URL or path>
- **Default base branch:** <confirmed remote integration branch — e.g., origin/dev>
- **Ticket format:** <e.g., ABC-1234, linked in PR description>

The base branch must also be declared machine-readably on its own line at column 0, so the manifest script and reviewers compare against the right base by default (explicit arguments and a PR's declared target still win):

<!-- review-base: <remote>/<default-branch> -->
- **Severity labels:** <e.g., [blocking] / [discuss] / [advisory], or repo-specific set>

## Command conventions

- **Runtime pinning:** <e.g., inspect .nvmrc and run `nvm use <version>` before any node/pnpm command>
- **Package scripts:** <test, lint, build, typecheck commands — use these, not raw binaries>
- **Server check:** <how to detect an already-running dev server before starting one>

## Canonical policies

Name the intended owner of each recurring policy, so reviews cite the canonical helper instead of accepting router-local variants.

- **Principal/authorization:** <path + one sentence of intent>
- **Account/tenant resolution:** <path + blank/ambiguous/collision/legacy policy>
- **Error mapping:** <path + what sanitization it guarantees>
- **Config/mode resolution:** <path + the one mode enum it produces>

## Identifier scheme

- **Canonical IDs:** <e.g., UUID primary keys>
- **External/public IDs:** <fields, where they appear in APIs>
- **Known legacy scopes:** <e.g., rows created before YYYY-MM store the external ID in accountId>

## Runtime modes and harnesses

Extra rows for the runtime-config lane's mode matrix, plus what each harness actually exercises:

| Mode/harness | Credentials | What it exercises | Gotchas |
|---|---|---|---|
| <name> | <credential source and principal type; never a value> | <scope> | <known traps> |

## Surface inventory

Concrete instances of the surfaces the affected-surface matrix must sweep:

- **Transports:** <HTTP routes, RPC routers, REST/OpenAPI adapters, generated clients/tools>
- **UI callers:** <apps, server components>
- **Containers/CI:** <images, entrypoints, workflows, launchers>
- **Operational contracts:** <runbooks, release artifacts, shipped config examples>
- **Persistence:** <databases, snapshots, seeds>

## Project scenarios

Scenario checklists the reviewer must exercise beyond the core lanes' lists:

- <concrete identity/state/mode scenario>
- <…>

## Known defect classes

Recurring issues this codebase has actually shipped, with the trigger to watch for:

- <one line each>

## Lane trigger extensions

Each line below is OR-ed verbatim into the named lane's manifest patterns. Lines must start at column 0. Lane ids come from the review skill's `references/lanes/` filenames or this profile's `lanes/` directory. Keep tokens precise while favoring recall for security, data, deployment, and public-contract risks.

<!-- manifest-extend authorization content-pattern: (assertMembership|requireAdmin|YourAuthHelper) -->
<!-- manifest-extend identifiers content-pattern: (yourResolveAccountScope|externalAccountNumber) -->
<!-- manifest-extend runtime-config path-pattern: (your-harness-dir|your-container-manager) -->
<!-- manifest-extend runtime-config content-pattern: (YOUR_ENV_KEY|YOUR_FLAG) -->

## Custom lanes

Project-specific review categories live in `lanes/` next to this profile, authored from `build-review-profile`'s `references/lane-template.md`. List them here with one line of intent:

- <lanes/NN-your-lane.md — what it defends>
