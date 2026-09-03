# Evaluation runtime containment validation

Status: implementation validated locally; accepted runtime digest pinned.

## Scope

Safety PR 2A.2 adds the outer OCI boundary used only by live evaluation
attempts. Production review execution, prompts, models, routing, and grading
policy are unchanged.

The launcher accepts only the published Peregrine runtime image by immutable
GHCR digest and always uses `--pull never`. It exposes the sanitized checkout
and Peregrine assets read-only, one private attempt output directory
read-write, and tmpfs-backed home and scratch paths. Capabilities are dropped,
privilege escalation is disabled, and neither the Docker socket nor another
host path is mounted.

API access passes only the selected provider's credential variable name to
Docker. CLI-session access instead accepts one provider-specific directory
containing only the private session file; it never falls back to an API key or
mounts an ambient CLI home. Existing provider flags disable repository rules,
settings, MCP servers, plugins, skills, and session persistence; a strict
launcher parser rejects unknown or missing evaluation flags.

Before provider work, the runner verifies daemon access, local presence of the
exact digest without pulling, digest identity, CLI versions, mount permissions,
sibling-host denial, and zero-credential containment. Provider networking is
recorded separately as `limited`, because Docker bridge egress does not prove a
destination allowlist. Filesystem isolation is recorded as `enforced` only in
the new schema-2 matrix manifest; schema-1 evidence retains its historical
`unavailable` meaning.

Timed-out or failed containers are force-removed by opaque name and a separate
daemon query must prove that no container remains. Provider-created output is
read through `O_NOFOLLOW` descriptors and rejected unless the output tree
contains only expected regular files with bounded size, ownership, mode, and
link count. The reader rechecks descriptor and path identity after reading.

## Local evidence

Using Node 22.22.1:

- `npm run typecheck`: passed.
- `npm test`: 144/144 passed.
- Focused engine and containment tests after the review fixes: 30/30 passed.
- `git diff --check`: passed.

No provider was invoked. The fake launcher exercises provider timeout,
force-removal, survivor checks, immutable arguments, access-mode separation,
host-path translation, hostile output mutations, and capability evidence at
zero model cost.

## Accepted runtime image

`ACCEPTED_EVAL_RUNTIME_IMAGE` pins
`ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`.
Manual publication run `33786871726` built it from trusted `main` commit
`511a687c2aecf484bd28f9f9e32420a3985a69ab`, verified the exact digest on
amd64 and arm64, and completed its subject-digest attestation. Independent
verification constrained the signer to this repository's
`.github/workflows/eval-runtime-image.yml`, the same source commit,
`refs/heads/main`, and a GitHub-hosted runner. Because the GHCR package is
private, the benchmark host authenticated outside the experiment, pre-pulled
the exact digest, and does not mount registry credentials into provider
containers. Runtime launches use `--pull never`, and schema-2 artifacts accept
only this exact image reference.
