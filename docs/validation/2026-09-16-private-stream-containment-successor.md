# Private-stream containment source correction

The failed source gate at public commit
`5f73133c38c89c791b5cbe49f7999c562b506a11` remains a predecessor. Its private V1/V2
freezes and failure handoff are immutable. This correction is source preparation
only; it does not establish runtime readiness or grant publication, provider,
canary, retry, batch, or production authority.

The publication wrapper now calls `scripts/private-stream-containment.ts`.
It creates only trusted input fixtures, mounts both directories read-only, and
overrides the candidate entrypoint with Node running the read-only-mounted
`private-containment-probe-v1.mjs`. There is no host `/output` directory, writable
host bind, report-file reader, or `chmod 0777` path. Docker logging is disabled
for this attached containment container. Home and scratch remain bounded tmpfs.
The accepted recipes, original containment helper/launcher, forwarders, original
workflow, and accepted image constants remain unchanged.

The versioned helper retains the predecessor's Linux, UID/GID, read-only root and
input, tmpfs, network namespace, host-sentinel, socket, zero-credential and pinned
CLI version checks. `/output` must now reject writes. It emits only the fixed
schema/protocol/status tuple and never writes a checks report. Version subprocess
output is capped at 1 KiB. The host pipe is capped at 1 KiB before bytes can reach
the validator; the validator also checks combined stdout/stderr length before
decoding and accepts only the exact fixed tuple, with one optional final newline.
It cannot accept arbitrary strings, duplicate keys, additional fields, diagnostics,
concatenated reports, oversized output or a failed subprocess as passing evidence.
The existing 4 MiB cap continues to apply to the separate egress client's results.
Cleanup diagnostics also retain that cap. `docker run --quiet` suppresses image
pull progress so normal platform pulls cannot pollute the fixed result channel,
while `--pull always` remains required for platform runs ([Docker CLI reference](https://docs.docker.com/reference/cli/docker/container/run/)).

Cleanup always attempts exact-name removal and explicit absence verification,
then exact-digest removal and absence for platform runs. A known auto-removed
container requires exact-name absence proof. Surviving objects, wrong names,
unknown failures and failed image cleanup reject the probe; primary failures do
not skip cleanup. Temporary input directories are removed on success and failure.
Existing egress source-witness checks, tokenless fixed endpoint, unprivileged
verification and digest/platform/attestation workflow guards remain in force.

| Requirement | Implementation | Local evidence |
| --- | --- | --- |
| No candidate host report persistence | Input-only mounts, attached pipe, logging disabled, fixed-metadata helper | Regression first reproduced host report creation at the predecessor; corrected launch rejects this path |
| Bound candidate data before parsing | 1 KiB capture and pre-decode cap; exact fixed-format comparison | Oversized string/buffer/multibyte, malformed, duplicate-key, extra-field and stderr rejection |
| Preserve containment and cleanup | Versioned helper, exact absence checks, unconditional cleanup | Native/amd64/arm64 injected launches; restrictions, auto-removal, survivors, wrong names, thrown run and image cleanup failures |
| Preserve accepted sources and gates | Separate publication workflow/profile and additive helper | Accepted-source byte comparison, existing affected tests and YAML checks |
| Preserve default-deny evidence | New private V3 freeze and exact reconstruction | Versioned package binds failed predecessors, validation and source hashes; no runtime authorization |

Validation uses Node 22.22.1, `npm run typecheck`, the focused publication suite,
the affected containment/egress/observation/safe-canary tests, helper syntax, YAML
syntax and diff checks. No Docker operation, provider client, image publication,
workflow dispatch or push is part of this correction. Injected launch evidence
does not establish live Docker/platform behavior. A fresh independent source gate,
immutable image publication and platform proof, independent image acceptance, and
fresh exact canary authorization remain prerequisites.
