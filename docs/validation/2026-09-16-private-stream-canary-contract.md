# Private-stream single-canary contract V1

This additive preparation binds the accepted immutable image
`sha256:b7b2ab5d41b51f32a33c35e17e15746ac7c922d12243d5f773f4c7fcd2c30a52`
to exactly one new Sol/low infrastructure canary, with a 1,200,000 ms hard
wall-time limit beginning before preparation. Public base is
`904795f4f6c6a3b87bbd8eafbe696fc67e29c3fa`; private base is
`c4875bc503ea52c4e8669a121e29a25825ca651f`.

The current authorization is recorded verbatim: “Move forward with anything you
need to. You have my permission.” Its provenance is coordinator-relayed user
text, not a signature or independent message retrieval. It is scoped here to
this one prospective canary after a fresh exact execution-contract gate and
session preflight. The earlier “I authorize the canary only run. Use a sol low
subagent to run the canary.” remains historical and consumed. Neither statement
authorizes retries, a review batch, production routing, or broader experiments.

| Requirement | Implementation and deterministic evidence |
| --- | --- |
| Accepted source/run/attempt/platform/attestation and both gates | Exact 22 publication inputs, public image gate, private final acceptance gate, V2 acceptance binding |
| Fresh contract/source/private freeze gate | Independent trusted byte hashes and full binding equality; stale/wrong source, image, gate and freeze rejection |
| Isolated authenticated Codex session | Exact receipt for fresh CLI session, no API fallback, ambient home or plugins; no credential byte inspection or persistence |
| Tokenless private MCP and complete catalog | Exact four tool definitions; complete pagination and empty resource/template/prompt catalogs; no token in client endpoint |
| Whole-attempt deadline | Exact 1,200,000 ms, monotonic start before preparation, abort reads/exec, uncancelled teardown; checked again at capability consumption |
| Single use and immutable failure retention | Opaque nonserializable preparation capability, exclusive durable state directory, create-only start/terminal, denied copied/replayed/restarted capabilities |
| Served identity/accounting/cleanup | Independent metadata or explicit unknown, separate client/provider counts, unknown remains null, input plus output counted once, all absence proofs required |
| Preserve history and deny broader work | Exact consumed tombstone and safe-canary freeze; 64 unopened slots; no existing source or evidence rewritten |

`createPrivateStreamCanaryPreflight` checks coordinator-pinned gate/session
bytes. These pins must come from the independent review and live observer,
never from the submitted receipt itself. Deterministic fixtures test contract
semantics and do not prove real session, catalog, containment, identity or
cleanup behavior. A hash authenticates bytes, not an observer's truthfulness.

The new API issues only a preparation capability. There is no provider or
Docker launcher in this version, and `requirePrivateStreamCanaryDispatch`
unconditionally denies. The future reviewed dispatcher must use the fixed
canary state directory bound by the gate and freeze; it must preserve that
directory even after crashes, start the existing whole-attempt deadline before
any preparation, and retain teardown proof before claiming completion. A failed
attempt consumes the slot. Changing the directory or creating a successor is
not an authorized retry.

Source preparation and user authorization are recorded. Independent execution
gate, session preflight, capability issuance, runtime readiness, execution
readiness, and all provider/canary/retry/batch/production flags remain false.
Served identity is captured only from independent provider metadata; unknown
identity or usage cannot pass the evidence assessment. No infrastructure result
establishes scientific eligibility, equal compute, or review efficacy.

Private freeze/reconstruction records retain exact public commit, source files,
private predecessor bytes, validation evidence, and the unopened ledger. A fresh
Astra-medium execution-contract review must bind those exact identities. Future
runtime adapter integration and authenticated session preflight remain separate
prerequisites. No image/container/client invocation, provider attempt, workflow
dispatch, push, retry, batch or production change is performed by this section.
