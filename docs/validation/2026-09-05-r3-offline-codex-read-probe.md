# R3 offline Codex read probe

Date: 2026-09-05. Evidence class: credential-free runtime diagnostic, not model inference.

## Result

The accepted local arm64 image can read an ordinary file directly, but its
Codex read-only sandbox cannot start the same read under the tested container
restrictions. This blocks claiming usable contained repository exploration
for the historical experiment. It does not establish the cause of every
unavailable-file report in earlier model runs.

Image: `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`.
Local inspection returned that digest and `arm64`. Runtime reports
`codex-cli 0.152.0` and Node `v22.22.1`.

## Reproduction

The image was already present: no pull, build, credentials, checkout, curator
store, or host configuration was supplied. Container flags were:

```text
--rm --pull never --network none --read-only --cap-drop ALL
--security-opt no-new-privileges --pids-limit 64 --user 1000:1000
--tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000
--tmpfs /home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000
```

The command after the image was:

```sh
/bin/sh -c 'cat /etc/os-release; codex --sandbox read-only sandbox -- /bin/cat /etc/os-release'
```

Direct `cat` printed Debian GNU/Linux 12 metadata. The sandboxed command
exited 1 before executing its read, with:

```text
bwrap: No permissions to create a new namespace, likely because the kernel does not allow non-privileged user namespaces. On e.g. debian this can be enabled with 'sysctl kernel.unprivileged_userns_clone=1'.
```

That diagnostic's suggested cause is not established. A separate read-only
inspection inside the same container policy returned:

```text
/proc/sys/kernel/unprivileged_userns_clone: 1
CapEff: 0000000000000000
NoNewPrivs: 1
Seccomp: 2
```

`codex help sandbox` confirmed the installed diagnostic syntax. An earlier
`codex sandbox linux --help` invocation also failed at namespace creation,
but used an unsuitable syntax for this version and is not the primary proof.

## Boundary and next action

This is an isolated CLI sandbox diagnostic, not a replay of an actual model
tool call. Production/evaluation dispatch uses the same pinned CLI and
read-only sandbox setting, but model-tool availability still needs its own
authenticated evidence under the final registered launch.

Do not disable sandboxing, relax container capabilities/seccomp, or change host
kernel policy merely to make this test pass. No such change was made. Resolve
the supported read/search execution boundary and then repeat credential-free
positive-read and negative-write/history/egress probes before R4. The current
bridge-network provider launch also lacks a destination allowlist; passing a
network-disabled diagnostic does not establish safe provider-connected egress.

The inspected kernel/CLI outputs and command are retained here as an authored
diagnostic record, not a signed runtime attestation. No review-model calls,
historical source execution, provider cost, or efficacy result occurred.
