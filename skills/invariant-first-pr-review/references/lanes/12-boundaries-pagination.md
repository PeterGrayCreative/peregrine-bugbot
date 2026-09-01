# Boundaries, Pagination, and Ordering

**Lane summary:** Verify collection boundaries, cursor/offset movement, sort stability, limits, and first/last/empty-page behavior across API, storage, and UI layers.

<!-- manifest path-pattern: (list|search|query|pagination|cursor|table|grid|feed|collection|repository|router|controller) -->
<!-- manifest content-pattern: (page(Size)?|limit|offset|cursor|hasNext|hasPrevious|nextPage|previousPage|orderBy|sort|take|skip|slice\(|length[[:space:]]*[<>]=?) -->

## Triggers

- changed collection limits, cursor encoding, offset math, sort keys, filtering order, or page metadata;
- first/last indices or inclusive/exclusive range changes;
- unstable ordering across equal primary sort values;
- empty results, deleted cursor rows, or page-size extremes.

## Invariants

- Every eligible item appears exactly once across consecutive pages under a stable snapshot.
- Page metadata agrees with the returned items and the next request boundary.
- Limits are validated consistently and cannot cause unbounded work.
- Ordering is deterministic, including ties and null values.

## Counterexamples

Use zero and one item, exactly one full page, one item beyond a full page, tied sort values, a deleted cursor row, an empty page, and minimum/maximum/invalid limits.

## Verification

Trace request parsing through query ordering and response metadata. Check both forward and backward transitions when supported and distinguish snapshot-concurrency limitations from deterministic boundary bugs.
