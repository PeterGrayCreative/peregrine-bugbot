# R2 complete-history feasibility: Sequelize #8430

Date: 2026-09-05
Scope: exposed DEVELOPMENT source preparation only; this is not admission, partition selection, human confirmation, or provider evidence.

## Outcome

Complete ancestry is feasible for the smaller of the two eligible snapshot captures, Sequelize #8430. The previous shallow tar and the other three snapshot archives remain unchanged. A new non-shallow bare source clone and a separate Git bundle were created locally:

- source clone: `/private/tmp/peregrine-r2-replay-sources/sequelize-8430-complete-v1.git` (85,516 KiB);
- versioned capture: `/private/tmp/peregrine-r2-replay-sources/sequelize-8430-complete-v1.bundle` (73,954,380 bytes; SHA-256 `9d9a441c1983cb732a43e7f9a87dbf76b82c1f383d6a7804bcd7c6c82af80af6`);
- offline validation clone: `/private/tmp/peregrine-r2-replay-sources/sequelize-8430-complete-v1-offline-check.git` (85,336 KiB).

These files are local-only `/private/tmp` captures and are not durable or checked into Git. Their tracked metadata is [sequelize-8430-complete-v1-manifest.json](artifacts/2026-09-05-r2-local-replay-sources/sequelize-8430-complete-v1-manifest.json).

## Bounded acquisition

The evidence-store baseline was 45,344 KiB. The full clone, bundle, and retained offline validation clone added 243,076 KiB (237.379 MiB), below the 250 MiB cap. Recorded creation phases took 4 seconds for the public clone, 1 second for the exact-object fetch, 1 second for bundling, and 4 seconds for the offline clone; no phase approached the 20-minute cap.

The initial command was a read-only public `git clone --bare --no-tags --single-branch https://github.com/sequelize/sequelize.git`. It recovered complete default-branch ancestry but correctly did **not** contain the historical PR branch head `bda0df47...`. A second read-only fetch preserved the three PR-only identities as evidence refs:

```text
git --git-dir=<new-clone> fetch --no-tags origin \
  bda0df47ebcca4ad06f9eec006d35537ce6deb43:refs/evidence/review-head \
  a2d0c10a38083958361ff8218a015adcc21e7764:refs/evidence/final-head \
  2a3b3dba6bc257e19378bd18f56017fd66bfe6e6:refs/evidence/final-base
```

This distinction matters: a non-shallow default-branch clone alone is insufficient for this opportunity. `git fsck --full --no-dangling` passed only after the explicit identities were rooted. No promisor markers, alternates, grafts, or replacement refs are present.

## Exact historical verification

All checks below used `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0`, and `git -c protocol.allow=never` after acquisition.

| Check | Recovered value |
| --- | --- |
| object format / shallow state | `sha1` / `false` |
| review base / tree | `a056b5aa36c7598f5cbb3aaee0165bda53e9c65a` / `0547c8a3712081add3675782b200e4e0e272e557` |
| comment-bound head / tree | `bda0df47ebcca4ad06f9eec006d35537ce6deb43` / `0c9ada3aa6305bbd2e70b71d487beaf00c02d3b3` |
| final base / tree | `2a3b3dba6bc257e19378bd18f56017fd66bfe6e6` / `00c003917abff84efc8bf6000e66b05b63bb790d` |
| final head / tree | `a2d0c10a38083958361ff8218a015adcc21e7764` / `e3a6afdf22b5e4137769e0a17c6ad59b3de4c49a` |
| review merge base | exact review base `a056b5aa...` |
| final-head parents | review head `bda0df47...`, final base `2a3b3dba...` |
| review-head root / ancestry count | `fee92083a75c15f5b6cd2d0c2f3bb043ae155e68` / 7,749 commits |
| repository-family identity | `ecbb11132c5f78baa9f763a604e2631220a6512bb6320590200cc5aa6b8df3e3` |
| canonical review diff | 2,219 bytes; `b0141b612d654f0b32b9a7eac61d54febf319feb0114e6775fab187e659f01ce`; 3 files, 18 insertions, 3 deletions |
| canonical final diff | 2,219 bytes; same SHA-256 as the review diff |
| comment-head to final delta | 516 bytes; `1e995caac443af908c84a874094710862da6f0dc193424344c79ae4699f90998` |
| license | MIT `LICENSE`; blob `1a7101a7f57e21531f6c0cba50a0ab725782f511`; content SHA-256 `367eeae92316a2485489ffbb05f9c3bc90b439c0e0b026d81d23a6453bdc4aa8` |

The canonical command retained the R2 reconstruction contract: `git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --`. The three reviewed files are `lib/sequelize.js`, `lib/transaction.js`, and `test/integration/cls.test.js`. Both reviewed trees have zero symlink/gitlink entries and no `.git` or `.gitmodules` paths.

The family identity was recomputed under the repository-pinned Node 22 using the unchanged `git-root-family-v1` JSON contract in `eval/case-isolation.ts`: SHA-256 over `{"version":"git-root-family-v1","objectFormat":"sha1","rootCommitOids":["fee92083a75c15f5b6cd2d0c2f3bb043ae155e68"]}`.

## Separate capture and offline proof

Because the source is non-shallow, `git bundle create <bundle> --all` is safe here; unlike the earlier snapshot archives, no shallow boundary is hidden or discarded. `git bundle verify` reports five refs, SHA-1 object format, and “The bundle records a complete history.” It preserves the three evidence refs plus current `main`/`HEAD`.

A fresh bare clone from the bundle, with no public remote involved, passed `git fsck --full --no-dangling`, reported `--is-shallow-repository=false`, had no alternates or promisor markers, recovered root `fee92083...`, reproduced merge base `a056b5aa...`, and reproduced canonical review-diff SHA-256 `b0141b61...`. The fresh clone maps only `main` as a local ref, but the bundle advertises and retains all three evidence refs and their objects; the exact review objects were directly resolvable in the clone.

## Materializer assessment and limitations

This capture clears the complete-ancestry gate in `eval/case-isolation.ts`: non-shallow SHA-1 history, authentic root commit, no replacements/grafts, exact merge base, and exact base/head trees are all available. The `.bundle` path is a local, uncredentialed Git clone source and the offline clone demonstrates its self-contained object closure. No guard was changed or relaxed.

This is not yet a claim that a complete R2 historical case passes every materialization or leakage-policy check. No case specification was selected, no provider-visible run was performed, and no historical source or dependency was executed. The source still requires a case-specific structural smoke/materialization pass after an authorized case is authored. The archive also includes later source history as curator-only material; the existing materializer must continue to export only sanitized base/head trees before any reviewer sees the case.

The old manifest remains byte-identical at SHA-256 `baab0f0d002e640ad7769da4665713c086519278db7aee332794a8faf46f47c9`, and all four earlier tar hashes were rechecked unchanged.

## Independent source verification

A separate agent independently confirmed bundle bytes/hash, five advertised
refs, complete ancestry, strict fsck, all four revisions/trees, root-family
identity, three canonical diffs, license, and storage arithmetic using offline
reads of the bundle-derived clone. No correction was required. The reported
ten-second acquisition total is the acquiring agent's observation; static
artifacts cannot independently prove that timing. This is independent agent
source verification, not two human curator confirmations or case admission.
