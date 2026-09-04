# Codex provider

The Codex runner performs two independent `codex exec` stages:

1. an ephemeral configured-effort breadth pass with the configured strict breadth schema;
2. an ephemeral investigation pass with the validated breadth ledger, runner-generated manifest, embedded diff, and `review-result.schema.json`.

With `breadthLedgerMode: "structural-compact"`, the breadth schema bounds
low-value clear prose and the runner structurally compacts the validated result
before investigation. Required candidates, escalations, and coverage are never
sampled or silently truncated. The default `full` mode retains the legacy
schema and transfer behavior.

Both use a read-only sandbox, strict config, ignored user config, explicit models/effort, stdin prompts, and an output file outside the target checkout. Missing, failed, timed-out, or malformed stages fail the review.

Local authentication is handled by Codex. CI passes `OPENAI_API_KEY` only to the Codex analysis step. Codex installs the root `.codex-plugin/plugin.json` through the Git-backed marketplace in `.agents/plugins/marketplace.json`; `npm run plugin:update:codex` refreshes the `main` snapshot and installed plugin. Interactive calls keep the original task coordinator-only and launch a bounded breadth worker followed by a distinct bounded investigation worker. A `peregrineRouting` block selects their preferred model and effort; when an override is unavailable, the stage remains a separate worker on an available model and the fallback is reported. Loose `.agents/skills` copies are compatibility-only and must not coexist with the plugin under the same names. See [configuration](../configuration.md), [installing from GitHub](../installing-from-github.md), and [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins).
