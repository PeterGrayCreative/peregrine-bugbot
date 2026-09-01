# Host routing

Keep orchestration separate from review judgment. The breadth pass nominates candidates; only the strong investigator can verify, consolidate, assign severity, and produce final findings.

## Claude Code or Cowork

- Load this repository as a Claude plugin or install the two skills together.
- Delegate one breadth sweep to the configured fast model using `breadth-worker-packet.md`.
- Keep tools read-only and bounded to repository inspection.
- Run adjudication on the configured investigation model.
- Plugin invocation may be namespaced by Claude; do not hard-code the namespace inside the skill itself.

## Codex

- When the Peregrine runner is available, use its separate Codex breadth and investigation processes. Each process receives the canonical bundled skill, a strict output schema, a read-only sandbox, pinned review metadata, and only the context needed for its stage.
- For an interactive Codex review without the runner, use one configured fast worker only when worker/model routing is actually available. Otherwise perform a separate breadth pass in the current thread and continue with strong-model adjudication.
- Do not assume that a Codex installation merges duplicate skill names across `.agents/skills`, `.codex/skills`, and plugin roots. Prefer the bundled plugin as the canonical copy and use the doctor command to detect duplicates.

## Other hosts or unavailable routing

Use the current model for two separate logical passes. Label the breadth ledger provisional and re-open every activated high-risk lane during adjudication.

## Context and cost controls

- A cheaper model reduces price and often latency; it does not reduce tokens on its own.
- Give the breadth pass only the scope contract, pinned SHAs, bounded lanes, filtered diff, immediate callers, and necessary contract-bearing context.
- Do not send existing review comments, earlier findings, full repository history, full test logs, or every reference file.
- Default to one breadth worker. Use two or three only for at least three independent invariant families where parallelism justifies duplicated setup cost. Never create one worker per file.
- Partition parallel work by invariant family and deduplicate by root invariant before adjudication.

Record the host, actual breadth and investigation models, reasoning/effort settings when exposed, and any fallback in the coverage confirmation.
