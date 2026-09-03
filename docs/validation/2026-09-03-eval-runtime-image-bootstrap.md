# Evaluation runtime image bootstrap validation

Date: 2026-09-03

Scope: Safety PR 2A.1 image bootstrap only, based on
`2e4ae2ad5deb34aba8b91cde78d8e4662dcf109d`. This slice does not execute a live
provider, publish or pull an image, add a container runtime to the evaluator, or
open the merged fail-closed live gate.

## Immutable inputs

- `node:22.22.1-bookworm-slim` resolved to the multi-platform index digest
  `sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d`.
- The image lockfile pins `@anthropic-ai/claude-code@2.1.252` and
  `@openai/codex@0.152.0`, matching `.github/actions/setup-peregrine/action.yml`.
- Every workflow action reference is a full commit SHA. The manual multi-platform
  builder additionally pins Buildx `v0.37.0`, the BuildKit image digest
  `sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`,
  and the binfmt helper digest
  `sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0`.

The image and helper digests were checked using read-only
`docker buildx imagetools inspect` registry metadata. Action commits and the
Buildx release were resolved from their upstream Git refs.

## Local validation

All Node commands ran after `nvm use 22`, which selected Node `22.22.1` and npm
`10.9.4`.

- `node --import tsx --test tests/eval-runtime-image.test.ts` — passed 7/7.
- `npm run typecheck` — passed.
- `npm run validate` — passed: 57/57 Node tests, all skill/packaging/install
  checks, and the 8/8 zero-cost structural smoke suite with five expected markers
  found and zero findings on three clean controls.
- `git diff --check` — passed.
- Ruby YAML parsing of `.github/workflows/eval-runtime-image.yml` — passed.

The local Docker daemon was reachable (Docker Engine `29.7.2`, Linux arm64), but
the exact pinned Node base image was not cached. A local image build would
therefore have pulled image layers, which this task explicitly prohibited. The
zero-credential container build/smoke remains to be exercised by the unprivileged
pull-request job; it is not claimed as locally passed.

The workflow's executable probe launcher owns the complete ordered `docker run`
argument vector. Pure tests parse its valid local and digest-addressed forms and
reject mutations that restore default networking, remove the read-only root, make
an input mount writable, add a host-root mount, or replace the published digest
with a mutable tag. The in-image probe now independently checks the root mount's
`ro` flag, loopback-only interfaces, and absence of default IPv4 or usable IPv6
routes.

No provider process, registry login, image publication, or image-layer pull was
performed. `eval/case-isolation.ts` remained byte-for-byte unchanged from the base
commit, so Claude and Codex live matrix attempts still stop before provider
execution.

## Acceptance boundary

After this bootstrap merges, an authorized maintainer must manually dispatch the
publication job from `main`, independently verify the resulting GHCR attestation
and amd64/arm64 digest, and explicitly approve that digest. Publication precedes
the two platform probes so that they exercise the actual registry artifact; a
probe failure may leave a commit-tagged but deliberately unattested candidate,
which must be treated as rejected. A separate Safety PR
2A.2 can then pin the released digest and implement runtime mounts, secret
allowlisting, timeout cleanup, network-status accounting, and fake-provider
execution. Until that follow-up passes, live evaluation stays disabled.
