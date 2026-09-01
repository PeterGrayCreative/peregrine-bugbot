# Configuration

`peregrine.config.json` is versioned with `schemaVersion: 1`. The default runner remains `claude`; select Codex with `--runner codex`, `PEREGRINE_RUNNER=codex`, a reusable-workflow input, or the `PEREGRINE_RUNNER` repository variable.

## Runner settings

| Field | Claude | Codex |
| --- | --- | --- |
| breadth model | `runners.claude.breadthModel` | `runners.codex.breadthModel` |
| investigation model | `runners.claude.investigationModel` | `runners.codex.investigationModel` |
| effort | `investigationEffort` | `breadthEffort`, `investigationEffort` |
| budget | `maxTurns`, `maxBudgetUsd` | account-side limits and timeout |
| timeout | `timeoutMs` | `timeoutMs` shared across both stages |
| canonical skill | `skillName` | `skillName` |

Provider-scoped overrides:

- `PEREGRINE_CLAUDE_BREADTH_MODEL`
- `PEREGRINE_CLAUDE_INVESTIGATION_MODEL`
- `PEREGRINE_CLAUDE_INVESTIGATION_EFFORT`
- `PEREGRINE_CODEX_BREADTH_MODEL`
- `PEREGRINE_CODEX_INVESTIGATION_MODEL`
- `PEREGRINE_CODEX_BREADTH_EFFORT`
- `PEREGRINE_CODEX_INVESTIGATION_EFFORT`

An override for one provider never mutates the other provider's block. Unknown runners, placeholder model names, invalid effort, non-positive limits, and invalid confidence thresholds fail before a model starts.

## Limits and filters

- `maxEscalations`: maximum candidates the investigation prompt may promote.
- `maxDiffLines`: filtered-diff gate; `--deep` deliberately bypasses it.
- `minConfidenceToPost`: findings below this value remain in the artifact but are not posted.
- `maxCommentsPerPr`: posting cap after confidence and dedupe filtering.
- `filters.ignorePaths`: file blocks removed before line counting, prompt construction, and inline mapping.

Every finding also carries `disposition: fix-in-pr|follow-up`. Both remain in
the review artifact; only `fix-in-pr` findings above the confidence threshold
are eligible for GitHub comments.

## CLI

```text
npm run review -- --runner <claude|codex|mock> --repo <path> --diff <path>
  [--base <ref>] [--head <ref>] [--deep] [--output <path>] [--post]

npm run post -- --result <path> --diff <path> [--config <path>]
npm run doctor
```

`--post` remains available for local compatibility. CI uses separate `review` and `post` processes so provider and GitHub write credentials do not share a process.
