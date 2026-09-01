# Frontend State and Effects

**Lane summary:** Trace derived state, effects, closures, optimistic updates, and asynchronous UI transitions so rendered state stays synchronized with the authoritative source.

<!-- manifest path-pattern: (components?|pages?|app|ui|hooks?)/.*\.(tsx|jsx|ts|js)$|\.(tsx|jsx)$ -->
<!-- manifest content-pattern: (use(State|Effect|Memo|Callback|Reducer|Ref)|set[A-Z][A-Za-z0-9_]*\(|optimistic|invalidate|mutation|queryClient|Promise\.all) -->

## Triggers

- changed hook dependencies, derived state, memoization, effects, subscriptions, or cleanup;
- optimistic mutations and rollback/invalidation logic;
- asynchronous event handlers that capture mutable state;
- duplicated server and client sources of truth.

## Invariants

- Rendered state derives from the current authoritative input, not a stale closure or copied prop.
- Effects run for every dependency that changes their behavior and clean up the matching subscription or request.
- Optimistic failure restores the exact prior state and success reconciles with the server response.
- Out-of-order responses cannot overwrite newer user intent.

## Counterexamples

Change a dependency after the first render, issue two requests in reverse completion order, reject an optimistic mutation, unmount during work, or switch identity while cached state remains.

## Verification

Trace the state owner, event/effect closure, async completion, cache update, and rendered result. Require a user-observable failure rather than a generic hook-rule complaint.
