# Configuration

`peregrine.config.json` is versioned with `schemaVersion: 1`. The default runner remains `claude`; select Codex with `--runner codex`, `PEREGRINE_RUNNER=codex`, a reusable-workflow input, or the `PEREGRINE_RUNNER` repository variable.

The default route is deliberately strong rather than cost-minimal:

| Host | Breadth | Investigation |
| --- | --- | --- |
| Claude | `claude-sonnet-5` / `high` | `claude-opus-5` / `high` |
| Codex | `gpt-5.6-luna` / `high` | `gpt-5.6-sol` / `high` |

## Runner settings

| Field | Claude | Codex |
| --- | --- | --- |
| breadth model | `runners.claude.breadthModel` | `runners.codex.breadthModel` |
| investigation model | `runners.claude.investigationModel` | `runners.codex.investigationModel` |
| effort | `breadthEffort`, `investigationEffort` | `breadthEffort`, `investigationEffort` |
| budget | `maxTurns`, `maxBudgetUsd` | account-side limits and timeout |
| timeout | `timeoutMs` | `timeoutMs` shared across both stages |
| canonical skill | `skillName` | `skillName` |

Provider-scoped overrides:

- `PEREGRINE_CLAUDE_BREADTH_MODEL`
- `PEREGRINE_CLAUDE_BREADTH_EFFORT`
- `PEREGRINE_CLAUDE_INVESTIGATION_MODEL`
- `PEREGRINE_CLAUDE_INVESTIGATION_EFFORT`
- `PEREGRINE_CLAUDE_SKILL_NAME`
- `PEREGRINE_CLAUDE_MAX_TURNS`
- `PEREGRINE_CLAUDE_MAX_BUDGET_USD`
- `PEREGRINE_CLAUDE_TIMEOUT_MS`
- `PEREGRINE_CODEX_BREADTH_MODEL`
- `PEREGRINE_CODEX_INVESTIGATION_MODEL`
- `PEREGRINE_CODEX_BREADTH_EFFORT`
- `PEREGRINE_CODEX_INVESTIGATION_EFFORT`
- `PEREGRINE_CODEX_SKILL_NAME`
- `PEREGRINE_CODEX_TIMEOUT_MS`

An override for one provider never mutates the other provider's block. Unknown runners, placeholder model names, invalid effort, non-positive limits, and invalid confidence thresholds fail before a model starts.

## Interactive plugin routing

An interactive plugin or skill call can override the four routing fields in the
current request:

```yaml
peregrineRouting:
  breadthModel: gpt-5.6-luna
  breadthEffort: high
  investigationModel: gpt-5.6-sol
  investigationEffort: high
```

For example:

```text
@Peregrine Review review this pull request using:
peregrineRouting:
  breadthModel: gpt-5.6-luna
  breadthEffort: high
  investigationModel: gpt-5.6-sol
  investigationEffort: high
```

Explicit invocation values win over installed defaults. Peregrine records both
the requested and actual route; if the host cannot select the requested model,
it uses the current model for that stage and reports the fallback.

Claude also supports persistent plugin options. Configure them during install:

```bash
claude plugin install peregrine@peregrine --scope user \
  --config claude_breadth_model=claude-sonnet-5 \
  --config claude_breadth_effort=high \
  --config claude_investigation_model=claude-opus-5 \
  --config claude_investigation_effort=high
```

Claude users can change the same values later through the plugin configuration
interface. Codex does not currently expose an equivalent plugin `userConfig`
manifest field, so use the per-invocation block in Codex.

`skillName`, `maxTurns`, `maxBudgetUsd`, and `timeoutMs` remain automated-runner
settings. Interactive hosts own their parent task lifecycle and cannot reliably
enforce those values from a skill prompt.

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
