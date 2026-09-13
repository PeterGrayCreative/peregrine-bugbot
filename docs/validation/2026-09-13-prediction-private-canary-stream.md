# Prospective private-stream canary (post-canary V2)

The consumed Sol/low canary remains FAIL / not-eligible, with coordinator-relayed
evidence-integrity PASS, zero client launches supported by receipts and ledger
`providerCalls:null`. Its raw originals remain in restrictive local quarantine;
the immutable sanitized V1 archive and all predecessor freezes are unchanged.
No retry or review-slot/batch authorization follows from this correction.

## Gate failure and correction

V1's redactor could not establish a secret-free evidence boundary: transformed
capability strings could survive, and provider output reached a host file before
validation. This was an architectural assumption/insufficient-verification miss.
The missing evidence was an independent disk scan under arbitrary producer
streams. The rule is now omission of free-text streams, not a larger encoding
detector. Historical V1 code remains a rejected predecessor, not the future path.

The new registration does not inherit the consumed approval. Its command uses
`--json` and `--output-schema`, with no `--output-last-message` and no writable
host output mount. Existing bounded subprocess capture collects at most 4 MiB
combined stdout/stderr in process memory; overflow or invalid UTF-8 fails closed.
The reducer requires one closed session/turn, the unchanged gated item-ID and
lifecycle rules, four completed repository capabilities, terminal usage, and
exactly one final agent message matching an enum-only status schema. It persists
only that status, typed counters/enums, hashes and lengths. Reasoning, tool text,
IDs, stdout, stderr, errors/causes and arbitrary result fields are not serialized.
Failure retains typed metadata/hashes, not partial raw text. No file is retrieved,
so companion files or arbitrary credential/container paths are not an input API.

Mechanical receipts similarly select exact typed fields and one-way bindings.
Live argv and the full observed topology still pass through the existing strict
runtime validators before a client is admitted. Receipt byte inventory and phase
chronology are checked separately. The new assessor reports **metadata integrity
only**, never semantic containment proof or batch eligibility. Hashes cannot
reconstruct omitted raw inspect/tool bytes. Independently authenticated live
observation remains a mandatory, currently unavailable external requirement.

The fixed client URL is `http://mcp-forwarder:8082/mcp`. Only the host reader and
forwarder retain the upstream random capability; the forwarder injects its fixed
upstream path. The client gets an empty read-only workspace, schema-only assets,
no sidecar environment/PID/socket mount, and the existing isolated internal
network. Exact network membership and authenticated mounted-source binding are
unchanged; the nonsecret endpoint is not intended as a public Internet service.
This opt-in forwarder source is **not in the accepted predecessor image**.
The accepted forwarder and Dockerfile stay byte-identical. The new versioned
`methodology-mcp-forwarder-private-v1.mjs` and `Dockerfile.private-stream-v1`
preserve the tested base implementation; the full forwarder security suite runs
against both modules. This deliberate source fork preserves immutable acceptance
instead of changing its digest or weakening the existing source-pin test.
Real successor dispatch is blocked pending a new immutable image/helper
acceptance and fresh independent review plus explicit user authorization.

Archived CLI help makes the last-message file optional and separately describes
JSON events/schema output. Exact 0.152 producer conformance remains unobserved;
the prospective strict profile may fail and cannot be relaxed within an attempt.
Known route mismatch rejects; exact served backend identity remains unknown.
No encoding-detection completeness, equal-compute, elapsed provider-timeout,
actual client support, authenticated catalog or independent-observer claim is made.

## Bounded implementation and verification

1. Typed reducers and fixed endpoint → encoded-string and local HTTP fixtures.
2. File-free command/reducer using existing containment/deadline → synthetic
   success/failure, disk-before/after, cancellation and uncancelled cleanup tests.
3. Versioned registration/metadata assessment → default-deny, copied/cross-run
   authority, resealed route/scope, receipt bytes and phase mutation tests.
4. Exact public/private freeze reconstruction → original 16 mounts and all 64
   unstarted review slots; fresh independent gate before any later work.

This is the first coherent review checkpoint. The source-only successor can be
reverted independently without rewriting the consumed attempt or evidence.
No production defaults, old accepted image, original scientific prompts/caps,
historical assessor behavior or `.changeset` files are changed. The only shared
refactor extracts the existing item lifecycle validator without changing its
rules. New tests use injected executors, local HTTP and credential-free Node
children; no provider, Codex CLI, Docker, image, retry or batch is invoked.
Focused and full applicable validation logs/hashes are recorded in the additive
private V2 package. The initial invalid synthetic reasoning lifecycle and a
wrong lifecycle-helper return-shape assumption were corrected, not hidden by
loosening the retained validator.
Full validation also caught the accepted-source pin; the prospective change was
moved into the additive module/recipe, leaving the original assertion intact.
