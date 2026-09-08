# Independent R2 development reconstruction check

Date: 2026-09-05  
Reviewer: `codex-task:/root/benchmark_semantics_exact_head_review`  
Evidence class: independent AI static check of exposed historical development material

This check is not human curation, admission, runtime reproduction, reserved
validation, confirmation, or holdout evidence. It covers only Bull PRs #537 and
#556 and webpack PR #10335 using the already-present reports, Git objects, and
canonical diffs. No repository code or provider was run.

## Identity and byte verification

I regenerated the three canonical review diffs directly to standard output
with the documented canonical Git options and independently recomputed their
SHA-256 hashes. The regenerated hashes match the stored files and reports.

| Opportunity | Verified base and tree | Verified head and tree | Canonical review diff |
| --- | --- | --- | --- |
| Bull #537 | `196878d58f74d6e5ebef01559326a8bfe1db5451` / `f911fb9aa155c169e9a00ac3039e99947ab34153` | `fc8d37e34f2a95dc8653c8335e8bf7c82820b4b6` / `8e1fbd5f785ac2a22d13568ac46ca21b3ac329a4` | 1,946 bytes; `524ab9a5516b3f64e8bec79e1f56975c7c82e0607edecf508fcc2f9867308c2e` |
| Bull #556 | `ec7b57b001be2d81264a2ee254ef3c1774cc7efe` / `794a490949a7f02eaaa95e93757736cd8d9196a5` | `a9308a75052f6165bcd09f0d56ea0b9234600c1c` / `562146cf4a359d7794c48984276b6539b247ad06` | 593 bytes; `49e1bccfffecbf72189642d386039404b341b2ef204e06c2e7987bd751ca17af` |
| webpack #10335 | `7f583400fb94c597e1b9898a9f2f5d2d63204a9c` / `b1f41c97d9bc1b16297aacddc4dc00051d6df1a5` | `9cebcfd9fd3bd3f4e19a4259c32a9ca630166f4b` / `76b43ac9b73dee1e250db601da1eb571e196c8d4` | 39,002 bytes; `18f23ce9e08aaa3569f282516b52ed996e34fdacead9e740e17c9e04f0135f08` |

The Bull #537 repair is the direct child
`79d1c7bd40d3fa9d8bd226bd1102a1c418266159`, tree
`41cec2daec1655617395f01ec5ad5d7db591c809`; its stored 4,322-byte diff hashes
to `c939121d1c1d15130e94c188f7a91346151a5fea5313da8dbbfcb985cda49353`.
The webpack repair pair is
`255ae13f59ce36e93b6d8c4301e9cd3366140bda` (tree
`0c7cb8b4ab102119a05af02dfb63182bc6c3ffcf`) to
`beb58fd23dbeb87a7ca0ca257a4ee228457cef4e` (tree
`4be60542e54b6ef8d88cc39378ae16d8ea85a1aa`); its stored 2,501-byte diff hashes
to `3b5b6470535b960e400582ee4bdfe52d075aaa5f0c33734b11285e7b3a35a806`.
The webpack review base is independently confirmed as the merge base. The API
base-tip `89c752411e9bd803401acf1b8402559dae4c6eea` is a two-parent merge whose first
parent is that review base, so it is not a substitute for the merge-base diff.

## Candidate dispositions

### Bull #537 — CONFIRM, with a narrower root boundary

The review-head defect is statically established for the final-attempt
`moveToFinished` path. `Job.prototype.moveToFailed` enqueues
`multi.moveToFinished(args)` and resolves from `multi.exec()` without examining
the command result. In this multi form, a negative missing-job or missing-lock
code is data inside the result array rather than a rejected `multi.exec()`
promise. The direct child repair records that this command was enqueued, reads
the last result's value, and rejects through `finishedErrors` when it is
negative. The existing `processJobs` rejection continuation did not emit the
error; the same repair makes that continuation emit `error`. This supports the
reported user-visible routing consequence.

