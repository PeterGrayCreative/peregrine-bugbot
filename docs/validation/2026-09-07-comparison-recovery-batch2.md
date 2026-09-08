# Comparison recovery checkpoint, batch 2

Date: 2026-09-07. Metadata only; no causal proof or protected scope appears here.

The three assigned frozen slots have newly recovered source opportunities. Two
have static review-only draft packets; one remains an unresolved draft with a
qualification gap. No slot is admitted, partitioned, or human-approved. Recovery
stops at this checkpoint; no further batch or source expansion was started.

| Opaque slot | Availability | New bundle manifest SHA-256 |
| --- | --- | --- |
| `r2-random-008` | Source recovered; draft unresolved | `6b04248b0fa86a9b46630e919f1c5852b1b50c42a1ccee8f8b9e0c4f97a2fe20` |
| `r2-random-012` | Source recovered; static review-only draft | `e02ec33a71d9132ca3943a83ae431f9c4fb384bccb4db358f2b86aa717d5930d` |
| `r2-random-014` | Source recovered; static review-only draft | `e9ecb3c3633a9d210bf3f8bccded16f6fffccddb9b0f33df50115c41522466fb` |

The offline metadata verifier passed: 208 hash-bound files, three canonical
diffs regenerated with network protocols denied and lazy fetching disabled,
and three blank human cards. All three diff hashes match the prior recorded
diff bindings. This does **not** establish original dossier, proof, card, or
packet byte identity: those lost temporary artifacts were not recovered.

The bundles retain exact revisions and trees, full canonical opportunity diffs,
shallow Git source captures, archived response receipts, historical licenses,
source snapshots, qualified static proofs, adjacent unknowns, and blank human
decisions. Historical builds, dependencies, tests, or application code were not
executed. No providers, production changes, staging, commits, or pushes occurred.

The three bundles bind 23,415,409 bytes, below the combined 250 MiB acquisition
cap. Acquisition and preparation stayed within the 30-minute per-slot budget.
Initial restricted-network failures and one resolved lookup failure remain in
the audit trail; final recovery-status records supersede them.

All artifacts below the recovery root are curator-only working material by
assignment, not an independently protected or sealed store. AI preparation is
not human confirmation. No independence, global-clean, admission, partition,
reproduction, or original-byte-identity claim is made. Remaining gates include
the unresolved draft qualification, human review, duplicate audit, governance,
and storage/access controls.

Recovery root:
`/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/comparison-recovery-v2`.

Main-safe verifier: `verify-metadata-only.mjs` in that root. It reports only
counts, opaque IDs on errors, and hashes. It hashes proof/source bytes without
printing or interpreting them. The main task must not inspect `finalize.mjs`,
dossiers, proofs, snapshots, or source payloads.

Metadata summary SHA-256:
`a107f364b9540af48934974706ee7c17e9ecd19488eabe1e309d0e165944c209`.

Verifier invocation (after inspecting repo `.nvmrc`, which pins 22):

```sh
source /Users/petergray/.nvm/nvm.sh
nvm use 22
node /Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/comparison-recovery-v2/verify-metadata-only.mjs
```
