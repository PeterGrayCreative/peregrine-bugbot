# Prospective CLI-session prediction correction v1

Decision: retain the non-API Sol/high CLI-session route under a new, prospectively
registered resource contract. The original registration and approved execution
freeze remain unchanged. Their 120,000 aggregate / 16,000 output-token per-attempt
guarantees and exact served identity were **not met**, and are not retrospectively
relabelled as satisfied. No review-arm outcome or provider call preceded this
correction. This is prediction-only descriptive development, not calibrated truth.

## Local capability evidence

The local host binary is Codex CLI 0.154.0, SHA-256
`4f85982624b3898c8991cb80c0981b2aa71070e3537046c9a95950318a95afcc`.
Its help and compiled experimental protocol schema were captured without starting
a turn/server or inspecting credentials. `exec` advertises requested model and
JSON events but no hard total/output-token flag. The generated configuration has
context-window/auto-compaction settings; those are not cumulative expenditure
caps. Token-usage notifications are observations, not pre-dispatch reservations.
The checked-in engine consumes terminal usage only. This evidence does not prove
that no other implementation could ever provide hard caps.

The accepted contained runtime pins CLI 0.152.0 and is not locally present. Its
failed local image-inspection result is retained; no image was pulled. Host
0.154.0 is not substituted for the accepted runtime. Requested Sol/high is not
an authenticated served model/version. Both exact served fields remain unknown;
observable reroutes or deviations must be retained, never silently ignored.

## Fixed successor contract

- Keep all 16 cases and all 64 A/B slots in the original serial order. No retries,
  delegation, concurrency, source selection, prompt tailoring or arm reordering.
- Hard work deadline: 20 minutes starting **before preparation**, shared across
  reads and the one subprocess invocation. Expiry closes reads and sends SIGKILL
  through the existing execution boundary. Teardown remains mandatory after
  cancellation; record its duration separately and do not start another attempt
  until container/sidecar/network absence is proved. Cleanup failure blocks the
  batch. A safety cleanup overrun is not a successful within-budget attempt.
- Hard per-attempt source budgets remain 100 read calls and 2,000,000 returned
  UTF-8 bytes. Reuse the existing four-tool prediction reader, including literal
  `read_link`; the three-tool methodology MCP is not falsely called equivalent.
- Record terminal CLI input/output counters and available reasoning detail.
  Missing/ambiguous/incomplete usage is unknown, not zero. Requested settings and
  token observations do not establish exact backend identity or equal compute.
- Before outcomes, fix cumulative stopping thresholds at **7,680,000 reported
  input-plus-output tokens** and **1,024,000 reported output tokens** (64 times the
  predecessor's prospective allowances). Check after every terminal and before
  the next attempt. Stop at either threshold, unknown usage or unproven cleanup.
  An in-flight attempt can overshoot: retain and disclose it. These are batch
  stopping thresholds, not hard provider-token ceilings or per-attempt limits.
- Retain partial output, failures, all unstarted slots and the stopping reason.
  Report the observed prefix, missing suffix and arm exposure; do not present a
  selectively completed subset as a balanced or equal-compute experiment.

## Implementation and validation boundary

`eval/prediction-cli-session.ts` rebinds the original registration, records its
unmet guarantees, and evaluates exact serial prefixes using the existing terminal
usage parser. `eval/prediction-cli-deadline.ts` is a one-invocation deadline guard,
not a dispatcher or authorization capability. Optional deadline propagation in
the existing subprocess/container boundary leaves production defaults unchanged.

Node 22 typecheck, 31 prediction tests and 61 affected containment/engine/telemetry
tests passed. A real local subprocess was killed after an accelerated 1-second
test deadline; its partial output survived and a PID-absence check established
local process teardown. A separate regression proves the deadline signal reaches
contained execution but not its mandatory removal/absence checks. These are not
claims that the unavailable container or an actual provider agent was executed.

The first typecheck failed because the new registration used `returnedBytes`
instead of the existing `returnedToolBytes` constant; the field reference was
corrected before test execution. No test or old limit was weakened to pass.

Private `ai-exploratory/prediction-development-v1/cli-session-correction-v1/`
contains the local capability capture, additive registration, source bindings,
zero-provider initial ledger and durable cancellation probe. Independent gate,
accepted runtime availability, exact four-tool MCP attachment, authenticated
container/network cleanup and separate explicit dispatch authorization remain
required. `providerAuthorized` and `executionReady` stay false. Prior freezes,
rejections and the original Section 3 failure remain preserved.

## Deadline implementation successor

Independent review rejected public `b2ef213` / private `c464030`: `finish()`
could race a new invocation or another `finish()`, and failed `exec-start`
persistence could still invoke the runner. All three exact regressions failed
against that preserved version. The successor closes admission synchronously,
shares one terminal promise across concurrent/repeated finishes, and cancels
with zero runner invocations if the start record cannot be persisted. Cancellation
and cleanup records survive; the conflicting file is not overwritten.

Node 22 typecheck, all 34 prediction tests and the same 61 affected tests pass.
Private `cli-session-correction-v2/` preserves the rejected baseline test output
and adds versioned closure/collision probes and a successor source-bound freeze.
The scientific registration, batch thresholds and readiness boundary are unchanged.
