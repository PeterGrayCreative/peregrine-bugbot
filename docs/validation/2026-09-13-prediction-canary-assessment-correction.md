# Canary assessment v2: evidence-integrity correction

Independent review rejected public `1aa1474` and its private assessment-v1
evidence: an unfinished `item.started` read could coexist with four completed
reads, and an otherwise valid search could carry additional unauthenticated hits.
Both defects were reproduced before correction (4/6 focused groups passed).
The rejected commit and private evidence are preserved unchanged.

The v2 assessor correlates source-read starts, updates and completions by unique
ID and exact server/tool/arguments. Orphaned, duplicate, unfinished, mismatched
or failed dispositions are ineligible. Every search hit must match a full source
byte witness in authenticated `observer/tool-calls.json.searchSources`, shaped
as `{path, bytes}`. Witness byte length and SHA-256 must match a regular file in
the frozen mount; every hit's exact path, one-based line and literal-containing
text must match that source and the requested search scope. This also validates
extra hits and hits in incomplete responses, not only the required diff hit.
Witnesses are observer evidence, never added model inputs or extra read tools.

Positive controls retain native-link/refusal paths and add multi-file search and
in-progress updates. Negative controls re-pin and re-seal the entire candidate
inventory, stream, transcript and audits where appropriate, so rejection does
not depend on a stale outer hash. Validation is retained additively in private
`canary-assessment-v2/`; no predecessor artifact is overwritten.
Node22 typecheck, all 59 prediction tests (7 assessor groups), 13 HTTP tests,
101 affected reader/runtime/engine tests and diff checks passed.

No provider, CLI client, Docker or image operation is performed. Original Sol/high
registration, all 64 unstarted review slots, accepted runtime and production
routing are unchanged. Missing actual observer evidence remains `not-eligible`;
the batch guard still always denies and readiness/authorization remain false.
