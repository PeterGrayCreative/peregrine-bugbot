# Prediction runtime boundary: reader complete, Docker gate blocked

This additive section starts at public `b2faedf7137bbeeb9714a3444f873cc260524078`
and private `fdc233dd96a8fd971be96457b9542792cbbdf5a1`. No provider/model command,
credential inspection, production-route change or review attempt occurred.

## Implemented boundary

`attachPredictionReadTools` authenticates the original registration, approved
mount manifest and the scheduled case's full repository-only source closure.
It attaches exactly `list_tree`, `read_file`, `search_text` and literal
`read_link` to the existing neutral HTTP MCP transport. The legacy review API
still exposes three tools. No curator files, method resources, shell or outgoing
request tool is available. Both arms inherit the same 100-call / 2,000,000-byte
reader, including failed calls; transport overhead has a separate fixed cap.
Whole-attempt closure rejects reads and closes the listener.

The sidecar adapter accepts the existing endpoint's capability token and passes
the optional whole-attempt cancellation signal through setup, never mandatory
cleanup. Production callers and routing defaults are unchanged. Real probes
reproduced two readiness defects: `docker logs --since 0s` excluded retained
startup output, and the gateway does not emit the forwarder's `ready:true`
field. The correction checks the pinned entrypoints' actual protocol/host/port
records; it does not weaken topology inspection or sealed-audit requirements.

## Actual image evidence and stop

Existing Docker authentication successfully pulled the accepted digest
`sha256:d62b740e61ef05f0813531544e5de89ce76e2eb4a8d55248d9f364b9afd7a171`.
A separate credential-free, network-disabled inventory observed Node 22.22.1,
Codex package 0.152.0 and 14 immutable runtime/client files. The gateway and
forwarder bytes match the checked-in source. This is not a CLI session or
authenticated served model/version; both served fields remain unknown.

Four create-only topology probes are retained in private
`ai-exploratory/prediction-development-v1/runtime-boundary-v1/`:

- Attempt 1 failed before the client started. Its 20-second accelerated timer
  fired after roughly 915 seconds; the cause of that lateness is unestablished.
  Its cleanup-success field was erroneous because the initial harness swallowed
  a setup cleanup error. That artifact and exact source archive are rejected,
  not repaired or used as deadline/cleanup proof.
- Attempts 2–4 retain setup cleanup failures as unproven. They terminated in
  roughly 12 seconds, before the accelerated deadline. Attempt 3 exposed the
  exact gateway wire mismatch; attempt 4 passed gateway readiness but the pinned
  forwarder emitted `methodology MCP forwarder failed` and supplied no valid
  sealed audit. Its underlying startup cause remains unestablished.

No topology probe reached the fixed Node client, much less a provider agent.
Post-probe Docker listings found no remaining probe containers or networks, and
the offline inventory container's exact absence was checked. Absence alone does
not repair the missing forwarder audit. No image was rebuilt or substituted.

## Validation and remaining gate

Node 22 focused tests cover exact four-tool metadata, literal links, no source
following/leakage, hash/content tampering, failed-call and byte ceilings, listener
cancellation and shared cleanup. Existing deadline tests retain real local
process-kill evidence; they are not whole-container proof. Private validation
records bind commands, output and the complete local runtime source closure.
The shared fixture was extracted without changing the earlier preparation
assertions; readiness fixtures now use the actual pinned entrypoint records.

Final focused validation passed typecheck, client syntax, all 41 prediction
tests, 13 HTTP tests and 114 affected reader/egress/attachment/containment/
sidecar/engine/telemetry tests. An earlier broad methodology invocation ended
nonzero with incomplete TAP under its 180-second runner bound; it is not called
green. The first affected-surface run had two stale Docker-stub wire fixtures;
their correction and the passing successor are retained alongside that failure.

The current section is ready for independent review of deterministic attachment
and its preserved failures, **not** runtime acceptance. The pinned forwarder's
startup/audit failure, actual container/descendant termination, complete
sidecar/network teardown, and eventual explicitly authorized CLI attachment
remain open. The registered 20-minute work deadline and terminal-token/batch-stop
contract are unchanged. All 64 review slots remain unstarted;
`providerAuthorized` and `executionReady` remain false.
