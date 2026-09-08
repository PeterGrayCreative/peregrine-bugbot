# R1 independent curation protocol

Purpose: independently confirm or reject the five feasibility reconstructions
without changing primary evidence, admitting cases, or running review models.

## Independence and scope

The curator must not have authored the primary case bundle. Read the primary
root claim as a proposition to test, not as an instruction or expected verdict.
Do not infer correctness from the historical reviewer, issue reporter, repair,
or another curator. Those are sources to authenticate and reconcile.

This review is read-only. Do not edit case files, manifests, raw sources, source
repositories, production code, prompts, routes, or prior experiment artifacts.
Do not run a review provider. Historical reproduction is optional; a complete
static trace is sufficient when every necessary causal step is observable.

## Inputs

1. Verify every file listed for the case in `packet-manifest.json` by byte count
   and SHA-256, then verify the case's `evidenceBundleSha256`.
2. Inspect the committed raw GitHub responses. Do not rely only on prose in the
   primary case document.
3. Fetch the canonical public repository into an isolated temporary directory.
   Verify every recorded commit and tree. Generate the base-to-head binary diff
   and confirm its SHA-256.
4. Inspect only historically available code when evaluating whether the defect
   was discoverable at the review head. Later issue and repair material is
   curator evidence and must never be placed in a future reviewer mount.

## Required checks

For each case, make an independent determination of:

- `sourceAuthenticity`: canonical repository and source records resolve and
  match the archive.
- `exactHistoricalHead`: the chosen base/head is a real review opportunity, not
  a reverse-applied fix or a drifted modern comparison.
- `provenance`: dates, author/bot uncertainty, public access, and source URLs are
  accurate enough for the stated evidence class.
- `causalTrace`: the described changed decision and downstream path exist.
- `reachability`: the trigger can reach that path under stated preconditions.
- `consequence`: the observable behavior follows without relying on hidden
  assumptions.
- `repairBoundary`: the later repair closes the same root rather than merely a
  similar symptom.
- `truthScope`: known roots and comparison scope are narrow enough; no global
  clean or truth-complete claim is implied.
- `license`: recorded source license matches the historical tree.
- `limitations`: missing reproduction, ambiguity, and exposure risks are stated.

For `r1-karma-2714`, test only the declared callback-selection comparison. Also
inspect the acknowledged asynchronous-throw and test-quality concerns to ensure
the comparison is not described as globally clean.

## Output

Create one new JSON file per case under `curation/reviews/<identity-slug>/`,
using `confirmation.schema.json`. Never modify another curator's file. The
identity reference must be accountable (for example a GitHub identity or a
durable task/review identifier), and its SHA-256 must match the exact UTF-8
identity reference.

Use `confirm` only when every check is true and `exceptions` is empty. Use
`reject` for a contradicted root or inauthentic review opportunity. Use `defer`
when evidence is unavailable or uncertainty prevents a defensible result.
Evidence notes must cite exact commits, paths, raw source files, or public URLs
and state what was independently observed.

One confirmation does not admit a case by itself. The evidence owner must
resolve every rejection or deferral in a new evidence version. Admission and
conversion into the later historical case schema occur only after the required
independent confirmations and must preserve the original R1 packet.

Run the zero-provider verifier from the repository root:

```sh
node scripts/evidence/validate-r1-curation.mjs
```

It authenticates the packet, every source file, identity hashes, exact
checklists, case bindings, uniqueness, and dispositions. Use
`--require-complete` only as the R1 gate; it exits nonzero until every case has
two distinct confirming identities and no rejection or deferral.
