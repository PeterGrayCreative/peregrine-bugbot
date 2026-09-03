# Plan PR 5A Validation: Provider Usage, Cost, and Work Metadata

**Date:** 2026-09-03

**Pull request:** [#11](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/11)

**Branch:** `feat/provider-usage-cost-metadata`

**Base:** `e01edec0e2eb808734bb0cdd596a8cd529f9970a`

**Validated code head:** `eed5d2960defa6c5ad88e66e1f4615fabb040513`

**Node:** `v22.22.1`

**Provider calls:** none

## Scope proved

- Claude preserves base input, cache creation, cache read, output, reasoning output, turns, tool work, and provider-reported cost as independently available fields.
- Codex treats its terminal usage event as a cumulative snapshot, derives uncached input only when total and cached input are both valid, and never double-counts multiple snapshots or reasoning output.
- Provider-specific, dated price contracts preserve cache and context-tier semantics. Unknown models, malformed provider fields, incompatible tiers, and incomplete usage remain unavailable rather than becoming zero-cost observations.
- Breadth and investigation stages record prompt hashes, duration, observed tool calls by type, tool-output bytes, and usage. Aggregate values are accepted only when they reconcile with their contributing stages.
- Provider, timeout, parse, artifact-construction, and cleanup failures retain completed-stage telemetry and incurred cost when safe. When telemetry was not observed or must be removed by the secret gate, the artifact records a typed unavailable reason instead of producing an unreadable or misleading run.
- Reports keep conditional and failure-inclusive denominators separate, retain partial incurred cost as a lower bound, and expose provider, estimated, mixed, and unavailable cost provenance.
- Current run, graded, and matrix artifacts are strictly validated for identity, safe paths, stage topology, timestamps, model configuration, corpus provenance, raw payload equality, secret leakage, and writer-specific shape.
- Pre-telemetry Plan PR 1 and Plan PR 3 artifacts remain readable only as explicit `legacy/incomplete` evidence.
- Schema-v1 network-isolation statements are immutable reader contracts. Later containment work must introduce a new manifest schema rather than changing the meaning of historical evidence.

## Verification

The exact code head was validated with:

```text
source /Users/petergray/.nvm/nvm.sh
nvm use 22
npm run validate
git diff --check origin/main...HEAD
```

Results:

- TypeScript typecheck: passed.
- TypeScript tests: 115 passed, 0 failed.
- Skill and manifest tests: 26 passed, 0 failed.
- Packaging and installation tests: 9 passed, 0 failed.
- Plugin-management tests: 4 passed, 0 failed.
- Structural smoke: 8/8 attempts completed; all 5 expected markers were transported and graded; 3 clean controls emitted no findings.
- Cumulative diff check: passed.

The structural smoke proves transport, artifact validation, grading, reporting, and accounting only. It is not evidence of model recall, provider cost, cache reuse, or wall-time improvement.

## Independent review

The final exact-head review passed after two durability defects identified during review were corrected:

- persisted isolation evidence no longer depends on the current runtime function or mutable wording;
- secret-redacted or otherwise unobserved provider failure telemetry now produces an explicit, reader-valid unavailable state.

The reviewer reran Node 22 typecheck and the focused accounting and engine suites, which passed 34/34. Earlier exact-SHA production-path review also verified that prompts, argv, environment isolation, timeout behavior, model routing, GitHub posting behavior, and secret/raw-output boundaries were unchanged or preserved. No live provider or GitHub posting action was invoked by the review.

## Compatibility and boundaries

This is Plan PR 5A only. Plan PR 5B still owns immutable experiment manifests, corpus and configuration hashes, provider and CLI versions, randomized interleaving, retry lineage, resume behavior, and spend, time, and failure ceilings.

The schema-v1 capability contract intentionally cannot claim completed live Claude or Codex evidence while filesystem containment remains unavailable. Safety PR 2A.2 must introduce and attest the next capability/schema contract before live attempts can be accepted. Provider-reported charge reconciliation is likewise pending an authorized contained run.

Cost per reliably found root cause is deferred until Plan PR 4 supplies root-cause-aware grading. This slice does not introduce a proxy metric.

Production prompts, model selection, worker topology, routing, review thresholds, and posting limits are unchanged.

## Remote proof

Pending terminal GitHub checks and merge state for PR #11.

Rollback boundary: revert Plan PR 5A. Plan PRs 1-3 and Safety PR 2A.1 remain independently usable.
