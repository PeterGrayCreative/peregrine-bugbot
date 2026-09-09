# R3 runner-owned scope evidence

Date: 2026-09-08. Evidence: deterministic structural tests only. No model,
provider, or historical case invocation occurred.

The historical methodology lifecycle now persists a version-2 attempt result
when it uses the trusted provider attachment. That result binds:

- the registered raw review-scope digest;
- the exact sealed neutral-read tool policy and provider-attachment reference;
- a runner-owned, sanitized audit of MCP requests, sessions, tool outcomes,
  incomplete-result codes, denials, and transport failures;
- model-reported limitations and emitted-finding count.

The audit retains ordered tool names, bounded allowlisted status codes, and
domain-separated result digests. It never stores tool arguments, requested
paths, search queries, source text, or unknown tool names. Its reader
reauthenticates counts, canonical ordering, aggregate codes, and the snapshot
digest. Concurrent calls are ordered by request arrival rather than response
completion. Finalization refuses to snapshot while a request handler is active,
seals the audit once, and prevents later requests from mutating it.

The version-1 scope record is deliberately fail-closed. It has no
credential-bearing model/tool canary and therefore cannot certify `complete`.
A model-completed review is graded `runner-scope-unverified` when the canary is
missing, or `runner-scope-incomplete` when the audit or model output records an
availability failure. Neither state receives root credit. Legacy methodology
result version 1 remains readable and retains its original unverified meaning.
The terminal writer rejects a version-2 result unless it receives the branded,
single-use provider scope finalizer; legacy version-1 writes reject that
capability. Persisted hashes retain the repository's existing caller-held trust
boundary and are not signatures against a hostile evidence-store owner.

Focused Node 22 verification passed:

- typechecking;
- the 168-test methodology suite and 13-test MCP transport suite;
- parser mutation checks for changed counts, order, codes, policy, registered
  scope, derived result, and digests;
- lifecycle integration proving the stored version-2 result is reauthenticated
  from sealed invocation records.

Complete `npm run validate` passed from clean commit `80305fc` under Node
22.22.1. That command included typechecking, the full repository tests, all 168
methodology tests, all 13 MCP transport tests, corpus validation, skill/package
validation, and the eight-attempt structural smoke. No provider was invoked.

Remaining R3 gates are an enforced provider-destination egress boundary, an
explicitly authorized credential-bearing canary and its new versioned scope
record, inferential decision seals, and real human-admitted historical cases.
This slice proves accounting behavior, not provider contact, model identity,
review completeness, or Peregrine efficacy.
