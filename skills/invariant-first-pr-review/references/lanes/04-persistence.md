# Schema, persistence, migration, and transactions

<!-- manifest path-pattern: (schema|prisma|migration|migrate|seed|entrypoint|\.sql|models\.py|structure\.sql) -->
<!-- manifest content-pattern: (@@unique|@@index|@unique|Json|JSONB|transaction|db push|migrat|backfill|dedup|fingerprint|persist|ALTER TABLE|CREATE (UNIQUE )?INDEX|NOT NULL) -->

**Lane summary:** Every valid pre-change database upgrades to a defined outcome, constraints account for legacy data, and multi-write actions are atomic.

## Triggers

- ORM schema changes (e.g., Prisma models), required fields, unique constraints, indexes, JSON columns
- changes to persisted identifier representation or ownership
- mounted databases, snapshots, schema push/migration commands, seeding, or schema fingerprints
- multiple writes that represent one user-visible action

## Invariants

- Every valid pre-change database has a defined upgrade outcome: migrate, backfill, deduplicate, or fail before serving.
- New required or unique constraints account for legacy nulls and duplicates.
- Persisted ownership is sufficient to enforce every read and mutation boundary.
- Related writes are atomic when partial state would violate a contract.
- Schema compatibility checks compare semantic structure, not incidental serialization.

## Counterexamples

- duplicate legacy rows before a new unique index;
- null legacy owner before an exact owner predicate;
- persisted volume or snapshot started under newer code without schema application;
- column order from `ALTER TABLE` differing from a fresh schema;
- database bookkeeping tables, locale, CHECK constraints, triggers, or views altering a schema fingerprint;
- an author reply claiming a migration commit that is absent from the PR head;
- first write succeeds and second fails, leaving partial user-visible state;
- JSON fields stored but dropped or replaced by placeholders in output.

## Scope decision

A hard-cutover deployment policy does not excuse silent corruption or ambiguous reads. Prefer a migration or a fail-before-serving guard. Treat compatibility shims as a separate, explicit decision.
