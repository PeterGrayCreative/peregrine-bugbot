# Contained semantic judge validation

Scope: evaluation-only semantic judge execution. Production review prompts,
routing, and GitHub posting are unchanged.

The immutable experiment protocol preregisters a separate judge budget and the
exact Codex `gpt-5.6-luna` / medium / `semantic-v1` identity. `eval:judge`
constructs a complete Cartesian comparison schedule, content-addresses and
sorts it, and shares identical inputs across repeats and variants. Every
provider attempt has write-once start/provider markers and terminal evidence;
the separate stop record and terminal seal authenticate the exact recursive
ledger tree. Stopped, incomplete, tampered, or failed-required evidence cannot
be used for definitive grading or reporting.

Before every provider start, the runner validates the exact unsealed prefix and
rejects extra, missing, altered, symbolic-link, special-file, or out-of-order
state. A recovered start marker without a terminal attempt is authenticated as
an interrupted stopped ledger and is never silently retried. The first failed
required comparison also stops v1 immediately.

The contained command profile mounts an empty checkout, one result schema, and
one private output directory. Ground truth, review artifacts, the case corpus,
Docker configuration, and registry credentials are not mounted. The accepted
Codex argv disables `shell_tool` and `unified_exec`, ignores user rules and
configuration, and labels interpolated benchmark fields as untrusted data. The
accepted runtime digest remains unchanged in this source PR. Because the GHCR
package is private, operators authenticate outside the provider container with
read-only package access and pre-pull the exact digest; launches keep `--pull
never`.

The prompt exposes only the ground-truth file/range, description, reachable
preconditions, and observable impact. Curator-only IDs, root-cause groups,
lanes, expected disposition/severity, and provenance remain model-blind but are
retained in the full canonical truth digest that authenticates scheduling and
deduplication.

Docker Desktop may expose inert kernel tunnel devices even under `--network
none`. The image probe now accepts only the explicit known tunnel-device set,
requires every such device to have zero traffic, and still fails on any
non-loopback assigned address, non-loopback route, or default route. The image
probe ignores non-interface sysfs control files such as `bonding_masters`. The
image source must be merged and manually published before a separate PR can
accept the new attested digest.

Validation commands (Node 22):

```text
npm run typecheck
node --import tsx --test tests/eval-judge-ledger.test.ts tests/eval-grading.test.ts tests/eval-runtime-containment.test.ts tests/eval-runtime-image.test.ts
npm run validate
```

The focused suite uses fake semantic-judge executors only and makes no provider
request.

Final result:

- TypeScript typecheck passed.
- Node test suite passed: 191/191, including the fake contained semantic
  judge through grading seal and report rendering.
- Skill validation passed: 26/26.
- Package/install validation passed: 9/9.
- Plugin lifecycle validation passed: 4/4.
- Structural smoke passed: 8/8 attempts and 5/5 expected markers.
- `git diff --check` and every checked-in JSON schema parse passed.
