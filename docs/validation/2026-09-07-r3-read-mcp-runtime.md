# R3 read-tool HTTP adapter and synthetic runtime probe

Date: 2026-09-07. Evidence: structural tests and a credential-free synthetic
protocol probe. No Codex/model/provider invocation or historical source execution.

## Implemented boundary

`eval/methodology-read-mcp.ts` wraps the existing read functions in a small,
single-client HTTP service. It supports initialization, the initialized
notification, ping, discovery/calls for exactly three neutral tools, and
cancellation acknowledgments. No shell, prompts, resources, SSE, or outgoing
MCP requests are exposed. It uses Node builtins and adds no dependency.

The pinned protocol is 2025-06-18. Unknown initialization versions negotiate
that supported version; subsequent requests require the negotiated header and
session. Exact Host/Origin checks, a random endpoint, one random session,
request/response byte limits, connection limits, per-run request counts, and
timeouts bound this experimental service. Random capabilities are not strong
authentication. Timers cannot preempt synchronous filesystem work; overdue
results are discarded, not described as hard CPU or filesystem deadlines.

The implementation follows the official MCP [transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
[lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle),
and [tool](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
contracts. OpenAI Docs confirms the intended [HTTP server and tool-allowlist
configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli); this test
does not establish Codex's effective configuration or model-visible catalog.

## Direct verification

Node 22.22.1 typecheck passed. Fourteen focused tests passed (eight HTTP and six
read-core tests). Loopback binding required the local sandbox approval path;
no provider access was involved. `test:methodology-http` adds those eight tests
to normal `validate`/CI. Independent read-only review approved the adapter and
the probe scripts within their declared experimental boundary.

## Actual two-container probe

The existing accepted arm64 image was verified by digest:
`sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`.
Both containers used only one temporary internal Docker network, no published
ports, read-only root filesystems and bind mounts, UID/GID 1000, dropped
capabilities, no-new-privileges, bounded memory/CPU/PIDs, and private tmpfs paths.
Container environments matched the image environment exactly; no host/provider
credential environment was added.

| Observed check | Result and scope |
| --- | --- |
| Client/source separation | Client mounted only its probe script and public dummy canary; source mounted only in tool container. |
| Tool-side credential absence | No client canary or configured Codex auth path in the tool container. No real credential mounted anywhere. |
| Source read/list/search | All three worked through initialized HTTP protocol; exact neutral catalog returned. |
| Source write and path restrictions | Synthetic source write denied; absolute/traversal/history tool reads rejected without revealing dummy canary. |
| Protocol rejection | Unknown tool, untrusted Origin, and wrong session rejected. |
| Network diagnostic | No IPv4 default route; one TCP attempt to `1.1.1.1:443` failed. Not an exhaustive egress proof. |

Exact configurations, stdout, compiled module bytes, scripts, source bindings,
and cleanup output are in the [artifact manifest](artifacts/2026-09-07-read-mcp-runtime/manifest.json).
All fourteen artifact bindings were independently rehashed by main. The trusted
capsule was compiled using TypeScript 5.9.3, NodeNext/ES2022, from the two bound
TypeScript modules. The test never mounted the implementation checkout or
curator evidence store inside either container.

Both disposable containers and their network were removed after capture and
their absence verified. Source files and all captured evidence remain. Captured
random protocol capabilities expired with cleanup. The logs are authored
experimental evidence, not independently signed runtime attestation.

## What remains

This establishes a useful isolated synthetic tool path, not historical reviewer
readiness. Integration still needs authenticated runtime launch/configuration,
actual Codex tool availability, provider-connected destination restrictions,
credential-bearing client isolation, runner-owned scope observations, and
grading/report consumers. A minimal model canary and historical experiments
retain separate authorization gates. The earlier broad read-only credential
canary failure remains valid; production/default launch behavior is unchanged.

Publication: implementation, probe bytes and report are pushed in
`2f5a919c82f38fb72a3d60634e6391c3238f02b6` on PR #32. The remote SHA matched;
GitHub `check` and credential-free build/smoke passed for that head. Independent
artifact review verified all fourteen file hashes, three source bindings, and
the exact manifest inventory against the captured configuration and outputs.
