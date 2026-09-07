# R3 read-tool foundation

Date: 2026-09-07. Structural implementation only; not integrated with providers.

`eval/methodology-read-tools.ts` supplies strict synchronous `list_tree`,
`read_file`, and literal `search_text` functions over a caller-authenticated,
immutable source export. Required limits bound index entries, file bytes,
serialized JSON output bytes, and search matches. Configured namespace prefixes
and `.git` at every depth are excluded. A legitimate repository `auth.json`
is not rejected solely because of its filename.

Directory enumeration is incremental. File reads use bounded buffers, direct
regular-file checks, no-follow opening, fatal UTF-8 decoding, preserved BOM,
and binary-content rejection. Ordinary source drift and symlink replacements
are rejected through metadata fingerprints; these are not a sandbox against
hostile concurrent filesystem mutation or hard links.

Results distinguish complete indexed-export operations from incomplete,
truncated, and unavailable operations. These statuses do not prove model
understanding, complete review scope, or a clean PR. No raw shell execution,
filesystem writes, transport, provider calls, or production changes are added.

## Verification and review

Node 22.22.1 typecheck and six focused deterministic tests passed. The test is
included in `test:methodology` so normal validation/CI runs it. Cases cover
literal matching, exact UTF-8/BOM, legitimate source filenames, path traversal,
symlinks, namespace exclusions, binary/invalid text, all resource caps, JSON
escaping, missing paths, and export drift.

Independent review found search could miss a file added inside an indexed
empty directory while claiming completion. Search now checks scoped directory
fingerprints as well as files, with a regression test. Final read-only review
approved the corrected implementation; main reran focused tests/typecheck.

Implementation SHA-256: `f558a0a1ddbb990d2a21d3c8d4702e699cbd4cf6e05717d0bbf84bbb556d5c04`.
Test SHA-256: `f6f10e479eb5937c84a3e53e1ccae90c701b6651fb9a17c33d03948579ae754f`.

## Remaining boundary

This is only the proposed credential-free sidecar's read-function core. MCP
transport, runtime mount authentication, provider-only network access,
credential isolation, real tool availability, served model identity, and
runner-owned scope observations remain unproved/unintegrated. The earlier
failed credential-path canary remains a failure, not repaired by these tests.
Historical provider runs remain unauthorized. No new historical efficacy
evidence results from this slice.
