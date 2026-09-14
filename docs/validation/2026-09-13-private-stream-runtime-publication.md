# Private-stream runtime publication preparation

This source-only checkpoint prepares publication; it does not publish, accept an
image, or authorize a canary. The consumed canary remains FAIL / not-eligible,
with no retry and all 64 review slots unstarted. The preceding private-stream
implementation passed independent review and landed in PR64; image/helper
acceptance and fresh exact canary authorization remain separate requirements.

The separate manual `eval-private-stream-runtime-image` workflow prepares the
`private-stream-v1` candidate. The original `eval-runtime-image` workflow stays
byte-identical because accepted evidence pins its source. The new job builds only
`Dockerfile.private-stream-v1` and tags the result
`private-stream-v1-<full-commit>`. Tags are discovery labels, not immutable proof:
acceptance must use the published digest, exact run/commit, both platform reports,
source input and build-provenance attestation. Old accepted image constants,
Dockerfile, forwarder source and the versioned private helper/recipe are unchanged.

| Requirement | Minimal implementation | Deterministic evidence |
| --- | --- | --- |
| Separate publication and identity | Explicit main-only manual job; distinct commit tag; digest probes before attestation | Workflow/pin/default tests |
| Credential-free containment and egress | Existing containment and network/source-witness proof reused | Existing tests plus injected amd64/arm64 runs |
| Fixed nonsecret reviewer endpoint | Separate hash-pinned verifier fixture; strict private argv mode | Cross-profile/extra-flag/refusal tests and candidate helper HTTP tests |
| No raw mechanical evidence | Bounded piped capture and typed hashes only; raw results validated live | Encoded stdout/stderr/error/result disk scans |
| Exact readiness-denied source input | Git-authenticated source/import/data inputs and lockfiles | Revision/drift/default-deny tests; private freeze/replay |

The reviewer runs from the existing independently pinned Node verifier image,
not candidate-provided reviewer code. It receives `/mcp`, never the forwarding
capability. Its negative path must fail before reaching the fake upstream; the
upstream source-address and challenge witness remain authoritative. The private
fixture uses a separate protocol and `wrongPathDenied` field, preserving the
legacy fixture and token-based protocol byte-for-byte.

The private wrapper limits each Docker client's captured streams to 4 MiB and
120 seconds, allows only PATH/HOME in the host client environment, and never
uploads raw argv, streams, diagnostics, causes or arbitrary result fields. HOME
permits the normal workflow Docker client's registry login file; it and registry
credentials are not mounted into fixtures or sidecars. Only typed starts/results,
byte counts and hashes are retained, even on failure. No universal reversible-
encoding detector is claimed. The existing containment fixture's credential-free
`--version` queries are distinguished from provider/client-session launches.

GitHub's private-job artifacts retain the exact source input and per-platform
typed reports, including failure/partial starts, for 90 days. Missing reports,
failed cleanup or a failed platform prevents successful attestation/acceptance;
an uploaded artifact by itself is not a pass. Registry publication, architecture
execution and attestation have **not run in this section**. No local Docker,
image, Codex/provider operation, workflow dispatch or push occurred.

The source input always leaves digest, workflow run and independent acceptance
unknown and readiness/authorization false. A future successful workflow still
requires an additive archive and independent review before a separate runtime
acceptance change. It cannot inherit the consumed canary authorization. This
checkpoint can be reverted without rewriting any predecessor evidence.

Affected validation caught the initial in-place workflow edit against that
unchanged acceptance pin. The failed draft and run remain private evidence;
the correction uses a separate workflow rather than changing the accepted hash.
