# TypeScript and JavaScript evidence and ablation progress

Updated: 2026-09-07
Active branch: `research/ts-js-evidence-r2`

## Current recovery notice

User explicitly resumed the full R2-R8 goal after the recovery checkpoint.
Recovery remains closed and durable. Broader preparation may continue under
the original boundaries; historical provider batches still require separate
R4 authorization.

The user subsequently resumed the bounded recovery plan. Sol verified all
current recovery stores, created an immutable 147,065,638-byte archive and
full file inventory under persistent `.worktrees/evidence-curation`, and
successfully restored and reverified it from a second local copy. See the
[local recovery report](../validation/2026-09-07-sol-minimal-recovery-results.md).
No missing dossier was synthetically rebuilt. The existing implementation
repository is publicly visible, so causal evidence was not uploaded there.
The user approved a separate private repository; the split archive was pushed
to exact commit `c571d88d99dee7c07805c1d820cc405bdb21f46d` and a fresh
remote-origin clone passed full reassembly and offline verification. Remote
durability is complete for this recovery closure. That recovery pass did not
resume curator isolation, R2 collection, R3 implementation, or provider runs.

After explicit resumption, the first new slice implemented
[sole-human governance and packet-response verification](../validation/2026-09-07-r2-sole-human-governance.md).
It preserves two-curator v2, adds a separate v3 path for one accountable human,
authenticates complete packet responses, and derives a byte-bound admission
without mutating the reviewed draft. No real packet response, admission,
partition, or provider run occurred.

