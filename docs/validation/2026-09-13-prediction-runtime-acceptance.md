# Experimental runtime acceptance, not provider authorization

This change accepts the published methodology/prediction runtime:
`ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:ccad8c4087d95936231b9c0ac38f4db0782e74da7183c08eee59b71114e15826`.
It is a zero-provider checkpoint awaiting independent review, not an R4
experiment pass or permission to launch a CLI-agent/provider canary.

## Publication and byte bindings

[Workflow run 34758654512](https://github.com/PeterGrayCreative/peregrine-bugbot/actions/runs/34758654512)
is a successful manual `main` run at
`b01d15680705ff7e8d28047f5b529298acbb1c95`. Original logs show containment and
egress probe passes for both platforms, before the successful attestation step.
The retrieved OCI index hashes to the accepted digest; its child manifests are:

- `linux/amd64`: `sha256:6c02658ab4ce790c3ecb090c0e99d862cd20eeed342277e957f82c0c75814d3a`
- `linux/arm64`: `sha256:0042d215ff539773cd80cf7ee9e2ec2fd9ffaf63d95120e49055b3c484eee07b`

Signed provenance verification passed with the exact repository, workflow,
source commit and `refs/heads/main`, denying self-hosted runners. Its certificate
binds this run/attempt and its statement binds the published digest. The public
acceptance record freezes raw run/job/log/attestation hashes plus workflow,
image recipe, package/lockfile, sidecar and fixed client source hashes.

Original API responses, signed bundle, verification result, workflow log ZIP,
raw job logs, both OCI manifests and the build-record artifact are preserved in
private `ai-exploratory/prediction-development-v1/runtime-acceptance-v1/`.
The build artifact was returned as gzip despite the API's `/zip` URL; its raw
bytes match the API artifact digest and were not rewritten. No standalone
JSON probe reports were uploaded; the original logs are the platform evidence.
The package-version API returned 403 for missing `read:packages` scope. That
failure remains explicit; existing registry authentication successfully supplied
the OCI manifests and native image. No credentials were inspected.

## Native zero-provider proof

The exact published arm64 image passed the existing fixed Node reader probe:
result digest `ed3209deda2a2197fbab46a4844fa92254b85c2d5baddf7e7f9a6091879e8dfe`.
All 14 inventoried Node/Codex/sidecar files equal the preceding repaired native
candidate's bytes. Node is 22.22.1 and Codex package bytes remain 0.152.0; no model
CLI was invoked. A separate installed-file inventory for amd64 is unavailable.

The authenticated four-tool reader was listed and the frozen diff read. This
source has no native link, so Docker exercised an unavailable `read_link`
response; literal-link success remains deterministic-test evidence. The client
and SIGTERM-ignoring child ran, the accelerated 20-second guard cancelled at
20,004 ms, and teardown completed at 21,071 ms. Forced client removal, sealed
valid sidecar audits and exact container/network absence checks passed. This
is not a 20-minute CLI-agent run.

## Compatibility, validation and remaining gates

Only explicit experimental methodology/prediction launches select the new
digest. General review runtime `0ad23c12…`, production routes, source readers,
scientific registrations and all prior evidence remain unchanged. Historical
invocation/scope readers accept the exact old `d62b740e…` digest; new launches
reject it. Historical readability does not grant a launch capability or canary
status. The former local-only candidate remains preserved separately.

Node22 typecheck, 41 prediction tests, 13 HTTP tests and 155 affected runtime,
reader, attachment, invocation, scope-record, engine and telemetry tests passed.
Regression checks bind source bytes, preserve historical readers, reject old
or arbitrary launch images and retain the unverified-without-canary verdict.
The successor freeze verifies public/private source closure, raw publication
and signed-provenance bindings, native runtime bytes, unchanged scientific
registration and all 64 slots; it also rejects publication-byte mutations.

Independent review and a separately authorized supported non-API CLI-agent
canary remain required. Exact served model/version and provider usage are
unknown; assessor/blinding receipts are absent. `executionReady` and
`providerAuthorized` remain false, and all 64 review slots remain unstarted.
