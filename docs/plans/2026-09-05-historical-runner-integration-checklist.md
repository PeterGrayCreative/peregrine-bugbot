# Historical runner integration checklist

Status: future integration work after the R3 contract checkpoint. No historical
reviewer invocation is authorized or enabled by this checklist.

Binding plan: [TS/JS evidence and ablation](2026-09-04-typescript-javascript-evidence-ablation-plan.md).
The full-program goal and R2 human-curation/partition gates remain unchanged.

## Current boundary

The new truth, curation, scope, metric-policy, and leakage contracts are tested
building blocks, not an operational historical benchmark. `runMatrix` still
rejects `historical-efficacy-v1` before scheduling. Production and legacy seeded
protocols retain their existing behavior. The new curation reader authenticates
declared confirmations, not actual human independence or historical source trees.

## Ordered integration

- [ ] **Versioned four-arm scheduling.** Extend the existing experiment machinery
  (`src/types.ts`, `eval/experiment.ts`) without reinterpreting legacy
  control/treatment pairs. One case/repeat block contains A, B, C, and D with
  deterministic balanced order. Twelve cases and two repeats must derive 24
  blocks, 96 review attempts, and 144 planned review-model invocations. Tampered,
  incomplete, duplicated, or cross-protocol blocks must reject.
- [ ] **Neutral prompts and resource mounts.** Add an experimental-only arm
  compiler and common output/candidate contracts. A/C receive no Peregrine
  packets, lanes, profiles, examples, semantic manifest annotations, or detailed
  finding schema. Current `prepareProviderAssets` copies all skills and schemas;
  a generic prompt alone does not make that mount neutral. Preserve production
  asset copying as the default. Hash actual allowed resources and compiled inputs.
- [ ] **Topology-aware execution and artifacts.** Reuse the existing Codex stage
  runner for A/B single reviewer and C/D discovery plus fresh reviewer. Pin the
  registered homogeneous model/effort, share total allowance, and freeze the
  two-stage split. Version artifact validation rather than weakening existing
  mandatory two-stage records. Integrate runner-owned scope evidence so empty
  findings with unavailable context cannot become a complete review.
- [ ] **Pre-invocation evidence and ceilings.** Seal exact assembled prompt,
  schema, mount, model, effort, tool policy, and deadline immediately before each
  invocation. The second stage binds the first stage's output. Current source
  hashes are not exact assembled prompt hashes, and the once-per-attempt start
  marker does not count both model calls. Retain both attempt and invocation
  accounting, including failed/stopped/retried work and missing telemetry.
- [ ] **Historical consumer integration.** Wire caller-trusted curation,
  materialized source identity, input authentication, scope evidence, shared
  metric eligibility, and arm-blinded adjudication into scheduling, grading,
  reporting, and sealed decisions. Generic arms must bypass production semantic
  manifest preflight. The seeded paired funnel must reject this design, not
  apply its panel sizes or promotion rules. Only then replace the execution gate.

## Zero-provider acceptance sequence

1. Scheduler/compiler test: synthetic case descriptors, all four arms, balanced
   96/144 accounting, stable hashes, and no treatment resources in generic arms.
   This proves scheduling and compilation only, not R4 readiness.
2. Integrated runner test: temporary synthetic Git history, explicitly synthetic
   curator declarations, injected deterministic outputs, four terminal attempts,
   six stage-input/invocation records, exact hashes, incomplete-scope behavior,
   and valid seals. Deny provider calls and network throughout.
3. R4 registration: genuinely admitted historical cases, protected partitions,
   human roles, exact prompts/runtime/model, ceilings, seeds, analysis, and
   authorization request. Synthetic declarations cannot satisfy this gate.

No token cap should be claimed where the runner cannot enforce one. Equal time
allowance is not equal consumed compute. B remains an adapted experimental
single-worker method, not the installed production skill. Full-context history
sanitization and provider-egress restrictions require their own verified probes;
content filtering and an empty session are insufficient.
