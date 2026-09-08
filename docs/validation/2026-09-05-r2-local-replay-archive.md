# R2 local replay source archive

Date: 2026-09-05

Scope: local snapshot capture of the four already exposed development source clones whose declared snapshot trees were complete without network access. This is source history for curator replay, not reviewer-visible material, admission, human confirmation, or runtime proof.

## Result

Four standalone bare Git repositories were archived under `/private/tmp/peregrine-r2-replay-sources/`. The **44.26 MiB archive files are local-only and are not stored or pushed in this repository**. Total tar bytes are 46,405,120. The tracked [artifact manifest](artifacts/2026-09-05-r2-local-replay-sources/manifest.json) binds archive bytes, source clones, declared commits and trees, shallow boundaries, repair/final history, licenses, and validation results. Its SHA-256 is `baab0f0d002e640ad7769da4665713c086519278db7aee332794a8faf46f47c9`.

| Local source archive | Bytes | SHA-256 | Preserved license |
| --- | ---: | --- | --- |
| `/private/tmp/peregrine-r2-replay-sources/webpack.git.tar` | 25,552,896 | `9017e3a9d902d03157a2272d962fafbed736480b5705252bebb1a4cb08e084c1` | MIT, `LICENSE` blob `8c11fc7289b75463fe07534fcc8224e333feb7ff` |
| `/private/tmp/peregrine-r2-replay-sources/vscode-112075.git.tar` | 17,070,592 | `0a1f3d3b3ff80f07a1e86dc0730f2fed7af1d44bf6cb5b25746e06efb95d58f4` | MIT, `LICENSE.txt` blob `0ac28ee234d232ac0691f39cebf95bf6b2a763a5` |
| `/private/tmp/peregrine-r2-replay-sources/sequelize-8430.git.tar` | 1,509,888 | `7782464d4c468fd2a0ea5edb7deb13717f371c2d2a933a8865d50e74f19cfcda` | MIT, `LICENSE` blob `1a7101a7f57e21531f6c0cba50a0ab725782f511` |
| `/private/tmp/peregrine-r2-replay-sources/rxjs-2397.git.tar` | 2,271,744 | `c34b014456fac147cf99e7e473dc2f45aaafc608b40fc3a89e81a1f5f36776a5` | Apache-2.0, `LICENSE.txt` blob `656e7d0018fe25a646834df3df9e9a7e45ca1f9e` |

The local manifest is 5,890 bytes and has the same SHA-256 as the tracked byte-identical copy. `/private/tmp/peregrine-r2-replay-sources/manifest.sha256` records that digest locally.

## Construction and verification

No source clone was modified. For each source, a new bare repository was initialized in a disposable directory, the local object database and authentic `shallow` file were copied, and only named `refs/archive/*` plus a replay HEAD were added. The bare repositories have no remotes, alternates, partial-clone configuration, grafts, replace refs, or `.promisor` pack markers. File mtimes in the disposable copies were normalized to `2000-01-01T00:00:00`, entries were byte-order sorted, and uncompressed ustar archives were created with macOS metadata copying disabled.

Representative commands were:

```sh
git init --bare <disposable>.git
rsync -a <source>/.git/objects/ <disposable>.git/objects/
cp <source>/.git/shallow <disposable>.git/shallow
git --git-dir=<disposable>.git update-ref refs/archive/<role> <exact-commit>
git --git-dir=<disposable>.git fsck --full --no-dangling
find <disposable>.git -exec touch -h -t 200001010000 {} +
find <archive-name>.git -print | LC_ALL=C sort > <archive-name>.files
COPYFILE_DISABLE=1 /usr/bin/tar -c --format ustar --no-recursion \
  -f <archive-name>.git.tar -C <work-root> -T <archive-name>.files
```

All verification that could consult Git objects ran with `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0`, and `git -c protocol.allow=never`. Each tar was extracted into a fresh directory. Offline checks established:

- `git fsck --full --no-dangling` passes for all four extractions;
- every declared review, repair, final, sibling, introducer, and squash-equivalent commit resolves to its recorded tree;
- all recursively referenced blobs across the declared snapshots are present: webpack 4,432/4,432, VS Code 4,512/4,512, Sequelize 300/300, RxJS 859/859;
- exact review merge bases are `7f583400...`, `b4ec131c...`, `a056b5aa...`, and `c81882f2...` respectively;
- webpack's reviewed head reaches the repair base and repair head; VS Code's squash commit carries a byte-identical reviewed patch and directly parents the repair; Sequelize's final merge directly includes both reviewed head and later base; RxJS's reviewed and final heads remain sibling commits, with later history descending only from the final sibling;
- eleven archive-contained canonical diff/equivalence checks reproduce their stored hashes, including both reviewed and later-fix paths;
- before archiving, all 19 canonical development review/repair diffs across the 12 recoverable opportunities regenerated locally with transport disabled and no mismatch.

## Materialization gate and losses

An independent AI verifier repeated archive hash/size checks, safe tar-member
inspection, fresh extraction, strict offline Git integrity, declared identities,
license hashes, and all eleven canonical comparisons. It corrected the initial
webpack count of 4,431: including the declared review-base tree makes the union
4,432. No blob was missing and archive/manifest bytes were unchanged. This
verification is not independent human admission. Both construction and
verification used disposable scratch copies, not the original source clones.

These are self-contained **snapshot replay captures**, but they are not yet accepted historical-runner inputs. All four preserve authentic shallow boundaries: webpack 79, VS Code 3, Sequelize 1, and RxJS 10. `eval/case-isolation.ts` requires `rev-parse --is-shallow-repository` to be false and derives `repositoryFamilyIdentitySha256` from complete root commits. No shallow marker was removed, no ancestry was fabricated, and the guard was not relaxed. A later authorized archive pass must recover complete non-shallow ancestry before these sources can enter the materializer.

The other exposed source clones remain excluded. Their `blob:none` promisor stores lack complete declared trees: Bull is missing 61/76 union blobs, Next.js 5,879/6,019, NestJS 2,109/2,125 across the three Nest opportunities, and Axios 87/115. VS Code #98988 additionally lacks the exact reviewed commit. No hydration or network fetch was attempted.

No historical source code, build, test, dependency, provider, admission, partitioning, production behavior, commit, push, or binary upload into Git occurred.
