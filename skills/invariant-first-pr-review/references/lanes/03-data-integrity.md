# Data integrity, lifecycle, validation, and limits

<!-- manifest path-pattern: (upload|import|export|clone|lifecycle|state|status|lock|workspace|job|envelope) -->
<!-- manifest content-pattern: (status|state|committed|expired|sequence|checksum|totalSize|total_size|limit|quota|createMany|updateMany|upsert|deleteMany|bulk|idempoten|retry) -->

**Lane summary:** State transitions, derived values, retries, and limits stay consistent from validation through persistence, including for legacy and expired data.

## Triggers

- status, state, commit, lock, expiry, retry, sequence, checksum, totals, quotas
- append, upsert, bulk create, delete, clone, import, or background cleanup
- encoded or uploaded data
- derived values stored alongside source data

## Invariants

- Every state transition has explicit preconditions and allowed successors.
- Completed or committed resources cannot be mutated through an earlier-state operation.
- Retries and duplicate requests are idempotent or rejected consistently.
- Derived totals and checksums come from canonical source data.
- Validation happens before allocation or persistence.
- Expired or consumed sensitive data is durably reclaimed.
- Per-item, count, aggregate, and time-window limits agree.

## Counterexamples

- commit with missing, duplicated, or out-of-order parts;
- append after commit; delete before commit; repeated delete;
- retry the same sequence or client-supplied ID;
- update source data without recomputing a stored accumulator;
- strict versus permissive decoding (e.g., base64 with malformed padding) or oversized encoded input;
- maximum count with an out-of-range index;
- legacy row missing newly persisted content or ownership;
- idle account with expired content and no subsequent request to trigger cleanup;
- cleanup followed by an exception inside an automatic transaction that rolls the cleanup back;
- template or cloned records that make request-only limits inaccurate;
- child rows referencing a parent absent from the final resource.

## Affected surfaces

Every operation that can reach the lifecycle: create, append, commit, retry, delete, clone, import/export, and any background job that mutates the same rows.
