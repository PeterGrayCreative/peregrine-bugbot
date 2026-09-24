# Development benchmark refocus and Sol handoff

Date: 2026-09-23. Status: prospective planning amendment; implementation pending.
Scope source: the user's request to amend the plan and checklist after the
project review, with Sol to pick up implementation afterward.

## Next deliverable and precedence

Prepare one reviewable, zero-provider, two-arm benchmark package using the
completed 12-case visible historical development corpus. The question is whether
Peregrine's single-reviewer instructions improve bug findings enough to justify
their additional work compared with a competent minimal reviewer.

This document is the current implementation checklist. For this milestone it
supersedes earlier instructions to finish the 24-case reserved partition before
preparing any historical experiment, to default to four arms/96 attempts, or to
resume acquisition runners and calendar windows. Those documents and artifacts
remain historical records. This amendment changes sequencing prospectively; it
does not alter previous outcomes, labels, approvals, or selection protocols.

The September 12 correction program's failed packet path remains terminated.
This is a successor exploratory milestone using the separately admitted
`historical-oracle-v1` development corpus, not a reopening of that packet or its
prohibited R4 path. The adapter must retain the newer corpus's evidence class.

The full [R1–R8 objective](2026-09-05-typescript-javascript-evidence-full-program-goal.md)
remains incomplete. The user paused execution and has now requested planning
changes only. Do not infer a provider authorization or automatically start
implementation from this handoff. Sol's next implementation task is the package
described here when the user resumes implementation.

## Current state

| Area | Verified planning baseline |
| --- | --- |
| R1 | Historical reconstruction feasibility completed. |
| R2 development | 12 admitted visible-development cases: 8 defects, 4 scoped comparisons, 9 roots, 5 repositories, 12 duplicate families, 6 TS and 6 JS cases, 24 AI review records. |
| R2 reserved | Target remains 16 defects and 8 comparisons. Recorded yield is 0 defects and 1 comparison; that comparison's final selection-order qualification remains unresolved. No ready reserved partition. |
| R3 | Substantial harness implementation exists. The trusted local A/B runner completed a seeded diagnostic; the historical development adapter and full dry run still need implementation/verification. |
| R4/R5 | No current historical freeze or provider authorization. This milestone prepares a development-only freeze. |
| R6–R8 | Reserved selection, confirmation, prospective work, and final component decisions remain outstanding. |

The [one-case diagnostic](../validation/2026-09-17-trusted-local-ab-diagnostic-results.md)
found the same known defect in both arms, with more time and tokens for Peregrine.
It establishes a usable comparison path, not a general performance conclusion.
Development truth is partial and AI-reviewed; it is neither human verification
nor independent confirmation. The five-repository set and its concentration do
not satisfy the eventual corpus diversity targets.

## Frozen design to prepare

- Use the existing 12-case roster unchanged. Bind the private corpus digest
  `a152cb95fe9130b6da7af864bbb7847d3c4ac6b50d72d290c6a3671833d3b1a9`
  and verify actual case/source artifacts before materialization. No silent
  substitutions, exclusions, truth changes, or promotion to a protected corpus.
- Arm A: competent minimal review prompt. Arm B: Peregrine single-reviewer
  method. Both get identical raw scope, historical checkout, tools, output
  schema, model, effort, and enforced limits. B's method is the intended
  difference; select any lane inputs from raw scope under a fixed rule, never
  from oracle answers or reserved evidence. Freeze prompt and resource hashes.
- Prepare 12 cases × 2 arms × 2 repeats = **48 review attempts / 48 reviewer
  invocations**, with no discovery worker. Repeats measure within-case
  consistency; there are still only 12 cases and 12 duplicate families.
- Reuse the trusted local runner's requested `gpt-5.6-sol`, high effort,
  20-minute per-attempt deadline and 4 MiB output limit as the proposed settings.
  Verify compatibility without contacting a provider. If that model/runtime
  cannot be supported, record the blocker and revise the proposed freeze
  explicitly; never silently substitute a model. Distinguish requested model
  identity from any actually observed identity.
- Run sequentially. Counterbalance A/B order across the two repeats of each
  case; use one retained seed to shuffle case blocks before outcomes exist.
  Record the complete ordered schedule and distinct attempt IDs. The maximum
  serial reviewer time is 16 hours at these caps; grading/preparation is
  additional and must have its own declared budget and call count.
- Freeze the failure policy: no automatic retry or replacement of a started
  attempt. Preserve every failure and missing outcome. Stop the batch on a
  systemic infrastructure or evidence-integrity failure; retain the unstarted
  suffix and request a separately scoped recovery decision. Completed failures
  stay in the scheduled denominator, never become clean reviews.

This trusted-local route has a narrower assurance boundary than the separately
developed container/egress route. Its prior diagnostic does not certify an
arbitrary historical corpus. The dry run must establish that reviewer access is
limited to intended source/resources and cannot reach private truth, repairs,
review comments, prior answers, or reserved material. A read-only checkout alone
does not establish that boundary. Fix a demonstrated access defect or report it
as a blocker; do not merely rename the assurance claim.

## Implementation checklist for Sol

One coherent implementation slice should deliver preparation, schedule, dry run,
and an unfilled report template. Split only if an actual implementation boundary
requires it. Do not build another general experiment framework.

- [ ] **Reconcile inputs:** verify current public/private heads and clean state,
  activate Node 22, run the migration verifier, and revalidate the 12 development
  cases and source closure. Record exact failures rather than replaying old
  acquisition instructions. If a case is unusable, stop package acceptance and
  document it; keep the roster unchanged pending an explicit design revision.
