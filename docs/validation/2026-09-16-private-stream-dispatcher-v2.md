# Private-stream observable canary dispatcher V2

Status: source implementation only. No Docker command, provider request or canary was run while preparing this change.

## Why V2 exists

The independently reviewed V1 dispatcher remains preserved at public commit
`bc5be2e820173ac9e2daa3a60edb27ea53163ea3` and private evidence commit
`5d43bace30609578d9fbbc9c1a1c27afdd8aa93a`. Its gate failed because Codex CLI
0.152.0 does not expose an independently authenticated provider-served model,
provider request count or complete hidden/client catalog. V2 does not manufacture
those facts and does not add a proxy observer to infer them.

V2 is a separately versioned evidence contract for one Sol-low infrastructure
canary. It cannot establish bug-finding quality, skill value, comparative cost or
production readiness. Those questions belong to the later paired methodology
experiment.

## Retained evidence

| Requirement | V2 evidence |
| --- | --- |
| Requested route | Exact `gpt-5.6-sol` / `low` request, CLI-session access |
| Runtime identity | Codex CLI `0.152.0`, accepted immutable image digest and source commit, exact public/private/source/runtime-input bindings |
| Work | Complete bounded CLI event lifecycle; terminal input/output tokens; cached, cache-write and reasoning counters when present; aggregate is input plus output |
| Repository access | All four registered read tools must complete; the existing runtime compares CLI calls with the bounded trusted reader transcript and preserves only typed counts and hashes |
| Time | One 1,200,000 ms monotonic deadline starts before preflight and covers setup and execution; abort precedes uncancelled cleanup |
| One use | Durable state directory and fsync precede client launch; no clearing or retry API exists |
| Cleanup | Reads close, client and sidecars are absent, networks are absent and temporary session data is removed before success |

The terminal always records these as unavailable: provider-served identity,
provider request count, dollar cost and complete hidden/model-visible catalog.
A client launch is not relabeled as a provider request. CLI terminal usage is
identified as CLI-reported work, not independently authenticated billing data.

## Scope and safety

- V1 remains the default for its historical callers. The only shared change is
  an optional successor hook in the runtime adapter; absent that hook, V1 uses
  its original permission consumer and stream reducer.
- V2 has only `--preflight` and `--canary` modes. There is no review, retry,
  batch or production path.
- The runtime still uses the accepted private image, isolated authenticated CLI
  session, tokenless fixed MCP endpoint, read-only empty workspace, schema-only
  assets, bounded output, disabled client logs and mandatory topology cleanup.
- Raw CLI, model, tool-response, credential and error text is never written to
  durable V2 evidence. The reducer retains enums, numeric counters and one-way
  bindings only.
- A fresh exact Astra-medium gate, clean committed public/private sources and
  operator-provisioned runtime inputs remain prerequisites. This source change
  itself authorizes and executes nothing.

## Verification plan

Under Node 22, run the focused V2 tests, the V1 dispatcher suite, affected
prediction-safe-canary/runtime/publication suites, typecheck, package/static
validation and immutable predecessor replay. Denial shims must prove that no
validation step invokes Docker, Codex, Claude or a provider. The exact public
commit, source closure, private freeze, validation terminal and reconstruction
will be recorded in the private evidence repository before independent review.
