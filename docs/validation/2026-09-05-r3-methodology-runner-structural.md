# R3 methodology runner: structural integration

Date: 2026-09-05. Evidence class: **structural/mock only**.

Plan: [TS/JS evidence and ablation](../plans/2026-09-04-typescript-javascript-evidence-ablation-plan.md).
Worktree: `/private/tmp/peregrine-ts-js-evidence-r1`.
Branch: `research/ts-js-evidence-r2`; draft PR #32 remains stacked on R1.

## Implemented and exercised

- Four experimental prompts: competent minimal A/C reviewer, generic C
  discovery, adapted trusted Peregrine B/D investigator, and adapted D breadth.
  All receive identical canonical raw scope and neutral review output fields.
- Existing `materializeCase` supplies exact per-arm assets. Existing Codex stage
  execution supplies CLI arguments, ephemeral sessions, telemetry, and failure
  handling. Production orchestration and method-packet bytes are unchanged.
- The experimental executor verifies materialized base/head/diff/changed paths,
  remote-free two-commit Git history, and clean checkout before dispatch.
- Equal registered total deadlines and stage splits are enforced, including
  elapsed preparation and recording time. No unenforceable token cap is claimed.
- Exact prompt/schema/resource/route/deadline/handoff inputs are written
  exclusively before each dispatch. Caller-held record digests prevent a
  rewritten body plus self-hash from passing against the retained receipt.
- Terminal records authenticate those receipts and exact output-to-handoff
  linkage, derive usage and model limitations, reject false completion and
  relabeling completed stages as failure, and preserve partial/failed work.
- Failed non-secret parsing output remains available. Secret-unsafe output is
  omitted explicitly; missing output/usage remains unknown rather than zero.

The integrated test uses a real temporary structural Git fixture and an
injected deterministic `ProviderExec`. It creates four terminal attempts with
six dispatch/input records (one each for A/B, two each for C/D). The callback
asserts requested Codex arguments, not the identity of a real served model.
Every experimental result retains `scope.status: unverified`; empty findings
never become a complete-review or globally clean claim.

## Verification and review corrections

Under `.nvmrc` Node 22:

```sh
npm run typecheck
npm run test:methodology
node --import tsx --test tests/engines.test.ts tests/method-packet.test.ts tests/eval-experiment-core.test.ts
git diff --check
```

The methodology suite contains 45 tests. The affected production-engine,
method-packet, and legacy experiment-core suites contain 45 tests. Both suites
passed during integration. Commit `e8ce1b64ed365b53c81723e8e6bffddda3a825e1`
then passed full local `npm run validate`, GitHub `check`, and the
credential-free image build/smoke. Skipped model-review/posting/publication jobs
are not counted as executed checks.

Independent review identified and corrected inherited cheap-model priming,
unavailable production-only context requirements, invocation self-hash trust,
successful attempts being relabeled failed, ambient Git controls redirecting
scope checks, and secret-bearing failures becoming unrecordable. Integrated tests also exposed
optional `undefined` telemetry fields incompatible with strict canonical JSON;
aggregates are normalized before serialization. These were plumbing defects,
not model-quality outcomes. Existing benchmark artifacts and decisions were
not rewritten.

## Case/source and terminal-seal integration follow-up

The next structural slice adds:

- A historical-case join that authenticates declared admission, caller-trusted
  policy, partial truth scope, metadata bytes, original repository family,
  commits, reproduced trees/diff, and scheduled distinct-root count. Hidden
  truth remains runner-side; no truth-derived lanes enter model inputs.
- Code-only B/D lane activation using the source-hashed existing manifest
  implementation, without profiles or custom lanes. A/C reject this operation.
  Both method arms derive identical activation for the same comparison.
- A complete-only outer seal over the exact scheduled terminal receipts and
  raw registration/input/terminal bytes. Failed reviews remain accounted for.
  Missing, duplicate, cross-run, orphaned, rewritten, or symlinked evidence
  rejects. A caller must retain the seal digest outside the mutable files.

Independent review approved these bounded changes. The expanded methodology
suite passes 62/62 and typechecking passes. A subsequent focused lane test also
passes with hostile ambient Node loader options, demonstrating the child
manifest process does not inherit those options. No historical code or live
review model was executed by these tests. Complete-ancestry rejection remains
unchanged; local shallow snapshot captures do not qualify for materialization.

The additional synthetic historical integration test joins declared admission,
actual Git materialization, code-only lanes, six mocked stage dispatches, and
all four terminal records through the complete outer seal. It does not yet bind
the historical admission or lane-activation provenance in the invocation
registration; that explicit prerequisite is being added before R4.

## Frozen inputs and lifecycle follow-up

The input plan and trusted historical runner now close the earlier admission
and lane-provenance integration gap. Before lifecycle start, the runner reads
the caller-held plan digest; during preparation it repeats source
materialization and B/D code-only activation and compares both with the frozen
plan. A/C never receive the lane result. Generic prompt/resource canary tests
exclude hidden truth and plan contents from reviewer-visible inputs.

Four static stage prompts are frozen exactly. The two second-stage prompts
freeze a deterministic template; only the canonical, authenticated first-stage
handoff is substituted. Changed prompt bytes with recomputed local hashes,
different handoffs, stale scope/admission, and late plan registration reject.

Lifecycle records capture start before preparation, dispatch-start at the
injected ProviderExec boundary, zero-dispatch preflight failure, and partial
execution. Stage-one and stage-two post-intent/pre-dispatch failures preserve
their respective one/two intents with zero/one dispatches. The composite seal
binds this lifecycle, the input plan, all actual planned inputs, and the older
complete review-terminal seal where applicable. It requires every scheduled
lifecycle; missing/stopped schedules cannot masquerade as complete.

Independent review approved the input-plan, lifecycle, trusted runner, and
composite evidence slices. The expanded Node 22 methodology suite passes
78/78; typechecking and diff hygiene pass. Earlier commit `15cb7d1` also passed
GitHub `check` and credential-free image build/smoke. No production code or
default route changed in this follow-up.

## Remaining integration boundary

This slice is not R3 completion or R4 readiness. Invocation intents prove input
capture, not provider contact; terminal records are runner evidence bound to
caller-held receipts, not independent signatures or runtime-model attestation.
Stopped/missing schedule seals, retry lineage, actual runtime/tool policy, and
authenticated scope evidence remain unfinished. Historical curation,
grading/report eligibility, and arm-blinded
adjudication still require consumer integration. The CLI historical execution
barrier remains intact.

No live provider, historical runtime reproduction, human admission, reserved
partition, holdout, precision/recall estimate,
or efficacy result is produced here. The proposed 96-attempt experiment remains
unregistered and unauthorized. The research continues; this report is not a
request to stop at another checkpoint.

A separate [credential-free runtime diagnostic](2026-09-05-r3-offline-codex-read-probe.md)
does exercise the pinned image: direct reads work, but nested Codex read-only
sandbox execution fails before the read. It does not establish usable review
tools or provider-connected egress, and no security settings were relaxed.
