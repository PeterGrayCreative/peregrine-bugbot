# peregrine-bugbot 🦅

Two-tier LLM code review for PRs: a cheap model does breadth-first triage over
the diff, a strong model investigates only the suspicious areas. Engine-
agnostic by design — Claude (via
[bugbot-codex-skills](https://github.com/PeterGrayCreative/bugbot-codex-skills))
today, OpenAI or anything else behind the same interface tomorrow.

## How it works

```
PR diff ──► Engine.review(ctx) ──► Finding[] ──► threshold / dedupe / cap ──► PR comments
                 │                                        │
   claude | openai | mock                     cost + usage → job summary
```

- **Engines** (`src/engines/`) implement one method: `review(ReviewContext) →
  EngineResult`. The Claude engine shells out to `claude -p` and runs the
  [invariant-first-pr-review](https://github.com/PeterGrayCreative/bugbot-codex-skills)
  skill: session model = strong investigator tier, plus a `breadth-worker`
  subagent pinned to the fast tier (the skill's docs are explicit that the
  *orchestrator* owns model routing). With `--base`/`--head` the skill drives
  git itself (merge-base review, manifest script, profile from the merge-base
  `.peregrine/profile.md`); without git (fixture eval cases) the diff is
  embedded and the skill's no-git fallback applies. Scratch output goes to a
  temp dir outside the repo — the skill requires an untouched working tree.
  The OpenAI stub documents exactly what to wire. The mock engine exercises
  everything for free.
- **Posting** (`src/github/`) filters by confidence, dedupes re-pushes via
  fingerprints embedded in comment markers, caps comments per PR, and posts a
  summary with cost. A finding must include its *failure path* — the input or
  state that triggers the bug — which is the main false-positive filter.
- **Eval harness** (`eval/`) benchmarks model configs on recall / false
  positives / cost per case. See `eval/README.md`.

## Quickstart (local, on any repo)

```bash
nvm use && npm ci
git diff main...HEAD > /tmp/pr.diff
export ANTHROPIC_API_KEY=...
npm run review -- --repo /path/to/repo --diff /tmp/pr.diff        # dry run, prints findings
```

## CI setup (phase 1: this/your repos)

1. Add `ANTHROPIC_API_KEY` to repo (later: org) secrets. Use a **dedicated
   Console workspace with a monthly spend limit** — that's the hard cost
   backstop.
2. `.github/workflows/review.yml` reviews PRs when they leave draft;
   re-pushes cancel superseded runs; oversized diffs are skipped.
3. Comment `@peregrine-bugbot` on a PR for an on-demand deep review
   (members only — `mention.yml`).

## Org rollout (phase 2+)

Other repos call the reusable workflow:

```yaml
# their-repo/.github/workflows/peregrine.yml
name: peregrine
on:
  pull_request:
    types: [opened, ready_for_review, synchronize]
jobs:
  review:
    uses: PeterGrayCreative/peregrine-bugbot/.github/workflows/review.yml@main
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Start in shadow mode per repo (drop `--post` in a fork of the workflow) until
precision is tuned. Graduate to a GitHub App only when you want central
telemetry/config without per-repo CI.

## Cost controls (layered)

| Layer | Mechanism |
|---|---|
| config | `maxEscalations`, `maxDiffLines`, `maxCommentsPerPr`, `minConfidenceToPost` |
| workflow | draft skip, concurrency-cancel on re-push, 20-min timeout |
| engine | `maxTurns`, read-only tools, per-run timeout |
| billing | dedicated API workspace with monthly spend limit |

## Security notes

- PR content is untrusted model input. The review session gets read-only
  tools (+ writing its findings file) and never executes PR code.
- The mention trigger is gated to OWNER/MEMBER/COLLABORATOR.
- Don't run this with write permissions on fork PRs.

## Swapping engines

Implement `Engine` in `src/engines/<name>.ts`, register it in `engine.ts`,
add a config block, done — CLI, workflows, and the eval harness pick it up via
`--engine <name>` / `PEREGRINE_ENGINE`. Fill `usage.costUsd` honestly; the
benchmark's value-per-dollar comparison depends on it.

## Repo layout

```
src/            orchestrator, engines, GitHub posting
eval/           case library + matrix runner + grader + report
.github/        review.yml (auto + reusable), mention.yml (@peregrine-bugbot)
docs/design.md  architecture & rollout rationale
```
