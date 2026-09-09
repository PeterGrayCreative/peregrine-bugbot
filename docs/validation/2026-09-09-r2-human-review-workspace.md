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
- Commit: `bf5af2b`
- Guide: `review-workspaces/r2-recovered-human-review-v2/REVIEW.md`
- Single editable workbook: `review-workspaces/r2-recovered-human-review-v2/RESPONSE.json`
- Strict reference templates: `review-workspaces/r2-recovered-human-review-v2/response`
- Packet SHA-256: `2b73535d50524c256bf26223b9f577d94cb1110e47745b6ebc0a06893ed89574`
- Workbook SHA-256: `e73f614e89640719f8a4ac6cddc7509fed23179cbf6481d43767885a7e12a430`
- Initialization SHA-256: `0dd09bb1d8bf34846f6af1c0eee3af926e5388c861af624bd41c4d78a201cc5c`
- Reviewer identity SHA-256: `ae599bb9dccbf7e231c7e4d8e13fdae15a769c503b3ac2f7cef820bcac18d43e`

The guide links each immutable dossier card to its row in a single blank
workbook. The reference response directory contains exactly 36 dossier
decisions and one packet decision copied byte-for-byte from the packet. The
packet is not nested in or mutated by the workspace.

`compile-human-review-workbook.ts` accepts only a completed workbook with the
exact canonical dossier order, packet and reviewer digests, acknowledgments,
bounded reasons, correction rules, and canonical timestamps. It creates a new
strict response directory and immediately passes that output through the
existing response verifier. Invalid workbooks leave no partial output.

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
that a forged dossier acknowledgment rejects without output.

## Human gate

Only the user may complete `RESPONSE.json`. Every proposal must be marked
`approve`, `reject`, or `unresolved` with evidence and the bound reviewer
identity. The packet acknowledgment comes last. The draft PR must not be merged
until the complete response verifies. One-person review remains explicitly
non-independent and does not create a sealed holdout.
