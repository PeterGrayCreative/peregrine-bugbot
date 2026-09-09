# R3 methodology egress lifecycle integration

Date: 2026-09-09
Base commit: `aa4ca1391d254d6ebfeb785e787b0da5562c8b8b`
Evidence class: deterministic structural integration only

## Result

The trusted historical-methodology provider attachment now owns the complete
per-attempt egress lifecycle proven mechanically in PR #37:

- production attachments accept an exact provider-authority allowlist and use
  only the repository-owned Docker executor;
- two fresh IPv4-only networks and the gateway/forwarder sidecars are created
  and inspected before the reviewer is launched;
- the reviewer receives only an opaque, supervisor-issued internal-network
  capability, with exact proxy and tokenized MCP destinations;
- invocation policy version 3 binds the egress attachment and rejects a route
  or token that differs from the attachment;
- scope-record version 2 binds the registered scope, exact tool policy,
  provider-authority digest, runner-owned MCP audit, and ordered sealed sidecar
  diagnostics;
- async scope finalization awaits sidecar sealing and cleanup before a review
  terminal can be written;
- attachment or materialization cleanup failure becomes a lifecycle failure
  before terminal success, while cleanup retries remain bounded and observable;
- structural mocks retain the prior attachment and scope-record formats and
  cannot satisfy provider-class evidence.

The exact environment and numeric limits accepted by the supervisor match the
immutable sidecar image. Unknown inherited environment entries and values that
the bundled MCP forwarder cannot honor reject before startup.

## Review corrections

Independent Luna reviews identified and the integration corrected:

- inherited immutable image environment entries missing from container-inspect
  validation;
- forgeable caller-shaped launch descriptors and provider-class executor
  injection;
- non-retryable partial cleanup and unbounded final log capture;
- an invocation URL not cross-bound to its attachment token;
- attachment/scope limits wider than the bundled forwarder accepts;
- normal pretty-printed Docker network-inspect output being parsed as JSONL;
- malformed finalizer input being checked only after irreversible cleanup;
- outer cleanup errors that could contradict an already-written lifecycle
  terminal;
- omission of the new egress suite from the standard methodology test gate.

## Verification

All Node commands use the repository Node 22 pin.

- Typecheck: passed.
- Focused egress, containment, attachment, scope, invocation, and lifecycle
  tests: passed.
- `git diff --check`: passed.
- Full `npm run validate` on clean commit `de3bac6`: passed, including 295 core
  tests, 13 evidence-capture tests, 44 historical-truth tests, 188 methodology
  tests, 13 methodology-HTTP tests, corpus/skill/package validation, and the
  8/8 structural smoke.

No Docker daemon, external network, provider, model, or credential-bearing
operation was used by this integration verification. The earlier standalone
credential-free Docker proof remains the runtime evidence for the sidecars.

## Claim boundary

This establishes fail-closed wiring and artifact compatibility, not provider
contact or review completeness. No credential-bearing canary has run, so scope
remains `unverified` or `incomplete` and receives no historical root credit.
Served-model identity, real tool availability with credentials present,
inferential decisions, human admission, and Peregrine efficacy remain open.
