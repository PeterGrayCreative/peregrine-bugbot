# Sol minimal evidence recovery results

Date: 2026-09-07

Status: local recovery checkpoint complete; off-device durability incomplete.
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

The archive and restore are on the same computer and disk. This protects
against accidental deletion of one working directory, but not disk loss. The
approved existing GitHub repository was checked live and returned
`visibility: PUBLIC`, `isPrivate: false`. No evidence branch, commit, push or
upload was created. A public branch would expose benchmark answers and would
not be a protected partition or sealed holdout.

The archive also exceeds GitHub's
[100 MiB regular Git-object limit](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits#activity). A future
approved private destination therefore needs bounded archive volumes or an
appropriate private large-file mechanism. Splitting files solves transport
size, not public exposure. The next safe action is to select a private GitHub
repository or make the existing repository private, then split, upload, fetch
the exact remote commit into a fresh directory, and repeat the restore checks.

## Scope accounting

No source candidate was substituted or newly collected. No missing rationale
was invented. No repository source, historical code, dependency, test, build,
provider, judge, production route, prompt, posting API, or benchmark was run or
changed. No evidence Git branch or remote mutation occurred. Only this
metadata report and status references belong in the implementation PR.
