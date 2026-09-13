# Sol-low operator v6: canonical observed-state graph

V5 (`14cd8a8` public / `06cb0a7` private) admitted contradictory helper
addresses, prefixes, network/endpoint identities and paused/restarting state.
Its freeze and all predecessors remain unchanged. Private
`sol-low-operator-v6/reproduction.json` retains 20 exact failing predecessor
regressions, including malformed CIDR suffixes.

One shared validator now serves runtime preparation and the low-route offline
assessor. It requires complete exact Config, State, HostConfig, NetworkSettings,
endpoint, Mounts and network/member schemas, with only enumerated no-access
default variants. Unknown, missing or contradictory fields fail closed. CIDR
parsing consumes the entire canonical address/prefix. Both helpers must be
running, not paused/restarting/dead/OOM-killed, with valid nonzero process IDs,
zero exit/error and consistent creation/start/unfinished timestamps.

The two helper/two network graph binds creation-command IDs to inspected IDs,
registered static `.2`/`.3` addresses, `/28` prefixes, `.1` gateways, network and
endpoint IDs, member names, MACs and namespaces. It reconciles command, launch,
inspect and client/sidecar/network cleanup order. Mechanical span cannot exceed
the whole-attempt duration (one millisecond allowance for separate wall-clock
and monotonic-clock quantization). Creation/stdout and inspect bodies are bound
to their authenticated receipts; records are not assessed independently.

## Producer boundary

Archived create-only container inspect proves the retained field names and
defaults, not a running container or network. Accepted image metadata separately
binds the image labels/config/manifest identities. Full running/network inspect
was not archived. Therefore the complete running/network profile is expressly
**prospective** and real-producer conformance remains unproven until the single
canary. The contract records that limitation. Real output must match before the
client runs. A mismatch retains failure/cleanup, consumes that one attempt and
requires a new version and authorization before retry; the same attempt cannot
relax the profile. Synthetic fixture fields are not reclassified as observations.

## Deterministic verification

Tests retain every previous rejection and cover the 20 exact V5 reproductions,
839 schema mutations (every retained nested object key), optional metadata/default
variants, strict address/date syntax and systematic cross-record identity/state/
chronology attacks. A synthetic producer mismatch proves zero client invocation,
retained receipts and uncancelled cleanup with restart denied. Fixture expansion
provides the required prospective profile rather than weakening negative tests.
The private validation logs record exact commands, source hashes and pass counts;
the successor freeze is reconstructed byte-for-byte before handoff.

No provider, Codex client, Docker/image operation or real attempt occurred.
Accepted runtime, original Sol-low amendment, Sol/high inputs, 16 mounts and 64
unstarted review slots remain unchanged. Assessment v6 grants no batch eligibility
or authorization. Readiness remains false and a fresh exact-freeze independent
gate is required.
