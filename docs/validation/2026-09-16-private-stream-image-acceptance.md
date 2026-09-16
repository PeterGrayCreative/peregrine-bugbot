# Private-stream image acceptance input V1

Run [35153807393](https://github.com/PeterGrayCreative/peregrine-bugbot/actions/runs/35153807393),
attempt 1, successfully published source `788733c8d1935df2badd1765174de5a18d64394f`
at `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:b7b2ab5d41b51f32a33c35e17e15746ac7c922d12243d5f773f4c7fcd2c30a52`.
Its commit tag is `private-stream-v1-788733c8d1935df2badd1765174de5a18d64394f`.

This additive record authenticates publication evidence for a fresh independent
image gate. `publicationVerified` describes the collected evidence;
`imageAccepted`, `runtimeReady`, `executionReady` and every authorization remain
false. The existing experimental acceptance constants and production routing are
unchanged. No launcher consumes the new record.

`eval/private-stream-image-acceptance-v1.json` pins the source contract, exact
workflow/run/attempt, three artifact identities and archive digests, native and
dual-platform report hashes, original source-input/start files, immutable OCI
index and child manifests, signed bundle, and successful strict `gh` verification
receipt. The verifier first authenticates all 22 files against this fixed
inventory, then checks semantic cross-bindings. It never trusts a supplied PASS
or verification boolean, and does not cryptographically verify arbitrary new
bundles. Exact frozen bytes bind the actual successful cryptographic verification.

| Requirement | Implementation and direct evidence |
| --- | --- |
| Exact run and committed source | Run/attempt/workflow identity checks; private replay checks all 148 source inputs against source Git blobs |
| Artifact provenance and bytes | Three exact API IDs/digests; both ZIPs retain exactly seven typed/source members; byte comparison against extracted files |
| Native and two-platform evidence | Strict report schema, source seal, zero-provider and authority checks; published reports bind the exact digest and platform |
| Immutable image and tag | Identical raw tag/index bytes and both Linux child manifest digests |
| Verified build provenance | Successful strict signature policy; certificate source/workflow/ref/issuer/hosted-runner/run identity and signed subject/source/run checks |
| Preserve history and default denial | Additive public module and private package; prior constants and all tracked private predecessor bytes unchanged; no runtime selection |

The private package is `ai-exploratory/prediction-development-v1/private-stream-image-acceptance-v1/`.
It preserves original API responses, all three archives (including the ancillary
build record), typed reports, signed evidence, collectors, failed verification
receipt, development findings, validation, and exact reconstruction. Prior V1/V2
failures, V3 source gate, accepted runtime evidence, consumed failed canary, and
64 unstarted review slots remain unchanged.

Limitations: the native job probes its local tag; only the amd64/arm64 publication
reports prove this published digest. The arm64 workflow uses QEMU emulation.
Metadata receipts cannot reconstruct omitted raw Docker or candidate streams.
The native credential-free probes check CLI versions, not credential-bearing
provider sessions, served model identity, or scientific eligibility.

Validation uses pinned Node 22, focused publication/acceptance tests, affected
containment/egress/observation/preauthorization/attachment/safe-canary tests,
typecheck, package validation, YAML/helper syntax, diff hygiene, and exact private
replay. Runtime-denial guards prevent actual Docker/provider-client launches
during these checks. Forty-four changed/missing-byte cases reject across all 22
evidence inputs. No provider, canary, review batch, image pull, container run,
workflow dispatch, remote push or production change is part of this section.

A fresh independent Astra-medium image gate remains required. Any later provider
work also requires fresh explicit authorization bound to an accepted successor
runtime and exact canary contract. Publication cannot retry the consumed canary,
start any of the 64 review slots, or supply missing CLI/session/catalog, served
identity, assessor/blinding or scientific acceptance evidence.
