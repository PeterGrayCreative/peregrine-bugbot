# Plan PR 5B Validation: Immutable Experiment Runner

**Date:** 2026-09-03

**Pull request:** pending

**Branch:** `feat/immutable-experiment-runner`

**Base:** `e6137edad32bfb5d45e277eec463cedab6d64c8e`

**Validated code head:** pending

**Node:** repository pin `22`; validation runtime `22.22.1`

**Provider calls:** none performed for this draft record

**Status:** local implementation and validation passed; exact committed-head,
remote CI, and PR review evidence remain pending.

## Scope under validation

- A self-authenticating, immutable experiment manifest records repository,
  corpus, prompt, method, schema, merge-base profile, judge, matrix config,
  emitted matrix manifest, Peregrine config, and aggregate configuration hashes.
- The manifest records exact configured models and effort, CLI versions,
  provider availability, the random seed, cache condition, access and cost
  accounting modes, timestamps, ceilings, and complete attempt order.
- Screening and checkpoint schedules use seeded case/repeat block
  randomization, adjacent control/treatment attempts, and balanced first/second
  variant position.
- Attempt-started and provider-started markers establish durable execution
  boundaries. Terminal success and failure artifacts are created atomically and
  exclusively, carry the experiment ID and raw manifest digest, and cannot be
  substituted across experiments with repeating attempt IDs.
- Complete and ceiling-stopped experiments write an exclusive terminal seal
  over both manifests, attempt state, terminal records, and stop evidence before
  releasing the writer lock. Interrupted experiments remain unsealed.
- Resume validates immutable inputs and runtime metadata, skips all terminal
  artifacts without replacing failures, rejects stopped experiments, and
  rejects interrupted attempts.
- Retry accepts only a failed or interrupted source attempt and creates a new
  one-attempt experiment linked to the source manifest hash, attempt ID, and
  exact source-attempt evidence digest. It never edits the source directory.
- Provider-attempt, observed provider-cost, persisted wall-time, and
  consecutive-failure ceilings are evaluated before the next scheduled
  attempt. The overall failure-rate ceiling is evaluated only after a complete
  control/treatment block, so it cannot suppress the paired variant;
  `minAttemptsForFailureRate` remains a completed-attempt count. Any triggered
  ceiling persists an authenticated stop record.
- `api-key` plus required accounting and `cli-session` plus best-effort
  accounting are explicit immutable protocol modes. Session-backed runs retain
  available token, work, duration, and cost telemetry and represent unknown
  dollar cost as `n/a`. Provider-attempt, wall-time, and failure ceilings remain
  mandatory when exact subscription-session cost is unavailable. PR 5B records
  and validates this contract; Safety PR 2A.2 must make the contained session
  mount operational before a non-API provider run can start.
- Separate fail-closed Claude and Codex checkpoint examples exercise the same
  immutable contract without authorizing a live provider attempt.
- Grading and reporting accept only declared experiment metadata and validate
  the experiment schedule, state markers, terminal-attempt prefix, retry
  linkage, and stop decision before consuming evidence. Grading requires the
  terminal seal, resumes only a partial unsealed grade set, and seals all
  completed grades; reporting requires that grading seal and detects any
  replacement or deletion.

## Verification to run

Run from a clean checkout of the exact branch head:

```text
source /Users/petergray/.nvm/nvm.sh
nvm use 22
npm run typecheck
npm test
npm run test:skills
npm run eval:smoke
git diff --check origin/main...HEAD
```

Focused experiment tests must additionally prove:

- identical seeds and inputs produce the same schedule, with paired positions
  balanced as far as the block count permits;
- a changed manifest byte, hash input, runtime identity, undeclared file, unsafe
  state entry, schedule hole, or mismatched marker is rejected;
- completed and failed attempts survive resume unchanged;
- a started-but-nonterminal attempt blocks resume and is eligible for an
  explicitly linked retry;
- retry creates new evidence while leaving the source byte-identical;
- retry, grading, and reporting cannot race an active experiment; interrupted
  grading validates and preserves existing grades before completing the rest;
