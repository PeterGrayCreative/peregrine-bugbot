# Sol-low operator v7: namespace uniqueness and timestamp precision

V6 (`615e5aa` public / `037ce65` private) remains unchanged. Its gate found
distinct full SandboxIDs sharing one validated 12-character namespace path.
The existing timestamp parser also accepted nine fractional digits but truncated
them to milliseconds. Four direct-graph and fully resealed assessor regression
groups reproduce those predecessor failures and are retained privately.

The shared graph now requires unique validated SandboxKeys as well as full IDs.
Profile `methodology-observation-graph-v2` parses the same strict UTC RFC3339
producer forms (whole seconds or one through nine fractional digits) into exact
integer nanoseconds. Calendar validation cannot normalize invalid dates or
discard fractions. Creation/start order and container/network creation versus
receipt bounds reject one-nanosecond inversions. The running state's exact zero
FinishedAt sentinel remains mandatory; nonzero or unregistered forms reject.

Receipt timestamps remain authenticated integer milliseconds and convert exactly
for comparison, without invented sub-millisecond observations. Fractional or
unsafe receipt numbers reject. Monotonic deadline telemetry keeps its existing
number precision and direct ordering; tests cover fractional values, one-
nanosecond inversions, the hard wall limit and cleanup receipt boundaries. The
previous one-millisecond wall/monotonic quantization allowance is unchanged.

Validation includes both helpers and resealed artifact inventories, valid equal
and adjacent nanoseconds, leap-day/second boundaries, every accepted fraction
width, malformed/default representations and all predecessor tests. Exact
commands, counts and byte-for-byte freeze replay are retained in private V7
evidence. No tests or scientific limits were weakened.

No actual provider, Codex client, Docker/image operation or attempt occurred.
Original amendment, accepted runtime and 64 unstarted review slots are unchanged.
Real-producer conformance remains prospective and must fail closed before client
invocation; mismatch requires a new version and authorization before retry.
Readiness and batch authorization remain false. A fresh independent review of
the exact V7 freeze is required.
