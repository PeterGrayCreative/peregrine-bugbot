# R2 human packet preparation: comparison batch 1

Date: 2026-09-05

Scope: first two frozen random slots only. This is visible preparation for one
later human review, not admission, partition selection, a truth answer, two
independent confirmations, provider evidence, or proof of protected-folder
access control.

## Aggregate result

Both fixed sampled slots produced bounded, narrow human-review cards. Neither card
asserts that its PR or repository is globally clean.

| Slot | Exact review range | Canonical diff | Prepared decision scope | Readiness |
| --- | --- | --- | --- | --- |
| `r2-random-001` — `microsoft/vscode#76187` | `f1742df0a341e183339cfac63c7b72384f820402..d6c5e387dd1e1532e98e89c58c523f2741dc6628` | 8 files; 16 additions, 16 deletions; 7,067 bytes; `7e75dc2b4c5b211621c3df199fd1436af122fddf4f281d1ef562077e065ece56` | Decide whether spelling-only local, comment, and parameter-label edits preserve search flow and callable type shapes | Ready for human approve/reject/unresolved, with weak review-specific protection evidence |
| `r2-random-002` — `vercel/next.js#7669` | `ba373d8707ad932c87c8a13e0362dad00af6a21a..725fe76fe672962bd164b4861ab50cb0c91828b9` | 10 files; 83 additions, 87 deletions; 18,140 bytes; `c120f15be79e50d64c80d8e4531d89da5fba360945d7737236c813fd6bb23166` | Decide whether AMP state predicates prevent alternate generation while already rendering the hybrid AMP alternate | Ready for human approve/reject/unresolved, with edited-body and adjacent final-review caveats |

The exact base/head trees are:

- `r2-random-001`: `150e602462b63fb6282867db3d341f38b859692a` /
  `3f48c9dfebe36baee63860764747ba34455c954a`.
- `r2-random-002`: `46fccc4e33227883c2cf706230e42363f163cc28` /
  `9c4600c6a2094fb009e384ea358e240e7cbeffc0`.

## Evidence and provenance

The slots remain bound to `random-sample-v1.json` SHA-256
`6651ccb6762edfdb03d07a7cc3620b51f3a38c8152bb15953558dcb50ba3ad91`,
`random-context-v1.json` SHA-256
`6e62df1c8a8570d1e7865fa809ccf3a87fdda42d62c071de2e5ea5c9de791221`,
and `candidate-inventory-v1.json` SHA-256
`e032eba8e1059f1d5b820e7907475c861cd817493974dc1b24d462bd95ca3b71`.

Public GET evidence and request receipts are under
`/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch1/`.
All 30 receipts and 30 response objects revalidated against their byte counts,
request-derived names, and response SHA-256 values. Each raw-tree digest hashes
the byte stream of sorted `relative-path<TAB>file-SHA-256<LF>` records. The
authenticated raw-tree digests are:

- `r2-random-001`: `4399a0ea52896d7786ba4e24414a5f0d9d4d57d9ad88601f992a20a535a52781`;
- `r2-random-002`: `09892abfcecda00db664067b5d405bddc496af76e4a99a37b27189520de751d8`.

Repository metadata identifies both sources as MIT. At the reviewed VS Code
head, `LICENSE.txt` is blob `69be21bd8ed0832530bac207b84d0b0200dc22f2`,
1,110 bytes, content SHA-256
`f177ff41be08b33d2360c93ef97d3e6cbe493c11320e1cd9bbdc00ab4c723a67`.
At the reviewed Next.js head, `license.md` is blob
`4a8b342e16a876b9fe73ae8643737dadeed05ce5`, 1,085 bytes, content SHA-256
`13c047a81df5cb736664d7b1da3d28b69951ccd8372eb0e1da84e89150240989`.

Canonical diffs were generated with Git `2.50.1 (Apple Git-155)`, `LC_ALL=C`,
`LANG=C`, `TZ=UTC`, and:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

After needed blobs were acquired, both diff hashes reproduced with lazy fetching
disabled and `protocol.allow=never`.

## Bounded acquisition and losses

- Approximate active initial time was 10 minutes for `r2-random-001` and 15
  minutes for `r2-random-002`, below the 30-minute per-case cap.
- Retained source repositories were 42,908 KiB and 804 KiB respectively, below
  the 250 MiB per-case source cap. Including raw evidence, diffs, manifests, and
  cards, the complete case directories were 43,076 KiB and 1,252 KiB.
- The first API attempt was blocked by the local sandbox before returning bytes;
  the authorized public retry succeeded. No failed response is represented as
  evidence.
- Both source repositories are intentionally shallow partial captures. Exact
  range commits, trees, changed blobs, and canonical diffs are locally
  authenticated, but neither source is represented as current historical-runner
  compatible.
- There was no slot substitution. There is no discarded-slot loss in this
  batch; both cards retain their uncertainties for the sole later human reviewer.
- No historical source, build, test, dependency, provider, admission, partition,
  commit, push, or actual protected-folder/access-control mechanism was run or
  established.

## Human packet locations

- `/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch1/r2-random-001/human-review-card.md`
- `/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch1/r2-random-002/human-review-card.md`
