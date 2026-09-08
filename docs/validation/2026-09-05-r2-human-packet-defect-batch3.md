# R2 human-packet defect preparation batch 3

Date: 2026-09-05

Preparation identity: `codex-task:/root/r1_curator_alpha`

Status: curator-prepared drafts only; no case admission, human decision, partition assignment, provider run, or independent-human confirmation

This bounded batch prepared the four named defect-queue work items from the frozen 100-candidate inventory. Case-level causal answers, repair details, and truth proposals remain in the designated curator evidence store rather than this tracked summary. Storage access control is unresolved, so this work creates no protected-selection claim. The candidates remain development-only pending the sole human's later consolidated review.

## Aggregate result

- Attempted work items: 4
- Dossiers ready for the sole human's later `approve` / `reject` / `unresolved` decision: 4
- Case losses, deferrals, or reconstruction rejections: 0
- Authenticated public GET receipts: 85; unresolved failed captures: 0
- Resolved capture failures preserved in case logs: 4 incorrect license-path requests; corrected historical license responses captured successfully
- Combined raw-response and Git-object acquisition: 4,755,229 bytes of the 262,144,000-byte cap
- Initial investigation cap: all four work items completed in less than 15 minutes each, within the 30-minute cap
- Exact reviewed bases, heads, merge commits, trees, relevant merged blobs, canonical review/repair diff bytes, and introducing-to-repair ancestry were checked offline with `GIT_NO_LAZY_FETCH=1` and `protocol.allow=never` after bounded acquisition
- Historical repository code and dependencies executed: none
- The shared source object store is shallow/promisor and is not a complete replay bundle or historical-materializer input

## Artifact bindings

The authoritative aggregate record is local-only at `/private/tmp/peregrine-r2-human-review-preparation/defects-alpha-batch3/batch-manifest.json`.

| Artifact | SHA-256 |
| --- | --- |
| Aggregate manifest | `3a0fa20ae4f098b298d7c9f3c17101d4fcfc17548aa18ddf47a0eb5d366645d6` |
| Work-item bundle `r2-post-merge-alpha-007` | `6a2a4832b5f21366879ac117e235ad15d152b6dba48e308f45869bee5b658b68` |
| Its bundle-manifest file | `f0796c4ccabf73b26316f4496e3feae2369a8c1a5e4add915b4b4562d82bbab7` |
| Work-item bundle `r2-post-merge-alpha-009` | `42445acb1a07d358d64c134a2fab6c20ab3e7f6683469b6455b4fd658be9f821` |
| Its bundle-manifest file | `cd6b58a03f997f3e3351f4312825e66e0168a94ef82ed3b0979781457b53fc19` |
| Work-item bundle `r2-post-merge-alpha-011` | `5ebb38d0354ec997b7de028e1daafb656bd48902726235525c8beda39b2e85e1` |
| Its bundle-manifest file | `167cbfee95d663b3d3b9562b603534bf553181f186c0c9141edb66b6c7dcdb6a` |
| Work-item bundle `r2-post-merge-alpha-012` | `1942ebb90b6d496a3ff48888f3002bbc4c5deaef36419ac821aff0b0e4ee14db` |
| Its bundle-manifest file | `2b1ab14ef77026d047cdabf68abd9fe802c45eb7786fc3791e928dd2b3326953` |

The bundle hashes bind raw response objects and receipts, exact canonical diffs, static proof, contrary evidence, provenance/license bytes, replay limitations, and blank human-decision controls. They do not encode a human approval.
