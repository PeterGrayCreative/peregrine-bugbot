# R2 sole-human governance and packet-response verification

Date: 2026-09-07

Status: structural implementation complete. No historical case was admitted,
partitioned, or sent to a provider.

## Result

R2 now has a versioned sole-human governance path without weakening the
existing two-curator contract:

- `protected-git-review-v1` and historical curation schema v2 retain their
  two-distinct-confirmation requirement;
- `sole-human-historical-v1` registers one accountable human identity,
  requires one exact approval, and declares that AI preparation cannot satisfy
  the human gate;
- historical curation schema v3 separates AI preparation evidence from the
  human decision and records truth-scope, case-bundle, packet, dossier,
  verified-response, response-decision, and source-dossier bindings;
- methodology case, runner, and grading-projection readers accept either
  historical policy version while preserving existing source/input checks;
- packet templates use hashed human identities and explicit `sole-human-v1`;
- a new response reader verifies immutable packet closure, dossier bundles,
  exact decision coverage, registered human identity, packet/dossier
  acknowledgements, attestations, timestamps, and response digest.
- a non-mutating admission builder consumes only that verified response,
  follows the dossier ID bound in the v3 draft, and emits new curation bytes
  for append-only persistence and mandatory re-read.

Response verification rejects missing/extra decisions, packet drift, unbound
packet files, wrong identities, false two-human claims, unsafe paths, symlinks,
and invalid packet/dossier hashes.

## Verification

All commands used Node `v22.22.1` from `.nvmrc`.

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run test:evidence-capture` | 11/11 pass |
| `npm run test:historical-truth` | 44/44 pass |
| `npm run test:methodology` | 94/94 pass |
| Focused historical-curation tests | 13/13 pass |

These tests use synthetic cases and responses. They establish structural
governance, byte binding, and fail-closed behavior only.

## Preserved boundaries

- One human remains one human; no independent-human claim is created.
- Registered identity hash is caller-trusted binding, not cryptographic
  signature or proof of who typed a response.
- AI reconstruction and integrity checks never count as human approval.
- V3 admission still requires complete case bundle and explicit approval. No
  draft was upgraded by this change.
- Packet verification does not prove causal truth, source completeness,
  protected selection, curator isolation, or sealed holdout status.
- The importer derives an append-only admission from the verified response,
  refuses to mutate the draft, and uses the dossier ID already bound by v3.
- Production prompts, routes, topology, models, posting, and defaults remain
  unchanged.

## Remaining R2 gate

Prepare complete one-time packet with sufficient defect and scoped-comparison
headroom, authenticate its full reference closure, then obtain user's explicit
per-card decisions. Admission/import and partition selection remain later
steps. Current recovered evidence still contains 30 draft proposals, nine
retained losses, and zero human decisions or admissions.
