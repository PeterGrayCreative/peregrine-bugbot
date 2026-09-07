# Linked defect recovery checkpoint

Date: 2026-09-07. Preparation identity: `codex-task:/root/recover_linked_defect_family`.

Recovered source slots `r2-post-merge-alpha-014` and `r2-post-merge-alpha-015` as one work item, opaque ID `r2-linked-family-001`. One draft defect-bearing proposal and one blank human decision card are ready for future consolidated review. The family preserves separately supported conditions without two-case credit. No admission, human confirmation, partition, provider run, historical code execution, or historical dependency execution occurred.

Evidence stays outside the implementation checkout:

`/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/linked-defect-recovery-v1`

| Metadata | Result |
| --- | --- |
| Source slots / work items / proposals | 2 / 1 / 1 |
| Losses or deferrals | 0 |
| Independently credited extra cases | 0 |
| Hash-bound files | 75 |
| Combined stored bytes, including source archive and working object store | 23,375,523 |
| Acquisition cap | 262,144,000 bytes |
| Bundle manifest SHA-256 | `aec6b391a23df78a78d6c0b3f211bf475efcbebcd1c09b00290fccadd5966b8e` |
| Historical proof level | complete-static-trace; not executed reproduction |
| Exact review/repair endpoints, trees and canonical full diffs | Recovered and offline verified |
| Review-record binding | Exact final introducing head has a source review record |
| Introducing-to-repair ancestry and Git object integrity | Offline verified |
| Human response | Blank; bound to current manifest hash |

This is new recovery content. Identity with either deleted original bundle hash is not claimed. Two resolved acquisition failures are preserved in the evidence store. The current checkpoint completed within the per-slot 30-minute initial bound, with no substitution or further collection.

The exact-object archive is shallow: it supports offline endpoint inspection and canonical-diff reconstruction, but is not a complete-history replay bundle or historical-materializer input. The readable local root does not establish protected selection or a sealed holdout. Draft readiness does not resolve the overall corpus count or human admission gates.

Metadata-only verification from the implementation checkout (reads file bytes for hashing, emits no causal text):

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22
node /Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/linked-defect-recovery-v1/verify-metadata-only.mjs
```

The recipe checks all 75 manifest members and verifies the blank response's manifest binding. The human-facing entry point for later packet assembly is `review-card.md`; instruction authors should use the metadata-only verifier and this report rather than reading causal evidence. No files were staged, committed, or pushed.
