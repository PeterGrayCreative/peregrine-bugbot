# r1-vscode-73801: cleanup on service exit

Status: primary static analysis complete; independent curator confirmations pending
Class: TypeScript, review-caught defect
License: MIT

## Review opportunity

- PR: [microsoft/vscode#73801](https://github.com/microsoft/vscode/pull/73801),
  created 2019-05-15T23:51:00Z and merged 2019-05-17T18:55:32Z.
- Exact defect-bearing review head:
  `b239497ecacac5e5c945791530251f1ee897b22b`, tree
  `3f3fb544cd8cbe32db074e07f56b2c9bf54f632f`.
- Its parent is the reconstructable review base
  `0cfb9ad1c3a4ea5983c8dbb458ed14f7581a6846`, tree
  `6f44b1c65a56b58a8ac7c4819d0cab2d5088c143`.
- The PR API's later base SHA is not used for this intermediate review snapshot;
  it produces a 112-file drifted comparison. The commit parent produces the
  authentic four-file, 60-addition, 3-deletion change.
- Binary diff SHA-256:
  `dcbb98dee1b5e3c271b53067301bf5fad0a4ed64dd21acbe7cb9f5f4998a3db0`.

The author account and both reviewer accounts are GitHub `User` accounts; no
bot indication was observed. Authorship is historical provenance, not proof
that the code was unaided.

## Frozen root

The head adds `rimraf.sync(electron.getRootTempDir())` inside the TypeScript
server process-exit callback. That callback also runs when the service is
restarted. `getRootTempDir` is extension-wide and memoizes its directory, so a
restart deletes shared cancellation/temp state while the extension remains
active. A newly spawned service can then attempt to use paths under the removed
root. The smallest safe boundary is extension instance deactivation, or an
instance-specific directory whose lifetime matches the extension instance.

## Static trace and historical correction

1. `typescriptServiceClient.ts` registers the changed cleanup in the server
   handle's exit callback, immediately after `serviceExited` and restart-state
   handling.
2. The callback is therefore a service-process lifecycle seam, not an editor
   shutdown/deactivation seam.
3. `utils/electron.ts` memoizes the root path and `getTempFile` creates files
   below it.
4. Reviewer `mjbvz` identified the restart path in
   [discussion r284499651](https://github.com/microsoft/vscode/pull/73801#discussion_r284499651)
   on 2019-05-16 and explained that a restart with JS/TS files open can break
   cancellation-file creation.
5. The accepted PR removes cleanup from the service exit callback, adds
   `deactivate()`, and introduces `getInstanceDir()` below the root. Temp files
   move to the instance directory and deactivation removes that directory.

This is a complete static trace with contemporaneous reviewer and correction
evidence. No historical build was executed during R1.

## Scope and limitations

The frozen known root is cleanup at the wrong lifecycle boundary. The case does
not assert that the rest of the PR or repository is defect-free. The historical
VS Code toolchain was not reconstructed, so exact runtime reproduction remains
future optional evidence. A second accountable curator must independently
verify the trace before admission. The analysis author is not counted as a
formal curator confirmation.
