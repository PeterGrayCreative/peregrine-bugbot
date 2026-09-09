# Historical runner integration checklist

Status: partial integration, updated 2026-09-09. No historical
reviewer invocation is authorized or enabled by this checklist.

Binding plan: [TS/JS evidence and ablation](2026-09-04-typescript-javascript-evidence-ablation-plan.md).
The full-program goal and R2 human-curation/partition gates remain unchanged.

## Current boundary

User explicitly resumed the full R2-R8 goal after the 2026-09-07 recovery
checkpoint. Structural implementation may continue. This still does not
authorize historical model runs.

The later recovery-only resumption produced a verified local archive. The
implementation repository was public, so the user approved a separate private
backup repository. Its exact remote commit passed a fresh remote-origin restore.
That repository now also contains the consolidated 30-proposal, 10-loss packet.
R3 structural work resumed; historical providers remain unauthorized.

The experimental HTTP adapter and a real two-container, credential-free
synthetic protocol probe now pass. Source and dummy credential mounts were
separate; read/list/search worked with bounded rejection paths. This does not
prove a Codex model session, provider-connected egress, credential-bearing
client isolation, or historical scope completeness. See the
[HTTP/runtime record](../validation/2026-09-07-r3-read-mcp-runtime.md).

The underlying bounded read/list/literal-search core has deterministic tests;
its initial [foundation record](../validation/2026-09-07-r3-read-tool-foundation.md)
predates the HTTP integration above. Credential-bearing runtime containment,
provider-connected network policy, and actual model tool availability remain open.

A standalone credential-free Docker proof now exercises the intended network
shape with the candidate runtime image. The reviewer is attached only to an
internal network. An exact-host, exact-SNI TLS gateway and a fixed tokenized MCP
forwarder are the only dual-homed sidecars. The probe binds container
entrypoints, IPv4-only IPAM and membership, observed source addresses, random
per-exchange challenges, and sealed audits. Direct reviewer access fails in the
fixture. The trusted methodology attachment now launches this topology through
the repository-owned Docker executor and binds it into lifecycle evidence.
That integration is structurally tested; a credential-bearing Codex canary
remains separately gated. See the
[egress record](../validation/2026-09-09-r3-egress-sidecar-proof.md).

The methodology runner now has an exact Codex launch profile: Sol high,
read-only sandbox, no ambient config/rules, built-in shell tools disabled, and
only the three neutral read tools registered through the bounded MCP adapter.
The exact tool policy is retained in invocation intents. The accepted image was
observed as Codex CLI 0.152.0 and parsed the MCP configuration without credentials
or network access. Two-worker attempts may use two distinct MCP sessions; the
default remains one. This is structural/runtime-configuration evidence, not a
provider/model canary or an egress allowlist. See the
[neutral launch record](../validation/2026-09-08-r3-neutral-codex-launch.md).

The trusted attachment now finalizes a sanitized runner-owned MCP audit into a
versioned attempt scope record. The record binds the registered raw scope, exact
sealed tool policy, ordered tool-result digests, bounded availability codes,
and model limitations. Raw tool arguments and source do not enter the terminal.
Finalization rejects active requests, freezes later access, and the terminal
writer requires the branded provider finalizer for version-2 results.
The current record intentionally lacks a credential-bearing canary, so it can
only produce `unverified` or `incomplete`; neither state receives root credit.
Legacy result readers retain their original behavior. See the
[runner-scope record](../validation/2026-09-08-r3-runner-scope-evidence.md).

A separate schema-v2 stopped-run closure now authenticates a terminal prefix,
an optional started/nonterminal attempt, and the exact unstarted suffix.
Missing projections require this caller-authenticated closure; absent files
alone still reject. Reopening a closed runner rejects before preparation.
Complete-only v1 seals remain unchanged. Worker termination is a caller
declaration, not process proof; runtime availability remains open. New
methodology registrations now bind an exact zero-retry policy; legacy v1
registrations remain readable but cannot launch new invocations. Diagnostic
child retries require a future, separately versioned non-promotional protocol.
See the
[stopped-run verification record](../validation/2026-09-07-r3-stopped-run-closure.md).

