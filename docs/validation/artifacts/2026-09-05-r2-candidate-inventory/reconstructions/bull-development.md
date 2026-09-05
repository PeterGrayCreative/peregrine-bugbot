# R2 Bull development reconstructions: PR #537 and PR #556

Date: 2026-09-05  
Repository family: `OptimalBits/bull`  
Exposure: historical development material; never reserved selection, confirmation, or holdout evidence  
Status: primary reconstruction and static trace complete; no admission or independent curator confirmation

## Scope and method

This record reconstructs only the two named review opportunities:

- [OptimalBits/bull#537](https://github.com/OptimalBits/bull/pull/537), a review-caught error-propagation defect; and
- [OptimalBits/bull#556](https://github.com/OptimalBits/bull/pull/556), a narrowly scoped reviewed comparison.

They are separate opportunities in one repository and must remain in one repository/duplicate-family cluster for analysis. Neither may be counted as independent transfer evidence from the other. No replacement was selected.

The investigation began from the six-resource captures authenticated by:

- `main-review-candidates-v1.json`, SHA-256 `476083489f866d558eb139def6a2c08c296313f1ce22d1de5c267662ee1befcd`; and
- `main-review-context-v1.json`, SHA-256 `acb2b03dde74cb64ef9dc57ecacf35416411de0afa640e6325362fd5e782d3fa`.

Twelve captured request receipts and twelve response objects for these PRs were copied byte-for-byte into `/private/tmp/peregrine-r2-bull-reconstruction/raw/`. A read-only filtered clone at `/private/tmp/peregrine-r2-bull-reconstruction/repos/bull/` authenticated the Git objects. Canonical diffs are stored in `/private/tmp/peregrine-r2-bull-reconstruction/diffs/` and were generated under `LC_ALL=C`, `LANG=C`, `git version 2.50.1 (Apple Git-155)` with:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

The stored bytes and their hashes below are authoritative for this reconstruction. This document does not create a curator packet or admit either case.

## Opportunity 1: PR #537 error propagation

### Historical identity

- PR: [#537](https://github.com/OptimalBits/bull/pull/537), created `2017-05-20T20:39:44Z`, updated `2017-05-24T06:51:36Z`, merged `2017-05-24T06:51:33Z`.
- Exact review base: `196878d58f74d6e5ebef01559326a8bfe1db5451`, tree `f911fb9aa155c169e9a00ac3039e99947ab34153`.
- Reviewed defective head: `fc8d37e34f2a95dc8653c8335e8bf7c82820b4b6`, tree `8e1fbd5f785ac2a22d13568ac46ca21b3ac329a4`.
- Direct repair commit: `79d1c7bd40d3fa9d8bd226bd1102a1c418266159`, tree `41cec2daec1655617395f01ec5ad5d7db591c809`.
- API-reported final PR head: `88e2ba9a47f5b1d17c0969078817c0462ba1fc98`, tree `c0942d6f71ae0aa27959be0d0a9e0f6ce2aadb89`.
- Historical license: `LICENSE.md` and `package.json` at the review base declare MIT.

The captured current API base, `fd147244477faede59092e90d67b9ce3fa2652a6`, cannot be used as the reviewed base: it was committed on `2017-05-23T21:21:41+02:00`, after the first review, and `git merge-base --is-ancestor <api-base> <reviewed-head>` fails. Its merge base with `fc8d37e...` is the reviewed head's sole parent, `196878d5...`. The parent is also an ancestor of that later API base. Therefore the authentic intermediate review opportunity is `196878d5...` to `fc8d37e...`, not the current API base to the final PR head.

### Canonical evidence

| Evidence | Commits | Files / logical stats | Stored bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Reviewed defective diff | `196878d5...` → `fc8d37e...` | 3 files, 8 insertions, 2 deletions | 1,946 | `524ab9a5516b3f64e8bec79e1f56975c7c82e0607edecf508fcc2f9867308c2e` |
| Direct repair diff | `fc8d37e...` → `79d1c7bd...` | 4 files, 50 insertions, 7 deletions | 4,322 | `c939121d1c1d15130e94c188f7a91346151a5fea5313da8dbbfcb985cda49353` |

The review diff contains three full-index file sections: `lib/job.js`, `lib/queue.js`, and `lib/scripts.js`. The repair diff adds `test/test_queue.js` to those three paths.

### Captured review evidence

- Inline comment `117649575`, created `2017-05-22T01:24:30Z`, updated `2017-05-23T22:33:22Z`, on `lib/scripts.js`, binds to `original_commit_id=fc8d37e34f2a95dc8653c8335e8bf7c82820b4b6` and reports by testing that the expected event behavior is absent.
- Inline comment `117928077`, created `2017-05-23T08:20:51Z`, updated `2017-05-23T22:33:22Z`, on the same path and original commit, states that the error is not propagated because the script executes inside a Redis multi command; the final result must be selected from the multi response.
- General discussion `303552303`, created `2017-05-23T22:36:00Z`, updated `2017-05-23T22:36:20Z`, corrects the desired lifecycle result: loss of a job lock is not a real job failure, so the queue should emit `error`, not `failed`.
- The capture records all three associated review IDs (`39372234`, `39657380`, and `39672619`) against `fc8d37e...`; their review bodies are empty, so the inline records are the substantive evidence.

### Frozen candidate root

At the reviewed head, `Job.prototype.moveToFailed` queues `multi.moveToFinished(args)` and resolves directly from `multi.exec()`. The negative `moveToFinished` result for a missing job key or lock is an element of the multi-result array rather than a rejected `multi.exec()` promise. The reviewed code even notes that `-1` and `-2` are ignored. Consequently, loss of the lock is not propagated through `moveToFailed`; downstream processing may proceed as though the job was moved to failed and cannot route the condition through the queue's processing-error path.

The direct child repair `79d1c7bd...`:

1. marks when the multi includes `moveToFinished`;
2. reads the final multi result as `_.last(results)[1]`;
3. rejects for a negative code through `scripts.finishedErrors`;
4. makes the `processJobs` rejection branch emit `error`; and
5. adds a test that releases the lock, asserts the job is not moved to failed, and completes through the `error` event.

This is a complete static trace of the error-propagation and lifecycle-routing seam, supported by the contemporaneous review and direct repair. It is not a reproduced runtime result.

### Proof limits and admission blockers

- No Bull code or historical dependencies were executed. The reproduction needs Redis plus 2017-era Node/npm dependencies; no isolated, credential-free runtime was established in this bounded pass.
- The new test was inspected but not run. Its existence and asserted event path support the static trace, not a `reproduced` proof label.
- The initial reviewer wording asks about a `failed` event, but the later thread and repair establish that `error` without `failed` is the intended behavior. A truth record must preserve that correction to avoid grading the wrong event contract.
- The final PR head contains subsequent merges and a later error-handling commit. It must not replace the exact commented head in a reviewer-visible case.
- Independent accountable curator confirmations, source packet binding, duplicate grouping, and formal admission remain undone.

Candidate proof level: `complete-static-trace`; runtime result: `unresolved`.

## Opportunity 2: PR #556 scoped comparison

### Historical identity

- PR: [#556](https://github.com/OptimalBits/bull/pull/556), created `2017-05-31T17:17:48Z`, updated `2017-06-01T15:09:34Z`, merged `2017-05-31T20:36:48Z`.
- Review base: `ec7b57b001be2d81264a2ee254ef3c1774cc7efe`, tree `794a490949a7f02eaaa95e93757736cd8d9196a5`.
- Reviewed head: `a9308a75052f6165bcd09f0d56ea0b9234600c1c`, tree `562146cf4a359d7794c48984276b6539b247ad06`.
- The base is the reviewed head's sole parent, and the captured API base/head values match this pair.
- Historical license: `LICENSE.md` and `package.json` at the review base declare MIT.

### Canonical evidence

The exact stored review diff is one full-index section for `lib/queue.js`, with 2 insertions and 0 deletions, 593 bytes, SHA-256 `49e1bccfffecbf72189642d386039404b341b2ef204e06c2e7987bd751ca17af`.

The head adds explicit `return null` statements after the `completed` and `failed` EventEmitter calls inside `Queue.prototype.processJob`. The PR body reports a Bluebird warning that a promise was created in a handler but not returned.

### Captured review evidence

- Inline `119443021`, created `2017-05-31T18:53:06Z`, updated `2017-05-31T18:53:15Z`, on `lib/queue.js`, `original_commit_id=a9308a75052f6165bcd09f0d56ea0b9234600c1c`, proposes returning the result of `.emit` instead of `null`.
- Inline `119444688`, created `2017-05-31T18:59:22Z`, updated `2017-05-31T18:59:32Z`, same path and original commit, questions whether doing so would affect callback/promise behavior.
- Inline `119466914`, created `2017-05-31T20:36:31Z`, updated one second later, same path and original commit, retracts the suggestion after confirming that EventEmitter `emit` returns `true` or `false`.
- The four captured reviews (`41323194`, `41324996`, `41349595`, `41539875`) all bind to `a9308a...`; the substantive reasoning is in the inline thread.

### Declared comparison scope and static trace

The tempting claim is: “returning `null` loses the event result or listener work, so the callback should return `_this.emit(...)`.” Within the declared internal return-selection scope, the claim is not supported:

1. EventEmitter `emit` returns a boolean indicating whether listeners existed; it does not return or await a listener's promise.
2. Returning that value from the inner `.then` would make `processJob` fulfill with `true` or `false`, exposing listener presence as the promise value.
3. The internal caller is `.then(_this.processJob).then(processJobs, ...)`. The bound `processJobs` callback does not use this fulfillment value, so propagating the boolean performs no needed internal control flow.
4. The explicit `return null` is therefore a deliberate no-result sentinel while satisfying the promise-library handler-return discipline described by the PR.

This supports only: “reviewed comparison case; no confirmed defect in choosing explicit `null` rather than returning EventEmitter's boolean in these two handlers.” It does not prove that the whole PR, `processJob`, callback interoperability, or event listeners are defect-free.

### Proof limits and admission blockers

- No code was executed. The static trace covers the changed callbacks and their immediate internal consumer, but does not enumerate unknown external callers of the non-documented `processJob` method.
- The comparison depends on the standard EventEmitter boolean-return contract, which the contemporaneous reviewer explicitly confirmed; a curator should still bind the applicable historical Node contract if admitted.
- The head changes the previous implicit `undefined` fulfillment to explicit `null`. This reconstruction does not claim those values are universally interchangeable; it claims only that returning `.emit` is not required by the reviewed internal path.
- The PR body's Bluebird warning was not reproduced, and the change's effectiveness against that warning remains runtime-unverified.
- Independent accountable curator confirmations, a declared reviewed scope, and formal admission remain undone. This cannot be labeled globally clean.

Candidate proof level within the declared comparison scope: `complete-static-trace`; runtime result: `unresolved`.

## Time, failures, and stopping decision

- Initial bounded investigation ran from scratch-workspace creation at approximately `2026-09-05T09:07:23-04:00` through evidence write-up at `2026-09-05T09:13:34-04:00`: 6 minutes 11 seconds total for the two related opportunities, well below either two-hour case limit.
- The first sandboxed clone attempt failed because DNS/network access was unavailable. The approved read-only retry succeeded. No source repository was modified.
- The historical license is `LICENSE.md`, not `LICENSE`; the initial `git show <commit>:LICENSE` probes failed and were corrected without changing evidence.
- No other reconstruction failed, timed out, or exceeded its case budget.

Both named opportunities are recoverable enough to send to independent curation, subject to the blockers above. This result does not admit them, assign partitions beyond their explicit development exposure, or establish that Peregrine can find either mechanism.