- [ ] **Adapt existing code:** inspect `eval/trusted-local-review-runner.ts`,
  `eval/historical-oracle.ts`, the existing case materializer, and prompt/output
  modules. Add only the adapter/schedule support this 48-attempt package lacks.
  Preserve old readers and the seeded diagnostic. The existing
  `scripts/evidence/run-trusted-local-review.ts` launches a real provider; it is
  not a dry-run command and must not be invoked during preparation.
- [ ] **Separate preparation from launch:** the preparation/dry-run entry point
  must require no credentials, never read/copy auth files, and have no live
  provider dispatch. Freeze the later launch command and require an explicit
  authorization record bound to the final package before any real invocation.
- [ ] **Materialize and check all 12 cases:** retain exact historical base/head,
  diff and source identities; compare A/B inputs byte-for-byte except intended
  method guidance. Exercise the access/leakage boundary and resource allowlists.
  Do not import, compile, test, or rerun the historical candidate code here;
  validate retained evidence and source bytes. Additional oracle execution
  belongs to a separate bounded reconstruction task.
- [ ] **Exercise all 48 scheduled slots without providers:** use an injected
  fake executor with clearly labeled synthetic outputs to verify scheduling,
  unique directories, output parsing, raw stdout/stderr retention, failure and
  stop handling, grading joins, and report denominators. These outputs are
  structural tests and must never enter observed model-result tables.
- [ ] **Freeze grading and reporting:** prepare blinded finding inputs and a
  private truth join. Match known roots by causal mechanism and reachability;
  assess every additional finding as supported-new, unsupported, or unresolved.
  Specify reviewer roles, dispute handling, and any grading-model authorization
  and budget separately. Preserve partial-truth and AI-review limitations.
- [ ] **Run focused Node 22 verification:** cover the historical adapter, prompt
  isolation, schedule, trusted runner and report paths actually changed. Use
  injected execution only. Run typecheck when TypeScript changes. Broaden tests
  only for affected consumers or a demonstrated regression; use CI for the
  repository-wide gate.
- [ ] **Obtain one fresh Astra-medium-or-stronger package gate:** inspect the
  final fixed inputs, fair comparison, access boundary, failure policy, grading,
  dry-run evidence and authorization stop together. Return explicit PASS/FAIL.
  Re-review only changed or unresolved findings; preserve prior decisions.
- [ ] **Deliver the concrete authorization packet:** exact implementation and
  corpus hashes, prompt bytes/hashes, requested model/effort/runtime, schedule,
  limits, expected calls, private grading plan, dry-run result, gate, and launch
  command. Push private evidence to private `main`, public implementation through
  a PR, and write one concise handoff. Stop before provider execution.

Sol may implement bounded changes at low reasoning as requested by the user.
Judgment-heavy design and methodological decisions use Astra medium or stronger;
Luna is restricted to mechanical changes with explicit acceptance criteria.
Keep one fresh independent gate per coherent completed section, including the
whole benchmark package, rather than making each small document its own section.

## Report and decision after separately authorized execution

The report must include per-case paired findings and known-root coverage,
unsupported findings per scheduled review, scoped comparisons receiving
unsupported findings, unresolved findings, confirmed new findings, completion
and failure categories, and observed wall time, input/cached/output tokens and
other available work measures. State unavailable measurements as unavailable.
Do not invent monetary costs. Highlight every severe baseline-found,
Peregrine-missed root. Freeze exact metric definitions and failure handling in
the package; avoid an outcome-selected composite score.

Report raw paired counts and per-case differences first, accounting for repeated
runs and repository/family dependence. Any intervals must use a prespecified
method appropriate to this small exploratory set. No efficacy, safety,
non-inferiority, or unseen-repository claim follows from this development screen.

Use the result to choose one next action: simplify/remove unhelpful guidance,
investigate a specific mixed result, or prepare a narrowly motivated component
ablation and reserved validation. Freeze any subsequent prompt changes as a new
version. A positive, negative, or inconclusive development result does not
complete the R1–R8 program or authorize production changes.

## Deferred work and operating rules

Reserved collection is deferred for this milestone. Preserve its 100-candidate
frame, failed attempts, 16/8 target, and current order disputes. Before resuming
reserved work, publish one prospective finite remaining budget and reconcile
the precedence ledger/order rule with an independent methodology gate. Resolve
or honestly defer cases; publish a yield shortfall if the budget or requirements
cannot be met. Do not retrospectively validate an out-of-order admission, weaken
truth requirements, or substitute seeded cases. Use a curator separate from
prompt implementation; prior shared-task exposure is retained as a limitation.

No watcher, polling loop, new acquisition coordinator, or calendar waiting
window belongs in this benchmark milestone. Preparation begins when assigned;
future authorized attempts use preregistered elapsed caps and actual start/end
receipts. Existing expired windows remain invalid. This amendment does not
authorize new reserved source retrieval or candidate reconstruction.

Reuse working infrastructure. Add a feature only when a checklist acceptance
condition demonstrates the need. Keep case identities and answer-bearing bytes
private; public work contains implementation, protocol and aggregate progress.
Do not resume production optimization, routing, posting, R5 provider runs, or
credential-bearing canaries under this planning amendment.

## Sol's first task

Read this document and private `CURRENT-HANDOFF.md`, then implement the smallest
credential-free development-corpus adapter and 48-slot dry run against the
existing trusted local A/B runner. Deliver the complete gated authorization
packet above. Do not resume the old reserved source window or run a live model.
