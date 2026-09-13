# Prediction local preparation

Status: local implementation and reconstruction verified; independent gate
approved within the zero-provider scope. This is a bounded addition to the approved adapter at `768a13c`.
It does not complete the original R4 runtime freeze or authorize R5.

The implementation reuses the existing prompt compiler, source read tools,
prediction plan, outcome parser, adjudication and sensitivity analysis. The
atomic-delivery skill kept the change to the source-to-adapter boundary and
its direct consumer tests. No passing adapter or production route was changed.

## Source and evidence authority

The private evidence repository's approved `mounts-v2` at `63ed0f1` uses a uniform
repository-only rule for all 16 cases. Its manifest SHA-256 is
`efd255a524fd9c556cfb8f73e46ec39bd5f0a1b6d3b22db0573ecee59f7c606e`.
Rejected `mounts-v1`, including its two selectively supplied external contexts,
remains unchanged at `982e7b0`. The successor reuses its pinned source packs and
verified reconstruction functions, preserving complete base/head trees and raw
diffs. Supplemental external context is excluded uniformly; missing dependencies
or standards remain common limitations and cannot be reported as clean scope.

Private `ai-exploratory/prediction-development-v1/preparation-v1/` contains the
create-only preparation program, exact condition decomposition, authority,
start/terminal records, full assembled prompts, local read transcripts, source
and implementation hashes, and deterministic reconstruction verification.
The prepared result identifier is
`fcdf28c7f2795e4f05bd9dc9856c068e98bf7dd4e6f14c3675440c6b6ce1a149`;
its preparation identifier is
`c341d5ee2a4baa58f499b8baf55ecac844fc14eba50de98f849a330b59228349`.
These identify canonical sealed records, not independent truth or provider runs.

## Requirement coverage

| Requirement | Implementation and direct evidence |
| --- | --- |
| Bind the full registered frame to approved historical source | `bindPredictionMounts` checks trusted manifest and registration digests, exact case/attempt order, complete head-plus-diff inventory and uniform empty supplemental context. All filesystem bytes, modes, links and directories are checked before use. The private gated reconstructor independently establishes native Git endpoint closure. |
| Freeze equal raw inputs and compiler-produced A/B prompts | `preparePredictionDryRun` derives changed paths from complete endpoint inventories, reads the hash-bound raw diff, and uses the existing common prompt compiler. The neutral task is fixed across cases; prediction conditions stay in administrator records. All 64 scheduled bindings are retained. |
| Preserve the full bounded bundle | The private condition artifact copies registered contract text. Linked-family-001 has both separately named conditions; all 16 cases contribute 17 conditions without increasing case count. This semantic decomposition requires the independent gate. |
| Read only one case; retain limitations | `createPredictionCaseReader` wraps existing read tools, refuses traversal and non-allowlisted methods, and exposes native symlinks only as literal link text. Binary, oversized or missing context remains explicitly unavailable. This function boundary is not a provider sandbox. |
| Enforce observable local resource caps | Reservations include failed calls; 100 cumulative calls and 2,000,000 UTF-8 returned bytes are enforced. Excess bytes are withheld and recorded. Tests cover call exhaustion and accumulated output overflow. Provider token and wall-time enforcement is not claimed. |
| Freeze lifecycle and tool logs without dispatch | Each of 64 local probes binds a start, prompt digest, source digest, exact read request/response and closed-reader terminal. Provider calls stay zero and reviewer output stays null. Real source reconstruction followed by complete replay matched the result. |
| Keep synthetic analysis distinct from observations | The adapter probe has all 64 review attempts missing, no assessor calls and no findings. Existing tests separately cover partial/failed outputs, adjudication history and all sensitivity views. The empty probe is not measured agreement. |
| Preserve attempts and reject resealed drift | Persistence creates a new directory and writes start before preparation, then a content-addressed result and terminal or retained failure. Existing directories cannot be reused. Verification reconstructs the artifact from separately trusted inputs, rejecting changed prompts or readiness claims even after resealing. |

## Verification

Node v22.22.1 was activated with `nvm use 22` before every Node command.

- `npm run typecheck`: passed.
- `npm run test:prediction`: 17/17 groups passed, including five new preparation groups.
- `node --import tsx --test tests/eval-methodology-read-tools.test.ts tests/eval-methodology-prompts.test.ts tests/eval-methodology-prompt-isolation.test.ts`: 16/16 affected consumer groups passed.
- The private preparation command rebuilt all 16 approved mounts offline,
  completed all 64 local read/lifecycle probes, and replayed the entire result
  identically. It retained 17 conditions, zero actual review attempts and zero
  provider calls.
- `git diff --check`: passed.

An initial local typecheck failed before test execution because the fixture's
diff entry widened `mode: "100644"` to `string` in a sorted array (TS2322).
Adding a literal type assertion corrected the fixture. That failed validation
is retained here; no provider or evidence execution occurred in that attempt.

## Remaining execution requirements

The artifacts fix `executionReady` and `providerAuthorized` to false. The
requested route is Sol/high with served version null. A concrete served version,
observable aggregate input/output/reasoning-token and output-token caps,
provider process/credential/network containment, wall-time cancellation,
assessor identity and semantic free-text blinding still require runtime work
and appropriate evidence. Separate explicit provider authorization is absent.
Passing local probes neither satisfies those requirements nor changes the
original Section 3 failure, the prediction-only evidence class, or R5-R8 status.

## Independent gate

A fresh Astra-medium gate issued **APPROVE** for zero-provider local
preparation. It independently replayed the persisted artifact from manifest
bytes read directly from private commit `63ed0f1`, reproduced all 16 mounts,
17 conditions, and 64 missing-output probes, and attacked cross-case paths,
absolute and `.git` reads, resealed attempt/contract bindings, duplicate and
late budget settlements, and false readiness. Node 22 type checking and all 17
prediction tests passed.

The approval explicitly excludes wall-time cancellation, provider containment,
provider token enforcement, served-version identity, assessor blinding, R4
completion, and authorization for R5.
