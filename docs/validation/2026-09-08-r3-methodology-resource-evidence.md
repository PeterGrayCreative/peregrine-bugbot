# R3 methodology resource evidence

Status: structural verification only. No provider or historical review ran.

The authenticated grading projection now derives one resource observation for
every scheduled attempt from the same complete or stopped execution closure.
Observed lifecycle wall duration includes preparation and dispatch overhead;
runner duration and provider-reported usage remain separate. Preflight,
interrupted, failed, and missing outcomes stay visible.

`methodology-resource-set.json` is a new append-only analysis artifact bound to
the schedule, invocation registration, input plan, execution closure, terminal
digests, and exact scheduled order. `methodology-resource-report.json` reports
outcomes and per-arm observed/unknown counts, subtotals, complete totals,
median, and P95. A total is `null` if any scheduled value is unavailable; zero
is used only when the provider actually reports zero. Monetary cost remains
unavailable when the provider does not expose it.

The existing descriptive methodology report was intentionally not changed, so
previously sealed report artifacts and readers remain valid. A later versioned
decision join may consume both artifacts after registration binding is closed.

Verification under Node 22:

- `npm run typecheck`
- `node --import tsx --test tests/eval-methodology-grading-projection.test.ts`
- full methodology-focused suite before commit

This proves authenticated accounting behavior, not model identity, provider
contact, efficacy, or R4 readiness.
