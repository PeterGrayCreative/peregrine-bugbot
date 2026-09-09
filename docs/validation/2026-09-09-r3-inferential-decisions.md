# R3 inferential decisions and versioned lineage

Date: 2026-09-09

Status: deterministic structural implementation. No provider or reviewer-model
experiment ran, and this record makes no bug-finding efficacy claim.

## Implemented boundary

- The inference plan is written before methodology execution and binds the
  registered schedule, input plan, model topology, contrast, hypothesis,
  bootstrap policy, seed, case roster, and proposed dependence components.
- Every post-run adjudication resolution is an append-only record bound to the
  exact finding occurrence and an authenticated complete grade set. Truth
  versions are derived from grades rather than accepted from a caller.
- Unmatched findings are grouped into content-addressed root ledgers that bind
  every occurrence, classification, case, arm, repeat, grade set, effective
  adjudication head, and schedule. Later adjudication creates a new ledger;
  earlier ledgers remain readable.
- Decision surfaces retain registered-root repeat reliability, comparison-case
  unsupported roots once per root per review, comparison cases receiving noise,
  confirmed-new occurrences and unique roots, completion outcomes, resource
  limits, observed work, and explicit unknowns.
- Decision seals form one append-only version chain. Each version rederives its
  plan, sealed analysis, effective adjudication, root ledger, metrics, and exact
  implementation-source manifest. An old decision remains reproducible after a
  later resolution and decision. Legacy and versioned seal storage cannot
  coexist as unrelated histories.

## Deliberate fail-closed state

The current historical input contract does not authenticate duplicate-family
assignments or registered-root severity. The public inference builder therefore
retains descriptive point estimates and counts but emits no inferential interval
and no positive decision. Severe baseline-found/treatment-missed analysis is
also explicitly unavailable. These are R2/R3 prerequisites for R4, not values
that may be supplied informally by an experiment operator.

Malformed-output, tool-unavailable, and incomplete-scope completion categories
are not separately distinguishable in the current authenticated resource
artifact. They are reported as unavailable rather than inferred as zero.

## Verification

- Node version: `22.22.1` from `.nvmrc`.
- Focused resolution, root-ledger, inference, and decision-seal suite: 29/29
  passing.
- TypeScript no-emit typecheck: passing.
- A pre-commit repository-wide validation reached 292/295 tests. The three
  failures were the expected provider-experiment clean-worktree guard because
  the implementation was still uncommitted.
- After committing the implementation as `5d8e383`, `npm run validate` passed
  end to end from the clean worktree. This included 295 base tests, 218
  methodology tests, 13 methodology HTTP tests, historical-truth and evidence
  capture suites, corpus validation, skill/package checks, and the eight-case
  structural smoke. Remote CI is pending.
- Independent pre-integration review found four defects: repeated comparison
  noise was undercounted, the public inference builder could expose intervals
  before duplicate-family authentication, truth versions were caller-asserted,
  and legacy/versioned seal stores could coexist. All four were corrected and
  receive adversarial regression coverage. A fresh post-fix read-only review
  reported no findings; its typecheck, diff check, and focused 29-test suite
  passed under Node 22.22.1.

## Remaining R3 gates

1. Authenticate duplicate-family assignments from the admitted, frozen R2
   curation and partition artifact.
2. Bind registered-root severity for severe-regression decisions.
3. Complete the separately authorized credential-bearing model/tool canary.
4. Import real human admissions without claiming independent review where the
   curator and verifier roles overlap.

Until these gates close, R4 cannot be registered and no historical provider
run is authorized.
