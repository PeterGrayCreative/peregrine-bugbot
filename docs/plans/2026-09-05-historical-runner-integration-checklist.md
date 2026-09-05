# Historical runner integration checklist

Status: partial integration, updated 2026-09-05. No historical
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

Current implementation: `eval/methodology-schedule.ts` compiles and revalidates
the explicit four-arm design using the existing experiment module's canonical
serialization and seeded shuffle. It does not start providers or write an
external immutable seal. A twelve-case/two-repeat synthetic test derives
24 balanced blocks, 96 attempts, and 144 expected invocations. Legacy pair
types and scheduling remain unchanged. Model/configuration identities are
declared registration data; the runtime still must authenticate the effective
configuration and actual invocation records. The declared model is constrained
to `gpt-5.6-sol` with high effort; another model requires a new registered
protocol decision, not regeneration of arm hashes to bypass this contract.

`eval/methodology-output.ts` and the two `methodology-*.schema.json` files define
minimal experimental review and discovery output. They require no lane,
invariant, confidence, disposition, or fix plan. Incomplete responses retain
findings and limitations; an empty completed response is model self-report,
never proof of complete scope or a globally clean case. These contracts are
used only by the experimental runner, not production engines. Fourteen initial focused tests and nineteen
legacy experiment-core tests pass under Node 22 (33 total); typechecking passes.
Review corrected path whitespace, credential-like diagnostic keys, duplicate
cross-corpus case IDs, and oversized schedule allocation risks.

Asset preparation now uses the existing `materializeCase` callback with exact
per-arm allowlists, without changing the default preparer:

| Arm | Prepared resource files |
| --- | --- |
| A / B | Common experimental review schema only |
| C | Common review schema and neutral discovery schema |
| D | Common review schema, production breadth schema, and the exact breadth-worker packet |

B/D investigator methodology is compiled inline; the whole skill tree is
not mounted as a substitute. Generic arms receive no installed skill, plugin
manifest, profile, examples, or production finding schema. Manifests bind exact
paths and copied bytes. Missing/extra files, unexpected empty directories,
symlinks, and changed bytes reject against the retained manifest. Source bytes
are leakage-checked and written from the same buffer to avoid a second-read
race. Sealing that manifest and attesting the actual runtime mount remain
consumer responsibilities.

Nine focused tests, including real structural-fixture materialization across
all four arms, pass under Node 22. Base/head/diff/head-tree identities remain
identical across arms; default materialization retains its prior asset package.
Independent review approved this bounded slice. These tests do not establish
historical admission, prompt neutrality, network containment, or efficacy.

The experimental prompt/compiler and executor are now integrated with the
existing Codex stage function. A/B dispatch one stage; C/D dispatch discovery
and a fresh reviewer. Generic prompts retain the competent minimal baseline;
method arms use trusted current method sources with explicit static-context,
format, and topology adaptations. Review removed inherited model-tier priming
and unsatisfied production-only context requirements. Every arm receives the
same canonical raw scope. A separate exact-prompt validator preserves answer
restrictions without inventing a breadth ledger for single-reviewer arms.

Before each dispatch, exclusive invocation-intent records capture exact prompt,
schema, resource manifest, requested route, stage cap, absolute attempt deadline,
and previous output. Returned digests must be retained outside those mutable
files. Terminal records bind those receipts, observed stage traces, exact raw
outputs, aggregate usage, and rederived model limitations. Stage two must use
the first stage's actual output. An intent is not proof of provider contact or
served model identity. A complete-only outer run seal now binds every scheduled
terminal receipt, including failures, and the raw bytes of the registration,
intents, and terminals. Missing, duplicate, cross-run, orphaned, or symlinked
evidence rejects. This is terminal accounting, not behavioral success.
Stop/retry handling and registered runtime/tool-policy authentication still
need integration.

The executor authenticates the materialized two-commit comparison with Git,
rechecks assets at dispatch, charges preparation/sealing time to the attempt
deadline, and retains failed-stage telemetry and non-secret malformed output.
Its result always marks runner scope availability **unverified**; no experimental
result is converted to production `EngineResult` or `clean`.

See the [structural integration report](../validation/2026-09-05-r3-methodology-runner-structural.md)
for tests, corrections, and remaining boundaries. No historical case admission,
actual model inference, container leak probe, or efficacy claim follows from
the injected test provider.

The historical case join now binds an admitted declaration, trusted curator
policy, partial truth scope, sanitized task metadata, and original source
identity to the existing materializer. It rechecks those inputs before and
after materialization, verifies reproduced source commits/trees/diff, and
returns only raw comparison data as model input. It preserves the complete
ancestry requirement; shallow local captures do not qualify. Synthetic
curator declarations in tests are not independent human admission.

Method arms derive lanes from the actual sanitized code through the existing
trusted manifest script, with no profile or custom-lane argument. B/D use the
same source-hashed activation. Curator truth labels are not an input; generic
A/C arms reject lane activation. An immutable input plan now freezes admission,
activation, raw scope, exact static prompts, and deterministic second-stage
handoff templates before attempt evidence exists. The trusted historical
runner re-materializes the case, rederives B/D activation, compares fresh
preparation to that plan, and checks each assembled invocation before recording
it. The truth-bearing plan and curator store remain outside provider mounts.

Lifecycle records separate preflight failure from dispatch-start and retain
partial two-stage work. Dispatch-start is not provider contact. Composite
execution evidence binds the input plan, registration, every scheduled
lifecycle, actual planned inputs, and the complete review-terminal seal when
applicable. Missing schedules cannot use this complete-only contract;
stopped-run sealing and retry lineage remain unfinished. Scope availability
and actual provider/model identity remain unverified. The expanded structural
methodology suite passes 78/78.

- [x] **Versioned four-arm scheduling.** Extend the existing experiment machinery
  (`src/types.ts`, `eval/experiment.ts`) without reinterpreting legacy
  control/treatment pairs. One case/repeat block contains A, B, C, and D with
  deterministic balanced order. Twelve cases and two repeats must derive 24
  blocks, 96 review attempts, and 144 planned review-model invocations. Tampered,
  incomplete, duplicated, or cross-protocol blocks must reject.
- [x] **Neutral prompts and resource mounts (structural preparation).** Add an experimental-only arm
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

The [offline CLI diagnostic](../validation/2026-09-05-r3-offline-codex-read-probe.md)
found that nested Codex read-only sandbox execution fails at namespace creation
under the tested accepted-image restrictions. Direct reads succeed. This is a
runtime-readiness blocker, not an excuse to disable sandboxing; passing existing
image smoke checks alone does not establish working review-agent tools.
