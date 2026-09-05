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
control finding. After the implementation commit is clean, an independently
blinded reviewer will produce a committed curator source and the CLI will run
against that archive to prove the committed-source, sealed-grade, ledger,
derived-decision, and report path end to end. The route remains
operator-rejected because its wall-time regression was unacceptable; resolving
the finding does not authorize fast-screen advancement.

## Verification record

- Node: repository-pinned Node 22 (`v22.22.1` locally).
- Focused typecheck and 27 adjudication/funnel/grading tests: passed.
- Initial full suite: 250/253 passed; the three expected provider-enabled
  integration tests refused the dirty implementation worktree. The full suite
  is rerun from the clean implementation commit.
- Full `npm run validate`: pending clean-commit verification.
- Independent exact-head review: pending.
- Remote CI and merge verification: pending.
