# Host routing

Keep orchestration separate from review judgment. The breadth pass nominates candidates; only the strong investigator can verify, consolidate, assign severity, and produce final findings.

## Claude Code or Cowork

- Load this repository as a Claude plugin or install the two skills together.
- Keep the calling agent coordinator-only.
- Delegate one breadth sweep to the configured fast model using `breadth-worker-packet.md`, wait for its ledger, then delegate investigation to a new agent on the configured strong model using `investigation-worker-packet.md`.
- Keep tools read-only and bounded to repository inspection.
- Plugin invocation may be namespaced by Claude; do not hard-code the namespace inside the skill itself.

## Codex

- When the Peregrine runner is available, use its separate Codex breadth and investigation processes. Each process receives the canonical bundled skill, a strict output schema, a read-only sandbox, pinned review metadata, and only the context needed for its stage.
- For an interactive Codex review without the runner, keep the calling task coordinator-only. Spawn a bounded breadth worker, wait for its ledger, then spawn a bounded investigation worker. Do not use a full-history fork when it would force the child to inherit the coordinator's model or effort; send a minimal complete stage packet instead.
- If a requested child model or effort is unavailable, keep both stages in distinct workers on available models and report the fallback. If the host cannot create two workers, stop rather than investigating in the calling task.
- Do not assume that a Codex installation merges duplicate skill names across `.agents/skills`, `.codex/skills`, and plugin roots. Prefer the bundled plugin as the canonical copy and use the doctor command to detect duplicates.

## Cursor

- The Cursor plugin exposes two named foreground custom subagents: `peregrine-breadth` on `composer-2.5[]` and `peregrine-investigation` on `grok-4.6[effort=xhigh]`. Both are read-only.
- Keep the calling Cursor agent coordinator-only. Invoke `peregrine-breadth` with a self-contained role-tagged breadth packet, wait for and freeze its ledger, then invoke a new `peregrine-investigation` worker with the investigation packet, pinned evidence, and frozen ledger.
- Cursor subagents start with clean context. Do not rely on the parent conversation being inherited; packet contents must be explicit.
- Keep both workers in foreground mode because investigation depends on the completed breadth ledger. Do not run them in parallel.
- Cursor can fall back from a configured subagent model because of plan or administrator restrictions. Preserve two distinct workers and report requested versus actual routing. If Cursor cannot create both workers, stop before review judgment.
- The `/peregrine-review` command is an explicit native entrypoint; natural invocation of the shared skill must follow the same topology.

## Other hosts or unavailable routing

Use two separate workers on the current model when worker creation exists but model routing does not. If worker creation itself is unavailable, report that the interactive contract cannot run and use the automated runner instead.

## Context and cost controls

- A cheaper model reduces price and often latency; it does not reduce tokens on its own.
- Give the breadth pass only the scope contract, pinned SHAs, bounded lanes, filtered diff, immediate callers, and necessary contract-bearing context.
- Do not send existing review comments, earlier findings, full repository history, full test logs, or every reference file.
- Default to exactly one breadth worker and one investigation worker. Extra lane workers are outside the default topology and should be used only for at least three independent invariant families where parallelism justifies duplicated setup cost. Never create one worker per file.

Record the host, actual breadth and investigation models, reasoning/effort settings when exposed, and any fallback in the coverage confirmation.
