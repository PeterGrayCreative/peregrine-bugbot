# R2 collection progress

The research program resumed after the R1 checkpoint on 2026-09-05. R2 remains
in progress. No historical case is admitted by this collection step.

## Registered initial sampling frame

The first stratum samples 25 merged public PRs without selecting on comments,
defect labels, or outcomes. The collection protocol fixes eight repositories,
June 2019, a seed, within-repository hash ordering, and round-robin selection.
This is a purposive month/repository frame with reproducible sampling inside
it. It is not uniform sampling of all TS/JS history from 2017 through 2020.

Artifacts are under `artifacts/2026-09-05-r2-candidate-inventory/`:

- `collection-protocol.json`: sampling rules, 100-candidate ceiling, target
  source strata, exclusion taxonomy, and partition constraints.
- `random-sample-v1.json`: the first 25 candidates, all with unknown truth and
  unassigned partitions; source frame counts and capture receipts.
- `raw/objects/`: exact response bodies addressed by SHA-256.
- `raw/requests/`: exact GET parameters, source URLs, retrieval dates, lengths,
  and body hashes. Interrupted collection resumes verified captures.
- `random-context-v1.json`, when present: complete context-capture receipts for
  the sampled candidates. Its absence means this capture pass is unfinished.

Context retrieval includes PR metadata, inline comments, review bodies, general
discussion, commits, and changed files. Current API base/head values are leads;
they are not asserted to be contemporaneous historical review revisions.
Linked fixes and historical licenses require subsequent curation. Original and
updated timestamps and author/bot metadata remain in the raw source responses.
Any relevant comment edited after 2020 needs an archived original or exclusion
from strict historical evidence.

## Remaining work

1. Gather the other 75 candidates: target 50 substantive review threads and 25
   post-merge reports with linked fixes. Deduplicate against the random sample.
2. Reconstruct exact review opportunities, record curator hours and exclusions,
   and stop initial difficult reconstructions at two hours.
3. Curate toward 24 bug-bearing cases and 12 scoped comparison cases; preserve
   source-derived mechanisms, cross-file evidence, size variation, and duplicate
   families. Capture completion is not curation completion.
4. Obtain accountable independent confirmations. The R1 agent confirmations do
   not establish independent human adjudication for future model comparisons.
5. Protect selection identities/truth under curator control before writing or
   tuning prompts. Freeze partitions before model outcomes. No holdout claim is
   supported by a readable local directory.

The initial capture implementation has deterministic tests for interrupted
pagination, reuse of exact raw bytes, corruption rejection, truncated search,
and pagination ceilings. These establish collection behavior only.

Completed collection: 25 candidates across seven repositories, 17 discovery
responses and 150 context responses. Axios supplied no merged PR in the fixed
June window, so the registered round-robin rule proceeded with seven nonempty
pools. Both collectors replayed successfully from cached bodies without
changing either manifest. All changed-file counts matched the corresponding
PR metadata. Node 22 capture tests passed 3/3 and TypeScript checking passed.

R3 inspection confirms that the existing grader still labels completed misses
as infrastructure failures, and historical ground truth still requires a core
lane. Changes must introduce versioned semantics while retaining old artifact
readers; this inspection is not an implementation-completion claim.
