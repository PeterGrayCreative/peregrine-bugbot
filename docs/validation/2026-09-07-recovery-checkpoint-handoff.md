# Sign-out recovery checkpoint and stop instruction

Date: 2026-09-07

The user requested a stop after the next recovery checkpoint. Finish and
publish the in-flight recovery records only, then stop. Do not start another
source-collection batch, R3 implementation, runtime probe, or provider run.
The full R2–R8 goal remains incomplete; this is not a scientific termination.

## Resume location

- Worktree: `/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r2`
- Branch: `research/ts-js-evidence-r2`
- Draft [PR #32](https://github.com/PeterGrayCreative/peregrine-bugbot/pull/32)
  targets `research/ts-js-evidence-r1`, not main.
- Binding [research plan](../plans/2026-09-04-typescript-javascript-evidence-ablation-plan.md),
  [full goal](../plans/2026-09-05-typescript-javascript-evidence-full-program-goal.md),
  [progress](../plans/2026-09-04-typescript-javascript-evidence-ablation-progress.md),
  and [R3 checklist](../plans/2026-09-05-historical-runner-integration-checklist.md).

Do not work in the stale root checkout or assume the lost `/private/tmp`
stores exist. Preserve its unrelated files and old worktree metadata. The
[interruption record](2026-09-07-interruption-recovery.md) records missing
paths; sign-out itself is not established as the cause of the missing files.

## Durable versus local-only evidence

The frozen inventory remains 100 candidates across eight repository families,
with 772 receipts and 686 objects reverified. It has zero newly admitted cases.
Twelve previously exposed development cards have a repository-backed,
restore-tested archive with 316 bound evidence files. The complete Sequelize
#8430 replay bundle is also in the repository. Both recovery records preserve
new capture identities rather than claiming the lost originals were restored.

New supplementary causal proofs, source archives and blank human cards remain
outside the implementation checkout under
`/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/`.
Only metadata reports are published to the PR. **A push of these reports is not
a remote backup of those curator files.** These persistent local directories
are not an externally protected selection store or a sealed holdout.

Nine sampled-loss records preserve their original classifications and the
surviving source receipts, but original detailed rationales, dossier bytes and
diff bytes remain unavailable. They are qualified recovery records, not fully
reconstructed historical cases. No failed slot was silently replaced.

## Recovered curator stores

All paths below are relative to the persistent `evidence-curation` root above.
Hashes identify new recovery manifests, not lost original dossier versions.

| Store | Reconciliation | Main-verified bindings | Manifest SHA-256 |
| --- | --- | ---: | --- |
| `supplementary-recovery-v1` | 2 draft slots; unresolved proof retained | 120 | `db04c9834bae910a2bddfe814f6c411b9313e07e00975c5cbc77376e1e1e0235` |
| `supplementary-recovery-v2` | 2 qualified draft slots | 160 | `190bf370936dba68209955469741971ae1b2c7bb97e614e032111d5852ffc9e0` |
| `supplementary-recovery-v3` | 2 qualified draft slots | 155 | `4df5300183867b638968853adfac769103a76357420feff31166644cdaf2335c` |
| `supplementary-recovery-v4` | 4 draft slots; two proof qualifications | 262 | `ca420003859f54d375de723df0db565205b36e77cce4671635a2442d43ab458e` |
| `linked-defect-recovery-v1` | 2 slots, one draft case/card | 75 | `aec6b391a23df78a78d6c0b3f211bf475efcbebcd1c09b00290fccadd5966b8e` |
| `comparison-recovery-v1` | 4 scoped-comparison drafts | 251 | `c523f499ea93b28872d8e210516f912087198fb8dcea1fce22a1f633afbd56f4` |
| `comparison-recovery-v2` | 3 drafts; one unresolved qualification | 208 | `a107f364b9540af48934974706ee7c17e9ecd19488eabe1e309d0e165944c209` (metadata summary binding three manifests) |
| `sampled-loss-recovery-v1` | 9 qualified loss records, not proposals | 84 | `26c5c3513f510d87bc121a3b6bbf7bfe62714674f8c31a5be0ae0a1bc277d9fd` |

This reconciles 19 prior supplementary draft slots into 18 draft proposals
(11 defect hypotheses and seven comparison hypotheses). Together with the
12 exposed proposals, 30 drafts are available, including unresolved and
qualified drafts. This is not 30 admissible or independent cases. The target
is 36 admitted cases, while the proposed preparation ceiling is 48 cards for
rejection headroom; neither target has been met. Original loss recovery is
qualified, other replay archives remain missing, and packet-wide assembly
and reference closure remain unfinished.

## Integrity and exposure

The [role-separation disclosure](2026-09-07-recovery-role-separation.md)
records implementation-side source exposure for all nine sampled-loss slots.
Fresh curator reassignment does not undo that exposure. The main integration
agent checks enumerated file bytes/hashes and metadata without displaying new
causal proofs. Those checks do not independently establish scientific truth.

The user remains one accountable human curator/verifier, not two independent
human confirmations. Every recovered human decision remains blank. No partial
review request is being made; the user wants a consolidated batch.

## Verification scope

Under repository-pinned Node 22, the frozen-capture verifier passes and
`npm run test:evidence-capture` passes all eight tests. These cover capture
resumption, tampering/truncation rejection and immutable packet assembly.
Recovery file hashes are checked without source/proof text in output.

The previously pushed head `c37bdeddfd5fde3eb3086ddbb16e94ccc68dcbb1` has
passing GitHub `check` and credential-free build/smoke jobs. The recovery
checkpoint changes documentation only; it does not alter implementation,
test assertions, production defaults or provider behavior. Final push/CI
state must be checked against its own head, not inherited from that earlier
pass.

No historical code or dependencies were executed during this recovery. No
historical reviewer experiment was launched. Earlier synthetic R3 protocol
results remain structural evidence only.

## After explicit resumption

1. Recheck the PR head, worktree status and all recovery manifest bindings.
   Do not interpret a surviving hash reference as available source bytes.
2. Reconcile draft proposals, qualifications and duplicate families across
   all recovery stores. Two linked source slots now form one proposed case.
   Draft counts are not admissions or independent-case counts.
3. Continue the already bounded packet-preparation queue only after resumption.
   The consolidated packet still needs sufficient proposals, complete
   references and loss accounting. Existing heterogeneous card names/layouts
   need explicit, versioned assembly inputs; the packet assembler does not
   prove semantic completeness or reference closure.
4. Retain curator/implementation separation and the recorded exposure limits.
   Prepare the sole-human batch without requesting case-by-case approval or
   fabricating independent verification or protected partitions.
5. Resume the open R3 consumer/runtime work only within the binding plan.
   R4 still needs admitted evidence, governance, neutral grading/report
   integration, authenticated tool/scope availability, containment and frozen
   experiment conditions. Historical provider batches require separate
   authorization; this recovery does not supply it.
