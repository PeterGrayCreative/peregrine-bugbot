# R2 post-admission partition binding checkpoint

Date: 2026-09-09

Status: structural checkpoint complete; real R2 human review and partitioning remain open

## Delivered

The harness can now derive and persist an authenticated R2 partition artifact
after a sole human completes the existing review packet and approved cases are
imported as admitted historical curation v3 records.

The new contract:

- reauthenticates the immutable packet and complete sole-human response twice;
- requires the caller-registered human identity and a separate, self-digested
  partition attestation bound to the packet and response;
- treats that attestation as the sole authorized source of partition, case
  class, and duplicate-family assignments;
- re-reads every admitted case through the historical methodology reader and
  binds its registration, curation, case bundle, truth scope, repository
  identity, corpus, response decision, and dossier;
- requires exact coverage of approved dossiers while retaining rejected and
  unresolved response counts;
- derives the 12-case development split (8 bug, 4 reviewed comparison), the
  24-case selection split (16 bug, 8 reviewed comparison), duplicate-family
  containment, and the maximum nine cases per repository family;
- emits `insufficient-corpus` with exact deficits instead of relaxing gates;
- persists canonical append-only versions with predecessor and timestamp
  lineage, exclusive writes, historical digest reads, and strict rejection of
  symlinks, mixed files, tampering, stale sources, and concurrent writers; and
- records only sole-human assignment authority. It cannot claim independent
  selection or protected selection.

An approval containing a correction also now fails closed. A corrected case
requires a new packet/dossier version rather than silently changing the
reviewed evidence.

## Verification

Under repository-pinned Node 22.22.1:

- focused R2 partition suite: 7 passed, 0 failed;
- evidence-capture suite: 21 passed, 0 failed;
- complete `npm run validate`: passed;
- core suite: 295 passed;
- historical-truth suite: 44 passed;
- methodology suite: 218 passed;
- methodology HTTP suite: 13 passed;
- corpus validation, skill/package validation, and the eight-attempt mock
  structural smoke: passed; and
- Luna final review: no remaining P0 or P1 integrity finding.

The R2 partition suite intentionally lives in `test:evidence-capture`, which is
part of `npm run validate`; `npm test` alone does not run that specialized
suite.

## Evidence boundary

This checkpoint used generated fixtures and credential-free structural tests.
It ran no historical reviewer, semantic judge, or provider experiment and
produced no model-quality result.

The durable private packet at evidence commit `5d4969e46fdaff2dc36af53bd918d08150d3f7c4`
still contains 36 blank decisions. Therefore:

- no real historical case was admitted by this change;
- no real development/selection split or duplicate-family artifact exists;
- the selection partition is not protected or sealed; and
- R2 and the overall R1-R8 goal remain incomplete.

## Stop and resume point

Stop here. The next implementation slice is the operator-only truth/severity
binding from a real R2 partition artifact into a new inference protocol. It
must preserve legacy readers and keep dependence-aware intervals and severe
regression decisions unavailable until real authenticated inputs exist.

For the later two-repeat development screen, root detection remains descriptive
as 0/2, 1/2, or 2/2. The formal high-severity regression gate is reserved for
three-repeat confirmation: baseline C at least 2/3 and treatment D at most 1/3.
No provider work is authorized by this checkpoint.
