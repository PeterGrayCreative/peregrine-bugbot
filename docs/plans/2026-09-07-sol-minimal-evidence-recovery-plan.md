# Sol: minimal evidence recovery and durable handoff

Date: 2026-09-07. Status: execution paused before upload because the selected
repository is public.

Storage decision: the user approved the existing GitHub repository for evidence
backup. A live check on 2026-09-07 returned `visibility: PUBLIC` and
`isPrivate: false` for `PeterGrayCreative/peregrine-bugbot`. No evidence backup
branch or upload existed when checked. Upload is therefore blocked until the
user makes this repository private, selects a separate private repository, or
explicitly chooses encrypted public storage with a separately preserved key.
Branch separation alone does not protect benchmark answers.

## Assignment

Recover a dependable, resumable evidence store with the least repeated work.
Do not restart R2 collection or attempt to finish the research program.
Most missing draft evidence has already been reconstructed. The immediate
job is **verify, preserve, inventory remaining gaps, and stop**.

Use Sol for this recovery task. This is a curator/storage assignment, not a
benchmark arm or a production-model change. Do not launch historical reviewer
models, judges, builds, tests, dependency installation, or repository code.

Worktree: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2`

Curator root: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation`

Starting reference: `bca8393f30a02d8c1ec067761c5b08bbd012db0e`, branch
`research/ts-js-evidence-r2`, draft [PR #32](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/32).
Check live status first; preserve concurrent changes. The stale root checkout
and missing `/private/tmp` paths are not working locations.

Read these first, not every historical report:

1. [Recovery checkpoint and manifest hashes](../validation/2026-09-07-recovery-checkpoint-handoff.md).
2. [Role-separation disclosure](../validation/2026-09-07-recovery-role-separation.md).
3. [Packet requirements](2026-09-05-r2-human-review-packet-spec.md), only when deciding whether a missing reference blocks preparation.

The [research plan](2026-09-04-typescript-javascript-evidence-ablation-plan.md)
remains binding. No matching interview result was found under `.rein/specs`.
The reboot makes temp cleanup plausible, not proven; do not spend recovery
time investigating the deletion cause.

## Do not rebuild these from scratch

| Evidence | Starting disposition | Minimal action |
| --- | --- | --- |
| Frozen 100-candidate archive | 772 receipts / 686 objects verified at checkpoint | Run existing verifier once; reuse bytes. |
| 12 exposed development proposals | Repository-backed archive; 316 bound evidence files | Verify archive and fresh restore; do not rewrite proofs. |
| 19 supplementary source slots | Eight recovery stores reconcile drafts/losses; linked pair gives 18 draft proposals | Verify against checkpoint hashes; back up exact current versions. |
| Nine original sampled losses | Qualified records survive; detailed original rationales/diffs do not | Preserve explicit unknowns. Do not invent or recollect lost rationale merely to fill fields. |
| Complete Sequelize #8430 replay | New complete-history bundle already committed | Verify/reuse; do not recover the superseded shallow archive. |
| Reimplemented R3 code and synthetic results | Already committed | Leave untouched. Recovery is not another harness rewrite. |

The eight curator recovery stores are four `supplementary-recovery-v*` stores,
two `comparison-recovery-v*` stores, `linked-defect-recovery-v1`, and
`sampled-loss-recovery-v1`. Their checkpoint hashes are authoritative inputs.
There are 30 total draft proposals including exposed development material;
these are not 30 admitted, independent, or fully proved cases.

## Ordered execution

### 1. Verify existing bytes → produce one availability inventory

Budget: 20 minutes initially. Read `.nvmrc`, then activate its pinned Node 22:

```sh
source /Users/petergray/.nvm/nvm.sh
nvm use 22
node scripts/evidence/verify-r2-captures.mjs
```

Inspect and reuse the metadata-only verifiers named in the checkpoint reports.
Use the v3 supplementary verifier with an explicit v1 store argument where
v1 has no own verifier. Check expected manifest hashes from the committed
checkpoint **before** accepting internally consistent replacement files.
Reject traversal and symlinks; verify enumerated sizes/hashes and inventory.
Print opaque IDs, counts and failures only, not causal proof or source text.

Write `recovery-inventory-v1.json` under a new persistent curator subdirectory.
One row per bundle: path, expected/observed digest, verification result,
source availability, proof qualification, original-byte identity status,
backup location/status, and required missing references. Keep semantic truth
and human admission separate from storage availability.

If all current files verify, **skip reconstruction**. A hash mismatch is a
storage failure: preserve the suspect file, prefer a verified committed copy,
and do not regenerate a manifest just to accept changed bytes.

### 2. Back up verified evidence → test a full offline restore

Budget: 30–60 minutes of setup/verification, plus transfer time.

Make an immutable archive of the verified curator file closure, including raw
responses, manifests, receipts, proofs, blank cards, licenses, source object
stores and verification scripts. Exclude only proven disposable duplicates;
do not remove source objects required for offline checks. Use standard archive
and checksum tools, not a new backup framework. Reject unsafe archive members
before extraction. Keep originals untouched throughout.

First create a second persistent copy outside the source tree. This protects
against accidental source-folder deletion but **not disk failure**. Then push
the archive and its file/hash inventory to the approved existing remote,
`https://github.com/PeterGrayCreative/peregrine-bugbot.git`, on the dedicated
backup branch above. Use a separate persistent staging directory; keep causal
files out of the implementation checkout and PR. Inspect any existing backup
branch before writing; never overwrite history or force-push. Do not merge
the backup branch into research/main or open a merge PR for its contents.

Store immutable versioned archives and manifests; do not repeatedly commit
working clones or duplicate caches. Scan proposed uploads for credentials and
unrelated private material; omit account/session credentials entirely. Preserve
source licenses. Check actual upload constraints before pushing; if an archive
is too large, use bounded archive volumes with one manifest binding all parts,
not a new storage service or silent omission. Record the exact remote commit
and branch, not just a successful local commit.

GitHub provides a separate failure domain from this computer. It does **not**
provide curator isolation from other readers of this same repository. A
different branch is an organizational boundary, not access control. Record
repository-reader access/exposure and make no protected-selection or sealed
holdout claim; future genuinely sealed evidence needs a separately controlled
store. Reviewers must not receive the backup branch, remotes, or its Git objects
through their sanitized mounts.

Fetch the exact pushed backup commit into a fresh persistent directory without
reusing the source object store, then restore its archives. With
network access and lazy Git fetching disabled, compare complete file inventory
and every byte hash, rerun bound verifiers, and check available source refs,
trees and canonical diffs. Test the restore, not just archive creation. Record
backup digest, destination, restore digest/results and uncovered gaps.

**First safe checkpoint:** verified current evidence plus a tested restore from
the GitHub backup, with any failed upload/restore explicitly pending. No further
reconstruction is needed merely to reach this checkpoint.

### 3. Repair only blocking missing references → version each repair

Do this only if step 1 identifies a missing file necessary to read or verify
an already prepared dossier. Recover from existing archives/object stores
first, then exact public Git objects or dated responses. Use original
commit/tree/diff identities; never substitute current main or reverse a fix
and call it an authentic introducing change.

Initial cap: 20 minutes and 250 MiB new acquisition per affected family,
at most two families in this recovery pass. Share source acquisition within
a repository family. If capped or unrecoverable, retain a precise gap and
stop that item. Do not expand collection or silently change the candidate.
These are proposed recovery limits, not permission for provider experiments.

Write a new version; preserve old manifests and failed attempts. Verify exact
trees, canonical diff bytes, licenses, source receipts and all required blobs
offline. New response/proof bytes need new hashes, even if the Git tree or
review diff matches the historical binding. Back up each new version and
repeat the restore check before reporting it available.

Do not restore whole clones merely because they once existed. The missing
webpack, VS Code #112075 and RxJS #2397 snapshot archives are deferred unless
an actual dossier reference requires them. The former Bull/Next.js/NestJS/Axios
stores were already incomplete; rebuilding them is source-completion work,
not restoration of a previously usable benchmark. Full ancestry needed by
the historical materializer belongs to later runner readiness; do not relax
that gate or label a shallow capture runnable.

### 4. Publish one recovery report → stop

Write `docs/validation/2026-09-07-sol-minimal-recovery-results.md` with metadata
only: reused/restored/rebuilt/missing counts, qualified losses, exact manifest
and backup hashes, restore results, time/bytes spent, local versus remote
durability, and the next unresolved requirement. Link the inventory by digest
and approved location. Update current progress without rewriting old records.

Check documentation links and `git diff --check`. If the assembler/capture
code was not changed, no full harness test sweep is necessary for a storage
report. Use `npm run test:evidence-capture` if its inputs/code changed; no
provider-capable validation command without inspecting it first.

When executing this plan, commit only metadata/report changes to the existing
research branch; evidence bytes belong exclusively to the backup branch.
Push normally, record current-head
CI honestly, and stop. Do not assemble a partial human-review packet or ask
for individual decisions. Do not advance R3, collect more candidates, or run
experiments as part of recovery.

## Delegation and exposure

Default: one Sol worker. Verification/copying does not benefit from five
parallel reasoning agents. If two independent family repairs are genuinely
needed and delegation is authorized, allow at most two curator-only workers
with disjoint output paths. One owner assembles inventory/backup/report.

Use fresh curator-only contexts without prior prompt/tool-description
authorship. Anyone inspecting causal proofs must not later tune experimental
instructions against those reserved cases. Main implementation agents see
metadata only. Carry the nine recorded loss-slot exposure restrictions forward.
AI hash checks are not additional human confirmations; no local folder is a
sealed holdout.

## Definition of done, risks and rollback

- Every previously reported item has an honest available/missing/qualified row.
- Available evidence matches pinned recovery hashes and survives a fresh restore.
- Any unavailable originals remain explicitly unavailable; no synthetic backfill.
- Backup location/control is documented; no off-device claim for a same-disk copy.
- Metadata report and progress are published if publication was authorized.
- Full research goal, case admission and human-review readiness remain separate.

Blast radius: recovery directories and one metadata report/progress update;
zero product APIs, schemas, runtime defaults, prompts or dependency changes.
Rollback: retain old and new versions, mark an invalid capture superseded,
and never delete originals or failed evidence to tidy the result.

Expected initial pass: approximately 1–2 hours if stored bytes verify, plus
backup transfer time. Two capped repairs can add roughly 40 minutes before
verification. These are estimates, not a promise of full R2/R3 readiness.

Resolved decision: the existing GitHub repository is the off-device backup
destination. Its private status, successful remote push and fresh restore must
be verified. Curator access isolation remains unresolved; this backup does not
satisfy a protected-validation or external-holdout gate.

## Prompt to give Sol

> Follow `docs/plans/2026-09-07-sol-minimal-evidence-recovery-plan.md` in
> `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2`.
> Verify and back up existing recovery versions first. Do not redo recovered
> collection. Rebuild only a required missing reference within the stated caps;
> preserve unresolved gaps and old hashes. No provider experiments, production
> edits or partial human review. Return one metadata-only recovery report with
> tested restore evidence and explicit backup limitations, then stop. Use the
> approved existing GitHub repo on `evidence-backup/2026-09-07-recovery`; keep
> evidence out of the implementation PR. Verify private visibility and restore
> from the pushed commit. Do not claim that branch separation seals the answers.
