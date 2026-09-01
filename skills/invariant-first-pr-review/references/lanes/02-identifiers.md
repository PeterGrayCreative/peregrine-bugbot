# Identifier normalization and uniqueness

<!-- manifest path-pattern: (schema|model|account|router|resolver|lookup|slug|ident) -->
<!-- manifest content-pattern: (findFirst|findUnique|find_by|externalId|external_id|canonical|legacy|publicId|public_id|slug|@@unique|@unique|UNIQUE|collision|normalize|uuid|ulid|nanoid) -->

**Lane summary:** Every API-visible identifier resolves to exactly one resource through one normalization point, with blank, ambiguous, and colliding values handled explicitly.

## Triggers

- canonical internal IDs coexisting with external account numbers, public IDs, or slugs
- fallbacks between primary keys and public identifiers
- first-match lookups (`findFirst`-style) on an API-visible identifier
- new uniqueness constraints or collision pre-checks
- string identifiers later parsed as numbers

## Invariants

- Normalize once before authorization and persistence.
- Reject blank identifiers before any equality fast path or alias lookup.
- Detect ambiguous aliases rather than selecting the first row.
- Detect reverse collisions between canonical and external namespaces.
- Persist canonical representation unless a documented legacy scope is required.
- API-visible singular identifiers select exactly one resource.

## Counterexamples

- canonical ID, valid external ID, unknown external ID, and blank ID;
- two rows sharing an external ID;
- account A's external ID equals account B's canonical ID;
- legacy rows stored under the external identifier;
- public ID equals another row's internal primary key;
- leading-zero numeric strings such as `00` or `01`;
- caller-supplied ID reused concurrently or across accounts.

## Preferred designs

Use one shared resolver returning an explicit shape such as:

```ts
interface AccountScope {
  canonicalAccountId: string;
  persistedAccountIds: string[];
}
```

Make blank, ambiguous, collision, and legacy policies explicit in that resolver. Back frequently queried external identifiers with an intentional index and uniqueness policy.
