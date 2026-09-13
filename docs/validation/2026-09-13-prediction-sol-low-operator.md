# Sol-low canary operator and post-attempt gate

This additive checkpoint closes the two mechanical pre-dispatch gaps reported
after the Sol-low amendment merged: no durable independent-gate artifact and no
supported operator entry point. It does not execute or repeat the canary.

The private `sol-low-operator-v1/` package preserves the coordinator-relayed
stopped-run report and canonical clean Astra-medium PASS for public `d42eae0`,
private `f539314` and amendment freeze `0614ea7b...`. The gate digest remains an
operator-supplied trust input. The record explicitly disclaims direct retrieval
and authenticated served reviewer identity; a withdrawn malformed relay is not
treated as the verdict. A fresh independent review of this successor freeze is
still required before its operator can dispatch.

The supported entry point is `npm run evidence:sol-low-canary --`, followed by
these exact ordered arguments:

```text
--freeze FILE --freeze-sha256 SHA --gate FILE --gate-sha256 SHA
--report-directory NEW_DIRECTORY --preflight
```

`--preflight` never creates the frozen canary execution directory. It validates
the source successor, predecessor gate, exact authorization/prompt/route/mounts,
all 64 unchanged slots, session-file metadata without reading credential bytes,
and local availability of the accepted immutable image using read-only Docker
inspection. It never pulls an image. A separate create-only report retains
preflight failures. Replace only the final flag with `--authorize-one-canary`
to request the one registered attempt after independent review. There are no
route, review-slot, batch, retry, delegation or alternate-ledger flags.

The fresh gate file has kind `prediction-sol-low-operator-review-v1`, verdict
`PASS`, empty `blockingFindings`, exact `freezeSha256` and `sourceSha256`, a
nonempty `reviewReference`, and provenance `operator-supplied independent review`.
Its externally supplied digest is not inferred from arbitrary candidate bytes.

The driver reuses the existing nonserializable capability, exclusive canary
directory, four readers, Sol/low command, 20-minute whole-attempt guard, 100-call /
2,000,000-byte budgets, terminal usage parser and mandatory uncancelled cleanup.
Private mechanical receipts retain exact invocation/sidecar audit results and
opt-in client process IDs without recording credential environments. Persistence
failure blocks execution, but never skips cleanup. Partial/failure evidence and
an inventory remain separate from the unmodified review ledger.

`assessPredictionSolLowCanary` is a separate low-route decision backed by the
same strict item/turn/read/search and lifecycle checks as the preserved high
decision. It validates the new operator/gate/ledger bindings without relabeling
high evidence. Its strongest result is
`infrastructure-canary-observed-no-batch-eligibility`; it cannot authorize R5.
Missing independent catalog, model-originated read/refusal, identity, leakage,
token, lifecycle or absence observations produce `not-eligible`. Unknown backend
version remains an explicit limitation; known mismatch or fabrication rejects.
Normal completion is not evidence of elapsed timeout or forced termination.

Only synthetic executor/observer fixtures are used for this checkpoint.
Node22 validation passes typecheck, 84 prediction, 13 HTTP and 101 affected tests.
Eleven new operator/low-assessment groups cover preflight failure, exact flags,
one-shot races, partial retention, mechanical persistence and prior gate attacks.
The initial noncanonical temporary-fixture failure and its source are preserved.
The actual canary, all 64 review slots, and production routing remain untouched.
Validation and exact freeze/replay receipts are retained privately; no provider,
Codex client, Docker or image operation is performed during implementation.
