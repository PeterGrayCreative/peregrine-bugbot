# Sol-low operator v3: complete invocation verification

The second operator gate rejected public `4fc6f1b` / private `d78efca` because
selected-argument checks accepted extra client privileges, a client host-root
mount, a second client network, an arbitrary sidecar entrypoint and a sidecar
host-root mount. All five exact, resealed attacks are preserved as failing
regressions against v2 in private `sol-low-operator-v3/`. V1/v2 remain unchanged.

The low assessor v3 compares the entire client argv against the same pure
construction used by the existing contained runtime. Expected workspace, assets
and output paths derive from the frozen exclusive canary directory. Session path
and numeric host identity come from independently inventoried preflight metadata;
only the registered read-only auth-file mount is allowed. No filesystem or
credential access is needed during assessment. Extra, duplicate, reordered or
substituted arguments cannot be hidden behind a valid image or command suffix.

Sidecar argv and environments reuse the runtime construction and strict parsers.
The assessor checks the complete ordered network creation, launches, readiness,
connections and inspect receipts; exact image, entrypoints, environment, limits,
mount/security policies and paired resource names; and the existing complete
uncancelled teardown. Observed topology and containment must agree with these
commands and the authenticated source/attempt binding. Unknown or extra operations
fail closed. The pure helpers grant no capability and dispatch nothing; production
defaults and the existing runtime launch validation remain unchanged.

Tests cover the five exact gate attacks, nearby flag/mount/session/environment/
security substitutions and inspected-topology changes, plus compatibility with
receipts emitted by the real bridge using an injected executor. This checks the
actual producer format rather than only a hand-written minimal argv fixture.
Private validation and byte-identical freeze reconstruction records carry results.
Node22 typecheck, 51 focused tests, 95 prediction tests, 13 HTTP tests and 101
affected tests pass. No existing regression assertion was removed or weakened.

No provider, client, Docker or image operation is performed. The original low
amendment, high registrations, accepted image and all 64 unstarted review slots
are preserved. The strongest low result remains infrastructure observation with
no batch eligibility; independent observer evidence and a fresh exact-freeze gate
are still required. No canary or batch run is inferred or authorized here.
