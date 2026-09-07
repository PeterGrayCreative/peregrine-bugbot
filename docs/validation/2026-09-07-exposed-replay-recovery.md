# Exposed development replay source recovery

Date: 2026-09-07. Scope: Sequelize #8430 only, using the exact historical identities in the unchanged [original complete-history manifest](artifacts/2026-09-05-r2-local-replay-sources/sequelize-8430-complete-v1-manifest.json).

The complete history needed for all four declared historical revisions is recovered in a new persistent local source store. This restores source availability for this exposed development opportunity; it does not restore the missing old archive bytes or establish admission, human confirmation, runtime proof, or a selected partition.

## New artifact

Persistent root: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/exposed-replay-recovery-v2/`.

| Artifact | Value |
| --- | --- |
| Bundle | `sequelize-8430-recovered-v2.bundle` |
| Bundle bytes | 20,773,571 |
| Bundle SHA-256 | `29b45847bf8c13ea38acbc7743c420e36c3f890e7babc9b17a1de36da45518cc` |
| Metadata | [manifest.json](artifacts/2026-09-07-exposed-replay-recovery/manifest.json) |
| Metadata SHA-256 | `061dbd7d864bb0714f102a137ef3d6a090b14f15c10488e75386026b960d4384` |
| Persistent operation log | `operations.json` |
| Operation log SHA-256 | `b8f26a1e5c92e340b0c177888f095aec5a03a145852da2bb828bf48afd1219c6` |

The old 73,954,380-byte bundle hash remains recorded unchanged and does not match this new bundle. The new acquisition fetches only the exact review base, review head, final base, and final head into four named evidence refs, with full ancestry and no shallow or partial-clone flags. It does not fetch the current default branch. Its smaller size is a different source capture, not evidence that the old bytes were recovered.

## Offline verification

A new bare source repository received the public unauthenticated Git fetch. A separate empty bare repository, `offline-restore.git`, fetched only from the new local bundle. Every subsequent object check disabled lazy fetching and all transports. Both repositories passed:

- full `git fsck --full --no-dangling`, SHA-1 object format, and non-shallow state;
- exact original trees for all four revisions and the original review merge base;
- exactly 7,749 commits in review-head ancestry, root `fee92083a75c15f5b6cd2d0c2f3bb043ae155e68`, and original family identity `ecbb11132c5f78baa9f763a604e2631220a6512bb6320590200cc5aa6b8df3e3`;
- all three original canonical review/final/delta byte counts and SHA-256 values;
- original MIT license Git blob and decoded content hash;
- absence of shallow boundaries, alternates, promisor settings/markers, replacement refs, and grafts.

`git bundle verify` passed against the fresh restore, and the bundle advertises exactly the four historical evidence refs. Canonical diffs and readable license bytes are retained separately in the persistent root. No source commit, history, object, or Git ancestry metadata was synthesized or modified; only normal Git initialization/fetch/bundle operations created the new stores.

## Limits and remaining gates

The acquisition and verification script completed in 10.296 seconds against a 1,200-second wall cap. Aggregate new persistent data, including source repository, bundle, fresh restore, script, logs, diffs, license, and final manifest, is 64,064 KiB (62.5625 MiB), below the 250 MiB cap. The generated manifest records the slightly earlier pre-manifest accounting snapshot of 65,597,440 bytes. Operations were monitored against the aggregate cap; projected bundle/restore storage was checked before construction.

No historical code, hooks, dependencies, builds, or providers were executed. No case-specific materialization, admission, human decision, or partitioning was attempted. All source history remains curator-side exposed development material and must be sanitized before any future reviewer input. The old exposed-dossier recovery tree and archive remain unchanged; this new version is a separate source supplement.

After the bounded recovery completed, an exact-byte copy was also placed at `artifacts/2026-09-07-exposed-replay-recovery/sequelize-8430-complete-v2.bundle` for repository preservation. The [repository copy record](artifacts/2026-09-07-exposed-replay-recovery/repository-bundle.json) binds its unchanged 20,773,571-byte size and SHA-256. Its hash was independently recomputed and `git bundle verify` passed offline against the fresh restore, reporting four refs and complete history. The original persistent bundle and repositories remain unchanged. Including this additional bundle copy still leaves aggregate new data below the 250 MiB cap.

The original recovery metadata is retained byte-for-byte; its `localPersistentOnly` field describes the initial capture before the repository copy and is superseded for storage location by `repository-bundle.json`. Neither artifact is yet committed or pushed, and remote durability is unclaimed. No other replay sources or supplementary curator evidence were read or recovered by this pass.

Main independently rehashed the repository bundle and verified its four refs
and complete-history declaration offline. The original operation log and
recovery script are also copied byte-for-byte beside the repository bundle;
the log hash matches the initial manifest. Recovery script SHA-256:
`a394772ded22e21aa2956d9472ed3eae319293eb39d08a468f00b12d2d2f2c15`.
These exposed-development files passed the repository's secret-pattern check;
that check is not a guarantee that arbitrary public history contains no secrets.