The registered historical runner now authenticates the exact preceding
schedule prefix before starting an attempt. Skipped, reordered, and stale
lifecycle receipts reject before provider attachment; integration tests run
the actual frozen order rather than sorting receipts after arbitrary execution.

`eval/methodology-grading-contract.ts` adds a pure neutral grading boundary.
It checks a caller-held projection digest, exact truth/finding pair verdicts,
grouped-root credit, ambiguous cross-root reuse, and partial-truth metric
eligibility. Failed/missing/incomplete attempts remain scheduled misses;
unmatched findings remain unresolved and missed roots unattributed. This is
not a judge ledger, append-only adjudication consumer, or reporting pipeline.
Those functions now exist as separately sealed consumers; this pure primitive
still does not provide them by itself. The execution-to-projection reader now
authenticates all scheduled lifecycle outcomes and exact raw review receipts,
using projection version 2. It preserves explicit model inability separately
from unverified runner scope; neither obtains root credit. A stable trusted
corpus store is required. See the
[projection record](../validation/2026-09-05-r3-authenticated-grading-projection.md)
for review corrections, tests, and the remaining runtime/closure gates.

The new truth, curation, scope, metric-policy, and leakage contracts are tested
building blocks, not an operational historical benchmark. `runMatrix` still
rejects `historical-efficacy-v1` before scheduling. Production and legacy seeded
protocols retain their existing behavior. The new curation reader authenticates
declared confirmations, not actual human independence or historical source trees.

Post-recovery slice adds separate `sole-human-historical-v1` policy and
historical curation schema v3. It requires one registered human approval bound
to packet, dossier, truth-scope, and case-bundle hashes while keeping AI
preparation evidence non-confirming. Historical schema v2 and its
two-confirmation policy remain unchanged. Complete packet-response verification
rejects missing/extra decisions, packet drift, false independence claims, and
unbound files. A non-mutating importer derives an admitted curation document
only from the v3-bound dossier's authenticated approval; the caller must write
it to a new append-only destination and re-read it through admission. This is
structural governance, not a real human decision or case admission. See the
[verification record](../validation/2026-09-07-r2-sole-human-governance.md).

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
the separate stopped-run closure preserves nonterminal prefixes and missing
suffixes. New methodology registrations require zero retries. Trusted v2
lifecycles now retain runner-owned scope evidence, while actual provider/model
identity and the credential-bearing canary remain unverified. Version-3 tool
policies now bind the per-attempt sidecar attestation and version-2 scope record;
legacy version-2 tool policies and version-1 scope records remain readable.

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
- [x] **Topology-aware execution and artifacts.** Reuse the existing Codex stage
  runner for A/B single reviewer and C/D discovery plus fresh reviewer. Pin the
  registered homogeneous model/effort, share total allowance, and freeze the
  two-stage split. Version artifact validation rather than weakening existing
  mandatory two-stage records. Integrate runner-owned scope evidence so empty
  findings with unavailable context cannot become a complete review.

  Current slice: A/B and C/D lifecycle paths use their registered topology and
  retain every stage receipt. Trusted v2 attachments finalize runner-owned MCP
  evidence into a terminal-bound scope record. Incomplete or denied reads and
  model limitations prevent completion; missing credential-bearing canary
  evidence remains unverified. A future canary requires a new version rather
  than weakening this record.
- [ ] **Pre-invocation evidence and ceilings.** Seal exact assembled prompt,
  schema, mount, model, effort, tool policy, and deadline immediately before each
  invocation. The second stage binds the first stage's output. Current source
  hashes are not exact assembled prompt hashes, and the once-per-attempt start
  marker does not count both model calls. Retain both attempt and invocation
  accounting, including failed/stopped/retried work and missing telemetry.

  Current slice: prompt, schema, mount, model, effort, stage/attempt deadlines,
  prior output, the exact neutral tool policy, and a zero-retry registration
  policy are sealed. A trusted factory now binds the exact materialized source,
  runtime image/profile/access, assets, output, and bounded MCP service; its v2
  tool policy persists the source tree and attachment/root/limit digests.
  The provider attachment also supplies the branded, single-use scope finalizer;
  its sanitized MCP audit is reauthenticated by terminal readers. A standalone
  synthetic Docker proof now validates exact-destination gateway and MCP-forwarder
  policy without credentials. The production attachment creates those sidecars,
  gives the reviewer only the supervisor-issued internal-network capability,
  awaits sealed cleanup during scope finalization, and binds the diagnostics
  into the version-2 scope record. Effective served-model/provider evidence and
  a credential-bearing canary remain open.

  See the
  [egress integration record](../validation/2026-09-09-r3-methodology-egress-integration.md).
