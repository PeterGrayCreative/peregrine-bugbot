# Private-stream one-canary dispatcher v1

This additive integration starts at public `564d17b823624fb79030f3c1de13b44db823f91c`
and private `bea59fdf15afe08b084ae0d135a124072a8a992d`. It preserves the accepted
contract at `c5a8981f0e500b4ad45798b19729026486e3d49e` and selects only its accepted
private-stream image `sha256:b7b2ab5d41b51f32a33c35e17e15746ac7c922d12243d5f773f4c7fcd2c30a52`
inside the new adapter. Existing runtime selection and all predecessor files are
unchanged. No default configuration or gate grants execution authority.

| Requirement | Implementation and deterministic evidence |
| --- | --- |
| Exact new source/private freeze and Astra-medium gate | Dispatcher contract closure, independently pinned gate bytes, exact Git heads and clean-tree checks; gate/source tampering tests |
| One durable, crash-safe attempt | Exclusive attempt directory plus fsync before launch; copied/reused capability, concurrent reservation and restart tests |
| Deadline before preparation through provider work | One monotonic 1,200,000 ms timer; abort reader/process, kill client before awaiting active work, uncancelled absence checks; injected expiry tests |
| Isolated authenticated Codex 0.152.0 | Metadata-only host auth-file validation and network-none version/login-status checks; no credential file reads or ambient home mounts; synthetic adapter test |
| Strict tokenless MCP | Existing exact command, four-tool reader, fixed private forwarder, complete signed client catalog; schema/catalog mismatch tests |
| Independent identity, usage and accounting | Pinned Ed25519 observer, fresh challenge bound to source/run/session, terminal CLI usage reconciliation, provider calls null unless authenticated; replay/signature/accounting tests |
| Containment and cleanup | Existing sidecar argv/topology parsers, exact client create/inspect before start, no output mount or Docker client logs, container/network absence queries; synthetic cleanup failure tests |
| Private failure evidence | Typed fields and one-way bindings only, exclusive writes, retained partial evidence, immutable failures; secret/error nonpersistence tests |

The public entrypoint is `scripts/evidence/private-stream-dispatcher-v1.ts`.
It accepts exactly `--preflight --config <path> --gate-sha256 <independently-pinned-hash>`
or the separately authorized `--canary` mode with the same arguments. No mode is
run during this implementation. The preflight mode may launch metadata-only
containers and read-only MCP sidecars, but never a model request or execution
directory. It tears them down before returning and never issues a capability.
Canary mode performs a fresh preflight inside the same process/deadline, issues
one process-local capability, reserves the durable state directory and starts
one exact Sol/low client. A preflight receipt from another process cannot be
replayed as a capability. Failed or expired runs have no retry operation.

Config fields are exact and documented by the entrypoint's `exact()` check.
The fresh gate binds public/private commits, new source and private freeze hashes,
the accepted original contract hash, image, durable-state-directory hash, observer
public-key hash and runtime-input hash. Runtime inputs include the exact reader
registration/manifest, scope, paths and dedicated session directory. The private
freeze predates the gate and retains execution/provider readiness false. A gate
for the predecessor contract alone cannot authorize this integration.

The independent observer must be separately provisioned and reviewed by the gate.
It exposes a private evaluator-owned Unix socket, accepts no credentials or
provider prompt, and signs canonical JSON with Ed25519. Requests contain phase,
fresh nonce and context (binding, run ID and session metadata identity hash).
Responses have exactly payload and signature; payload contains kind
`private-stream-observer-v1`, the identical challenge fields and observation.
Ready observations require the complete pinned catalog, containment/session
profile and ability to observe identity/accounting. Complete observations include
the complete actual client catalog, authenticated provider-call count or null,
independently authenticated served identity or null, and complete terminal input,
output and reasoning counters. The observer must correlate the client named
`peregrine-eval-<runId>` and use independent provider metadata. A fabricated local
receipt or model self-report is not an observer implementation. Missing observer
deployment is an execution blocker; this source does not manufacture that trust.

The caller supplies an already authenticated, evaluator-owned, private directory
containing only a single-link `auth.json`; no credential bytes are read, copied,
printed or persisted by the evaluator. The CLI can read that file through a
read-only bind. Its state/home are fresh container-only tmpfs, removed with the
container; the source authentication file remains owned by the operator.

All 64 review slots remain unstarted. Prior consumed failures retain unknown
provider counts. Launch count is distinct from provider count, terminal input plus
output is counted once, cached/reasoning subsets are not added again, and every
result remains scientifically not eligible. Synthetic tests are not live proof.
Fresh exact source freeze, independent Astra-medium gate, successful live preflight
and fresh capability issuance remain prerequisites. No live preflight, capability,
canary, image operation, provider call, workflow dispatch, push or production
change is authorized by this source preparation.
