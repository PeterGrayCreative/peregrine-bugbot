# R3 methodology adjudication contract

Date: 2026-09-08

Status: structural implementation complete. No provider run or real finding
adjudication occurred.

## Result

The historical methodology path now has a dedicated, arm-blind adjudication
contract. It binds:

- run execution and input-plan digests;
- exactly every scheduled attempt grade, including failed and missing work;
- every and only unmatched finding occurrence by attempt, index, and evidence
  digest;
- one accountable curator identity and an explicit review protocol blind to
  arm, route, and timing;
- `confirmed-new`, `unsupported`, and retained `unresolved` outcomes.

The ledger records a canonical grade-set digest and self-digest. Missing,
extra, duplicate, stale, cross-run, or locally modified grade/decision inputs
reject. Unresolved evidence remains visible and will block later promotional
claims.

A descriptive four-arm report now revalidates the schedule, complete grade set,
and adjudication ledger. It applies case-level historical eligibility, keeps
failure-inclusive completion, separates registered-root and newly confirmed
findings, reports precision bounds with unresolved findings, and refuses a
promotional state while resource integration remains absent.

Append-only writers/readers now persist the full grade set, adjudication, and
report in a dedicated analysis store. Each reader requires its caller-held
digest and rederives the artifact from the preceding bound inputs; overwrites
and locally recomputed favorable summaries reject.

## Verification

Node `v22.22.1`:

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| focused grading + adjudication tests | 11/11 pass |
| adjudication/report tests alone | 3/3 pass |

## Boundary

This is structural evidence. The analysis store must remain separate from the
closed execution store. Joining its run ID to the authenticated invocation
registration, terminal resource ingestion, human calibration, statistical
comparisons, and provider-backed results remain open. It neither proves
reviewer blindness nor establishes that an adjudication is factually correct.
