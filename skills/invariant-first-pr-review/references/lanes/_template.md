# Lane name, as a short noun phrase

<!-- manifest path-pattern: (regex|matched|against|changed|file|paths) -->
<!-- manifest content-pattern: (regex|matched|against|changed|diff|hunks) -->

**Lane summary:** One sentence stating the family of guarantees this lane defends.

Authoring rules: copy this file to `NN-<lane-id>.md` (next free number; the id becomes the key profiles use to extend this lane). Keep the two manifest comments on their own lines directly under the heading — the manifest script extracts them verbatim as ripgrep regexes, and a lane with stale patterns silently stops surfacing files. Keep patterns stack-generic here; put stack- or repo-specific tokens in a project profile instead. Everything below drives the reviewer, so favor concrete triggers and the smallest counterexamples over prose.

## Triggers

- Changed files, tokens, or behaviors that activate this lane.

## Invariants

- The guarantees that must hold, one sentence each, written so a violation is checkable.

## Counterexamples

- The smallest inputs, identities, states, timings, or runtime modes that would break each invariant. These are what the reviewer actually executes mentally (or in tests).

## Affected surfaces

Which operations, routes, modes, or artifacts to sweep before closing the lane.

## Preferred designs (optional)

Canonical shapes that resolve the whole lane at once, when one exists.
