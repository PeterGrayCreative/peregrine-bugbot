# Prediction deterministic execution contract

Status: implementation-owner validation and the corrected independent gate
passed for the bounded zero-provider contract. Public base is
`35ff99cf4cd032504e2c3c1918d6a5664eea8e29`; private approved preparation base is
`4a71cca3239e5fe6d693ab9452646bd5f2fe3c27`. No provider was called, no production
route changed, and no execution authorization was issued. This checkpoint does
not establish provider readiness or complete the wider R4-R8 program.

This addition reuses the approved prediction plan, prompts, source preparation,
adjudication and analysis, plus the existing branded methodology containment
contract. It adds no provider dispatcher. The atomic-delivery skill kept the
change to the deterministic contract and its direct consumers.

## Requirement coverage and limits

| Requirement | Local evidence and fail-closed boundary |
| --- | --- |
| Explicit authorization | `prediction-execution-contract.ts` accepts only a caller-authenticated approval for an exact freeze, bounded named attempts, Sol/high, concrete version and expiry. Its process-local capability cannot be reconstructed from JSON and each attempt is consumed once. The expected approval digest must come from an independently trusted control plane; a hash does not prove user consent. No approval exists in this freeze. |
| Exact requested and observed route | The requested route stays `gpt-5.6-sol` / `high`. Observed model, effort and concrete version must match; requested settings do not establish served identity. The current adapter has no authenticated served-identity attachment, so preflight blocks and every local monitor result remains noncompliant as provider evidence. |
| One-attempt containment | Preflight reuses the branded schema-v2 provider attachment and checks the accepted image, runtime attempt, arm and source head. Its frozen contract requires isolated process/home/output, selected credential only and attempt-scoped provider-allowlisted networking. JSON lookalikes reject. No real container/network attachment is created or claimed by this section. |
| Deadline, cancellation and retained evidence | `prediction-attempt-monitor.ts` provides a monotonic 20-minute deadline and AbortSignal, append-only hash-linked events, first-stop retention, late partial-output retention and create-only terminal evidence. Structural tests exercise deadline and missing/partial closure. Wiring that signal to provider/container/network termination is absent; `terminationProven` remains false. |
| Resource accounting and caps | Complete cumulative input/cache, output/reasoning and disjoint preprocessing counters are checked without double-counting reasoning. Missing semantics, replay, rollback and cap overrun stop local monitoring. Existing local read budgets remain 100 calls and 2,000,000 bytes. The checked-in CLI lacks the registered hard 120,000 aggregate / 16,000 output-token cap bindings and complete live usage. All provider preflights therefore deny execution, even with a structurally valid authorization. |
| Assessor identity and arm blinding | `prediction-adjudication-gate.ts` requires externally authenticated fresh Astra xhigh/medium session receipts and a separate reviewed free-text blinding receipt covering the exact packet, run and all findings. The arm-aware blinding reviewer cannot be an outcome assessor. Pattern screening cannot satisfy the gate. The consumer binds the complete bundle against post-gate mutation. No authentic receipts or provider judgments exist here. |
| Complete local freeze | `prediction-execution-freeze.ts` reconstructs the approved preparation, freezes the transitive local source closure and method/schema/container resources, dependency lock, private authority, exact assembled prompts, caps, tool policy, runtime requirements, rubric, analysis and 64-entry schedule. It records absent capabilities explicitly and preserves all 64 provider attempts as unstarted/missing. Installed dependency bytes, image/CLI provenance, concrete served version and live capabilities remain external requirements. |

## Successor evidence

Private `ai-exploratory/prediction-development-v1/execution-contract-v2/` holds a
create-only driver, complete frozen record, replay verification and four
hash-chained structural deadline / aggregate-cap / output-cap / missing probes.
It binds the driver source and six private artifacts read from the approved
preparation lineage. Public source is frozen by exact file bytes, not by claiming
the uncommitted candidate is already a reviewed commit.

- Freeze identifier: `95b365eccb28bb9de4903b0692f58dd857e8c7a5c1d9d611b7a858d713059643`.
- Complete result identifier: `6fd76d934e32febe3a8c52fbb6cb3b55c41b727dc8c070a7652bbaa7b7ae574f`.
- Source manifest: `9ab20b86a057c2cf08c8e3a4cc2b69eadb0fa1f599706862ccc7a55be9690a53`, containing 106 files.
- Approved preparation: `c341d5ee2a4baa58f499b8baf55ecac844fc14eba50de98f849a330b59228349`.
- Reconstruction passed; 64 preflights denied; 64 provider attempts remain missing; zero provider calls; `executionReady=false`; `providerAuthorized=false`.

The fresh independent gate rejected v2 because its private driver executed two
mount helpers without authenticating their actual working-tree bytes. That
rejection and v2 remain immutable at private commit `d75090f`. Additive v3
verifies both helpers against literal SHA-256 pins and approved Git blobs before
dynamic import. Both helper-mutation regressions reject before evaluation.

The same gate then issued **APPROVE** for v3 after reproducing its three private
closure tests, all 25 public prediction tests, type checking, complete replay,
and resealed-readiness rejection. Accepted freeze:
`1968b9b30246dd5a4949a007fdc7706088f94612d28be76f43ac5f5c80b5bde8`.
Accepted result:
`9536b214e6e263fa4c12fdb3efa217a869375af7dfa6429b19ff63a05c7974fc`.
Approval covers deterministic preparation only; actual provider enforcement and
R4-R8 completion remain unproven.

Identifiers above are canonical sealed-record hashes, not raw JSON file hashes
or proof of semantic truth. The original registration's prediction-only class,
Section 3 failure, common repository-only context limitation and absence of
calibrated truth remain unchanged.

## Validation and preserved failure

Node pin `.nvmrc` was inspected and Node v22.22.1 activated with `nvm use 22`.
After the correction below, one sequential command passed type checking, all
25 prediction groups, all 220 methodology tests, all 13 methodology HTTP tests,
and `git diff --check`. These are local structural/consumer tests, not provider
experiments. The complete corrected private freeze independently reconstructed
and replayed successfully.

The first candidate passed its focused tests but failed implementation-owner
self-review: a caller could clone an authenticated adjudication bundle, change
the rubric and retain the old `binding.sha256`. The consumer previously checked
only that supplied binding field. The correction binds the complete bundle at
issuance and consumption; a regression rejects the reproduced mutation. The
rejected source archive, first freeze and probes, reproduction description and
original validation logs remain under private `execution-contract-v1/`; none
were overwritten. This self-review record is not an independent gate.

The first full `npm run validate` stopped in the main suite: 298/301 tests passed,
and three existing mocked/contained experiment tests rejected the intentionally
dirty public worktree with `provider experiments require a clean Peregrine
worktree`. No cleanliness check was weakened and no commit was manufactured to
bypass it. A full green validation requires the reviewed clean-head checkpoint
or a separately authorized exact-source validation snapshot. That lane is not
claimed complete here.

## Remaining external requirements

Before any dispatch, a separately reviewed supported bridge must establish hard
aggregate/output-token enforcement and live counters, attach the exact neutral
prediction read policy and whole-attempt cancellation to the existing contained
runtime, prove cleanup, and authenticate the served route. Separate explicit
user authorization must bind the resulting freeze and exact attempts. Before
adjudication, authentic fresh assessor and reviewed blinding receipts must be
supplied. Successful local preparation cannot authorize or substitute for any
of those requirements.
