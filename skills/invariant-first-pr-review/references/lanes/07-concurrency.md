# Concurrency, performance, and resource use

<!-- manifest path-pattern: (worker|upload|batch|queue|job|cron|pool|stream) -->
<!-- manifest content-pattern: (Promise\.all|upsert|transaction|Buffer\.from|reduce\(|setInterval|P2002|unique constraint|IntegrityError|concurrent|race|aggregate|full.?scan|\b(lock|mutex|semaphore)\b) -->

**Lane summary:** Races are decided by the database, allocation is bounded before it happens, and hot paths do not scan growing tables.

## Triggers

- check-then-create, find-then-update, uniqueness pre-checks, budgets, cleanup
- single-writer database writes (e.g., SQLite), large arrays, uploads, buffers, unbounded lists
- repeated first-match queries whose predicates have no index
- sequential independent work or background polling

## Invariants

- Database constraints or atomic operations decide races.
- Expected constraint failures map to structured public errors.
- Hot query predicates have matching indexes when data can grow materially.
- Input is bounded before allocation and before entering long write transactions.
- Independent work is not serialized without a correctness reason.
- Cleanup queries and aggregate checks do not full-scan growing tables on every request.

## Counterexamples

- two requests pass a pre-check before one hits the unique-constraint error (e.g., Prisma P2002);
- oversized encoded input is decoded before its limit check;
- unbounded recipient or nested arrays hold a single-writer database lock;
- alias resolution full-scans a table on every route;
- request-time cleanup scans history without account/expiry indexes;
- a performance claim with no plausible growth path, query plan, or benchmark.

Do not report the final case as a defect. Ask for evidence or classify it as follow-up research.
