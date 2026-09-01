# peregrine-bugbot 🦅

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

## Install and update the canonical plugin

Both hosts install from `PeterGrayCreative/peregrine-bugbot@main`. The marketplace snapshot and installed plugin are refreshed together, so loose copied skill directories are not part of the normal update path.

Install once:

```bash
npm run plugin:install:codex
npm run plugin:install:claude
```

After changes are merged to `main`, update the selected host and start a new thread:

```bash
npm run plugin:update:codex
npm run plugin:update:claude
```

Codex uses the repository marketplace at `.agents/plugins/marketplace.json`; Claude uses `.claude-plugin/marketplace.json`. For repository development, Claude can still load the checkout directly with `claude --plugin-dir '/path/to/peregrine-bugbot'`.

Confirm the installed source and detect conflicting loose copies with:

```bash
codex plugin list
claude plugin list
npm run doctor
```

The copy installer exists only for hosts that cannot consume a Git-backed plugin marketplace:

```bash
npm run doctor
bash 'scripts/install-local.sh' --client claude --scope personal
```

Do not combine the plugin with loose copies of the same skills. Codex does not merge duplicate skill definitions; `npm run doctor` reports duplicate local copies that should be migrated deliberately.

## GitHub Actions

The reusable workflow accepts `runner: claude|codex`. Supply only the matching secret. Pin consumers to a release tag or commit SHA after publishing a release:

```yaml
jobs:
  review:
    uses: PeterGrayCreative/peregrine-bugbot/.github/workflows/review.yml@v0.3.0
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
docs/            architecture, configuration, providers, security, release notes
```
