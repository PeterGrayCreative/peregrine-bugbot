# Sol-low operator v4: observed containment integrity

The v3 gate rejected public `7c34905` / private `0528cd9` after three
resealed gateway inspect receipts falsely passed: published host ports, a host
PID namespace and a host disk device. Private `sol-low-operator-v4/` preserves
all three failing predecessor regressions and the coordinator-relayed finding.
V1/v2/v3 artifacts and commits remain unchanged.

The shared sidecar inspect parser now requires an exact supported HostConfig
profile, with only the expected attempt network and role-specific host mapping.
Missing, additional or changed fields fail closed. This covers publication,
namespaces, devices, capabilities, security options, bind/volume/tmpfs mounts,
root filesystem protection, process limits, restart policy and masked/readonly
paths. No extra command, entrypoint, interactive input, configured volume or
published-port state is accepted. The runtime preflight and low assessor use
this same validator; the prior partial parallel check is removed.

The independent fixture projects defaults from the archived credential-free
`forwarder-startup-v1/inspect-tmpfs.json`, whose exact Git bytes are bound and
checked during freeze reconstruction. That archive used a local arm64 candidate
and **created but did not start** a diagnostic container. It is producer-shape
evidence, not proof of accepted-image sidecar execution. Docker's tmpfs mounts
are in HostConfig.Tmpfs while Mounts is empty. Explicit null/empty no-access list
forms and null/empty command forms are supported; other producer or daemon
default changes require inspection and prospective review, not silent acceptance.

Tests retain every predecessor attack, add the three exact failures, mutate both
sidecars' observed state after resealing, and reject mutation/removal of every
HostConfig field. Existing injected producer tests use the independent archived
profile. Node22 typecheck, 99 prediction, 13 HTTP and 102 affected tests pass.
Validation and byte-identical reconstruction results are private;
an independent exact-freeze review is still required.

No provider, Codex client, Docker, image operation or attempt occurred. The
accepted image, original low amendment, high inputs and 64 unstarted slots remain
unchanged. Readiness and provider/batch authorization remain false; the low
assessment v4 can establish no batch eligibility.
