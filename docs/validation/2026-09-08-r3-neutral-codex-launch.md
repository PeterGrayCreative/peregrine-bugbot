# R3 neutral Codex launch contract

Date: 2026-09-08. Evidence: structural tests plus credential-free, network-disabled
runtime inspection. No model/provider invocation and no historical case run.

The experimental methodology path now carries a versioned neutral read-tool
policy into every sealed invocation intent. Codex launches with built-in
`shell_tool` and `unified_exec` disabled and exactly one `source_read` HTTP MCP
server exposing `list_tree`, `read_file`, and `search_text`. The containment
parser accepts only Sol high, the three methodology schemas, attempt-owned
outputs, read-only sandboxing, disabled ambient rules/configuration, and a
random-capability URL on `host.docker.internal`. Docker host-gateway mapping is
required only for this narrow profile. Legacy evaluation and production launch
profiles remain unchanged.

The read adapter now supports at most two independent initialized sessions so a
two-worker attempt can reuse one immutable source export without sharing MCP
session identity. The default remains one session. Docker host authorization
freezes before the first initialization.

Direct evidence:

- the accepted immutable image reports `codex-cli 0.152.0` under a network-none,
  credential-free version probe;
- that exact image parses the registered `source_read` URL and three-tool
  allowlist;
- Node 22 typechecking passed;
- focused methodology runner, containment, historical integration, and MCP
  protocol tests passed; mutation tests reject shell re-enablement, model drift,
  additional tools, altered host-gateway mapping, and external MCP hosts.

This does not establish provider contact, served model identity, effective
model-visible tool availability, destination-restricted provider egress, or
historical review completeness. A credential-bearing model canary remains a
separate authorization checkpoint.
