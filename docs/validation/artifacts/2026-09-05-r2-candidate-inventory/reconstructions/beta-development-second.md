# R2 beta development reconstructions: NestJS #5710 and Axios #874

Date: 2026-09-05  
Exposure: historical development material; never reserved selection, confirmation, or holdout evidence  
Status: primary static reconstruction complete; NestJS remains a scoped-comparison candidate, Axios is retained as a comparison loss; neither is admitted or independently confirmed

## Scope and method

This record investigates only:

- [nestjs/nest#5710](https://github.com/nestjs/nest/pull/5710), the review concern that widening `ClientProvider` might break existing `ClientOptions`; and
- [axios/axios#874](https://github.com/axios/axios/pull/874), the proposed alternative of representing every repeated response header as an array rather than treating `Set-Cookie` specially.

Both are exposed development investigations. Safe behavior was treated as a
hypothesis, not a default. Axios is explicitly retained as a loss because its
source supports the implementation choice but not a qualifying contemporaneous
reviewed-comparison opportunity. No replacement candidate was selected.

I began from the cached screening captures, then captured complete public PR
context—metadata, inline comments, reviews, commits, changed files, and general
discussion—into
`/private/tmp/peregrine-r2-beta-reconstruction-second/api/`. Historical Node
v7.9.0 source and API documentation were captured there for the Axios contract.
Canonical repositories are read-only filtered clones under
`/private/tmp/peregrine-r2-beta-reconstruction-second/{nest,axios}/`; canonical
diffs are in the sibling `diffs/` directory.

Every stored API response is bound by an immutable request receipt, byte count,
and SHA-256. Diffs were generated using Git `2.50.1 (Apple Git-155)`,
`LC_ALL=C`, `LANG=C`, `TZ=UTC`, and:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

The historical `LICENSE` files declare MIT: copyright Kamil Mysliwiec at the
NestJS head and Matt Zabriskie at the Axios head. GitHub reports the cited PR,
review, and discussion authors as API type `User`. `coveralls` is nevertheless
clearly an automation account despite that API type, so its reports are not
treated as human evidence.

## Opportunity 1: NestJS #5710 `ClientProvider` compatibility

### Historical identity and canonical evidence

- PR “Feat/microservice deserialize error”, authored by `jmcdo29`, created
  `2020-11-17T17:07:05Z`. The exact discussion occurred on 2020-12-21. The PR
  was not merged until `2021-02-01T13:26:45Z`, so its merge postdates the
  program's initial 2017–2020 historical boundary and must remain an explicit
  limitation.
- Exact review base: `8009337e23867393353a38be6d083f1cb1d12998`, tree
  `156f5861a966d181b39afb717a29f59032fde059`.
- Exact reviewed head: `525ef913079e44f28d11de7bc60e323f3c05ac0a`, tree
  `1ad7193ceb924bb5b19e117a098ae75e7b5f05ec`.
- The base is an ancestor of the head; the three-commit chain is
  `530274e2...`, `7dad2e47...`, `525ef913...`. Current API base/head values
  match the reconstructed pair.
- Canonical review diff: 7 full-index file sections, 93 insertions and 11
  deletions, 9,142 bytes, SHA-256
  `a3bb1a3a0e1ac43b478cdb0f168746513fa4778f15fa9f1cb9eae27df0b2cdad`.
  Independent regeneration produced the same hash.

The seven paths are four microservice implementation/type files and three
integration fixture/test files. This is the complete reviewed surface, not a
single-hunk extraction.

### Review and context evidence

- Inline `546630729` and review `556282705` by maintainer
  `kamilmysliwiec`, created/submitted `2020-12-21T10:35:24Z`, ask whether the
  `ClientProvider` change is breaking. The inline targets
  `packages/microservices/module/interfaces/clients-module.interface.ts` and
  binds `original_commit_id=525ef913079e44f28d11de7bc60e323f3c05ac0a`.
- Reply `546825579` and review `556533873` by author `jmcdo29`, created and
  submitted `2020-12-21T17:10:53Z`, bind the same head. The response says
  `ClientProvider` is a union containing old `ClientOptions`, and unchanged
  integration tests built successfully. Neither inline body has an edit after
  creation.
- The later general discussion adds important scope limits. February–May 2021
  comments question gRPC error deserialization and ordinary-error propagation;
  the author acknowledges gRPC method differences. Those are feature/transport
  concerns, not evidence that old `ClientOptions` ceased to be accepted.
- Scratch receipts
  `api/requests/58104aee2beac89adf9ce42ede69123a1de6e36730e95cef702b4751f99dac9d.json`
  and
  `api/requests/fa37767948524933b73e08d135244a970bdd62bea47e94d300d84bce0b9a9df3.json`
  bind PR body SHA-256
  `dc0acb48c3f03c7e9f4104ceedddcba6af99501eb08724cda7990545774639e5`
  and inline-comment body SHA-256
  `f6f99c2dfd104da237d3ba8d2bff139c98ee45879cda1d0935920032b29afae4`.
  Reviews, commits, files, and discussion are separately authenticated in the
  same store.

### Declared comparison scope and complete static protection trace

The tempting finding is: “changing `ClientProviderOptions` to use
`ClientProvider` breaks callers that still provide a normal `ClientOptions`.”
Within the declared registration/type-acceptance scope, that finding is not
supported:

1. Before the change, `ClientProviderOptions` is `ClientOptions & { name }`.
   At the reviewed head, `ClientProvider` is
   `ClientOptions | CustomClientOptions`, and `ClientProviderOptions` is that
   union intersected with the same `{ name }`. Every formerly valid
   `ClientOptions & { name }` remains one branch of the widened type.
2. `ClientsModuleOptionsFactory.createClientOptions` and async `useFactory`
   widen their returns from `ClientOptions` to `ClientProvider`. An existing
   implementation returning the narrower old type remains compatible with
   that widened return contract.
3. `ClientsModule.register` still passes each option object to
   `ClientProxyFactory.create`; the async path still awaits the factory result
   and calls the same method.
4. `ClientProxyFactory.create` adds a custom overload and first tests for a
   truthy top-level `customClass`. Typed old `ClientOptions` variants have a
   required `transport` discriminant and no top-level `customClass`, so they
   continue through the pre-existing transport switch and constructors.
5. The integration change registers a custom proxy alongside existing client
   registrations and adds distinct assertions for custom and standard error
   serialization. This protects coexistence at the inspected head, although
   it is not a general external assignability suite.

The supported truth is only: **old, type-valid `ClientOptions` registration
shapes remain members of the widened union and retain the old runtime factory
path.** This does not claim arbitrary JavaScript objects with colliding
`customClass` properties are unchanged, that every transport supports the new
serialization hooks, that the post-2020 merge is within the initial window, or
that the rest of the seven-file PR is clean.

Disposition for development handoff: **retain as a plausible scoped comparison**.  
Candidate proof level within that scope: `complete-static-trace`; runtime result: `unresolved`.

### Proof limits and admission blockers

- No historical TypeScript build or integration suite ran. The assignability,
  control flow, and tests were inspected statically.
- “Existing tests built” is author testimony, not independent proof. The added
  standard-client assertion is supportive but does not compile a matrix of
  external old client configurations.
- A JavaScript caller can supply shapes outside the TypeScript contract; a
  truthy top-level `customClass` now changes runtime dispatch. That is outside
  the narrowly declared old type-valid input scope and must not be silently
  generalized.
- The review is in-window but merge and later feature discussion are in 2021.
  Formal curation must decide whether the plan permits that chronology.
- Independent confirmation, duplicate grouping, frozen truth, and admission
  remain undone.

## Opportunity 2: Axios #874 duplicate-header representation

### Historical identity and canonical evidence

- PR “Duplicate header handling”, authored by `tybro0103`, created
  `2017-04-29T04:00:10Z` and merged `2017-08-12T12:58:10Z`.
- Exact review base: `f31317aeca8f7fa385d6aee94ef6ec8ac9d7c072`, tree
  `375de76ed60c31d59d405001d855c8a3e660c347`.
- Reviewed/final head: `d29962a0515c29092025634d14977cc5b618585a`, tree
  `e1b8bb99873f7f0a818d75e9a9dd2d20bcb5701b`.
- The base is the first parent of merge `8c215194...`, followed by test commit
  `48c41036...` and comment-only head `d29962a...`; current API base/head values
  match the reconstructed endpoints.
- Canonical review diff: 2 full-index sections, 44 insertions and 2 deletions,
  2,542 bytes, SHA-256
  `a59f6ce73235b5e387dd2c8a084f55a199e104a1335574b89d1da075d1dff64d`.
  Regeneration produced the same hash.

### Full discussion and static contract trace

- The only head-bound inline comment is `114045639`, created
  `2017-04-29T04:12:24Z` by PR author `tybro0103` on
  `test/specs/helpers/parseHeaders.spec.js`, with
  `original_commit_id=d29962a0515c29092025634d14977cc5b618585a`.
  It merely asks whether the no-header expectation should be an empty array
  instead of `undefined`. Its associated review `35488843` is bodyless and is
  also by the author.
- The PR author separately calls the change breaking. There is no substantive
  contemporaneous reviewer response about the duplicate representation.
- General discussion `478599399` by `opichals`, created
  `2019-04-01T14:20:33Z`, asks why only `Set-Cookie` gets array treatment and
  proposes that any repeated field could be represented as an array. It has no
  path, `original_commit_id`, or reply, and was posted almost twenty months
  after merge.
- At the reviewed head, `parseHeaders` discards duplicates for the documented
  singleton list, preserves every `set-cookie` value in an array, and joins
  other duplicate values with `, `. Tests cover absent, single, and multiple
  `Set-Cookie`, discarded duplicate `Age`, and combined duplicate `Foo`.
- `xhr.js` is the observed production caller: it feeds
  `XMLHttpRequest.getAllResponseHeaders()` to `parseHeaders`. The Node adapter
  does not call this helper; it returns `res.headers` directly. This pass did
  not authenticate whether historical browsers exposed `Set-Cookie` through
  that XHR API, so no browser-level reachability claim is made.
- Authenticated Node v7.9.0 API documentation—the behavior explicitly targeted
  by the PR—states that duplicates of the singleton list are discarded,
  `set-cookie` is always an array, and all other headers are joined with
  `, `. Its implementation in `_http_incoming.js` performs the same three-way
  branch. Receipts
  `api/requests/e6e6bbf8c93bb04838d0bc171de323047e34e6a4ea1bd8df7ec4624b479c7c34.json`
  and
  `api/requests/682737e1f4a1a2e7cf2b38d35e3afdd06dd72327458681b9a685e232b7e9f309.json`
  bind body SHA-256 values
  `d263cb916f7d52e64f1f87bcc854907db3686e11ab0f0a8fe9ab9b6c66725dfc`
  and
  `22a6d4aa606e74af5e951377dcb21707970d6c4dc91a9ed1bcb43a9cae224460`.
- Axios receipts
  `api/requests/9eee2417a84616f2d6b1cb2e42a5342f3b75daa163c2e3a7503ebb6b120765b2.json`
  and
  `api/requests/229cce85bcdb04b85e2d184d41e6821a8f9392198a4cd43e45ea425cc2a5591f.json`
  bind metadata body SHA-256
  `21dc55d7324b7f98fd031e9e96613fe38eecb30a112304197c13509c10b27c3e`
  and general-discussion body SHA-256
  `2fe0962d987aa984c905bbb1489420d56b0181b8bdcb51df8c199fcaa97f69ce`.

The static source supports the narrow engineering conclusion that replacing
the three-way representation with “arrays for every duplicate” is not required
to match the historical Node header contract. It does **not** establish a
qualifying reviewed comparison: the only contemporaneous head-bound inline is
an author note about absent output, and the substantive alternative arrived
unanswered long after merge with no review revision binding.

Disposition for development handoff: **reject as a reviewed-comparison case and retain as a screening/reconstruction loss**. The safe-helper observation may remain provenance, but it cannot be upgraded into reviewed-clean evidence.

### Proof limits and loss reasons

- No historical Axios tests or browser runtime ran.
- No substantive independent review comment is bound to the reviewed head.
  Merge, tests, and conformance to Node behavior cannot manufacture that
  missing review opportunity.
- The 2019 question is post-merge, unresolved, and lacks path and
  `original_commit_id`.
- Browser reachability of `Set-Cookie` through the historical XHR header API
  was not authenticated. The demonstrated protection is helper/API shape, not
  an observed browser response.
- The comparison says nothing about standards beyond the captured Node v7.9.0
  contract or about every header's independent HTTP semantics. It is not a
  global clean claim.

## Time, failures, and stopping decision

- Instrumentation began at `2026-09-05T13:25:55Z`; dedicated captures began
  at `2026-09-05T13:26:49Z` for NestJS and `2026-09-05T13:26:52Z` for Axios.
  Work was interleaved, so per-case wall clocks are non-additive. Final
  validation ended at `2026-09-05T13:34:23Z`: NestJS consumed 7 minutes 34
  seconds and Axios consumed 7 minutes 31 seconds, both below the two-hour
  initial limit.
- Broad `git grep` against the Axios partial clone began excessive lazy-blob
  retrieval and was interrupted. Exact-path reads established the two adapter
  call paths without the broad fetch.
- An Axios license probe was accidentally issued from the NestJS checkout and
  failed because the Axios object is not in that repository. Repeating the
  read from the correct canonical checkout succeeded and authenticated MIT.
- No historical repository code, dependency install, or test was executed.
  No provider ran and no source repository was modified.

NestJS may proceed to independent development curation only within its narrow
old-input compatibility scope and with the 2021 merge chronology visible.
Axios #874 remains a documented loss. Neither result is an admission, reserved
partition assignment, or repository-wide clean judgment.
