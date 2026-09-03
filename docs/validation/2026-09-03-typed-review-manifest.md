# Typed review manifest shadow validation

Plan PR 6 adds a schema-v1 JSON shadow to the canonical review-manifest
producer. The existing human-readable stdout remains the only manifest content
sent to review models. Supplying `--json-output` writes the typed sidecar while
leaving those stdout bytes unchanged.

The typed manifest records resolved base, head, and merge-base provenance;
profile source and head-change warnings; changed-file status, rename origin,
line statistics, and binary state; per-file lane activation reasons; aggregate
lanes; trusted custom-lane sources; and complete base/head line-count evidence
for changed source files at or above the canonical 400-line threshold.
Repository profile policy still comes
from the merge base unless the caller explicitly selects a trusted external
profile.

Evaluation preflight strictly parses the shadow, checks changed-file, lane, and
large-file stdout semantics directly against typed fields, binds the typed base
and head commits to the reproduced history, checks profile provenance,
and persists a SHA-256-bound copy as evaluation metadata. Prompt construction,
model routing, and grading policy are unchanged.

## Local evidence

- Node: 22.22.1
- TypeScript typecheck: passed
- Core test suite: 144 passed, 0 failed
- Skill manifest tests: 26 passed, 0 failed
- Package/install tests: 9 passed, 0 failed
- Plugin-management tests: 4 passed, 0 failed
- Structural evaluation smoke: 8/8 attempts and 5/5 expected markers
- `git diff --check`: passed

The representative history suite covers additions, deletions, renames, binary
files, merge-base profiles, head-only/deleted profiles, Unicode paths, CRLF
patches, and SHA-1/SHA-256 repositories. A direct regression test confirms the
text-only and text-plus-JSON invocations return identical stdout bytes.
Additional seeded mixed-surface coverage exercises sixteen varied paths and
content-trigger families, and generated JSON is checked against the committed
schema as well as the stricter semantic parser.

The JSON helper consumes the producer's captured NUL-delimited status,
numstat, activation, and provenance records; it does not rerun Git discovery.
Text evidence is checked across status/stat output, lane inventories, large-file
counts, profile warnings, and custom-lane sources. Core lane IDs are captured
from the canonical lane records instead of duplicated in the JSON helper.
UTF-8 decoding is fatal, with explicit
coverage for tabs, newlines, invalid bytes, and replacement-character
collisions. Parser/schema parity tests reject slash or backslash traversal and
NUL paths, while artifact tamper tests reject independently rehashed typed
base/head commits that do not match the materialized history.
