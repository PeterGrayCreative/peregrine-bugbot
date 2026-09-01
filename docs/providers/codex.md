# Codex provider

The Codex runner performs two independent `codex exec` stages:

1. an ephemeral, low-effort breadth pass with `breadth-result.schema.json`;
2. an ephemeral investigation pass with the breadth ledger and `review-result.schema.json`.

Both use a read-only sandbox, strict config, ignored user config, explicit models/effort, stdin prompts, and an output file outside the target checkout. Missing, failed, timed-out, or malformed stages fail the review.

Local authentication is handled by Codex. CI passes `OPENAI_API_KEY` only to the Codex analysis step. Codex plugins use `.codex-plugin/plugin.json`; project skills use `.agents/skills` when a copied installation is necessary. Duplicate skill names are not merged, so prefer the plugin and check `npm run doctor`. See [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins), [Agent Skills](https://learn.chatgpt.com/docs/build-skills), and [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
