# Sol-low operator v8: clock-bound phase chronology

V7 (`a8723cd` public / `56af879` private) remains unchanged. Three fully resealed
deadline mutations reduced preparation, execution or teardown to zero while
positive-duration mechanical receipts remained. All three failures are retained
privately. Checking only whole-attempt duration was insufficient.

The phase mapping follows the checked-in producer's await order:

| Deadline interval | Authenticated mechanical receipts |
| --- | --- |
| start → exec-start | All sidecar/network preparation and readiness/inspect calls |
| exec-start → exec-closed | Client invocation/result **and** mandatory uncancelled client removal and absence query |
| exec-closed → teardown-complete | Sidecar/network stop, audit, removal and absence queries |

`createContainedProviderExec` awaits client remove/absence before returning;
only then does the guard emit `exec-closed`. Guard teardown awaits supervisor
and reader closure before `teardown-complete`. Output reading between execution
and teardown remains inside that teardown envelope, with no fabricated receipt.

The existing deadline and mechanical evidence producers now emit v2 records
with wall/monotonic samples and the same-process PID/time-origin identity.
Profile `methodology-observation-graph-v3` requires those samples; missing legacy
clock evidence cannot be repaired by guessing an origin. Each sample must match
its receipt's wall timestamp and the guard's clock source. Wall versus monotonic
differences retain one shared one-millisecond quantization envelope; opposite
endpoint errors cannot accumulate into a larger allowance. Every phase's wall
span also fits its duration plus that same bound. Monotonic
samples are not rounded and receive no added phase-order tolerance.

Every receipt must lie inside its assigned phase and the whole attempt. Ordered
receipts cannot overlap or run backward. Zero/negative/impossible phases reject
when receipts have positive duration, including wall-positive spans that might
otherwise hide inside the quantization allowance. Existing whole-duration,
cleanup, namespace, nanosecond, schema and authorization checks remain intact.

Tests include the three exact full-assessor reproductions, every receipt endpoint,
137 systematic clock/phase mutations, exact phase edges, one-nanosecond inversions,
the ±1ms boundary, source mismatch, missing clocks, and separately clipped client
removal/absence and network cleanup. Synthetic producer tests validate emitted
clock receipts through the same assessor boundary. Fixtures are prospective
synthetic evidence, never observations of a real canary.

No provider, actual CLI, Docker/image operation or attempt occurred. Production
routes, accepted image, original low amendment, hard limits and 64 unstarted
review slots are unchanged. Readiness and batch authorization remain false.
Real-producer conformance remains unproven; fresh exact-freeze review is required.
