# Benchmark semantics remediation

Date: 2026-09-05

## Scope

This checkpoint repairs three benchmark-evidence semantics without changing
review prompts, provider models, production routes, corpus labels, benchmark
panels, or production posting behavior:

- final unmatched-finding adjudication is append-only and bound to sealed run
  evidence plus a reviewed committed Git source;
- diagnostic-only case findings are excluded from every aggregate
  precision/FDR/false-positive surface, matching the funnel gate;
- new unexplained model misses are `unattributed`, while legacy evidence stays
  readable and is normalized to that label in derived reports.

Original semantic grades and funnel decisions remain immutable. A final
adjudication produces `experiment-adjudication.json`; any resulting decision is
written separately as `funnel-decision-adjudicated.json` and authenticates the
original decision and ledger.

## Operational proof

The previously sealed Luna-max/Terra-xhigh paired smoke contains one unresolved
control finding. Independent curator `Quartz Heron`, shown only the fixture and
finding, classified it as unsupported. The committed source is
`docs/validation/artifacts/2026-09-04-luna-max-terra-xhigh-screen/paired-smoke-adjudication-source.json`.
The CLI runs against that archive to prove the committed-source, sealed-grade,
ledger, derived-decision, and report path end to end. The route remains
operator-rejected because its wall-time regression was unacceptable; resolving
the finding does not authorize fast-screen advancement.

Operational results:

- ledger SHA-256: `fae699f5972e14d6276681923d01e19af34c75581b0157ab07506def397062f4`;
- the original version-1 inconclusive decision remains unchanged;
- the linked version-2 decision resolves required adjudications and returns the
  smoke gate's mechanical `advance` result;
- the refreshed report records control precision 0.8/FDR 0.2 with one blocking
  unsupported finding, and treatment precision 1/FDR 0;
- the operator's independent wall-time stop remains controlling, so no
  fast-screen follows.

## Verification record

- Node: repository-pinned Node 22 (`v22.22.1` locally).
- Focused typecheck and 27 adjudication/funnel/grading tests: passed.
- Initial full suite: 250/253 passed; the three expected provider-enabled
  integration tests refused the dirty implementation worktree.
- Full `npm run validate` from clean commit `d504664`: passed, including
  253/253 Node tests, corpus validation, 26 skill tests, nine package/install
  tests, four plugin-manager tests, and 8/8 zero-cost structural smoke attempts.
- Independent exact-head review: pending.
- Remote CI and merge verification: pending.
