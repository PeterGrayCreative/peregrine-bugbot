# Finding Contract

## Contents

1. Candidate evidence bar
2. Severity and disposition
3. Consolidation gate
4. Finding format
5. Rejected-candidate format
6. Final report template

## 1. Candidate evidence bar

Require all fields before accepting a finding:

- **Invariant:** the guarantee that fails.
- **Counterexample:** concrete input, identity, state, timing, or runtime mode.
- **Reachability:** code, contract, fixture, seed, or documented flow that creates the preconditions.
- **Failure path:** exact control flow or query that produces the bad outcome.
- **Impact:** user-visible, security, data, availability, support, or verification consequence.
- **Current-head evidence:** confirm the issue still exists at the reviewed SHA.
- **Scope relevance:** blocker for the ticket, valid follow-up, or broader pre-existing defect.
- **Verification:** focused test result or static proof with reason runtime execution was unnecessary or unavailable.
- **Fix boundary:** smallest safe repair and what must not expand.
- **Regression test:** behavior-focused test name and observable assertions when a test is warranted.

Confidence values:

- **Confirmed:** direct static contradiction or reproduced failure.
- **High:** complete reachable trace with one low-risk inference.
- **Medium:** plausible and material, but one precondition or contract source remains uncertain.

Do not publish low-confidence speculation as a finding. Put it under questions or rejected candidates.

For automated runners using the strict Peregrine JSON contract, map the prose
contract without changing its meaning:

- invariant: a stable lowercase hyphen-delimited root-cause slug, such as
  `canonical-account-before-membership`; keep it stable across title rewrites;
- severity: `high`, `medium`, or `low`;
- disposition: `fix-in-pr` or `follow-up` (rejected candidates are not emitted);
- confidence: Confirmed `0.95–1.0`, High `0.80–0.94`, Medium `0.60–0.79`.

Posting is limited to `fix-in-pr` findings above the configured confidence
threshold. A technically valid `follow-up` remains in the review artifact but
must not become an inline PR demand.

## 2. Severity and disposition

Use exactly one headline label (a project profile may rename these to match repository conventions):

- `[blocking]`: security, tenant escape, data loss/corruption, contract-breaking correctness, build/test failure, or a required ticket behavior that is broken.
- `[discuss]`: real architecture, migration, compatibility, or scope decision requiring human judgment.
- `[advisory]`: optional maintainability, test depth, naming, documentation, or unproven performance hardening.

Assign a separate disposition:

- **Fix in PR:** required to satisfy the contract safely.
- **Follow-up:** technically valid but outside the PR's blocking boundary.
- **Reject:** duplicate, superseded, speculative, unreachable, or subjective without concrete risk.

Severity describes impact. Disposition describes where the work belongs. Do not conflate them.

## 3. Consolidation gate

Before drafting comments, group candidates by invariant and answer:

1. Do two candidates fail for the same helper, missing policy, state transition, or runtime-mode decision?
2. Can one shared fix repair every affected operation?
3. Does a later design delete the condition that made an earlier candidate relevant?
4. Is this a symptom of a broader pre-existing defect outside the changed surface?
5. Does the proposed repair introduce new persistence, migration, background work, or runtime modes?
6. Is the finding technically real but not necessary for this ticket?

Consolidation rules:

- Emit one finding per root cause.
- Include an affected-surface matrix instead of repeating the comment.
- Mark replaced intermediate fixes as superseded and remove them from actionable output.
- Keep one primary repair boundary; list follow-up hardening separately.
- Never count an author reply or thread re-review as a new finding.

## 4. Finding format

```markdown
### [blocking] Canonicalize account identity before authorization

- **Disposition:** Fix in PR
- **Confidence:** Confirmed
- **Invariant:** Every documented account identifier resolves to one canonical account before membership checks and persistence access.
- **Counterexample:** A member calls the documented external account number while `Membership.accountId` stores the canonical UUID.
- **Reachability:** The public path schema accepts the external account number and the account row stores a different UUID.
- **Failure path:** The route passes the raw path value to `assertMembership`, which compares it with canonical IDs and rejects the member.
- **Impact:** Valid documented requests return `FORBIDDEN`; a collision variant may scope legacy rows to the wrong account.
- **Evidence:** `path/to/router.ts:line` at `<head-sha>`; shared resolver in `path/to/canonical-example.ts` shows the intended boundary.
- **Affected surfaces:** list, detail, create, update, delete, binary image route.
- **Fix boundary:** Resolve once, authorize the canonical ID, and query only explicit canonical/legacy persistence scopes. Do not add another router-local variant.
- **Regression test:** `members_can_use_the_documented_external_account_number_without_cross_account_access`
- **Assertions:** success for the owning member; denial for a colliding account; unchanged foreign state.
```

For an affected-surface matrix:

| Operation | Canonical ID | External ID | Blank | Ambiguous | Nonmember | Peer user |
|---|---|---|---|---|---|---|
| List | pass | fail | reject | reject | reject | n/a |
| Detail | pass | fail | reject | reject | reject | reject |
| Mutation | pass | fail | reject | reject | reject + unchanged state | reject + unchanged state |

Include only columns relevant to the invariant.

## 5. Rejected-candidate format

```markdown
- **Candidate:** Add an index for a lookup used by the new router.
- **Disposition:** Reject from PR comments; retain as follow-up research.
- **Reason:** The query is real, but no expected table growth, query plan, benchmark, or latency impact establishes a material PR risk.
```

Always retain rejected candidates in the private review ledger so duplicate ideas are not rediscovered in later rounds.

## 6. Final report template

```markdown
# Invariant-First PR Review

## Verdict
BLOCK | DISCUSS | PASS

## Scope contract
- Ticket:
- Base / head / merge base:
- Promised behavior:
- Explicit exclusions:

## Invariant coverage
| Lane | Trigger | Surfaces checked | Result | Confidence |
|---|---|---|---|---|

## Confirmed findings
[Use the finding format.]

## Follow-up hardening
[Real but non-blocking issues.]

## Rejected candidates
[Duplicates, superseded fixes, speculation, and subjective noise.]

## Scope-growth warning
[Infrastructure or behavior added beyond the ticket.]

## Coverage confirmation
- Files and contracts evaluated:
- Commands and results:
- Skipped checks and rationale:
- Confidence by area:
- Working-tree cleanup:
```
