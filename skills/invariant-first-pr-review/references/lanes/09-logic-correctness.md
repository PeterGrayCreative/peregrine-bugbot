# Logic Correctness

**Lane summary:** Trace ordinary control flow, data transformations, nullability, and boolean or arithmetic decisions that can produce the wrong result outside a specialized invariant lane.

<!-- manifest path-pattern: \.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|sh)$ -->
<!-- manifest content-pattern: (if[[:space:]]*\(|else|switch[[:space:]]*\(|case[[:space:]]|\?\?|\?\.|&&|\|\||return[[:space:]]|[+*/%]=?|===?|!==?|<=|>=) -->

## Triggers

- changed branching, predicates, fallbacks, comparisons, arithmetic, parsing, or transformation order;
- nullable or optional values crossing a boundary without an explicit outcome;
- a helper whose return semantics changed while callers retained old assumptions;
- inverted conditions, wrong operators, off-by-one behavior, or incomplete variant handling.

## Invariants

- Every reachable input variant selects the intended branch and result.
- Null, empty, false, and zero remain distinct when the contract distinguishes them.
- A refactor preserves evaluation order, short-circuit behavior, and return semantics.
- Exhaustive domain variants do not silently fall into an unrelated default.

## Counterexamples

Use the smallest input that crosses the changed decision boundary: the first/last value, an absent optional value, false or zero, an unknown enum member, or two values that compare differently before and after normalization.

## Verification

Trace the changed expression through one real caller and observable result. Prefer a focused behavior test over restating the implementation.
