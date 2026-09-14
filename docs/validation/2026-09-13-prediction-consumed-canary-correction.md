# Consumed canary: producer profile and evidence redaction

The single Sol/low canary is consumed and **not eligible**. Its independent
assessment was coordinator-relayed: evidence integrity PASS, canary FAIL;
authenticated observer evidence was absent. The reported read-only assessment
was not persisted originally, so its seal is recorded as a relay, not recreated
evidence. Receipts support zero client/model launches; the ledger's
`providerCalls` remains **null**, not rewritten to zero. Cleanup completed. All
64 review slots remain unstarted. No retry or batch is authorized.

The observed startup stop was a producer-schema mismatch: both running helpers
reported `HostConfig.OomKillDisable=null`; V8 required the create-only probe's
`false`. Successor `methodology-observation-graph-v4` requires the retained running
representation, null only. False, true, missing, unknown and inconsistent helper
values reject. The archived create-only fixture and V8 freeze remain unchanged.
This correction is prospective; it does not turn the consumed failure into a pass.

V8 also retained the ephemeral forwarding token in two mechanical receipts.
The originals are byte-verified in restrictive, local-only quarantine outside Git;
they are not GitHub-durable. A consumed/no-retry tombstone keeps the original
execution directory unavailable for reuse. The private sanitized archive uses an
explicit redaction marker with a one-way digest and records original file hashes,
inventory hash and every substitution. Original receipt seals are not resealed.

Future mechanical v3 receipts use `forwarding-capability-sha256-v1` metadata.
The SHA-256 occupies the original token position for exact cross-record comparison,
but is explicitly a redaction, not a live capability. Live values are checked
against the in-memory attempt token before persistence. Args, inspect streams,
echoed output and nested failure diagnostics are redacted; stream hashes bind
the persisted redacted bytes. Invocation, client and both sidecars must agree on
the digest. Missing/cross-run metadata or legacy unredacted receipts fail closed.
The low assessor advances to v9; external observer requirements remain unchanged.

Contained output is validated before redaction, with original and persisted
digests recorded. Unvalidated raw provider output is not publishable evidence.
No Docker, Codex, model/provider, image or production-routing operation was used
for this correction. Source and private evidence are local commits pending a
fresh independent gate. A new version and explicit authorization would be needed
for any future attempt; this package grants neither.
