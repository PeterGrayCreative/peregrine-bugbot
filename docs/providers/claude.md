# Claude provider

The Claude runner loads this repository through `--plugin-dir` and launches two isolated, read-only `claude -p` processes. Both are limited to `Read`, `Grep`, and `Glob`; repository command execution is not exposed. The configured breadth model receives the compact breadth packet and strict breadth schema; the configured investigation model receives the validated ledger, runner-generated manifest, embedded diff, canonical skill, and strict finding schema. Turns and budget are partitioned between the stages so cost and duration remain measurable per stage.

The optional `breadthLedgerMode: "structural-compact"` bounds low-value clear
prose at generation time and structurally compacts the validated breadth result
before investigation. Every candidate, escalation, covered file, unavailable
item, and exact clear count is retained. The default `full` mode preserves the
legacy schema and transfer behavior. `adaptive-structural-compact` uses the
same full provider prompt and schema, then selects a compact representation
only when it is strictly smaller; otherwise it transfers the exact full
ledger.

Local authentication is handled by Claude Code. CI passes `ANTHROPIC_API_KEY` only to the Claude analysis step. The pinned workflow CLI version is recorded in `.github/actions/setup-peregrine/action.yml`.

Claude plugins use `.claude-plugin/plugin.json` at the plugin root and keep skills in the root `skills/` directory. Plugin-installed skills may appear under a plugin namespace; shared skill text therefore does not hard-code an invocation namespace. See the [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

The marketplace in `.claude-plugin/marketplace.json` distributes this repository root. `npm run plugin:update:claude` refreshes the GitHub marketplace and plugin cache from `main`; releases bump the plugin manifest version so Claude recognizes the new cached release. Claude plugin `userConfig` stores persistent breadth and investigation model/effort preferences; an explicit `peregrineRouting` block in the current request takes precedence. See [configuration](../configuration.md) and [installing from GitHub](../installing-from-github.md).

Interactive Claude calls use the same topology as the runner: the calling agent
coordinates, one subagent performs breadth, and a second subagent performs
investigation after receiving the frozen ledger. Missing routing overrides do
not collapse investigation back into the calling agent.
