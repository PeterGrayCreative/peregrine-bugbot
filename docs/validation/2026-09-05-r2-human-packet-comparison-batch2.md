# R2 human packet preparation: comparison batch 2

Date: 2026-09-05

This aggregate covers only frozen slots `r2-random-003` and
`r2-random-004`. It records preparation readiness, losses, and artifact hashes;
it contains no causal answer or protected-scope claim.

| Slot | Aggregate result | Manifest SHA-256 | Decision/loss record SHA-256 | Diff SHA-256 | Raw tree SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `r2-random-003` | Explicit sampled loss; no substitution | `9da7bf97c6633ca3efafe1314994501a0824def02b83161aef9b1db1ea5576dc` | `4882196a0838a054266ce4c6012c0a7b7a7491b9ed6738217ca2618e2b150272` | `7933762ed9ec607446e66e0649d06c5b4f923f4184013a1f10a84f52af8e5038` | `2803fc053a4c30f154d5b83929a61a3d807430561bed4ee8015ee876375822d6` |
| `r2-random-004` | Ready for consolidated human review | `0b4214d5fd1f125d68d687d94c8446e3a11364910d06ae380cffbeb2b87727e7` | `8b62d887945eb79c82e3a68f946d8282e202ec14230c40d1c53521bec4111f6b` | `3101f1796cb1f06db63dfa8ac1d0d269c6f8437e763440fdbfe2c9dd67ce4c3e` | `615bf1ac009fdf5a5eb95c51bf8fa0c223deb0daec8ed90c285dbf7641191cfa` |

The two retained source captures total 884 KiB, and the complete batch directory
is 1,768 KiB, below the shared 250 MiB acquisition cap. Both initial screens
completed within the 30-minute per-slot cap. All 29 request receipts and 27
deduplicated response objects revalidated against request-derived names, byte
counts, and object hashes. Both canonical diff hashes reproduced offline with
lazy fetching disabled and network protocols denied.

Batch 1 slots remain visible development material only. Neither batch is an
admission, a truth answer, a reserved partition, two independent confirmations,
provider evidence, or proof of protected-folder access control. No historical
source, build, test, dependency, provider, commit, or push was executed.

Scratch artifacts:
`/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch2/`.
