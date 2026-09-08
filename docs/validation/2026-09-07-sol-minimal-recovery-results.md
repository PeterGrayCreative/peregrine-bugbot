# Sol minimal evidence recovery results

Date: 2026-09-07

Status: private off-device backup and remote-origin restore complete.
No historical reviewer experiment, case admission, production change, or
partial human review occurred.

## Outcome

Sol verified existing replacement evidence rather than rebuilding it again.
The verified closure now has a second persistent local copy, one immutable
archive, a complete per-file inventory, and a fresh restore that passed all
available offline verifiers. No artifact is stored under `/tmp` or
`/private/tmp`.

Backup root:
`/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/sol-minimal-recovery-backup-2026-09-07-v1`

| Artifact | Result |
| --- | --- |
| Immutable archive | `archives/sha256-00714e7f8cef9cef42de66308456889719234f14ec2bd978b8126204a43d38c0.tar.gz` |
| Archive bytes / mode | 147,065,638 / read-only `0444` |
| Archive SHA-256 | `00714e7f8cef9cef42de66308456889719234f14ec2bd978b8126204a43d38c0` |
| Archive members | 4,442 |
| Unsafe absolute/traversal/duplicate/link/special members | 0 / 0 / 0 / 0 / 0 |
| File inventory | 3,725 files / 237,246,247 bytes |
| File-inventory SHA-256 | `a803c8e26e79f19c27e536d81004d9e43066aec96f19c04fa9a774fb230ee9dd` |
| Recovery inventory SHA-256 | `3b0f7098e2c3c1d94a42c92440384f4648bd0f14948b4ea8ebe88ea3c9fb5221` |
| Archive-content manifest SHA-256 | `a5c0d6522f78f6fe4ade916764994afdd78b393d92217888288797d09c325084` |
| Fresh restore | 3,725 files rehashed; exact inventory match |

The backup root uses approximately 687 MiB because it retains the source copy,
compressed archive, and independent fresh restore. This is deliberate recovery
evidence, not three independent scientific copies.

## Verification

All Node work used the repository pin, Node `v22.22.1`. The fresh restore
verified:

- frozen candidate store: 772 receipts, 686 objects, 100 slots, zero admissions;
- eight recovery stores: exact checkpoint hashes and 1,515 bound-file checks;
- exposed development archive: 316 bound evidence files;
- sampled-loss store: 84 bindings, nine retained losses, and 54 receipts;
- complete Sequelize replay: two offline `fsck` passes, six canonical diffs,
  eight tree checks, four refs, and 7,749 commits in declared ancestry.

Offline Git checks disabled network transports and lazy fetching. The source
copy and fresh restore each contain the same 3,725 inventoried files. The
archive scan found no unsafe member type or path. No symlink was present in
the ten included recovery roots. The unrelated read-MCP runtime probe was
excluded because it is implementation validation, not curator evidence.

Credential scanning found no credential-like filenames, GitHub/AWS/OpenAI/
Slack tokens, PEM private keys, structured credential values, or credentialed
Git remotes. A URL-userinfo heuristic matched historical fixture URLs using
localhost or example-style hosts; these were retained as fixtures and not
classified as account/session credentials.

One initial read-only sampled-loss assertion assumed incorrect schema value
types and failed. The assertion was corrected and passed without altering any
evidence or manifest. The failed check remains disclosed; it did not change
the archive contents.

The integration agent independently recomputed the archive, recovery-inventory
and archive-content-manifest SHA-256 values and confirmed the archive is a
147,065,638-byte read-only regular file. Semantic causal proof was not printed
or reinterpreted during that metadata check.

## Preserved limitations

Thirty proposals remain drafts and nine qualified records remain losses. Human
decisions and admissions remain zero. Existing proof, review-record,
environment, original-byte, license, ancestry, exposure and packet-reference
gaps remain recorded in `recovery-inventory-v1.json`; archive completeness does
not resolve scientific truth.

The first approved destination, the existing implementation repository, was
checked live and returned `visibility: PUBLIC`, `isPrivate: false`. No evidence
was uploaded there. The user then approved a separate private repository:
[PeterGrayCreative/peregrine-evidence-backup](https://github.com/PeterGrayCreative/peregrine-evidence-backup).
It was created private and rechecked as `PRIVATE`, `isPrivate: true` after the
backup completed.

The 147,065,638-byte archive exceeds GitHub's
[100 MiB regular Git-object limit](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#activity),
so it was split into three ordered, read-only volumes:

| Part | Bytes | SHA-256 |
| --- | ---: | --- |
| 001 | 50,331,648 | `c6f78dbf3bd28d7cce2a01dcf4c63c019eaa364b898a209907356e5e2a5a3e33` |
| 002 | 50,331,648 | `ffe55586c90d0f1b13f85446820f18fb7bfddabf11917665f90c326772a59325` |
| 003 | 46,402,342 | `7c578386e3660f5239e6e8859cc2217d921b263a48228b39bd1b8c064e400d12` |

Volume-manifest SHA-256:
`84b7fc658cc378d6e821d03b772a96595c943a23bf83ee30f0d0eceedb2369cc`.
It binds the exact part order, total bytes and whole-archive hash.

The private repository's default branch is
`evidence-backup/2026-09-07-recovery`; exact remote commit:
`c571d88d99dee7c07805c1d820cc405bdb21f46d`. It contains exactly nine
authorized blobs, zero blobs at or above 100 MiB, no unrelated files and no
pull request. Main independently verified the private visibility, exact remote
ref, nine-blob tree and zero oversized blobs.

A fresh clone from that remote used no alternates, shallow boundary, partial-
clone setting or promisor packs; `git fsck` passed. The clone reassembled the
archive to the exact 147,065,638-byte whole hash, passed all 4,442 archive-
member safety checks, reproduced the 3,725-file inventory and reran every
offline verifier listed above. This establishes off-device recoverability for
the current closure.

Private GitHub storage is still readable by repository administrators and any
granted collaborators. It is durable backup, not curator isolation, a protected
selection partition, independent human verification or a sealed holdout.

## Scope accounting

No source candidate was substituted or newly collected. No missing rationale
was invented. No repository source, historical code, dependency, test, build,
provider, judge, production route, prompt, posting API, or benchmark was run or
changed. The only evidence remote mutation was the authorized private backup
repository/branch and its single exact commit. Causal evidence remains absent
from the implementation repository and PR; only this metadata report and
status references belong there.
