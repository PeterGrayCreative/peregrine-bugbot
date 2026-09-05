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

## Follow-up: alternate read-only backend diagnostic

The original default-backend failure above remains unchanged. A subsequent
credential-free probe used the same image and every container flag above,
selecting only the CLI's alternate read-only backend:

```sh
codex --sandbox read-only --enable use_legacy_landlock sandbox -- /bin/cat /etc/os-release
```

This command exited 0 and printed Debian 12 metadata. A negative-write check
then distinguished the writable outer temporary filesystem from the nested
read-only policy:

```sh
/bin/sh -c 'touch /tmp/direct-write-ok && codex --sandbox read-only --enable use_legacy_landlock sandbox -- /usr/bin/touch /tmp/inner-write-denied'
```

The outer write succeeded; the nested command exited 1 with:

```text
/usr/bin/touch: cannot touch '/tmp/inner-write-denied': Permission denied
```

OpenAI's [Linux sandbox documentation](https://github.com/openai/codex/blob/main/codex-rs/linux-sandbox/README.md)
describes this legacy fallback as restricted to equivalent supported filesystem
policies; it is not a replacement for every split read/deny policy. The exact
installed CLI behavior above is the evidence for this diagnostic, not a claim
that mutable upstream documentation pins this release.

No runner setting was changed. Read success and one denied write do not prove
credential isolation, history/sibling-case denial, working model read/search
tools, or provider-connected egress. In particular, a broad read-only policy
may expose readable provider credentials. The backend remains a candidate for
further isolated probes, not an approved historical execution profile. No
container capability, seccomp policy, network policy, or production default
was relaxed; no provider call or historical code execution occurred.

## Follow-up: synthetic credential-path read

A further network-disabled probe tested whether the alternate backend also
denies reads at the runner's configured credential path. The only host mount
was a newly created public canary, not a login file:

```json
{"syntheticCanary":"peregrine-public-test-marker-not-a-real-credential"}
```

Source: `/private/tmp/peregrine-auth-read-canary-20260905.json`. The same image,
user 1000:1000, network-disabled/read-only container, dropped capabilities,
no-new-privileges, and temporary-filesystem flags from the reproduction above
were retained. The additional mount and command were:

```text
--mount type=bind,src=/private/tmp/peregrine-auth-read-canary-20260905.json,dst=/home/peregrine/.codex/auth.json,readonly
<same pinned image>
codex --sandbox read-only --enable use_legacy_landlock sandbox -- /bin/cat /home/peregrine/.codex/auth.json
```

Result: exit 0, with the exact public JSON canary printed. The CLI also emitted
`WARNING: proceeding, even though we could not create PATH aliases: Permission denied (os error 13)`.
The warning did not prevent the read.

This proves no path-based read denial for this readable synthetic file under
the tested configuration. It does not prove access to an actual credential,
which was never mounted, nor does it test every file-ownership arrangement.
`eval/runtime-containment.ts` uses this destination for Codex CLI-session
credentials; therefore the alternate backend alone is not sufficient evidence
of the historical runner's required credential isolation. A credential-free
tool boundary or independently enforced read-deny policy must be demonstrated
before adopting it. No model call, real authentication material, source code,
production configuration change, or security-policy relaxation was involved.

## Credential-separated tool proposal: offline configuration checks

The next candidate design separates the credential-bearing Codex client from
a credential-free read/list/search MCP sidecar. HTTP transport requires an
internal Docker network, **not** `--network none`; the sidecar would have only
that internal connection. A provider-connected client would need a separately
verified egress boundary. Neither topology has been implemented or accepted.

Official [MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
describes HTTP transport, required-server startup and tool allowlists.
[Non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
describes ignoring user configuration and execution rules. These are available
controls, not proof of the proposed container boundary.

Using the same pinned image and restrictive flags above, without any mounts,
credentials, source trees or network, `codex exec --help` exited zero and
confirmed `--ignore-user-config`, `--ignore-rules`, `--ephemeral` and
`--strict-config`. Its help explicitly says ignoring configuration still uses
`CODEX_HOME` for authentication.

The following offline inventory invocation failed with exit 1:

```text
codex --strict-config --disable shell_tool --disable unified_exec
  -c tools.web_search=false
  -c 'mcp_servers.review.url="http://review-tools:3099/mcp"'
  -c mcp_servers.review.required=true
  -c 'mcp_servers.review.enabled_tools=["list_tree","read_file","search_text"]'
  mcp list --json
Error: `--strict-config` is not supported for `codex mcp`
```

Repeating without `--strict-config` exited zero and listed one enabled server,
`review`, with streamable HTTP URL `http://review-tools:3099/mcp`, no configured
bearer/header fields, null timeouts and unknown authentication status. The
listing did **not** expose `required` or `enabled_tools`; it therefore cannot
verify those controls or the actual model-visible tool catalog. The endpoint
was deliberately nonexistent and no MCP initialization or model turn ran.

Next proof needed: bounded synthetic sidecar read/search/list and rejection
tests, internal-network containment, strict execution configuration, and then
a separately authorized minimal model canary. This inventory check upgrades
neither runner completeness nor provider-egress claims.
