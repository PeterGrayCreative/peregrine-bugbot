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

## Verification

Node `v22.22.1`:

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| focused grading + adjudication tests | 11/11 pass |
| adjudication tests alone | 2/2 pass |

## Boundary

This is a pure structural contract. Durable file writing/reading, external
caller-held seals, report consumption, human calibration, and provider-backed
results remain open. It neither proves reviewer blindness nor establishes that
an adjudication is factually correct.
