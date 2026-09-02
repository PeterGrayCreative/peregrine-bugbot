# peregrine-bugbot

Invariant-first pull-request review for Claude and Codex. Peregrine runs a bounded breadth pass, sends its candidate ledger to a stronger investigation pass, validates the result, then optionally posts deduplicated GitHub review comments.

This repository is the canonical source for the runtime and both skills. It no longer checks out `bugbot-codex-skills` at runtime.

## What ships

- `skills/`: the same `invariant-first-pr-review` and `build-review-profile` skills for both hosts.
- `.claude-plugin/` and `.codex-plugin/`: native plugin manifests around that shared skill tree.
- `src/engines/`: real Claude and Codex adapters plus a deterministic mock.
- `schemas/`: strict breadth, review, and benchmark-judge output contracts.
- `.github/workflows/`: isolated analysis and posting jobs; model credentials never enter the posting job, and the analysis job has no write permission.
- `eval/`: runner-neutral recall, false-positive, duration, and cost evaluation.

See [architecture](docs/architecture.md), [configuration](docs/configuration.md), [security](docs/security.md), and the [implementation plan](docs/plans/2026-09-01-codex-claude-architecture-plan.md).

## Local review

Use the pinned Node version, install dependencies, and create a merge-base diff outside the reviewed checkout:

```bash
nvm use '22'
npm ci
git -C '/path/to/target' diff 'origin/main...HEAD' > '/tmp/peregrine.diff'
```

Claude (the default):

```bash
npm run review -- \
  --runner 'claude' \
  --repo '/path/to/target' \
  --diff '/tmp/peregrine.diff' \
  --base 'origin/main' \
  --head 'HEAD'
```

Codex:

```bash
npm run review -- \
  --runner 'codex' \
  --repo '/path/to/target' \
  --diff '/tmp/peregrine.diff' \
  --base 'origin/main' \
  --head 'HEAD'
```

Both runners use read-only model tooling. Local CLI authentication is inherited from the installed provider CLI; CI uses only the selected provider secret.

## Install from GitHub

The GitHub repository is the canonical distribution source. A normal plugin
installation does not require cloning this repository or copying skill folders.

Codex:

```bash
codex plugin marketplace add PeterGrayCreative/peregrine-bugbot --ref main
codex plugin add peregrine@peregrine
```

Claude Code:

```bash
claude plugin marketplace add PeterGrayCreative/peregrine-bugbot@main
claude plugin install peregrine@peregrine --scope user
```

Restart the selected host or start a new task/session after installation. See
the [complete GitHub installation guide](docs/installing-from-github.md) for
updates, verification, copied-skill migration, uninstalling,
development setup, and troubleshooting.

If the repository is already cloned, `npm run plugin:install:codex` and
`npm run plugin:install:claude` execute the same `main`-tracking installs.

## Configure model routing

Peregrine defaults to a high-effort breadth pass and a high-effort investigation
pass:

| Host | Breadth | Investigation |
| --- | --- | --- |
| Codex | `gpt-5.6-luna` / `high` | `gpt-5.6-sol` / `high` |
| Claude | `claude-sonnet-5` / `high` | `claude-opus-5` / `high` |

For interactive plugin calls, the calling agent is coordinator-only. It launches
one breadth worker, waits for the frozen ledger, then launches a distinct
investigation worker. This two-worker topology is the default whether or not a
`peregrineRouting` block is supplied; the YAML changes the worker models and
effort, not who performs the work.

Override one interactive review by including a routing block with the plugin or
skill call:

```text
@Peregrine Review review this pull request using:
peregrineRouting:
  breadthModel: gpt-5.6-luna
  breadthEffort: high
  investigationModel: gpt-5.6-sol
  investigationEffort: high
```

Use the Claude model names instead when calling the plugin from Claude. Claude
also supports persistent options during installation:

```bash
claude plugin install peregrine@peregrine --scope user \
  --config claude_breadth_model=claude-sonnet-5 \
  --config claude_breadth_effort=high \
  --config claude_investigation_model=claude-opus-5 \
  --config claude_investigation_effort=high
```

Codex does not currently expose persistent plugin `userConfig`, so use the
per-review block there. Peregrine records requested and actual routing and
reports a fallback when the host cannot select the requested model. A routing
fallback still uses two separate workers. If the host cannot create two workers,
Peregrine stops instead of silently investigating in the calling agent.

For the automated Node runner and GitHub Actions, edit
`peregrine.config.json` or use the provider-scoped environment variables.
Operational settings such as `skillName`, `maxTurns`, `maxBudgetUsd`, and
`timeoutMs` belong to that runner rather than an interactive plugin call. See
the complete [configuration reference](docs/configuration.md).

## GitHub Actions

The reusable workflow accepts `runner: claude|codex`. Supply only the matching secret. Track canonical development from `main` as shown below, or replace `main` with an immutable commit SHA for reproducible CI:

```yaml
jobs:
  review:
    uses: PeterGrayCreative/peregrine-bugbot/.github/workflows/review.yml@main
    with:
      runner: codex
    secrets:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

For Claude, set `runner: claude` and pass `ANTHROPIC_API_KEY`. A private Peregrine repository also needs `PEREGRINE_CHECKOUT_TOKEN` with read-only contents access. Drafts, fork PRs, oversized diffs, duplicate findings, and stale heads are stopped before posting.

## Verification

```bash
npm run validate
npm run doctor
```

`validate` runs TypeScript checks, adapter/posting/config tests, all skill manifest and packaging tests, and a keyless end-to-end mock evaluation. Live provider runs are deliberately separate because they use credentials and budget.

## Repository layout

```text
skills/          canonical cross-host skills
src/core/        prompts, filtering, schemas, normalized results
src/engines/     claude, codex, and mock runners
src/github/      deduplication and guarded posting
schemas/         provider output contracts
eval/            runner-neutral benchmarks
.github/         CI, automatic review, and mention review
docs/            installation, architecture, configuration, providers, security, release notes
```
