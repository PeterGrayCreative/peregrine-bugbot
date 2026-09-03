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

## Pricing contracts

`pricing` is optional. Peregrine never assumes that a missing or unknown price
means free. When the provider reports a charge, that value wins and is labeled
`costSource: "provider"`. Otherwise an estimate is produced only when a dated
contract exactly matches the provider, model, and optional service tier.

Each contract declares `pricingAsOf`, a catalog version, assumptions, whether
reasoning tokens are already included in output pricing, and one or more
context tiers. Anthropic contracts price base input, cache writes, cache reads,
and output independently. OpenAI contracts price uncached input, cache reads,
and output independently. The final tier omits `upToInputTokens`; earlier tiers
use increasing inclusive thresholds.

Service-tier matching is exact; a tier-specific request never falls back to a
generic contract. Context thresholds apply to each provider request before
stage totals are combined. A multi-request aggregate without per-request usage
stays `n/a` when the matching contract has context tiers. For
`reasoningOutputBilling: "separate"`, provider
output totals are treated as including reasoning tokens: Peregrine subtracts
the reasoning count from ordinary output before applying the separate rate. If
that relationship is unavailable or invalid, the estimate stays `n/a`.

The checked-in configuration intentionally contains no price values for the
configured future-facing model aliases. Operators must add verified rates and
a date before estimates can appear. Unknown models, missing token components,
ambiguous cache semantics, and unmatched service tiers remain `n/a`.

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
it uses the closest available or current model for that worker and reports the
fallback.

The execution topology is not another YAML option. With custom YAML or defaults,
the calling agent coordinates exactly two sequential workers:

1. a breadth worker on the resolved breadth route;
2. an investigation worker on the resolved investigation route, launched after
   the breadth ledger is frozen.

The parent agent does not count as either worker and must not silently take over
investigation. If model override is unavailable, both workers still launch on
available models. If worker creation itself is unavailable, the interactive
review stops and directs the user to the automated runner.

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

- `maxEscalations`: target number of candidates for full call-graph tracing. Explicit escalations and changed-file coverage are never silently discarded when this target is reached; `--deep` doubles the target.
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
  [--base <ref>] [--head <ref>] [--profile <path>] [--deep] [--output <path>] [--post]

npm run post -- --result <path> --diff <path> [--config <path>]
npm run doctor
```

`--post` remains available for local compatibility. CI uses separate `review` and `post` processes so provider and GitHub write credentials do not share a process.

Profile discovery follows the skill trust order: an explicit `--profile`, then
the repository's merge-base-safe `.peregrine/profile.md`, then the external
`${PEREGRINE_HOME:-$HOME/.peregrine}/profiles/<repository-key>/profile.md`.
