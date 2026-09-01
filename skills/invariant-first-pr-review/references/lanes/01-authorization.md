# Identity, authorization, and tenant isolation

<!-- manifest path-pattern: (auth|account|tenant|org|group|permission|role|user|session|token|middleware|guard|policy) -->
<!-- manifest content-pattern: (accountId|account_id|userId|user_id|tenantId|tenant_id|orgId|org_id|principal|membership|ownership|role|permission|owner|credential|authoriz|authentic|session|scope|publicProcedure|protectedProcedure|current_user|IsAuthenticated) -->

**Lane summary:** Every read and mutation is authorized against a verified principal, within the correct tenant boundary, before any state is disclosed or changed.

## Triggers

- account, user, organization, group, or parent/child resource identifiers
- route or procedure builders that differ in authentication (public vs protected variants), request context, headers
- membership, ownership, role, administrator, permission-profile, or self-access checks
- query filters added for account or user scope

## Invariants

- The principal is derived from verified credentials, not merely a present or caller-controlled identifier.
- Authorization occurs before any domain read that could disclose existence or collision state.
- Membership, ownership, and administrator permission are distinct policies.
- Child resources are scoped through every parent boundary.
- Rejected mutations leave persisted state unchanged.
- A caller cannot manufacture the membership or ownership fact later guards trust.

## Counterexamples

- no credentials; forged identity header; missing user; seeded/default user fallback;
- active-account member; secondary-account member; no membership;
- same-account peer accessing another user's resource;
- ordinary member calling an administrator-only operation;
- nonmember requesting an existing versus nonexistent child ID;
- resource ID valid in another account or parent;
- an unauthenticated creation route used to manufacture membership before a protected operation;
- authorization added after a collision, lookup, or mutation-prerequisite read.

## Affected surfaces

Check every list, detail, create, update, delete, bulk, nested, binary, and sibling route. Include mutation readback for denied writes.

## Scenario checklist for account-scoped changes

Always exercise: canonical ID, external ID, blank ID, ambiguous ID, active member, secondary-account member, nonmember, same-account peer user, and nested resource. A project profile may extend this list with repo-specific scenarios.
