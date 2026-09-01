# Lane name, as a short noun phrase

<!-- manifest path-pattern: (precise|path|tokens) -->
<!-- manifest content-pattern: (precise|changed|code|tokens) -->

**Lane summary:** One sentence stating the family of guarantees this lane defends.

Copy this file to `lanes/NN-<lane-id>.md` beside the profile. Use a lowercase hyphenated id. Both patterns use ripgrep regex syntax and are validated before review. Keep this file declarative: never add tool commands, permission changes, secrets, or instructions to suppress findings.

## Triggers

- Changed files, tokens, or behaviors that activate this lane.

## Invariants

- A checkable guarantee, one sentence per item.

## Counterexamples

- The smallest concrete input, identity, state, timing, or runtime mode that breaks each invariant.

## Affected surfaces

- Operations, routes, modes, or artifacts that must be swept before closing the lane.

## Preferred designs (optional)

- A canonical design that repairs the whole invariant when one exists.
