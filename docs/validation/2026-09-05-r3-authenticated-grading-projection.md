# Authenticated historical execution-to-grading projection

Date: 2026-09-05. Evidence class: deterministic structural integration only.

The new reader consumes the caller-held execution-evidence digest and projects
every registered attempt in schedule order. It authenticates the composite,
input plan, case registration, curator-bound truth, lifecycle receipt, review
terminal, exact raw review, and normalized output. It never accepts an
operator-selected successful subset.

Current runner scope is always unverified. Therefore a model-completed response
becomes an incomplete grading projection with `runner-scope-unverified`; an
explicit model inability becomes `model-unable-to-complete`. Both preserve the
original response and receive no known-root credit. Preflight failure,
interruption, and failed execution remain distinct reasons for scheduled failed
attempts. Missing/stopped schedules require a future authenticated closure
record; missing files cannot silently manufacture a grade.

## Review corrections

- Status reasons and model status are validated in both directions.
- The richer projection is explicitly version 2, not an implicit rewrite of
  the previous prototype shape. Production and legacy experiment readers are
  unchanged; no earlier experiment or truth record is rewritten.
- Historical admission hashes the same captured ground-truth bytes it parses.
  The authenticated case helper compares two complete reads. This is not a
  transactional filesystem snapshot: the trusted corpus store must remain
  stable while registration/grading occurs.
- Exact raw review output and its digest remain separate from normalized output.

Independent bounded review approved the final six-file implementation/test
diff. Under Node v22.22.1, typecheck and all 40 historical-contract tests passed.
A fresh final methodology run passed 88/88 with zero failures, skips, or
cancellations (43.31 seconds). Its eight-attempt synthetic projection exercise
retains both the provider-failed and model-unable scenarios alongside
model-completed/unverified, preflight-failed, and interrupted outcomes. The
existing `validate` command now includes this projection test through
`test:methodology`. `git diff --check` passed. These are focused local checks;
full CI on the pushed head remains a separate observation.

## Remaining boundaries

This reader does not establish working model tools, credential isolation,
provider contact, historical human admission, a protected validation partition,
or Peregrine efficacy. Durable neutral judge/adjudication/report consumers,
stopped/missing schedule closure, and a safe authenticated runtime still need
integration. No provider run or production behavior change is included.

## Independent source-bundle integrity replay

The integrator independently verified all 160 files bound by the second defect
preparation batch: 71 for `r2-post-merge-alpha-003`, 89 for
`r2-post-merge-alpha-005`. Each manifest matched the previously published file
digest; every declared artifact matched its byte length and SHA-256. Duplicate,
traversing, symlinked, or non-regular artifact paths were rejected. Only counts
and digests were emitted; causal proof contents were not shown to the
instruction author. This verifies local file integrity, not truth, human
approval, or remote durability of those local source bundles.
