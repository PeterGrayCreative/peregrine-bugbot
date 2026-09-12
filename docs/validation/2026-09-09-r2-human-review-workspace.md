# R2 all-at-once human-review workspace

Date: 2026-09-09

## Outcome

Created a deterministic initializer for the sole-human R2 response workspace
and used it to publish a blank, durable review branch in the private evidence
repository. This removes the need to copy or relink 37 response templates by
hand. It does not make a human decision.

## Durable workspace

- Evidence repository: `PeterGrayCreative/peregrine-evidence-backup` (private)
- Draft PR: [#1](https://github.com/PeterGrayCreative/peregrine-evidence-backup/pull/1)
- Branch: `curation/r2-human-review-v2`
- Commit: `b2e1bce`
- Guide: `review-workspaces/r2-recovered-human-review-v2/REVIEW.md`
- Single editable workbook: `review-workspaces/r2-recovered-human-review-v2/RESPONSE.json`
- Strict reference templates: `review-workspaces/r2-recovered-human-review-v2/response`
- Packet SHA-256: `2b73535d50524c256bf26223b9f577d94cb1110e47745b6ebc0a06893ed89574`
- Workbook SHA-256: `4d1658fb3be9b1b4a65f0503016f66056ed1bfd789431e1f5da24bb15fd51b44`
- Initialization SHA-256: `8010c3901ef9919c10f6e7683f3b2a9a5c3c2063f489435193b911d9359a6b35`
- Reviewer identity SHA-256: `ae599bb9dccbf7e231c7e4d8e13fdae15a769c503b3ac2f7cef820bcac18d43e`

The guide links each immutable dossier card to its row in a single blank
workbook. The reference response directory contains exactly 36 dossier
decisions and one packet decision copied byte-for-byte from the packet. The
packet is not nested in or mutated by the workspace.

`compile-human-review-workbook.ts` accepts only a completed workbook with the
exact canonical dossier order, packet and reviewer digests, acknowledgments,
bounded reasons, correction rules, canonical timestamps, and a partition,
case class, and duplicate-family ID for every approval. It creates a new
strict response directory plus a self-authenticating partition attestation,
then immediately passes the response through the existing verifier. Duplicate
families spanning partitions and invalid workbooks leave no partial output.
The original v1 compiler API and CLI form remain available for the prior
workbook protocol; only v2 can derive the partition attestation.

## Verification

Under the repository-pinned Node 22 runtime:

```text
npm run typecheck
node --import tsx --test tests/evidence-human-review-packet.test.ts
```

Typecheck and all 13 packet/governance tests passed. The tests prove copied
templates are byte-identical, the source packet is unchanged, links target the
authenticated card path, an existing or overlapping destination rejects, and
the blank response cannot pass completed-response verification. They also prove
that a completed workbook compiles to the existing strict response contract and
partition-attestation contract, while a missing partition assignment or forged
dossier acknowledgment rejects without output.

## Human gate

Only the user may complete `RESPONSE.json`. Every proposal must be marked
`approve`, `reject`, or `unresolved` with evidence and the bound reviewer
identity. Every approved proposal also needs its development/selection,
bug/comparison, and duplicate-family assignment. The packet acknowledgment
comes last and records the sole-human partition acceptance without claiming
independent selection. The evidence branch history is now merged to private
`main`; direct storage does not satisfy the incomplete human gate. One-person
review remains explicitly non-independent and does not create a sealed holdout.

## 2026-09-12 durable update

The private evidence repository now uses `main` directly. Commit `5f32493` adds
`review-workspaces/r2-recovered-human-review-v2/ALL-PROPOSALS.md`, a
review-only one-file view of all 36 bound cards. Its SHA-256 is
`2dcd12dfa192416b0ef056ca644f830526e46e3df8df951b34d8c75fd95b21e5`.
All 138 relocated local links resolve to durable packet files. The renderer's
focused test is part of `npm run test:evidence-capture`; typecheck and all 27
evidence-capture tests passed. The workbook remains blank and no human gate was
satisfied by this presentation change.
