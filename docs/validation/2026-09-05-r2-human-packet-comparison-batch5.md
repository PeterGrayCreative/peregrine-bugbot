# R2 human packet preparation: comparison batch 5

Date: 2026-09-05

This aggregate covers only frozen slots `r2-random-013` through
`r2-random-016`. It records preparation readiness, losses, counts, paths, and
hashes; it contains no causal answer or protected-scope claim.

| Slot | Aggregate result | Manifest SHA-256 | Decision/loss record SHA-256 | Diff SHA-256 | Raw tree SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `r2-random-013` | Explicit sampled loss; no substitution | `a15041d6785b6890c055ea5dc67b0df7b4688f3e13ad3790b6785bb746019f33` | `c0c78dcd3b94f449557b8ad1e1e9f8cb2ee228af4ec249e6a29b9fe702b3127a` | `1d04a5243c08ecc2f08938d5fcf2a05936343f06fc29264c1fa0fb1e4b8783ba` | `18e3950dc599d291b857616ebcb6b43a86c016ac50263c9aaa0cbadd9f92e02f` |
| `r2-random-014` | Ready for consolidated human review | `c82c15bb394eb672866b60f4e921d4448b61558be0e43a0eabaaf8e6426b31e7` | `50220dbc635c0f19e4d83f4cfa754a8b71db08f65273a17360b2593d1b85b9f4` | `90b3da1a8af43daf66b2c4215aba4bc1e2f8fa4ed603d7598a0ef8aa47908f10` | `c9cac2a760ff3c980bb813878d00b2fd8d57bbb05910c4919d66e6d7a6a42d6d` |
| `r2-random-015` | Explicit sampled loss; no substitution | `7084eba947d1eb9cdf586d79471966261963ca95a333cf85a5a507fae1c39c21` | `81143b79eb8464bedc60ed67cf1b0221f74f077349eea7b09841bd7e765253cb` | `9b2c6934d3df6b3d01089410cbc40db949ff6b354c0c2d02d627a6cc994eb50f` | `f0c806561926e7c5a910fda55637370eb1dfd3453d36865d7d534f75656997a3` |
| `r2-random-016` | Explicit sampled loss; no substitution | `c056dd947bd0639a9b89aa6f31058b5dbd00f4e143ccf99ddb39af3ac88ec679` | `bdf126259d9cb08114dd46e0904ba31c5b7007898c9b01dab4064f759ab73b68` | `dd6c55647908b7070a4a1772ae3bc5686644852a9a2565849dc13ea6898beb9d` | `b85eb0e77dceb2e3d505f612249000ea482cbaa601d47a94a811a293a137a2e7` |

Aggregate result: one ready record and three explicit losses, with zero slot
substitutions and zero acquisition shortfalls. The four retained source
captures total 1,624 KiB, and the complete batch directory is 2,552 KiB, below
the combined 250 MiB acquisition cap. Every initial screen completed within
its 30-minute cap.

All 62 request receipts and 58 deduplicated response objects revalidated
against request-derived names, byte counts, and response hashes. All four
canonical diff hashes reproduced offline with lazy fetching disabled and
network protocols denied. Exact trees, merge bases, and object connectivity
also revalidated offline.

This batch remains visible preparation for one later consolidated human review.
It is not an admission, truth answer, reserved partition, independent
confirmation set, provider result, or proof of protected-folder access control.
No historical code, build, test, dependency, provider, commit, or push was
executed.

Scratch artifacts:
`/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch5/`.
