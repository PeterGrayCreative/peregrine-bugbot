# R2 supplementary recovery batch 1

Date: 2026-09-07

Status: new recovery version of two previously prepared draft slots. No admission, human confirmation, partition assignment, model/provider run, or historical repository/dependency execution.

The former temporary dossier store is absent. Its historical aggregate report and hashes remain unchanged. This recovery does not claim to reproduce those original bytes or hashes. Case-level material remains in the designated persistent evidence directory; this summary contains only opaque identifiers, counts, integrity bindings, and readiness. Storage access control remains unresolved, so no protected-selection claim is made.

Persistent root: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/supplementary-recovery-v1`

| Measure | Result |
| --- | ---: |
| Existing slots attempted | 2 |
| Newly reconstructed dossiers ready for human review, still draft | 1 |
| Drafts retaining unresolved recovery gaps | 1 |
| Original dossier bundles restored byte-for-byte | 0 |
| Original bundle hashes matched | 0 |
| Scientific rejections | 0 |
| Public GET receipts | 28 |
| Frozen archived receipts reused with verified bytes | 4 |
| Failed HTTP captures retained | 1 |
| Other resolved preparation failures retained | 2 |
| Raw response plus acquired Git pack bytes | 2,501,970 |
| Combined acquisition cap | 262,144,000 |

Both slots now have exact historical revision/tree metadata, full-index review and repair diffs, license/context bytes, explicit proof limitations, and blank human-review cards. Canonical diff bytes were recomputed with network access disabled, relevant historical blob correspondence checked, and raw context checked against Git blob identities. Source receipts, raw bytes, Git packs, and losses are bound by the source manifest. One slot does not meet the full reviewed-object/consequence proof gate and remains an unresolved recovery gap. This does not overturn the original scientific assessment or create a rejection.

| Artifact | Readiness | SHA-256 |
| --- | --- | --- |
| `batch-manifest.json` | aggregate recovery record | `db04c9834bae910a2bddfe814f6c411b9313e07e00975c5cbc77376e1e1e0235` |
| `dossiers/r2-post-merge-alpha-002/bundle-manifest.json` | unresolved recovery gap; draft | `e350bff114d66bb871428b1aae1d93c7d412e100bc5effe5fe3891dae0411c56` |
| `dossiers/r2-post-merge-alpha-004/bundle-manifest.json` | prepared draft for future consolidated packet | `0a013273b2e2e349d015b97eaafc309423bfb6f1cf2c000efb0768bf3a438b38` |

The object store is partial, not a complete replay bundle or materializer input. No human card has been completed. The consolidated human-review packet is not declared ready by this recovery batch.

Main independently verified the batch and source-manifest hashes, both dossier
manifests, all 53 dossier-file bindings, 33 source-object/pack bindings, and
28 source-receipt bindings without reading causal proof content. This verifies
byte integrity, not the historical or causal claims. Supplementary evidence
remains outside the implementation checkout and has no remote backup claim.
