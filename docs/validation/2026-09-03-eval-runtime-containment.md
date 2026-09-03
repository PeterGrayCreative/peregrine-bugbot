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
`ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0186100efde64b85913efee1746a0cffd4f19368ce9eae0fa81b3eea6fc7c65c`.
Manual publication run `33765852688` verified that exact digest on both amd64
and arm64 and completed its subject-digest attestation. The runner uses
`--pull never`, and schema-2 artifacts accept only this exact image reference.
