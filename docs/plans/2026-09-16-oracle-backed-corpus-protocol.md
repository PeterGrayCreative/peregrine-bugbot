# Oracle-supported historical development corpus

Date: 2026-09-16. Protocol: `historical-oracle-v1`.

This additive R2 path implements the executable/formal-oracle option in the
[calibrated evidence protocol](2026-09-12-calibrated-evidence-audit-protocol.md).
It supports the user's request to complete the corpus using existing evidence
and AI curation. Original packets, AI proposals, human-response templates,
curation v2/v3, and their readers remain intact.

Each admitted case needs a behavior oracle supported by the historical source.
Two separate AI review sessions assess whether the oracle expresses the stated
contract and executes the actual historical code. Their identities, configured
models, effort, rubric, timestamp, rationale, and evidence digest are retained
as AI records. These records do not establish human verification or statistical
independence. A label proposal or static trace alone cannot satisfy this path.

## Evidence required per case

| Case | Required oracle observations | Permitted claim |
| --- | --- | --- |
| Known roots | Original review base passes; original review head fails each registered behavioral assertion; later repair passes those same assertions | The stated historical change introduces or exposes the reproduced roots in the declared scope |
| Reviewed comparison | Original head passes the scoped contract; a documented negative control that removes the relevant protection fails | The tested protection holds in the declared scope; no global bug-free claim |

Preserve commit and tree identities, source provenance, exact reviewed diff,
recoverable source archive, runtime/dependency description, oracle program,
contract, commands, full logs and structured results. All artifacts are hashed.
The same oracle program must be used across the case's observations. Tests from
a later fix may run in the curator environment but remain outside review input.
For negative controls, retain the applied patch and its rationale separately;
they are synthetic sensitivity checks, never historical review opportunities.

An executable oracle must fail at the intended assertion rather than fail to
install, load, compile or start. Each observation names the asserted root IDs;
comparison checks use `comparison-scope`. Process status is 0 for a pass and 1
for the expected behavioral assertion failure. Preserve infrastructure failure
logs, but do not use them to admit a case. A formal oracle requires a real proof
checker, retained certificate, model of the historical code, and equivalent
machine-checkable outcomes. AI-authored prose is not a formal oracle.

The AI reviewers must inspect reachability, historical source fidelity, the
underlying contract, defect introduction/exposure, causal repair, and negative
control relevance where applicable. They must abstain if an extraction omits
essential context, a harness changes behavior, or the oracle merely encodes the
desired answer. Two sessions can share systematic model error; disclose it.

## Deterministic compilation

The curator-only [case schema](../../schemas/historical-oracle-case.schema.json)
and [observation schema](../../schemas/historical-oracle-result.schema.json)
have strict versioned fields. Artifact paths are relative to the private
evidence store. Review digests are produced by
`historicalOracleEvidenceSha256(record)`, excluding the `reviews` field.
Reviewers bind their decisions to that exact digest.

After actual execution and both reviews, create an array of case-file
references (`path` and SHA-256) and run under the repository's pinned Node 22:

```sh
node --import tsx scripts/evidence/compile-historical-oracle-corpus.ts \
  /absolute/private/evidence-store \
  /absolute/private/case-refs.json \
  /absolute/private/new-corpus-manifest.json
```

The compiler reads evidence and exclusively creates the requested manifest.
It never runs stored commands, calls providers, or overwrites an existing
manifest. Missing artifacts, altered bytes, wrong commits/trees, stale reviews,
uncovered roots, environment failures, duplicate cases/opportunities, and
protected-partition claims reject. Related opportunities may share an explicit
duplicate family; report family counts and keep them clustered in analysis.

The compiler verifies recorded evidence consistency. It cannot authenticate a
human's identity, prove that a log was honestly produced, or decide whether an
arbitrary assertion captures the intended real-world behavior. Those limits are
why retained executions and separate semantic reviews are required.

## Scope and remaining integration

Output is `oracle-supported-visible-historical-development` only, with partial
truth, `humanVerified: false`, and `independentConfirmation: false`. It reports
actual case/root/repository/family counts and imposes no artificial 36-case pass.
Corpus completion against the original 24/12 target remains a separate report.

This slice does not feed the existing sole-human R2 partition compiler or
authorize R4/R5. A later explicit adapter must preserve this evidence class
when assembling review inputs and grading truth. Reserved selection and fresh
confirmation remain separate collection/partition work. Source artifacts stay
in the private evidence repository outside reviewer mounts.