Persistent worktree: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2`.
The missing temporary stores are documented in the
[interruption record](../validation/2026-09-07-interruption-recovery.md).
The frozen 100-candidate archive survives: 772 receipts / 686 objects reverified.

All 19 prior supplementary draft slots now have versioned replacement records
across [batch 1](../validation/2026-09-07-supplementary-recovery-batch1.md),
[batch 2](../validation/2026-09-07-supplementary-recovery-batch2.md),
[batch 3](../validation/2026-09-07-supplementary-recovery-batch3.md),
[batch 4](../validation/2026-09-07-supplementary-recovery-batch4.md),
the [linked family](../validation/2026-09-07-linked-defect-recovery.md), and
[comparison batch 1](../validation/2026-09-07-comparison-recovery-batch1.md) /
[batch 2](../validation/2026-09-07-comparison-recovery-batch2.md).
They yield 18 draft proposals, not 19 independent cases: two linked slots
form one proposed case. Source/proof qualifications remain explicit; none is
admitted. Nine [sampled-loss records](../validation/2026-09-07-sampled-loss-recovery.md)
are reconciled with surviving evidence, but their original detailed rationales,
dossier bytes and diff bytes remain unavailable. The consolidated human packet
is not ready; no partial review is requested. New curator files remain
local-only; pushed metadata reports do not back up their bytes remotely.

The [role-separation disclosure](../validation/2026-09-07-recovery-role-separation.md)
records implementation-side source exposure for the nine loss slots. Fresh
curator reassignment does not restore an unexposed-validation claim.

Twelve earlier exposed development cards have a restore-tested repository
archive binding all 316 evidence files; they remain unresolved draft
preparation. See the [exposed recovery record](../validation/2026-09-07-exposed-dossier-recovery.md).

The exposed Sequelize #8430 complete replay history is also restored in a
20,773,571-byte exact-ref bundle, with original trees/roots/diffs/license
matching. It is a new source capture, not the lost original bytes; see the
[replay recovery record](../validation/2026-09-07-exposed-replay-recovery.md).

The experimental HTTP tool path passed fourteen focused tests and a real
credential-free two-container protocol probe. This supersedes the transport
not-implemented statements in earlier snapshots below, but no Codex/provider
connection or historical efficacy was tested. See the
[runtime probe record](../validation/2026-09-07-r3-read-mcp-runtime.md).

R3 now has a separately authenticated stopped-run closure and missing-outcome
projection, with full methodology/historical-truth tests and independent review
passing. This supersedes the missing-closure status in earlier snapshots below;
runtime, final grading consumers, retry lineage, and admission remain open.
See the [closure record](../validation/2026-09-07-r3-stopped-run-closure.md).

## Active objective

Determine whether any Peregrine component improves consequential TS/JS bug
finding, unsupported-finding behavior, or measured work relative to a competent
minimal reviewer. Production routing remains frozen.

## Progress

| Step | State | Evidence / remaining gate |
| --- | --- | --- |
| R1: collection feasibility | Complete | Five public review opportunities are archived in canonical, packet-bound form. Every v3 case has 2/2 rostered independent confirmations and the strict readiness gate passes. |
| R2: gather and partition | In progress | Frozen 100 attempted candidate slots across eight repository families. A restore-tested one-shot packet now binds 30 recovered draft proposals and 10 retained losses in the private evidence repository. Sole-human v3 governance, packet verification, and non-mutating response-to-admission derivation pass structural tests without weakening R1/v2. Human decisions, sufficient admission yield/headroom, durable admission import, and partitioning remain open. |
| R3: neutral and truthful harness | In progress | Four-arm scheduling, prompts, materialization, input/lifecycle seals, stopped-run closure, grading projections, bounded HTTP read tools, both historical curator-policy versions, arm-blind all-findings adjudication, descriptive reporting, append-only analysis artifacts, authenticated terminal resource sets/reports, and a final registration-to-analysis/source-snapshot binding have structural proof. Missing durations/tokens/cost remain unknown rather than zero; old report artifacts remain unchanged. Inferential decision seals, actual Codex/runtime availability, provider-connected egress, retry lineage, and real human admission remain open. Legacy historical CLI admission still fails closed. |
| R4: register four-arm comparison | Not started | Requires R2 and R3. This is the next provider-authorization checkpoint. |
| R5: methodology measurement | Not authorized | Planned maximum 96 initial attempts plus at most three registered component screens. |
| R6: select and confirm | Not started | Requires frozen candidate and new powered confirmation corpus. |
| R7: deployment bridge and prospective discovery | Not started | No automatic posting or production route change. |
| R8: component decision | Not started | Positive, negative, simplified, or inconclusive outcomes are all valid. |

## R1 artifacts

The narrative below preserves historical progress snapshots; old local paths
and preparation counts are not current availability claims. Use the current
recovery notice and progress table above for the latest state.

Active full-program goal: [goal and completion contract](2026-09-05-typescript-javascript-evidence-full-program-goal.md).

Next R3 sequence: [historical runner integration checklist](2026-09-05-historical-runner-integration-checklist.md).
The contract checkpoint at `2ff9961` is pushed; GitHub `check` and
credential-free build/smoke both passed. These are implementation checks, not
historical efficacy evidence.

The four-arm compiler derives 96 review attempts and 144 planned model calls
for the proposed twelve-case/two-repeat design. Exact per-arm resource
allowlists integrate with the existing materializer. The pushed asset slice
`b2ebbf0` passed GitHub `check` and credential-free build/smoke.

The next integrated slice adds actual A/B/C/D prompt assembly, reuse of the
Codex stage runner, exact pre-dispatch input receipts, and terminal records
binding stage outputs and handoffs. Its tests inject deterministic provider
outputs: four attempts, six dispatches, no real model calls. Results keep scope
unverified and never claim `clean`. See the
[structural integration report](../validation/2026-09-05-r3-methodology-runner-structural.md).
Stop/retry handling, full historical consumer integration, authenticated
scope availability, runtime/tool-policy and egress probes remain unfinished.
R2 human curation, protected partitions, and R4 authorization gates also remain.

Runner commit `e8ce1b6` passed the complete local `npm run validate`, GitHub
`check`, and credential-free build/smoke. The structural integration report
does not convert those passes into model-quality evidence.

R2 now has four offline-complete local snapshot archives (44.26 MiB) with
independently checked hashes, source trees, licenses, and canonical diffs.
Their [manifest and report](../validation/2026-09-05-r2-local-replay-archive.md)
are tracked; binaries remain local-only. All four retain shallow history and
therefore remain rejected by the historical materializer's complete-ancestry
gate. Bull, Next.js, NestJS, and Axios also lack required unchanged blobs.
No newly admitted cases or protected partitions were created.

Follow-up: Sequelize #8430 now also has a separate complete-history bundle.
Independent offline source checks confirm the exact review objects, root-family
identity, canonical diffs, and license. This clears its ancestry/source
availability issue, not admission. The bundle remains local-only; see the
[complete-history report](../validation/2026-09-05-r2-complete-history-feasibility.md).

The next R3 slice adds an independently reviewed historical case/source join,
code-only B/D lane activation, and a complete-only outer run seal. The join
keeps hidden truth out of reviewer inputs and verifies the original source
family, commits, trees, and diff. The seal retains failed attempts and refuses
to declare terminal completeness when scheduled evidence is missing. The
expanded methodology suite passes 62/62, with typechecking passing. These are
structural results, not historical inference or human admission. End-to-end
synthetic integration now exercises four arms through the complete seal.
The subsequent input-plan and trusted-runner join now binds fresh historical
admission/source/activation, frozen prompts, dispatch/preflight records, and
complete composite evidence. Its expanded suite passes 78/78 with typechecking.
Missing/stopped schedules, retry lineage, historical grading/report consumers,
and authenticated runtime availability remain unfinished. Commit `15cb7d1`
passed both GitHub `check` and credential-free image build/smoke.

The user has offered to perform human curation and verification as one
consolidated review, not serial case requests. The
[packet specification](2026-09-05-r2-human-review-packet-spec.md) targets enough
proposals and explicit losses to make one batch useful. One person is one
human reviewer; no independent-human or sealed-selection claim is created.
Any sole-human development policy must be explicit and versioned rather than
silently weakening the current two-confirmation gate.

Four additional source-bound decision drafts are prepared for that consolidated
packet: [two defect proposals](../validation/2026-09-05-r2-human-packet-defect-batch1.md)
and [two scoped comparison proposals](../validation/2026-09-05-r2-human-packet-comparison-batch1.md).
They are not human-approved or admitted. Source captures remain local-only and
shallow/partial. The comparison summary exposed scoped hypotheses to the
instruction author, so those slots are visible development preparation, not
protected validation. The next two defect and two random-comparison slots are
being prepared without changing the frozen 100-slot inventory.

Comparison batch 2 subsequently finished: `r2-random-003` is a preserved
sampled loss, and `r2-random-004` supplies one additional draft decision card.
The [aggregate report](../validation/2026-09-05-r2-human-packet-comparison-batch2.md)
publishes no causal answers. Its two manifest file hashes were independently
recomputed by the integrator and match the report. The preparer authenticated
29 receipts and 27 deduplicated response objects and reproduced both diffs
offline. This is source/preparation evidence, not human admission.

The frozen inventory integrity replay still verifies 772 receipts, 686 raw
objects, exactly 100 attempted slots, and zero admitted cases. Comparison
preparation continues through fixed slots 005–008; losses remain in the sample.

Defect batch 2 also completed: [two additional draft dossiers](../validation/2026-09-05-r2-human-packet-defect-batch2.md),
67 authenticated receipts (nine reused), no losses, and 80,777,777 acquired
bytes within its cap. The integrator independently matched the aggregate
manifest hash. Across these first two preparation batches per stratum, eight
slots yielded seven draft cards (four defect, three comparison) and one sampled
loss. These are additional preparation records, not seven admissions. The next
four fixed defect slots and four random slots are in progress.

Comparison batch 3 finished with two more draft cards and two preserved sampled
losses ([metadata and hashes](../validation/2026-09-05-r2-human-packet-comparison-batch3.md)).
All four manifest file hashes were independently matched by the integrator;
the preparer verified 59 receipts, 54 objects, and four offline diffs. Across
completed new preparation batches, twelve attempted slots now yield nine draft
cards and three losses; none is admitted.

Defect batch 3 added four draft cards with no losses
([aggregate bindings](../validation/2026-09-05-r2-human-packet-defect-batch3.md)).
The integrator independently checked all 216 bound files for exact bytes,
SHA-256, regular-file paths, duplicate paths, and symlinks; all passed. An
initial verifier invocation used the wrong directory (omitting `cases/`) and
failed before reading a manifest; the corrected invocation passed without
changing source artifacts. The preparer reports 85 authenticated GET receipts,
four corrected license-path capture failures retained, and no historical-code
execution. The shallow/promisor source store is not a replay-ready bundle.

Comparison batch 4 added one draft card and three explicit sampled losses
([aggregate bindings](../validation/2026-09-05-r2-human-packet-comparison-batch4.md)).
All four manifest file hashes independently match the report. The preparer
verified 54 receipts, 51 objects, and four canonical diffs offline; this is
source-integrity evidence, not human verification or a clean-label claim.

Across these completed new batches: **20 attempted slots, 14 draft cards
(eight defect, six comparison), and six retained losses; zero admissions**.
These totals exclude the earlier 12 exposed reconstruction opportunities.
The next fixed batches are defect slots alpha-008/013/014/015 and random
slots 013–016. Shared-family relationships remain explicit.

Comparison batch 5 subsequently added one draft card and three retained losses
([bindings](../validation/2026-09-05-r2-human-packet-comparison-batch5.md)).
The integrator independently matched all four manifest hashes; the preparer
validated 62 receipts, 58 response objects, and all four canonical historical
diffs offline. Completed new preparation now totals **24 attempted slots,
15 draft cards (eight defect, seven comparison), nine losses, zero admissions**.
Random slots 017–020 are next, without substitution or inventory expansion.
The earlier 12 exposed opportunities are also being packaged for the same
single human review, retaining their limitations and shared-PR relationships.

The integrator additionally checked batch 5's eight diff/card files and four
decoded license payloads against their bound hashes and byte lengths. An
initial direct-file license check failed because `license.path` names the
historical repository path, not a copied slot-root file. The actual license
bytes were recovered from hash-authenticated raw API objects and matched;
the final portable packet still needs separately materialized license files.
No original manifest or source artifact was changed by these checks.

Defect batch 4 added four draft cards with no losses
([bindings](../validation/2026-09-05-r2-human-packet-defect-batch4.md)).
The integrator independently verified all 227 bound files, byte lengths,
hashes, direct paths and absence of symlink traversal. Ninety GET receipts and
two resolved acquisition failures remain preserved by the preparer. One
two-work-item shared-root relationship has zero independent-root credit
claimed; raw card counts must not become independent-case counts.

The current completed new-batch total is **28 attempted slots, 19 draft cards
(12 defect, seven comparison), nine losses, zero admissions**. Earlier exposed
opportunities remain separate. Further fixed-queue collection, existing-dossier
packaging, stopped/missing-run closure and credential-free read-tool work are
in progress. None authorizes a model run or satisfies the human review gate.

The user's sole-human curator/verifier arrangement is confirmed. A
portable [packet assembler](../validation/2026-09-05-r2-human-packet-assembler.md)
now accepts the recovered Markdown and JSON card formats, shared batch
manifests, and ordinary repository filenames. The recovery-specific builder
rejects any inventory other than the checkpoint's exact 30 proposals and 10
losses, hashes every copied file, and produced the [durable one-shot packet](../validation/2026-09-08-r2-recovered-human-review-packet.md).
The generic packet still does not claim semantic source completeness or
reference closure. Neither packet
assembly nor one person's approval can satisfy two independent-human claims.

The exact assembler commit `fdae0689509d3bf59fbcb05fd94f8ecb350d9b1c` passed
GitHub `check` and credential-free image build/smoke; draft posting, analysis
and publishing jobs were skipped. This is structural/tooling evidence only.

Commit `f53ff59` adds schedule-order enforcement and neutral grading with 86/86
focused methodology tests and passing typecheck. GitHub `check` and
credential-free image build/smoke both passed for that exact head. See the
[grading integration record](../validation/2026-09-05-r3-neutral-grading-integration.md).
The next reader must preserve exact model-completed output while classifying
runner-unverified coverage as incomplete. It must not rewrite model output or
infer scheduled missing attempts from absent files without a closure seal.

That [execution-to-grading projection reader](../validation/2026-09-05-r3-authenticated-grading-projection.md)
is now implemented with exact raw-output receipts, versioned status reasons,
and captured-truth-byte binding. Independent review approved after corrections;
final local typecheck, 40 historical-contract tests, and 88 methodology tests
pass. Current runtime evidence still yields incomplete or failed projections,
never an authenticated complete review. Neutral judge/adjudication/report
consumers and stopped/missing closure remain unfinished.

GitHub CI `check` and credential-free image build/smoke both passed on the
exact pushed projection-reader head `ece9acd8226fc8262d9ec712f5a34b8003a949f3`.
Draft-only analyze, posting, and publishing jobs were skipped. This verifies
that head's repository checks, not usable historical model tools or efficacy.

An [offline runtime probe](../validation/2026-09-05-r3-offline-codex-read-probe.md)
found that the accepted image's direct file read works but the CLI's nested
read-only sandbox fails at namespace creation under the tested restrictions.
No credentials, model calls, historical code, or security relaxation were used.
Usable read/search tools and provider-connected egress remain R4 blockers.
An alternate read-only backend subsequently passed an offline read and denied
an inner write under unchanged container restrictions. It is not adopted:
credential/history isolation, actual model tools, and provider egress remain
unverified. The original default-backend failure remains preserved in the report.
The subsequent synthetic credential-path probe **failed read isolation**:
the alternate read-only backend printed a public canary mounted at the runner's
`auth.json` destination. No real login file or credential was supplied. This
rules out adopting the alternate backend alone as a credential-isolation fix;
runtime scope cannot be upgraded on the strength of its positive read probe.

- [Feasibility report](../validation/2026-09-04-r1-historical-reconstruction-feasibility.md)
- [Machine-readable manifest](../validation/artifacts/2026-09-04-r1-historical-reconstructions/manifest.json)
- [Source response hashes](../validation/artifacts/2026-09-04-r1-historical-reconstructions/source-hashes.md)
- Per-case proof bundles under
  `docs/validation/artifacts/2026-09-04-r1-historical-reconstructions/cases/`
- [Independent curation protocol](../validation/artifacts/2026-09-04-r1-historical-reconstructions/curation/review-protocol.md)
- [R1 completion status](../validation/2026-09-05-r1-historical-reconstruction-status.md)
- [Resume handoff](2026-09-05-typescript-javascript-evidence-ablation-r1-handoff.md)
- Authoritative v3 curator packet SHA-256:
  `d96904edf56c5b8dac970f59fa95a14c495cde5bd22d50a805e6874df098c2fe`

## R1 correction and verification history

- V1 remains immutable and failed. Two curators independently rejected the
  TypeScript base/diff and the breadth of the Karma #2846 claim while
  confirming the other three cases.
- V2 corrected the TypeScript merge base and narrowed the Karma claim. It is
  retained as ready intermediate evidence, including the original rejections.
- A separate integrity review found that the old raw patch hashes depended on
  repository-specific abbreviated blob IDs. V3 stores canonical full-index
  diff bytes for all five cases and supersedes every old diff-hash claim.
- V3 confirmations bind the exact packet hash, case bundle, rostered curator
  identity, directory, and filename. Both curators authored their own five
  confirmation files. The validator reports 2/2 for every case and `ready`.
- Focused integrity tests, TypeScript checking, and the strict zero-provider
  gate pass under Node 22. The full suite reached 249/252 while the worktree was
  dirty because three provider-enabled fixtures enforce a clean-worktree guard.
  After the R1 implementation commit, the exact `tests/eval-experiment.test.ts`
  suite passed 12/12 from a clean worktree, confirming those failures were guard
  state rather than behavioral regressions.

## Frozen constraints

- No historical provider runs before R4 review and explicit authorization.
- Do not use visible seeded panels as historical efficacy evidence.
- Do not call comparisons globally clean or infer complete truth from one fix.
- Do not expose later fixes, comments, issues, or curator answers to reviewers.
- Do not change production prompts, topology, route, skill, or posting behavior
  as part of this research program.
