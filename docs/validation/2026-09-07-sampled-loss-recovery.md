# Sampled-loss recovery checkpoint

Date: 2026-09-07

Nine original sampled-loss slots remain losses: `r2-random-003`, `005`, `006`,
`009`, `010`, `011`, `013`, `015`, and `016`. No substitute, proposal, admission,
human decision, or partition was created.

Qualified recovery records and blank appendix cards are available under
`/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/sampled-loss-recovery-v1/`.
The root contains `manifest.json`, `recovery-summary.json`, `access-roster.json`,
and `recover.mjs`; per-slot records are under `losses/<opaque-id>/`.
Source details remain outside the ordinary worktree.

The manifest SHA-256 is
`26c5c3513f510d87bc121a3b6bbf7bfe62714674f8c31a5be0ae0a1bc277d9fd`.
Its 84 bound files total 746,951 bytes, excluding the manifest itself. The
recovery validates 54 frozen source receipts. A separate read-only verification
checked every bound file's size/hash, all nine loss dispositions, blank human
decisions, and the exposure restriction; it passed using pinned Node 22.

Original temporary dossier bytes, original detailed loss reasons, and original
diff bytes remain unavailable. Surviving prior hashes are provenance metadata,
not claims of recovered original-byte identity. These records preserve the
prior loss classification with that limitation explicitly stated. Historical
review identities, canonical diffs, historical licenses, and causal proof were
not independently reconstructed. Source availability does not establish truth.

Exposure is recorded transparently: an implementation reviewer previously read
new source material for all nine slots, then stopped without writing artifacts.
These slots cannot be claimed as unexposed reserved validation or a sealed
holdout. This recovery was performed by a fresh curator-only agent; AI
preparation does not count as human confirmation. A readable local directory
is not an external access-controlled store.

This is the requested stopping checkpoint. It used surviving local evidence
only: zero new public GET requests, zero acquired network bytes, zero historical
execution, and zero providers. The 20-minute initial/100 MiB acquisition ceiling
was not approached. No staging, commit, push, implementation change, prompt
change, or new collection occurred.
