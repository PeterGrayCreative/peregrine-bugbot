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

1. Complete historical reconstruction and eligibility decisions for the frozen
   100 attempted slots. This count includes weak, duplicate, and after-window
   leads, not 100 authenticated defects or substantive human reviews.
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

## Targeted screening checkpoint

The frozen `candidate-inventory-v1.json` now contains 100 attempted slots:
25 comment-independent PRs, 50 review-target leads, and 25 post-merge leads.
The title-ranked discovery frame contains 8,453 review leads and 214 post-merge
leads across eight repository families. These are source-search results, not
admitted cases. Additional screening losses remain in the screeners' reports;
the 100 slots are not a claim that only 100 source records were inspected.

The main 25-review batch yielded 20 substantive correctness leads, two possible
scoped comparisons, one weak/performance-only lead, and two without substantive
evidence. Some substantive discussions describe escaped defects rather than
review-caught bugs. Actual event class will be bound during reconstruction.
The post-merge shortlist includes one known R1 duplicate (webpack #8829) and
one weak/deferred lead without a fixing identity (RxJS #3165). After-window
comments and edits remain explicitly restricted. No failed slot is replaced
silently, and no historical case is admitted by the inventory.

The first targeted query protocol stopped on an incomplete Next.js search.
Version 2 preserves it and subdivides incomplete years into months. A later
GitHub search-rate-limit response stopped collection; the run resumed from
verified cached pages with new search requests paced at 2.3 seconds. Every
accepted leaf validates total count and duplicate IDs. Incomplete source pages
remain archived. The transport error was observed in the execution transcript;
no raw error-response body was captured by the successful-response store.

Screening reports and their exact source stores are now in the repository.
`screening-sources/README.md` maps original scratch paths to the durable copies.
Integrity replay verified 772 request receipts and 686 raw response objects.
Run under Node 22:

```sh
node scripts/evidence/assemble-r2-inventory.mjs
node scripts/evidence/verify-r2-captures.mjs
```

Six exposed development reconstructions have started: Bull #537/#556,
webpack issue #10966, VS Code issue #112124, and Next.js #7363/#16126.
They include bug and scoped-comparison leads and cannot later be represented
as reserved validation. The final 12/24 split is not frozen. Selection control,
36-case admission, and independent human curation remain open.

## R3 measurement prerequisites

The audited benchmark-semantics branch at `da106fa` was merged locally as
`3840fa5`: sealed adjudication, versioned decisions, diagnostic reporting
restrictions, and versioned unattributed completed misses. Original seals and
prior results remain intact. Focused grading/adjudication/funnel tests passed
29/29 after integration; this does not establish full historical readiness.

A separate strict schema-v2 historical truth parser now permits partial
known-root and scoped-comparison evidence, source-derived mechanisms including
`other-unclassified`, separate reproduced/static proof, and exact metric
eligibility. Legacy readers reject versioned truth instead of erasing its
scope. Nine contract tests and typechecking pass under Node 22. Independent
code review caught and verified a correction to schema path bounds; the schema
explicitly requires the parser for duplicate IDs and cross-field line order. The contract
is not yet wired into historical admission, scheduling, grading, or reporting;
those consumers must preserve its restrictions before any provider run.
