# R2 human-packet defect preparation batch 1

Date: 2026-09-05  
Preparation identity: `codex-task:/root/r1_curator_alpha`  
Status: curator-prepared drafts only; no case admission, human decision, partition assignment, provider run, or independent-human confirmation

This bounded batch prepared the first two named defect-queue work items from the frozen 100-candidate inventory. Case-level causal answers, repair details, and truth proposals remain in the designated curator evidence store rather than this tracked summary. Storage access control is unresolved, so this work creates no protected-selection claim. The targeted candidates were already exposed by tracked screening and remain development-only unless a later access audit establishes otherwise.

## Aggregate result

- Attempted work items: 2
- Dossiers ready for the sole human's later `approve` / `reject` / `unresolved` decision: 2
- Case losses, deferrals, or reconstruction rejections: 0
- Authenticated public GET receipts: 41; failed captures: 0
- Resolved preparation failures preserved in the loss log: 4; unresolved preparation failures: 0
- Combined raw-response and Git-object acquisition: 12,061,241 bytes of the 262,144,000-byte cap
- Initial investigation cap: both work items completed within 30 minutes
- Exact reviewed merge bases, trees, relevant merged blobs, and canonical review/repair diff bytes were rechecked with `GIT_NO_LAZY_FETCH=1` and `protocol.allow=never` after bounded acquisition
- Historical repository code and dependencies executed: none
- The source object store is shallow/promisor and is not a complete replay bundle or historical-materializer input

## Artifact bindings

The authoritative aggregate record is local-only at `/private/tmp/peregrine-r2-human-review-preparation/batch-manifest-v3.json`.

| Artifact | SHA-256 |
| --- | --- |
| Aggregate manifest v3 file | `05378047784efd7288da0c0f4c5f01ed4b786e7fcec5944f56ec779ca17a96ea` |
| Work-item bundle `r2-post-merge-alpha-002` | `bde1d19381ae9dba0e746aefc11aa23bd322b7088d59c7ed953a51fea2f2822e` |
| Its bundle-manifest file | `4716a46a11f1d382b0dff9d35af64c3885a73a5f661bab37502d6125bc5779b4` |
| Work-item bundle `r2-post-merge-alpha-004` | `9259c2d01595afbf68be5b0244cd3a2fa72a4a51eca246ed7a99204b66163177` |
| Its bundle-manifest file | `f0a77e451cf0742f585c0eabbf55c8be2404d7959e349f59bd3d74e9b45b2c06` |
| Preserved preparation-failure log | `8140dc29b1bdf21a458b758ef2ede26212ae48cd937c1fbc39cdb9d8f179176b` |

The bundle hashes bind raw response objects and receipts, exact canonical diffs, static proof, provenance/license bytes, replay limitations, and blank human-decision controls. They do not encode a human approval.
