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
passed during integration; final-head verification remains recorded in PR CI.

Independent review identified and corrected inherited cheap-model priming,
unavailable production-only context requirements, invocation self-hash trust,
successful attempts being relabeled failed, ambient Git controls redirecting
scope checks, and secret-bearing failures becoming unrecordable. Integrated tests also exposed
optional `undefined` telemetry fields incompatible with strict canonical JSON;
aggregates are normalized before serialization. These were plumbing defects,
not model-quality outcomes. Existing benchmark artifacts and decisions were
not rewritten.

## Not established / next work

This slice is not R3 completion or R4 readiness. Invocation intents prove input
capture, not provider contact; terminal records are runner evidence bound to
caller-held receipts, not independent signatures or runtime-model attestation.
The outer immutable run lifecycle must bind all scheduled attempts, intents,
terminals, stop/retry lineage, actual runtime/tool policy, and authenticated
scope evidence. Historic curation, grading/report eligibility, and arm-blinded
adjudication still require consumer integration. The CLI historical execution
barrier remains intact.

No live provider, historical runtime reproduction, container/network isolation
probe, human admission, reserved partition, holdout, precision/recall estimate,
or efficacy result is produced here. The proposed 96-attempt experiment remains
unregistered and unauthorized. The research continues; this report is not a
request to stop at another checkpoint.
