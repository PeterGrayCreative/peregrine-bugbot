# Runtime configuration, containers, and harnesses

<!-- manifest path-pattern: (Dockerfile|docker|compose|entrypoint|instrumentation|e2e|container|config|\.env|(^|/)ci(/|$)|\.github|circleci|gitlab-ci|jenkins|workflow|deploy|helm|k8s) -->
<!-- manifest content-pattern: (process\.env|env\.|getenv|ENV\[|ENABLE_|STRICT_|\bPORT\b|credential|bootstrap|cache|timer|interval|cron|locale|LC_ALL|feature.?flag) -->

**Lane summary:** One explicit runtime mode is resolved and consumed consistently by every producer and consumer — routes, containers, CI, harnesses, and documentation.

## Triggers

- environment variables, defaults, strict modes, feature or E2E flags
- Dockerfile, entrypoint, instrumentation, startup hooks, background timers
- container managers, ports, caches, locales, seeds, or test credentials
- CI jobs, internal API clients, operator runbooks, and release-artifact instructions

## Invariants

- Resolve one explicit runtime mode and consume it consistently everywhere.
- Startup bootstrap credentials are accepted by the route they call.
- Test-only behavior does not silently change unrelated production-like behavior.
- Source files required at build or startup exist in the produced artifact.
- Background cleanup runs without request traffic and does not keep processes alive.
- Parallel workers own disjoint resources.
- Hashing and sorting are deterministic across valid runtime locales.
- Every producer and consumer of a changed mode, credential, or default is accounted for.
- Operator documentation and shipped examples describe the mode the code actually resolves.

## Mode matrix

Check at least these rows; a project profile may add repo-specific harnesses as extra rows:

| Mode | Credentials | Route state | Cache | Seeding/bootstrap | Harness expectation |
|---|---|---|---|---|---|
| Development | explicit or documented fallback | enabled as intended | intended default | succeeds | local scripts work |
| Unit/integration | isolated test principal | deterministic | isolated | controlled | tests do not bypass context accidentally |
| E2E harness | explicit opt-in | enabled | preserve cache tests | succeeds | built image matches source assumptions |
| Production | explicit strong credentials | fail closed otherwise | enabled as designed | succeeds or aborts loudly | no fallback secrets |
| Bootstrap | temporary scoped credentials | reachable only while needed | irrelevant | succeeds | credentials cannot become steady-state auth |

## Counterexamples

- an E2E flag disables a cache required by a cache-persistence suite;
- the built image omits instrumentation or scripts copied explicitly elsewhere;
- the entrypoint sends credentials rejected by production classification;
- a standalone container harness lacks the flag or credentials its client uses;
- an unchanged launcher or CLI client still assumes a removed credential default;
- a pure classifier test passes while one repeated route guard is absent;
- a runbook or release README promises a production default the classifier rejects;
- a worker allocates beyond its reserved port range;
- a locale change alters sort order and therefore a schema fingerprint.

## Consumer closure

For every changed configuration key, resolver, shared flag, credential, or removed default:

1. Search the entire repository for the exact key, resolver name, and legacy literal.
2. Classify each match as a producer, consumer, launcher, client, test, CI path, bootstrap path, or documentation contract.
3. Put every runtime surface into the mode matrix, including unchanged standalone harnesses.
4. Do not close the lane until every match has a compatible value, an explicit exemption, or a finding.
