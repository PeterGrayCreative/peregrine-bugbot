# R2 recovered consolidated human-review packet

Date: 2026-09-08

Status: durable review-only packet assembled and verified. No human decision,
case admission, partition, provider run, or efficacy claim was made.

## Result

The complete surviving recovery checkpoint is now available as one immutable
human-review packet in the private repository
`PeterGrayCreative/peregrine-evidence-backup`:

- branch: `evidence-backup/2026-09-07-recovery`
- commit: `7ea098e`
- path: `review-packets/r2-recovered-human-review-v1/`
- packet SHA-256:
  `34a9fd6e698c5db75a72e1e1d41ce7e863ae8dde651d1e28ee18f42cf15aaeb0`
- bound contents: 30 draft proposals, 10 retained reconstruction losses,
  5,079 files, 132 MiB on disk

The packet includes exact copied cards, proofs, diffs, snapshots, receipts,
source repositories where recovered, manifests, blank per-proposal decisions,
one blank packet decision, an index, and a loss ledger. It is stored beside the
restore-tested recovery archive rather than in a temporary directory.

## Implementation

`build-recovered-human-review-request.ts` is deliberately specific to the
2026-09-07 checkpoint. It accepts no substitutions: the exact 12 exposed cards,
18 supplementary cards, exposed loss, and nine sampled losses must be present.
It walks direct files without symlinks, hashes every byte, supports the recovered
heterogeneous card/manifest layouts, and invokes the existing immutable packet
assembler. The generic assembler now supports shared batch manifests and normal
repository filenames beginning with `.` or `_`; packet verification applies the
same safe-path contract.

## Verification and limits

The packet verifier independently re-read its manifest, recomputed packet and
dossier bindings, checked all 5,079 file byte counts and SHA-256 values, and
verified exact filesystem closure. Focused evidence tests pass 13/13 and the
repository typecheck passes under Node 22.

This verifies copied bytes and packet closure, not causal truth, semantic
reference completeness, admission, independence, or scientific sufficiency.
Thirty drafts are below the 36 admitted-case target and provide no rejection
headroom. The user should receive one review request only after either additional
qualified proposals are gathered or a terminal shortfall packet is deliberately
accepted. The sealed packet must never be edited; completed decisions belong in
a separate response directory.
