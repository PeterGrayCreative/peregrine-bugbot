# Evidence-program interruption recovery

Date: 2026-09-07

The user resumed after being signed out. Read-only filesystem checks found the
former worktree, curator store and replay store absent. The cause of directory
removal has not been established; the authentication failure alone does not
explain it.

## Verified recovery boundary

- PR #32 remains open and draft on `research/ts-js-evidence-r2`, with pushed
  head `afb1d2c0afc71b8cd841ae4347f0f0b3703b49d0` and base
  `research/ts-js-evidence-r1`.
- The local branch and retained old-worktree index match that pushed head.
  No additional staged implementation was found in that index.
- A clean checkout was restored at
  `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2`.
  The user's old root checkout and unrelated untracked files were preserved.
  The stale worktree registration was retained, not pruned.
- Under Node 22.22.1, `node scripts/evidence/verify-r2-captures.mjs` verified
  all 772 committed receipts, 686 objects, 100 candidate slots and zero
  admissions. This verifies the committed candidate archive, not missing
  supplementary dossiers or replay bundles.
- Fresh `npm run typecheck` and `npm run test:evidence-capture` pass under
  Node 22.22.1 (eight tests, no failures/skips/cancellations). Dependencies
  were restored using `npm ci --ignore-scripts --no-audit --no-fund`.
- The independent read-only recovery inventory checked all 297 entries in
  the two surviving development bundles (148 + 149). Those checks establish
  retained file bytes, not the availability of old source clones.

## Unavailable local artifacts

The following exact locations do not currently exist:

- `/private/tmp/peregrine-ts-js-evidence-r1`
- `/private/tmp/peregrine-r2-human-review-preparation`
- `/private/tmp/peregrine-r2-replay-sources`

The completed supplementary batch reports describe 28 attempted slots:
12 defect draft cards, seven comparison draft cards, and nine sampled losses.
Their summaries and hashes remain committed; the referenced local bytes are
unavailable. **Nineteen reported drafts is not nineteen available dossiers.**
The original nine sampled losses remain recorded as such. Missing storage is a
separate availability failure, not a new scientific rejection of those cases.
The shared-root relationship remains in force.

The exact previously completed supplementary recovery queue is:

- Defect drafts, in preparation order: alpha-002, 004, 003, 005, 007, 009,
  011, 012, 008, 013, 014, 015 (`r2-post-merge-alpha-*`).
- Comparison drafts: random-001, 002, 004, 007, 008, 012, 014.
- Original sampled losses: random-003, 005, 006, 009, 010, 011, 013, 015, 016
  (`r2-random-*`).

Recovery of earlier exposed opportunities and the first two supplementary
drafts has restarted in new persistent version directories. Further queue
items that were in flight at sign-out are not silently counted as completed.

Four local snapshot archives and the complete-history Sequelize bundle also
require recovery. Their committed manifests do not reconstruct the binaries.
Uncommitted stopped-run closure and read-tool implementation work is not in the
restored tree and must be recovered from valid artifacts or reimplemented and
tested. No historical provider run is being resumed or inferred from these
partial implementation records.

## Recovery protocol

1. Reconcile the committed archive and every external reference before counting
   anything ready. Preserve all old hashes, reports, failures and truth versions.
2. Use the persistent worktree above for implementation. Use
   `/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation`
   for recovered curator data, outside the implementation worktree and every
   reviewer mount. This is local persistence, **not** an access-controlled
   holdout or an independently verified backup.
3. Recover the same frozen candidate slots, not substitutes. Prefer surviving
   committed bytes. If public retrieval is needed, record a new retrieval and
   recovery version; never claim new response bytes match a missing original
   without checking their original digest.
4. Preserve a metadata-only availability/recovery inventory in this PR. Before
   the consolidated packet is declared ready, require a second durable copy
   and a tested restore of its complete file closure. The destination and
   confidentiality controls must be explicit; a hash-only remote report does
   not satisfy backup.
5. Reimplement missing code in bounded reviewed slices, without bypassing
   historical admission, scope, execution authorization or production boundaries.

The user still receives one consolidated review packet, not partial approval
requests. One human cannot supply two independent human confirmations. R2–R8
remain incomplete and the full goal remains active.

## Retrospective

Failure: supplementary proof and source bytes were only in temporary storage.
The mistaken operational assumption was that those locations would survive
the research session; earlier reports correctly disclosed local-only storage
but did not fix its durability. Classification: insufficient persistence
verification. A restore-tested non-temporary copy would have prevented this
recovery gap. New rule: no review-ready packet claim without complete-file
backup and restore evidence; retain availability failures explicitly.
