# Section 2 Astra medium quality gate

Date: 2026-09-12  
Section: successor packet repairs  
Final disposition: **APPROVE for repair readiness**

## Scope and independence

A `gpt-6-astra` agent at medium effort implemented the judgment-heavy packet
repairs. A different `gpt-6-astra` medium-effort agent performed a read-only
quality/adherence gate against the correction goal, calibrated protocol,
methodology audit, private R2 corpus audit, source evidence, scripts, tests,
and generated packet. Neither agent admitted cases, created partitions, ran a
provider experiment, or changed production behavior.

## Rejection and correction cycle

The first gate rejected the candidate for three material defects:

1. Alpha-007, alpha-009, and alpha-011 selected final PR revisions instead of
   the exact recorded review opportunities.
2. The 16 AI-generated curator proposals lacked the generation provenance
   required by the calibrated protocol.
3. A resealed rendered proposal could populate human-decision fields while
   retaining a structured null decision and still pass validation.

The implementation was rebuilt to select the bound `review-record` identities
and diffs for those three cases, retain final revisions only as qualified
context, add honest shared AI-generation provenance with unavailable fields
represented explicitly, and require exact blank rendered decision fields.
Six new semantic tests reject the three final-revision substitutions,
fabricated confidence, a changed evidence-input digest, and a populated
rendered decision.

## Approved evidence

The final gate independently confirmed:

- byte-preserved v2 packet, workspace, and supplemental evidence trees;
- correct review-opportunity selection for all 16 proposals;
- alpha-010's 150-file relevant support closure;
- alpha-025's corrected direct-parent base, exact 27-path diff, and independently
  reproduced diff digest;
- corrected alpha-021 attribution and qualified exposed-07 recovery status;
- the RxJS alpha-025/random-007 duplicate family through shared blob evidence;
- substantive, source-linked proposals with blank human decisions;
- source-binding, reviewer-reference, admission, and mutation protections; and
- 22/22 semantic tests under Node `v22.22.1`.

The final private packet is stored on `PeterGrayCreative/peregrine-evidence-backup`
`main` at commit `56e2191`. Its packet aggregate is
`d22a47c82ce3168921df0f48d81c01210b7c4db41885963578647a2764f4d802`.
Post-commit validation reproduced 61 bound packet files, 16 proposals and
mount references, 27 alpha-025 paths, 150 alpha-010 support files, and all
three pinned historical tree identities.

## Boundary

This approval completes Section 2 only. It establishes repair readiness, not
semantic admission, calibrated human labeling, protected selection, runtime
isolation, provider authorization, or Peregrine efficacy. Those boundaries
remain work for later sections and separate authorization.
