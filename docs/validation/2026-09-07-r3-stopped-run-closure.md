# R3 stopped-run closure

Date: 2026-09-07. Evidence class: structural/mock only. No provider calls or historical admissions.

Recovered implementation after the temporary worktree disappeared. The new
`methodology-stopped-run-closure.json` is a separate schema-v2 record; complete-only
v1 execution evidence is not reinterpreted or overwritten.

The closure binds the frozen schedule, registration, input plan, exact terminal
prefix, optional started/nonterminal attempt and its intent/dispatch prefix,
unstarted suffix, stop declaration, timestamps, and exact artifact inventory.
The caller must retain the returned digest outside the mutable store. Late or
orphan writes invalidate verification. A fully terminal run cannot use this
closure to bypass its ordinary complete-run seal.

The caller must independently establish worker termination before sealing.
The record expressly describes that as a declaration, not proof this module
terminated a worker. A closure filename prevents runner reopening before
preparation/provider attachment, even if the closure contents are corrupted.

The stopped projection reader emits scheduled missing outcomes only after
authenticating this closure. Unstarted and started-without-terminal outcomes
remain missing with no raw output or root credit; closure accounting preserves
their distinct counts. Ordinary readers still reject absent lifecycle files.

## Verification

- Node 22.22.1: `npm run typecheck`, `npm run test:methodology`, and
  `npm run test:historical-truth` all passed in the persistent worktree.
- Focused tests cover all five two-stage intent/dispatch crash prefixes:
  0/0, 1/0, 1/1, 2/1, and 2/2. A mandatory assertion prevents silently
  skipping the two-stage branch.
- Tested altered digests, omitted/reordered receipts, incorrect suffixes,
  complete-schedule refusal, late writes, missing projections, and zero
  provider attachments after closure.
- Independent read-only review approved the final four-file implementation.
  Review caught an initial test reading receipts from the wrong JSON level;
  it was corrected to `terminal.result.intentReceipts` before final validation.
- Cross-run transplantation lacks a dedicated new test in this slice; existing
  registration-bound readers enforce those identities. No served model,
  containment, process termination, or efficacy claim follows from these tests.

Remaining R3 work includes runtime/tool and scope availability evidence,
neutral judge/adjudication/report consumers, and retry lineage. R2 human
curation and protected partitions remain open; R4 and provider authorization
remain separate gates. Production behavior is unchanged.
