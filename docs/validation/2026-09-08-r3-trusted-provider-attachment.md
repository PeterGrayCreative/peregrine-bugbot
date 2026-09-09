# R3 trusted methodology provider attachment

Date: 2026-09-08. Evidence class: structural/mock. No provider or historical
review experiment was run.

## Result

The historical methodology runner now accepts only a branded attachment built
by the repository-owned factory. The factory:

- binds the accepted immutable runtime image and `methodology-review` profile
  to the exact materialized checkout, arm-specific assets, and attempt output;
- starts a fresh bounded read-only MCP service over that exact checkout;
- marks that MCP service required, so Codex cannot silently continue without
  the registered read/search capability;
- freezes the request before any observer or attachment code can replace a
  provider-visible root;
- persists a v2 invocation reference containing the authenticated source tree,
  effective-root digest, runtime/profile/access identity, limit digests, and
  attachment digest;
- seals the provider-output byte limit and distinguishes real launches from
  structural mock executors, which cannot count as provider proof;
- limits A/B to one MCP session and C/D to two, then closes the service before
  deleting the materialized checkout; and
- rejects structurally similar attachments, cross-request reuse, mutable
  request drift, wrong roots, wrong source identity, and wrong runtime fields.
- replaces the MCP bootstrap Host allowlist with the exact post-bind Docker
  authority instead of leaving the placeholder authorized.

An independent Luna review found mutable-root substitution and failed-validation
listener-cleanup gaps in the first integration. The final implementation freezes
both request layers, requires the branded attacher before the lifecycle begins,
and retains any returned attachment before validating it.

## Verification

Under Node 22:

- TypeScript typecheck passed.
- The complete methodology suite passed 161/161 and the MCP HTTP suite passed
  9/9.
- The MCP integration read the expected file from the exact exported checkout.
- `git diff --check` passed.

The full `npm run validate` sequence passed from the clean implementation
commit under Node 22, including its clean-worktree provider guards.

## Remaining limits

This proves factory wiring and artifact binding only. It does not establish
provider contact, served-model identity, credential isolation, effective
provider-connected read/search behavior, destination-restricted egress, or
review completeness. The provider still uses Docker bridge networking without
an independently attested destination allowlist. A credential-bearing canary
requires separate authorization and remains an R3/R4 blocker.