- [ ] **Historical consumer integration.** Wire caller-trusted curation,
  materialized source identity, input authentication, scope evidence, shared
  metric eligibility, and arm-blinded adjudication into scheduling, grading,
  reporting, and sealed decisions. Generic arms must bypass production semantic
  manifest preflight. The seeded paired funnel must reject this design, not
  apply its panel sizes or promotion rules. Only then replace the execution gate.

  Current structural slice: the dedicated methodology adjudication contract
  binds every scheduled grade and every unmatched finding occurrence, retains
  unresolved outcomes, and rejects missing/extra/stale/cross-run decisions.
  A descriptive four-arm report now consumes and revalidates this contract,
  and a separate append-only analysis store retains grade-set, adjudication,
  and report artifacts behind caller-held digests.
  A final versioned analysis binding authenticates the invocation
  registration's run ID and schedule against every grade projection,
  adjudication/report artifact, terminal resource artifact, and the exact
  runtime analysis-source bytes.
  Registered descriptive contrasts now cross-bind grade status, terminal
  receipts, resource outcomes, frozen case truth/catalog identities, and
  strictly positive paired wall time. Their append-only artifact is joined to
  the unchanged v1 analysis binding by a separate source-bound derived seal.
  A source-bound arm-blind semantic-judge ledger now supplies the only
  definitive pair verdicts; persisted grades are rederived rather than accepted
  from callers. A composite append-only binding reauthenticates the execution,
  judge, grade, adjudication, report, and resource chain. Confirmed-new
  occurrences can be grouped into post-hoc discovery roots through a packet
  that omits arm, route, and timing. The exact grouping implementation and a
  private append-only operator blinding-key artifact are bound, and a fresh
  process can reopen and reproduce the sealed summary. Curator blindness is
  operator-mediated and not independently attested. A preregistered inference
  plan now derives failure-inclusive point estimates and all required decision
  surfaces from authenticated evidence. Grade-bound adjudication resolutions,
  content-addressed unmatched-root ledgers, and append-only versioned decision
  seals preserve every earlier decision. Inferential intervals remain blocked
  until duplicate-family assignments are authenticated; severe-regression
  decisions also remain blocked until registered-root severity is bound.
  Cross-run, caller-invented run identity, altered projection, mixed execution,
  and source drift reject. A separate versioned resource artifact derives every scheduled
  attempt's lifecycle wall duration, runner duration, stage count, and
  provider-reported usage from authenticated terminal evidence. Its report
  preserves observed subtotals but leaves totals null whenever any attempt is
  unknown; unavailable monetary cost is never converted to zero. Existing
  report artifacts and readers remain unchanged. See the
  [adjudication record](../validation/2026-09-08-r3-methodology-adjudication.md).
  See also the [resource record](../validation/2026-09-08-r3-methodology-resource-evidence.md).
  The [analysis-binding record](../validation/2026-09-08-r3-methodology-analysis-binding.md)
  describes the final structural join and its limits.
  The [sealed-judge record](../validation/2026-09-08-r3-sealed-semantic-judge.md)
  describes the authenticated semantic and discovery chain.
  The [trusted attachment record](../validation/2026-09-08-r3-trusted-provider-attachment.md)
  describes the runner/factory boundary and its remaining runtime limits.
  The [inferential-decision record](../validation/2026-09-09-r3-inferential-decisions.md)
  describes the versioned decision lineage and its deliberate blockers.

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
