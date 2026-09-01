# Claude provider

The Claude runner loads this repository through `--plugin-dir`, supplies the canonical review skill, and defines a read-only breadth worker using the configured fast model. The investigation session runs on the configured strong model and must return the shared review schema.

Local authentication is handled by Claude Code. CI passes `ANTHROPIC_API_KEY` only to the Claude analysis step. The pinned workflow CLI version is recorded in `.github/actions/setup-peregrine/action.yml`.

Claude plugins use `.claude-plugin/plugin.json` at the plugin root and keep skills in the root `skills/` directory. Plugin-installed skills may appear under a plugin namespace; shared skill text therefore does not hard-code an invocation namespace. See the [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

The marketplace in `.claude-plugin/marketplace.json` distributes this repository root. `npm run plugin:update:claude` refreshes the GitHub marketplace and plugin cache from `main`; releases bump the plugin manifest version so Claude recognizes the new cached release. See [installing from GitHub](../installing-from-github.md) for direct installation, migration, and update commands.
