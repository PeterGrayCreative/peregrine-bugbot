# TypeScript and JavaScript evidence and ablation progress

Updated: 2026-09-12 (prospective correction addendum; historical entries preserved)
Active branch: `research/evidence-audit-corrections`

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

Persistent worktree: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r3`.
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

The private evidence repository now holds the restore-tested
`r2-recovered-human-review-v2` packet at commit
`5d4969e46fdaff2dc36af53bd918d08150d3f7c4`. Its authenticated manifest binds
36 draft proposals (24 defect-bearing and 12 scoped comparisons), 11 retained
reconstruction losses, and blank human-decision templates. A fresh clone from
that exact remote commit reproduced packet SHA-256
`2b73535d50524c256bf26223b9f577d94cb1110e47745b6ebc0a06893ed89574`.
This historical snapshot records reaching a collection target for one
consolidated human review; it did not establish corpus readiness. None of the
drafts is admitted or partitioned, and sole-human review will not be described
as independent verification.

A durable blank response workspace is now stored on the private evidence
repository's default `main` branch. Commit `5f32493` adds a byte-bound
`ALL-PROPOSALS.md` containing all 36 cards in one scrollable document, with
relative proof links relocated to the exact packet copies. Decisions remain
exclusive to one consolidated `RESPONSE.json` workbook and the strict
per-dossier reference templates. A deterministic compiler expands only a complete, exact-order,
packet- and identity-bound workbook into the pre-existing 37-file verifier
format. The declared reviewer identity remains operator-prepared metadata, not
a human decision. The workspace starts with zero decisions and remains a draft
until the user completes the workbook and the verifier accepts it.

The experimental HTTP tool path passed fourteen focused tests and a real
credential-free two-container protocol probe. This supersedes the transport
not-implemented statements in earlier snapshots below, but no Codex/provider
connection or historical efficacy was tested. See the
[runtime probe record](../validation/2026-09-07-r3-read-mcp-runtime.md).

The latest R3 slice registers an exact zero-retry policy for new methodology
runs while retaining legacy registration read compatibility. It also derives
the registered D-versus-C, B-versus-A, and D-versus-A contrasts plus the
descriptive interaction from cross-bound grade, adjudication, and resource
artifacts. The contrast is persisted separately and joined to the existing v1
analysis seal through a new source-bound derived seal, so older analysis
artifacts are not reinterpreted. This is deterministic measurement plumbing,
not an inferential decision or provider result. See the
[validation record](../validation/2026-09-08-r3-contrasts-and-zero-retry.md).

R3 now has a separately authenticated stopped-run closure and missing-outcome
projection, with full methodology/historical-truth tests and independent review
passing. This supersedes the missing-closure status in earlier snapshots below;
provider runtime, inferential decisions, a future diagnostic-retry protocol,
and real admission remain open.
See the [closure record](../validation/2026-09-07-r3-stopped-run-closure.md).

The next R3 slice adds a source-bound, arm-blind semantic-judge ledger; grades
are derived only from its sealed Cartesian verdicts and persisted append-only.
A composite analysis binding reauthenticates the complete execution, judge,
grade, adjudication, report, and resource chain. Confirmed-new occurrences can
then be grouped into post-hoc discovery roots through a curator packet that
omits arm, route, and timing. The grouping is source-bound and reopenable after
process restart through a separate private operator key artifact. Curator
blindness remains operator-mediated and is not independently attested. These
are structural guarantees, not model-quality evidence. See the
[sealed-judge record](../validation/2026-09-08-r3-sealed-semantic-judge.md).

The current R3 slice binds a sanitized runner-owned MCP audit and exact
registered review scope into version-2 attempt terminals produced only through
the trusted provider attachment. Audit readers reauthenticate ordered calls,
aggregate counts, allowlisted status codes, and digests without retaining raw
paths, queries, source, or unknown tool names. Finalization rejects active MCP
requests and seals the audit against later mutation; version-2 terminal writes
require the branded provider finalizer. Version-1 scope evidence is
intentionally unable to certify completeness until a separately authorized
credential-bearing canary exists; missing canary evidence stays unverified and
observed unavailable context becomes incomplete. Both states remain
failure-inclusive and receive no root credit. Legacy terminals retain their
original meaning. See the
[runner-scope record](../validation/2026-09-08-r3-runner-scope-evidence.md).

The next R3 slice implements and exercises a standalone, credential-free
egress topology: the reviewer has only an internal network; a dual-homed TLS
CONNECT gateway permits an exact provider host and SNI; and a separate
tokenized forwarder permits only the fixed methodology MCP endpoint. The live
Docker probe authenticates exact network membership, source addresses,
entrypoints, request challenges, and sealed sidecar audits. It passed with no
provider credentials or model invocation. This proves the candidate sidecars
and synthetic topology, not Codex proxy behavior, the production methodology
lifecycle, or real provider reachability. See the
[egress sidecar record](../validation/2026-09-09-r3-egress-sidecar-proof.md).

The current R3 integration slice wires that topology into the trusted
methodology provider attachment and attempt lifecycle. Production attachments
use the repository-owned Docker executor only, create fresh per-attempt
networks and sidecars before provider launch, and pass an opaque
supervisor-issued capability to the contained reviewer. The invocation policy
and version-2 scope record bind the exact egress attestation, provider-authority
digest, internal MCP route, sealed sidecar diagnostics, and runner-owned MCP
audit. Cleanup is awaited before terminal scope evidence is written; failed
cleanup interrupts the lifecycle instead of producing a misleading scope
record. Structural mocks are separately branded and cannot satisfy provider
evidence. This remains structural evidence: no provider invocation or
credential-bearing canary has run under this slice. See the
[integration record](../validation/2026-09-09-r3-methodology-egress-integration.md).

The R2/R3 bridge now has a versioned post-admission partition contract. It
reauthenticates the immutable packet, complete sole-human response, every
admitted v3 case, truth scope, case bundle, registration, source-family
identity, and the separate human partition attestation. It derives exact
12-case development and 24-case selection counts, the 24/12 class balance,
duplicate-family containment, and the nine-case repository-family ceiling.
Append-only artifacts retain rejected and unresolved response counts and fail
closed on stale inputs, lineage gaps, symlinks, extra files, and false
independence/protection claims. This is structural readiness only: the durable
36-card packet still contains blank decisions, so no real partition artifact
or R2 admission exists. See the
[partition checkpoint](../validation/2026-09-09-r2-partition-binding-checkpoint.md).

## Active objective

Determine whether any Peregrine component improves consequential TS/JS bug
finding, unsupported-finding behavior, or measured work relative to a competent
minimal reviewer. Production routing remains frozen.

## Progress

| Step | State | Evidence / remaining gate |
| --- | --- | --- |
| R1: collection feasibility | Complete | Five public review opportunities are archived in canonical, packet-bound form. Every v3 case has 2/2 rostered independent confirmations and the strict readiness gate passes. |
| R2: gather and partition | Correction required; no admission or protected selection | The sealed v2 packet/workbook and its 36 blank decisions remain unchanged and unadmitted. A read-only Astra xhigh audit recommends 15 approvals (8 bug-bearing, 7 comparisons), 1 rejection, and 20 unresolved proposals; all approvals are development-only advisory recommendations, not human decisions. The current usable pool is short by 16 bug-bearing and 5 comparison approvals, and no R2 selection partition or R4 readiness exists. Repair the successor packet/corpus under the [correction goal](2026-09-12-evidence-audit-correction-goal.md) and [calibrated protocol](2026-09-12-calibrated-evidence-audit-protocol.md). |
| R3: neutral and truthful harness | Structurally complete; runtime canary separately gated | Four-arm scheduling, neutral prompts and mounts, input/lifecycle/stop seals, honest grading projections, all-finding adjudication, grouped discovery roots, resource accounting, exact Sol-high launch policy, bounded read tools, fail-closed scope evidence, destination-restricted egress, semantic judge, authenticated analysis joins, operator-only R2 truth/severity binding, clustered inference v2, and append-only decision lineage have deterministic evidence. Development severity remains descriptive and selection remains exploratory. Old artifacts and production behavior are unchanged. A credential-bearing model/tool canary requires separate authorization and is not historical efficacy evidence. Real execution depends on corrected R2 acceptance/partition under the prospective protocol, which does not yet exist. |
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

A [trusted provider-attachment slice](../validation/2026-09-08-r3-trusted-provider-attachment.md)
now binds the repository-owned containment launcher and bounded MCP reader to
the exact materialized checkout, source head tree, arm assets, output root,
accepted image, access mode, and limits. The invocation record retains a v2
attachment reference. Mutable callback roots, arbitrary lookalike attachments,
and cross-request reuse reject; MCP cleanup precedes checkout deletion. This is
structural/mock evidence only. Provider-connected credential isolation,
destination-restricted egress, served-model evidence, runner-owned scope
completion, and the inferential decision seal remain open.

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

## 2026-09-09: operator truth/severity binding checkpoint

The R2 partition implementation merged in PR #40 at `4e8ce05`. It can derive
and append-only store the exact 36-case, 12/24 development/selection split from
one authenticated human response and attestation. This is tooling completion,
not a claim that the current durable packet has 36 human-approved cases.

The next R3 slice now adds an operator-only truth/severity binding. It reads an
exact admitted R2 partition by digest, re-authenticates every historical case,
derives the same structured causal-root identity used by grading, rejects
grouped roots with conflicting severities, binds canonical truth and all
registration/curation/bundle/scope identities, and writes a contiguous
append-only lineage. The parser rechecks the 36-case split, repository-family
concentration, duplicate-family partition containment, root namespace, counts,
claims, ordering, and artifact digest. Reviewer-visible prompt compilation has
an explicit regression check proving the operator protocol, directory, and a
truth canary are absent from all four experimental arms.

This checkpoint does not yet make the inference surface truth-aware. Legacy
inference remains unchanged and its severe-regression surface stays unknown.
The next slice must add a versioned inference protocol and seal that consume the
exact binding while preserving legacy readers and descriptive-only 2-repeat
development semantics. No provider experiment has run.

## 2026-09-09: truth-aware inference v2 and seal checkpoint

Inference v2 now consumes the exact operator-only R2 truth binding instead of
accepting duplicate-family clusters or severity labels from its caller. Its
preregistered plan binds the invocation registration, input plan, partition,
case registration, curation, bundle, truth scope, and canonical truth digests.
Only opaque identities enter the reviewer-side plan; root answers and severity
remain outside every reviewer mount and prompt.

The v2 inference artifact derives clustered intervals from the authenticated
duplicate-family structure and derives high-severity C/D repeat counts from the
authenticated root catalog. Development results remain descriptive at two
repeats, selection results remain exploratory at three repeats, and formal
high-severity regression decisions remain reserved for a future confirmation
protocol. Existing v1 readers and artifacts are unchanged.

A separate append-only v2 seal rederives the complete analysis from the sealed
schedule, inputs, grades, adjudication chain, grouped unmatched-root ledger,
resource evidence, R2 truth binding, and an explicit implementation-source
manifest. Stored plans and seals reject wrong digests, non-contiguous lineage,
source drift, stale input joins, and cross-run truth bindings.

This is deterministic structural infrastructure, not efficacy evidence. The
durable R2 packet still has zero admissions until the sole human curator reviews
it, so no real R2 truth binding, v2 preregistration, or provider experiment has
been produced.

## 2026-09-09: one-pass R2 curation and partition workbook

Private evidence `main` holds workbook protocol v2 and the merged history of
the former draft PR #1. Commit `5f32493` adds the consolidated review-only view.
The same blank `RESPONSE.json` covers all 36 proposal decisions and, for every
approval, its development/selection placement, bug/comparison class, and
duplicate-family ID. No field is prefilled with a human judgment.

The compiler derives both the existing strict response directory and the
self-authenticating R2 partition attestation from that single completed file.
It rejects missing or contradictory partition fields, duplicate families that
span partitions, wrong packet or reviewer bindings, false independence claims,
and existing or overlapping destinations. This removes a second manual
attestation step but does not satisfy the human gate or authorize provider work.

## 2026-09-12: consolidated R2 human review view

A deterministic renderer now verifies the sealed packet before and after
reading its cards and writes all 36 proposal cards to one review-only Markdown
file. Each section includes the dossier, card, and packet digests. Relative
supporting-evidence links are relocated from the nested card location to the
exact durable packet copy; links outside the packet reject. The renderer
refuses packet/output overlap and overwrite, does not read or prefill decisions,
and does not claim completed or independent review.

The generated `ALL-PROPOSALS.md` is durable on private evidence `main` at
`5f32493`; SHA-256 is
`2dcd12dfa192416b0ef056ca644f830526e46e3df8df951b34d8c75fd95b21e5`.
All 138 relocated local links resolve in the durable checkout. Typecheck and
all 27 evidence-capture tests pass. Human review of the companion
`RESPONSE.json` remains the R2 gate.

## 2026-09-12: evidence-audit correction status

This dated entry is prospective and does not rewrite the historical snapshots
above. The replacement correction goal has four delivery sections: (1)
prospective protocol/design, (2) successor packet repairs, (3) corpus
repair/replacement, and (4) corrected R4 freeze. Each completed section
requires a `gpt-6-astra` medium-effort read-only quality/adherence gate before the next
section starts. The gate is a quality/adherence review, not human curation,
independent selection, provider evidence, or efficacy evidence.

The methodology audit found that universal per-item human signatures are not a
research-wide requirement, but it also found that AI consensus is not human
confirmation and that unaudited individual labels must not be called
human-verified. Future paths therefore use the calibrated probability/stratified
audit protocol, with full human review retained as the simpler small-corpus
option. The protocol requires a frozen minimal competent-baseline prompt,
identical raw scope/tools/model/effort/schema, comparable total allowances,
and no Peregrine leakage. A two-arm candidate-versus-baseline comparison is
enough for product value; four arms remain only for instruction/topology
attribution.

The 12-case/96-attempt study is explicitly exploratory. Its repeats are not
independent cases. Confirmation remains blocked until a preregistered
numerical or simulation/design-appropriate power and error plan names the
estimand, dependence unit, practical margins, interval method, multiplicity
policy, and failure handling. The 2-of-3 severe rule is only a stop/investigation
rule, and the 50-PR cohort is only feasibility/signal collection.

The [Astra xhigh evaluation and methodology audit](../validation/2026-09-12-astra-evaluation-methodology-audit.md)
records five repair classes: the alpha-025 base/diff mismatch; alpha-021
attribution; alpha-010 dossier binding; exposed-07's stale recovery status;
and incomplete or blank rendered proposal content. It also records the
RxJS duplicate-family link between alpha-025 and random-007. These are repair
inputs, not admissions. Provider runs, production routes, automatic posting,
and efficacy claims remain unauthorized; no exact 36-case readiness claim is
created by this status update.

The correction keeps collection bounded at at most 100 candidate slots, a
target of at least six repository families, and no more than 25% of an admitted
initial corpus from one family unless a replacement batch is prospectively
registered first. The candidate ceiling, family balance, admitted-corpus size,
and stopping conditions must be frozen before further collection. The valid
terminal outcomes are a corpus-ready zero-provider R4 freeze or a reviewed
termination/inconclusive report with yield, losses, unresolved reasons, and
the R4 boundary. Deterministic implementation, archival, and zero-provider
preparation are authorized by the correction program; credential-bearing
canaries, provider runs, and other external execution still require separate
authorization.

The Astra xhigh methodology report is durably archived in
`../validation/artifacts/2026-09-12-astra-methodology-research-review.md`.
The private Astra xhigh corpus report is archived at
`PeterGrayCreative/peregrine-evidence-backup/audit-reports/2026-09-12-r2-corpus-audit.md`;
source and archive SHA-256 values plus Git blob identities are recorded in the
[correction goal](2026-09-12-evidence-audit-correction-goal.md). The private
backup commit is `d04cce4`; neither archive is a corpus admission.

Section 1 is complete. A separate `gpt-6-astra` reviewer at medium effort
approved the corrected prospective protocol after verifying the bounded
collection rules, durable audit provenance, two terminal paths, truthful
completion rule, and external-execution authorization boundary. The gate is
recorded in the [Section 1 Astra medium gate](../validation/2026-09-12-section-1-astra-medium-gate.md).
This approval does not admit corpus cases or authorize provider execution.