The frozen truth should name the primary root narrowly: **the final-attempt
multi result is resolved without interpreting the embedded negative
`moveToFinished` status**. The downstream silent `processJobs` rejection path
is a required propagation seam, but it predates the reviewed head and should
not be represented as though the new `lib/scripts.js` change introduced it.

The added repair test is supporting but not complete proof of the primary
root. It configures two attempts; `_saveAttempt` increments `attemptsMade` to
one, so the released-lock failure takes the immediate `retryJob` branch, not
the final-attempt `moveToFinished` branch. It directly exercises the repaired
queue `error` emission, while the multi-result root remains established by the
source delta and contemporaneous repair rather than that test. Retain
`complete-static-trace`, never `reproduced`.

### Bull #556 — CONFIRM only as the declared scoped comparison

The changed internal chain supports the narrow negative claim. Both callbacks
emit an event and explicitly return `null`; their immediate consumer is
`.then(_this.processJob).then(processJobs, ...)`, and `processJobs` ignores the
fulfillment value. Returning EventEmitter's boolean would expose listener
presence without providing listener completion or a needed internal control
signal. The retracted review suggestion therefore is not a confirmed defect in
the inspected internal return-selection path.

Do not widen this to null/undefined equivalence, public API compatibility, or a
clean-head claim. `processJob` is installed on `Queue.prototype`, the change
does alter its fulfilled value from implicit `undefined` to explicit `null`,
and the bounded source set does not establish all outside callers. The
Bluebird warning and whether explicit `null` suppresses it were also not
executed. The admissible claim is only the report's stated comparison scope:
returning `_this.emit(...)` is not required by the immediate internal
continuation. This remains partial truth with no registered known root.

### webpack #10335 — CONFIRM as two distinct static roots

The report's primary one-file mechanism is confirmed. In introducing commit
`352ecd0c3add237448ae307679afe23c4f364e48`, the unshared-snapshot branch copies
each overlapping timestamp into `commonMap` and immediately deletes it from
the prior snapshot. If exactly one file overlaps, `commonMap.size < 2` then
continues without creating or attaching a child snapshot. The earlier snapshot
has permanently lost that dependency. The repair removes the pre-threshold
deletion and retains deletion only after shared-snapshot construction commits.
This is the mutation-before-acceptance root tied directly to the one-shared-file
stale-output report.

The missing `startTime` must be a separate candidate root, not folded into the
one-file deletion merely because one repair fixes both:

1. Common child snapshots are created as `{ fileTimestamps: commonMap }`, so
   their own validity check compares `current.safeTime > startTime` with an
   absent time boundary and cannot reject a file that may have changed during
   capture.
2. An already shared snapshot can be attached to another parent without first
   checking whether its time boundary is compatible with the later snapshot.
3. The repair independently propagates the minimum compatible `startTime`,
   rejects incompatible reuse, and makes the numeric guard explicit.

These mechanisms have different triggering conditions and failure paths. The
one-file deletion needs an overlap below the sharing threshold and loses
ownership immediately. The time-boundary defect applies to child snapshots
that are actually created or reused and weakens race detection. The escaped
one-file report is strong historical consequence evidence for the first root;
it is not independent runtime observation of the second. The second is a
`complete-static-trace` candidate only, with runtime consequence unresolved in
this check. A later curator may group both under one repair or optimization
family for clustered analysis, but known-root grading should not consolidate
them without a mechanism-based duplicate decision.

## Limits and inspection note

- No historical dependencies, Bull/webpack tests, Redis, builds, or provider
  reviews were run.
- No claim extends to files outside the named mechanisms or to whole-head
  cleanliness.
- The available source is a filtered promisor clone. One attempted broad
  `git grep` for Bull callers requested an absent object from its configured
  remote and failed at DNS before returning data. No response bytes were
  obtained and no source or evidence file was changed. Subsequent inspection
  stayed on already-present objects. Accordingly, unknown external Bull #556
  callers remain an explicit limit.
- This AI check can send the candidates to accountable independent human
  curation; it cannot satisfy either required human confirmation.
