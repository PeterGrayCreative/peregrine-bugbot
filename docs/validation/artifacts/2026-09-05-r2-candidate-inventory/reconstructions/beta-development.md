# R2 Next.js beta development reconstructions: PR #7363 and PR #16126

Date: 2026-09-05  
Repository family: `vercel/next.js`  
Exposure: historical development material; never reserved selection, confirmation, or holdout evidence  
Status: primary reconstruction and static trace complete; no admission or independent curator confirmation

## Scope and method

This record reconstructs only two previously screened review opportunities:

- [vercel/next.js#7363](https://github.com/vercel/next.js/pull/7363), a review-caught MIME/body-parsing defect; and
- [vercel/next.js#16126](https://github.com/vercel/next.js/pull/16126), a narrowly scoped comparison about `Promise.all` versus `Promise.allSettled`.

Both are exposed development material in the same repository family. They are
not independent transfer evidence from one another. No new candidate was
selected. Nothing in this document admits a case, assigns a reserved
partition, supplies an independent confirmation, or makes a repository-wide
clean claim.

I captured PR metadata, inline comments, reviews, commits, and changed-file
lists from the public GitHub core API into
`/private/tmp/peregrine-r2-beta-reconstruction/api/`. A separate core API
capture authenticates the correction dependency's source at tag `v1.0.4`.
All eleven immutable successful request
receipts authenticate their stored response length and SHA-256. A read-only
filtered clone of the canonical `vercel/next.js` repository is at
`/private/tmp/peregrine-r2-beta-reconstruction/next.js/`. Canonical diff bytes
are stored under `/private/tmp/peregrine-r2-beta-reconstruction/diffs/` and
were generated with Git `2.50.1 (Apple Git-155)`, `LC_ALL=C`, `LANG=C`,
`TZ=UTC`, and:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

The historical checkout declares the MIT license in `license.md` at both
review heads: copyright ZEIT, Inc. at the 2019 head and Vercel, Inc. at the
2020 head. GitHub reports the PR authors and cited comment authors as API type
`User`, not `Bot`. That metadata does not establish unaided human authorship.
Each cited inline body has `updated_at > created_at`; the update is within the
2017–2020 window, but the current API is not an edit history.

## Opportunity 1: PR #7363 MIME/body parsing root

### Historical identity

- PR “API interface extensions”, authored by `huv1k`, created
  `2019-05-16T15:44:48Z` and merged `2019-06-05T11:22:10Z`.
- Exact review base: `d103828c8e0ffbe92ccc14db97da465b5dbbf4f3`, tree
  `21a107dda9edee4ee52b59ef18d6c4c4035ffe4a`.
- Defect-bearing reviewed head:
  `92399dbaed48f738dbf3c7f97484ca116edee250`, tree
  `250f68b2c3de9f2ec3fdb9c7c3e2fb69ae547a87`.
- The head is a merge commit whose second parent is the exact review base.
  Independently, that base is the merge base of the reviewed head and the
  API's later base `2153789358ce6c3402d538680122460d28e8b684`.
- Direct correction commit:
  `40b5bc24b3241597188cdb98ef7295ef8a4c4dd1`, tree
  `81f2959342cf9dbd22b759090b9d7d262a9bc845`; its parent is
  `e46fa5756be69d8d99e44b17d5973ddd5bc65640`, tree
  `06529a85a1ead989b453b62cf7d971c7cdc5b398`. The correction descends from
  the reviewed head through that intervening merge.
- The current API's final head is
  `7e0f718a9669856f064e21c323b72a57a4f8455e`. It is not substituted for the
  exact commented head.

The current API totals, 14 files with 714 additions and 40 deletions, describe
the final PR and not the earlier review opportunity. The merge-base comparison
above recovers the actual reviewer-visible surface.

### Canonical evidence

| Evidence | Commits | Full-index sections / logical stats | Stored bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Reviewed defective diff | `d103828c...` → `92399dba...` | 14 files, 418 insertions, 62 deletions | 24,606 | `1c00d54b218d9350f2bf6832d89c728d7a155e5f55cd421910e1256ce6119e9b` |
| Direct correction commit | `e46fa575...` → `40b5bc24...` | 4 files, 19 insertions, 56 deletions | 7,572 | `1903dd68f251cf226f968792fc94f3f926bcbecf54c546cf69aaf049407faf2a` |

Regenerating the review diff produced the same SHA-256 a second time. The 14
review sections are the four Next server/runtime paths, one Next package path,
seven API integration fixtures/tests, the type declaration, and `yarn.lock`.
The correction touches `api-utils.ts`, its package manifest, the API
integration test, and `yarn.lock`.

### Captured review and correction evidence

- Inline comment `288068219` by `Janpot`, API type `User`, was created
  `2019-05-28T12:05:29Z` on
  `packages/next-server/server/api-utils.ts`. It binds
  `original_commit_id=92399dbaed48f738dbf3c7f97484ca116edee250` and says that
  MIME types are case-insensitive while the code does not account for case.
  The body was updated `2019-06-05T11:18:13Z`.
- The next-day commit `40b5bc24...`, “Use content-type for parsing,” replaces
  raw `startsWith` checks and the local charset splitter with
  `content-type@1.0.4`, adds its type package, and changes the URL-encoded
  integration request to the mixed-case value
  `application/x-www-Form-urlencoded`. The immediately following
  `ddc3905d...` changes only an unrelated `URL` constructor expression.
- Authenticated `jshttp/content-type` source at tag `v1.0.4` lowercases the
  parsed media type when constructing its `ContentType` result (source line
  129). Receipt
  `api/requests/3d2c9443351fb3685d4fcdc2c4cdb00cbc5875aa69f868d95cc93b1ee88fc732.json`
  binds body SHA-256
  `cf417b11686f11b2514ebd40ba409966e40a0482e5704e960cb2671b3761d808`.
- API evidence receipts are
  `api/requests/ac1cd0db70f19ac6fcbac0b564298958f1d46e14492121bbdb9135384fbbf222.json`
  for PR metadata (body SHA-256
  `2f94a6d6dd6d2a7ad2ce04c9b76addde2ee00ab127d7563e16af986228da75db`)
  and
  `api/requests/0008b708423b51ab246a9d5a4c3ec8662adbf28e92f6d3923a1ba864c16bfd4c.json`
  for inline comments (body SHA-256
  `c3d8265fae294d88ebc740f16ab788e73f4f0b3b515c3d8636a6df394194d1c7`).
  The commits, files, and reviews receipts are also authenticated in the same
  scratch store.

### Frozen candidate root and complete static trace

At the reviewed head, `parseBody` reads the incoming `content-type` header as
an unnormalized string. It calls `type.startsWith('application/json')` and
`type.startsWith('application/x-www-form-urlencoded')`, both case-sensitive
JavaScript comparisons. Valid MIME media types are case-insensitive, so a
request labeled `Application/JSON` or a mixed-case URL-encoded type misses its
parser branch and falls through to the raw string body.

The consequence is reachable through the production request path:

1. `next-server.ts::handleApiRequest` handles an API route, parses cookies and
   query values, then awaits `parseBody(req)` and assigns its return to
   `req.body` before invoking the user's resolver.
2. `parseBody` uses `getRawBody`, converts the buffer to a string, and returns
   either parsed JSON, a decoded query object, or that raw string according to
   the case-sensitive checks.
3. A user handler therefore receives a string instead of the documented/body
   parser's object for a valid mixed-case media type. Invalid mixed-case JSON
   also bypasses `parseJson` and its `ApiError(400, 'Invalid JSON')` path.
4. The integration fixture echoes `req.body`, and the existing tests cover
   lowercase JSON and URL-encoded values. They do not protect the reviewed
   head against media-type case changes.
5. Correction `40b5bc24...` delegates media-type and parameter parsing to the
   `content-type` package, compares its normalized `type`, and deliberately
   exercises mixed case in the URL-encoded integration test. This is the
   smallest repair boundary observed in history: header parsing plus the one
   regression assertion, with package/lock changes needed by that parser.

This is a `complete-static-trace` candidate, not a reproduced runtime result.

### Proof limits and admission blockers

- No historical Next.js code or dependencies were executed. The integration
  test and correction were inspected statically.
- The retained mixed-case regression assertion covers URL-encoded input, not
  an uppercase JSON spelling. The shared parsing mechanism supports the MIME
  root, but a future truth packet must not claim a JSON-specific runtime
  reproduction.
- The review body's later update prevents treating the current API text as a
  byte-for-byte contemporaneous snapshot without archived edit history.
- Other review comments and other changes in this large PR are outside the
  frozen root. The case cannot assert that the rest of the 14-file review diff
  is correct.
- Independent accountable confirmation, duplicate grouping, packet freezing,
  and formal admission remain undone.

Candidate proof level: `complete-static-trace`; runtime result: `unresolved`.

## Opportunity 2: PR #16126 scoped `Promise.all` comparison

### Historical identity

- PR “Update stylesheets on page navigation”, authored by `Timer`, created
  `2020-08-12T17:36:33Z` and merged `2020-08-17T21:20:06Z`.
- Exact review base: `aa7659d8078e3da30d634a8c2f88b6e9e1a5a198`, tree
  `aaa403f8d6e611179a0382020b491189c4527597`.
- Reviewed head: `786aa4b63729c87c8240e4035a1ac55c29030157`, tree
  `c3536b944e8f01f5b0354e20edfbc759542b3fc0`.
- The review base is the merge base of the reviewed head and the API's later
  base `cdff5dfb75173f8740913bd8af115909e9e7508b`. It entered the feature
  history as the second parent of merge `27888ac1...` earlier that day.
- The current API final head is
  `fc6ab9882749ac56023ad92d48c5e4094231f3df`, tree
  `792e25b2d2d5aea3640bedf6294160f2c4df8f56`. Its
  `packages/next/client/index.tsx` blob is byte-identical to the reviewed
  head's blob: `64e60429448ea662915d6d4b5431d68c30c57d73`.

The current API's 25-file, 752-addition, 65-deletion final totals are later
than the comment. The merge-base diff is the exact 22-file reviewer-visible
opportunity.

### Canonical evidence

The canonical review diff has 22 full-index file sections, 667 insertions and
65 deletions, 40,116 bytes, SHA-256
`6b794ddf6fbb3ee4c078a761cc6c25ef7de784fd50f9591e386f75b817d82c85`.
Regeneration produced the same hash. The stored file is
`diffs/next-16126-review.diff` in the assigned scratch directory.

### Captured review evidence

- Inline `471690233` by `prateekbh`, API type `User`, created
  `2020-08-17T18:33:00Z` on `packages/next/client/index.tsx`, asks whether
  the code should use the available `Promise.allSettled` polyfill instead.
- Reply `471709976` by `Timer`, API type `User`, created
  `2020-08-17T18:52:27Z`, states that any one error should immediately proceed
  to page reload and that `Promise.all`'s early rejection is intended.
- Both bind
  `original_commit_id=786aa4b63729c87c8240e4035a1ac55c29030157` and both show
  `updated_at=2020-08-17T19:28:24Z`, after the final feature-branch merge.
- API evidence receipts are
  `api/requests/16d1906957fbe96480d410964aa3126b33d84b9ae160c1ac4760ff84d4f2838d.json`
  for metadata (body SHA-256
  `057aecb3073d9004036d1389cacfc53355d7fca7c14e29f08dd015ffb20b0725`)
  and
  `api/requests/a72eeb5e2752448444773d28c425ee2d95b95baa4c113d789dcef965610adb79.json`
  for inline comments (body SHA-256
  `b2bbfb89428c82f2daf85a9f3120eaf9b082207e2cf0ff596c5721fe5d9953ad`).

### Declared comparison scope and complete protection trace

The tempting finding is: “`Promise.all` should be replaced by
`Promise.allSettled` so one failed stylesheet does not abort the group.” That
finding is not supported within the declared, narrow missing-stylesheet
fallback scope:

1. On a non-initial production render, the router supplies the destination
   route's `styleSheets` from `PageLoader` through `PrivateRouteInfo` and its
   render subscription. Development and initial hydration bypass this path.
2. `onStart` maps every required stylesheet URL through `createLink`, appends
   each staging `<link>`, and returns the link's promise. `createLink` resolves
   on `load` and rejects on the element's `error` event.
3. `Promise.all(required)` therefore rejects when the first required
   stylesheet rejects. Its single catch assigns `router.asPath` to
   `window.location.href`, then returns a never-resolving promise so client
   rendering cannot continue and flash an unstyled or error page before the
   browser reloads.
4. Waiting for every promise with `allSettled` would delay that declared
   fallback after a known missing asset and could wait on unrelated pending
   loads. The boolean question is not whether all loads eventually settle; it
   is whether any required CSS load has failed.
5. Commit `786aa4b...` adds a production integration fixture that removes the
   destination page's CSS files, navigates client-side, and asserts that a
   global sentinel disappears after the server-side reload. That test protects
   the missing-CSS fallback, though not the timing difference between one
   failure and multiple outstanding files.
6. The accepted final head retains the exact `index.tsx` blob. There is no
   later root correction because the challenged `Promise.all` behavior was
   preserved; later commits add a manifest-hydration test and a comment update.

The only supported comparison truth is: **within this production route-change
fallback, early rejection from any required stylesheet is intentional, and
the review proposal to wait for all settlements is not a demonstrated
correctness repair.** This says nothing about the rest of the 22-file diff,
CSS ordering generally, route cancellation, or every browser/network edge
case. It is not a global clean label.

Candidate proof level within that declared scope: `complete-static-trace`;
runtime result: `unresolved`.

### Proof limits and admission blockers

- No historical build or browser test ran. The protection test was inspected,
  not executed.
- The test removes all destination CSS files; it does not directly compare
  early rejection with a mixture of failed, pending, and successful loads.
- A browser may continue fetching other inserted links after `Promise.all`
  rejects. The scoped claim concerns when fallback begins, not network-request
  cancellation.
- Both comment records were updated after creation when the final branch head
  changed. Current API bodies require edit-provenance caution.
- Unknown external behavior and every other changed path remain outside the
  comparison scope. Independent confirmation and formal admission remain
  undone.

## Time, failures, and stopping decision

- Instrumented reconstruction began with the first dedicated API capture at
  `2026-09-05T13:08:19Z` for #7363 and `2026-09-05T13:08:22Z` for #16126.
  The investigations were interleaved; their per-case wall clocks are
  deliberately non-additive. Final document verification ended at
  `2026-09-05T13:20:31Z`. Thus #7363 consumed 12 minutes 12 seconds and
  #16126 consumed 12 minutes 9 seconds, both far below the two-hour initial
  limit.
- The first sandboxed public clone attempt failed because DNS was unavailable.
  The approved read-only retry succeeded.
- One broad `git grep` against the partial clone triggered excessive lazy blob
  retrieval and was interrupted. The trace was completed with exact-path
  `git show` reads. A later `GIT_NO_LAZY_FETCH=1 git show` printed one expected
  missing-promisor-blob warning while still returning the requested commit
  identity; all identities were independently available from other successful
  reads.
- The first dependency-source request used nonexistent ref `1.0.4` and failed
  with HTTP 404 without writing a receipt or response object. Retrying the
  repository's canonical tag `v1.0.4` succeeded and authenticated the needed
  source.
- No repository code, dependencies, or tests were executed. No source
  repository was modified, and no provider experiment ran.

Both opportunities are recoverable enough for later independent curation,
subject to the explicit blockers above. This development record does not admit
them, assign a reserved partition, or establish any global clean result.
