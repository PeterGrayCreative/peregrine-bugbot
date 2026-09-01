# Test honesty, maintainability, and scope drift

<!-- manifest path-pattern: (test|spec|e2e|fixture|seed|mock|harness|__tests__) -->
<!-- manifest content-pattern: (test\.skip|it\.skip|test\.fails|it\.fails|xit\(|xdescribe|as any|eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error|pytest\.mark\.skip|#\[ignore\]|\.only\() -->

**Lane summary:** Tests prove observable behavior and persisted state, fixtures satisfy the contracts they exercise, and the PR does not silently absorb unrelated scope.

## Triggers

- new or changed tests, fixtures, seeds, helpers, generated artifacts
- files crossing 400 or 1,000 lines
- one test serially exercising many independent operations
- bespoke helpers or repeated conditionals appearing across modules

## Invariants

- Tests prove observable behavior and persisted state, not only mock calls or returned truthiness.
- Negative-path tests cannot pass without reaching the risky read or write ordering.
- Each independent operation can fail without preventing later coverage.
- Fixtures and harnesses satisfy the authorization and runtime contracts they exercise.
- New abstractions remove concepts or centralize a real policy.
- Ticket fixes do not absorb unrelated infrastructure without an explicit scope decision.

## Counterexamples

- a nonmember test omits the ID required to reach a later collision lookup;
- a denied mutation lacks unchanged-state readback;
- caller tests construct an impossible context and bypass real identity creation;
- a source-level test passes while the built image omits the required file;
- pure resolver tests pass while repeated HTTP route guards or production launchers are untested;
- one 1,000-line serial test hides which operation failed;
- a helper name implies resource authorization but performs only caller/path equality;
- repeated local resolvers encode different versions of the same scoping policy;
- a response-shape ticket grows into migration infrastructure without blocker/follow-up triage.

## Judgment boundaries

Treat naming as advisory unless it obscures a security or ownership boundary. Treat large files as structural findings only when mixed responsibilities or serial coverage create concrete regression risk.
