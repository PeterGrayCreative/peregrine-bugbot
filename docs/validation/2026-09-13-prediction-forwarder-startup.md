# Prediction forwarder startup repair: zero-provider checkpoint

Base: `705d16a23c06814de20a571c6700a4b239955500` (PR #56). This
successor preserves all four earlier failed probes and their source snapshots.
It does not authorize a provider run or replace the accepted runtime image.

## Reproduced causes and minimal corrections

The credential-free, network-disabled diagnostic loaded the exact accepted
image's forwarder bytes. Configuration parsed, but Docker Desktop's
`host.docker.internal` alias resolved to one IPv4 and one IPv6 address. The
forwarder rejected the two-address set before listening. Startup now requests
IPv4, matching the supervisor's IPv4-only networks, and still requires exactly
one valid non-loopback address of that family. It does not choose the first
address or weaken endpoint, topology, egress, or sealed-audit checks.

Two successor probes passed startup but exposed incorrect Docker inspect
assumptions: the container user is in `Config.User`, not `HostConfig.User`,
and Docker serializes the tmpfs map in a different key order. The supervisor
now checks the correct user field and compares the exact tmpfs map canonically.
Root/missing users, spoofed alternate fields, extra mounts and weaker options
remain rejected. Both failed probes and exact predecessor-failing regressions
are preserved privately before the corrections; test fixtures now match the
observed Docker fields.

## Candidate and actual proof

An additive two-line Dockerfile derives from the unchanged accepted digest
`d62b740e61ef05f0813531544e5de89ce76e2eb4a8d55248d9f364b9afd7a171`
and copies only the repaired forwarder. Local candidate image identity:
`sha256:c7296f363efb44c6d48357e6c65dfcb9fac5c550e83b2c917ca7753adddbfa55`.
It was not pushed or substituted into provider defaults. Its real-supervisor
entry point allows only `zero-provider.invalid:443`, accepts no injected
executor/image override, and issues no provider launch capability.

Private `forwarder-startup-v1/attempt-3/result.json` has result digest
`dd35fe30675d61c0b1662f2d7eff69c243958df30e7c686d619dbdb523abcc79`.
The existing fixed Node client reached the authenticated four-tool reader,
read the frozen diff, and exercised an unavailable `read_link` response. This
selected source has no native link: literal-link success remains deterministic
test evidence, not a claim about this Docker probe. The client inventoried 14
runtime files; only the forwarder differs from the accepted inventory. Node is
22.22.1 and Codex package bytes remain identical to the 0.152.0 predecessor;
the model CLI was never invoked.

The client and its SIGTERM-ignoring child were observed running. The accelerated
20-second whole-attempt guard cancelled at 20,004.7 ms; Docker execution closed
with `timedOut:true`, forced client removal and exact absence checks passed,
and teardown completed at 21,110.3 ms. Both sidecars supplied ready, sealed,
self-digest-valid audits; sidecars and both networks were removed and their
absence verified. This tests the registered 20-minute primitive at an
accelerated duration; it is not a 20-minute agent/provider run.

## Validation and remaining boundary

Node 22 typecheck, client syntax, 41 prediction tests, 13 HTTP tests, 116
affected reader/egress/attachment/containment/sidecar/engine/telemetry tests,
and diff hygiene passed. The diff review found no production routing change,
test removal or relaxed containment requirement. Private diagnostics, builds,
failures, source/runtime bindings, validation and replayable freeze live in
`ai-exploratory/prediction-development-v1/forwarder-startup-v1/`.

Independent review, candidate distribution/acceptance, a supported explicitly
authorized non-API CLI attachment and assessor/blinding receipts remain
external requirements. Exact served model/version and provider usage remain
unknown. All 64 review slots are unstarted; `executionReady` and
`providerAuthorized` remain false. No scientific registration or prior freeze
was changed.
