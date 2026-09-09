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
- Commit: `24e725b`
- Guide: `review-workspaces/r2-recovered-human-review-v2/REVIEW.md`
- Response directory: `review-workspaces/r2-recovered-human-review-v2/response`
- Packet SHA-256: `2b73535d50524c256bf26223b9f577d94cb1110e47745b6ebc0a06893ed89574`
- Initialization SHA-256: `78af0ee87b9110ccf2ac6ba9dfeb48d1ddee4efd099a53412cd033191955af37`
- Reviewer identity SHA-256: `ae599bb9dccbf7e231c7e4d8e13fdae15a769c503b3ac2f7cef820bcac18d43e`

The guide links each immutable dossier card to its distinct blank response
file. The response directory contains exactly 36 dossier decisions and one
packet decision. The packet is not nested in or mutated by the workspace.

## Verification

Under the repository-pinned Node 22 runtime:

```text
npm run typecheck
node --import tsx --test tests/evidence-human-review-packet.test.ts
```

Typecheck and all 12 packet/governance tests passed. The new test proves copied
templates are byte-identical, the source packet is unchanged, links target the
authenticated card path, an existing or overlapping destination rejects, and
the blank response cannot pass completed-response verification.

## Human gate

Only the user may complete the decision files. Every proposal must be marked
`approve`, `reject`, or `unresolved` with evidence and the bound reviewer
identity. The packet acknowledgment comes last. The draft PR must not be merged
until the complete response verifies. One-person review remains explicitly
non-independent and does not create a sealed holdout.