- an existing manifest, state marker, attempt, stop record, grade, or lock
  cannot be overwritten;
- terminal and grading seals strictly authenticate their exact artifact sets;
  replacement, deletion, and cross-experiment attempt substitution fail closed;
- terminal result and failure telemetry must match the manifest's exact model
  and effort identities, and report generation must reject corpus drift;
- checked-in schema enums and required fields stay aligned with emitted
  manifests and the authoritative strict parser;
- a replaced `state/` symlink cannot redirect marker writes outside the run;
- spend, provider-attempt, wall-time, and consecutive-failure ceilings stop
  before the next provider-started marker, while failure-rate stopping waits
  for the current paired block to finish and then stops before the next block;
- best-effort CLI-session accounting permits `n/a` dollar cost while the hard
  provider-attempt ceiling still stops the run;
- structural smoke completes with no provider process or provider-started
  marker and remains labeled structural-only.

## Results

- TypeScript typecheck: passed under Node `22.22.1`.
- TypeScript tests: 136/136 passed.
- Focused experiment tests: 21/21 passed after adversarial hardening.
- Skill and manifest tests: 26/26 passed.
- Packaging/install tests: 9/9 passed; plugin-management checks: 4/4 passed.
- Structural smoke: 8/8 attempts completed; 5/5 expected markers found; no
  unexpected findings; no provider process was started.
- JSON schema parse and working-tree `git diff --check`: passed.
- Independent review: an adversarial pre-commit review identified locking,
  judge containment, model binding, stale-corpus, schema-parity, and safe-write
  gaps. Those findings are covered by the passing local suite; an exact
  committed-head re-review remains pending.
- Remote CI and review state: pending.

The structural smoke can prove schedule construction, immutable metadata,
attempt durability, grading/report ingestion, and zero-provider-cost transport.
It cannot prove model recall, semantic-judge quality, provider availability,
session authentication, token reduction, dollar cost, or wall-time improvement.

## Live-experiment gate

The checked-in Claude (`eval/matrix.config.json`) and Codex
(`eval/matrix.codex.config.json`) checkpoint examples are intentionally disabled
with `providerCalls: "deny"`, `maxProviderAttempts: 0`, and `maxWallTimeMs: 0`.
PR 5B does not open the live provider gate. Their current dry-run commands are:

```text
npm run eval:matrix -- --config eval/matrix.config.json
npm run eval:matrix -- --config eval/matrix.codex.config.json
```

Safety PR 2A.2 must first publish and independently accept the attested runtime
digest, pin it, implement the read-only checkout/assets and write-only output
mount contract, provide the selected API key or provider-specific CLI session
without exposing ambient homes or unrelated credentials, verify cleanup, and
repeat the fake-provider containment tests. The first provider-enabled screening
or checkpoint additionally depends on PR 4's immutable, contained, separately
budgeted semantic-judge ledger. PR 5B rejects `providerCalls: "allow"` before
creating a run directory, and its grader never launches a semantic experiment
judge. Once both gates exist, live configs must set explicit positive
provider-attempt and wall-time limits and deliberate failure thresholds.

For CLI-session Codex or Claude runs, dollar cost may remain unavailable. That
is recorded as `n/a`, not zero; the experiment is bounded by provider attempt
count, persisted wall time, and failure ceilings. No ambient login or implicit
API-key fallback is allowed.

## Compatibility and boundaries

This slice changes evaluation scheduling and evidence only. It must not change
production prompts, model choice, worker topology, routing, review thresholds,
posting behavior, or finding disposition.

High-severity behavioral-regression stopping requires Plan PR 4's
root-cause-aware grading and is not claimed by the runner's operational failure
ceilings. Cost per reliably found root cause likewise remains deferred until
Plan PR 4. Typed review-manifest shadow/parity remains Plan PR 6.

## Remote proof

Pending PR creation, exact-head review, required checks, and merge.

Rollback boundary: revert Plan PR 5B. Plan PR 5A provider telemetry and all
earlier evaluation-integrity and containment-bootstrap work remain independently
usable.
