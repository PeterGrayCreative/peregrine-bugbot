# Codex provider

The Codex runner performs two independent `codex exec` stages:

1. an ephemeral, low-effort breadth pass with `breadth-result.schema.json`;
2. an ephemeral investigation pass with the breadth ledger and `review-result.schema.json`.

Both use a read-only sandbox, strict config, ignored user config, explicit models/effort, stdin prompts, and an output file outside the target checkout. Missing, failed, timed-out, or malformed stages fail the review.

Local authentication is handled by Codex. CI passes `OPENAI_API_KEY` only to the Codex analysis step. Codex installs the root `.codex-plugin/plugin.json` through the Git-backed marketplace in `.agents/plugins/marketplace.json`; `npm run plugin:update:codex` refreshes the `main` snapshot and installed plugin. Interactive calls accept a `peregrineRouting` block for per-review model and effort preferences; unavailable routing falls back transparently to the active model. Loose `.agents/skills` copies are compatibility-only and must not coexist with the plugin under the same names. See [configuration](../configuration.md), [installing from GitHub](../installing-from-github.md), and [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins).
