# R2 main development reconstructions: VS Code #98988 and NestJS #383

Date: 2026-09-05  
Exposure: historical development material; never reserved selection, confirmation, or holdout evidence  
Status: VS Code exact review opportunity unrecoverable and rejected from the primary benchmark; NestJS yields two distinct complete-static-trace candidates; no admission or independent confirmation

## Scope and method

This record investigates only:

- [microsoft/vscode#98988](https://github.com/microsoft/vscode/pull/98988), specifically the missing `await` review on `canMove`; and
- [nestjs/nest#383](https://github.com/nestjs/nest/pull/383), specifically the option-coupling and caller-owned-option mutation review threads.

These leads were already exposed to the development curators. Nothing here is reserved validation evidence. Every named lead retains its inventory slot even where reconstruction fails; no replacement was selected. This record neither admits a case nor treats a successful merge or later repair as proof that a reviewed change was otherwise clean.

I began with the archived six-resource screening context, then captured the current public PR metadata, inline comments, reviews, commits, changed-file records, general discussion, and relevant timeline records into `/private/tmp/peregrine-r2-main-reconstruction-second/api/`. Fifteen successful request receipts bind fifteen response objects by byte count and SHA-256. Read-only filtered clones are under the scratch `repos/` directory. Canonical diff bytes are stored only in the scratch `diffs/` directory.

All canonical diffs were generated with Git `2.50.1 (Apple Git-155)`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`, and:

```text
git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <base> <head> --
```

The stored bytes and hashes below are authoritative for this reconstruction. No repository code or historical dependency was executed.

## Lead 1: VS Code #98988 missing awaits

### Historical evidence and reconstruction loss

- PR “File operation events support multiple resources” was created `2020-06-01T22:30:03Z`, updated `2020-08-08T23:22:31Z`, and merged `2020-06-24T08:32:55Z`.
- Inline comment `440055406`, created `2020-06-15T09:43:10Z` and updated `2020-06-24T08:32:45Z`, targets `src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts`, binds `original_commit_id=e0cd188e0d2e8007713efe37f8dc9821b5716f05`, and says “Missing `await` on `canMove`.”
- Inline comments `440055609` and `440055650`, created seconds later and updated at the same later timestamp, bind the same original commit and path and identify two more missing awaits in the same refactor.
- The preserved comment hunk shows the first reviewed expression exactly: `const validateMoveOrCopy = move ? this.fileService.canMove(...) : this.fileService.canCopy(...)`, followed by `validateMoveOrCopy instanceof Error`, without awaiting either promise.
- Review `430481360`, submitted `2020-06-15T09:45:48Z` as changes requested, additionally says the working-copy operations should run sequentially to avoid overlapping filesystem operations.
- General discussion `644581371`, created `2020-06-16T07:18:38Z`, says the author added the missing awaits in delete and move/copy. Reply `644594291`, created `2020-06-16T07:45:17Z`, confirms that the awaits make the operations sequential.
- The PR timeline records a force push to the exact reviewed head at `2020-06-12T22:18:59Z`, the June 15 review, and a force push away from it to `d4c2dc2f5bef03fb69faa6571b7da3f0bea9de19` at `2020-06-15T21:52:36Z`.

The exact reviewed commit is no longer available from either evidence path. The GitHub commit endpoint returned HTTP 422, “No commit found for SHA: e0cd188e0d2e8007713efe37f8dc9821b5716f05.” A direct read-only fetch returned `upload-pack: not our ref`, and the filtered clone cannot resolve the object. Consequently, this pass cannot authenticate the reviewed head tree, determine its exact historical base, preserve the complete reviewer-visible diff, or prove the exact repair against that head. The API's present base `ac314ec9d163ec5cfd8730fa1c228ba380db9b2e` and final head `dd1a7a5d7a02e90fa2ae7bc29e440a6472311bfc` are later PR state and were not substituted.

### Corroborating rebased lineage, not a primary case

The surviving rebased commit `e615a8081f42bb983e5828839fa6f37750da9964` is titled `fix: typing and sequential flow of copyservice`. Its source awaits the move/copy and delete feasibility calls and iterates the operations sequentially. Its parent and tree identities are:

- parent `4ad934a9b7857062370d9385a2939b58b45ca975`, tree `8a1962907331ade82c233a10fa39d8fe7c2cd605`;
- correction-equivalent commit `e615a8081f42bb983e5828839fa6f37750da9964`, tree `df7b2f50fea0d0df91ce0a939fb233d41a7b6236`.

The stored parent-to-commit diff has one file, 31 insertions and 21 deletions, 6,394 bytes, SHA-256 `ce548a1fd9a26f893054d7b6f01ed6a5ef2b497880411f9854d25ab29e21dde3`. It is corroborating repair-equivalent evidence only. Rebase and force-push history prevent claiming that it is the exact direct repair of `e0cd...`.

The suspected mechanism is technically plausible: if `canMove`/`canCopy` returns `Promise<Error | undefined>`, the unawaited promise is not itself an `Error`, so the guard can fail to stop an invalid operation; omitted awaits around filesystem operations can also allow overlap contrary to the reviewed sequential contract. But the complete exact reviewed source and diff are unavailable, so reachability, all affected calls, and the smallest repair boundary cannot be independently frozen from Git objects here.

Historical repository metadata and the surviving rebased lineage report an MIT license (`LICENSE.txt`, Microsoft copyright). Because the exact `e0cd...` tree is unavailable, the license bytes at that exact reviewed head were not independently authenticated.

Disposition: **reject from the primary historical review benchmark as an unrecoverable review opportunity**. Retain only as separately labeled historical-comment/bug-localization evidence if useful. Proof level: `unresolved`; no runtime result.

## NestJS #383: two separate review opportunities

PR “feat(@nestjs/common) improve the ValidationPipe” was created `2018-01-29T14:09:07Z`, updated `2019-09-23T17:12:18Z`, and merged `2018-02-11T11:27:18Z`. The authentic PR base is `18125677b203e437b467a777ad2b7decfe6d9a25`, tree `f9eb5d8df01eff5d498297fece4a7a91a61675bf`. It is an ancestor of both reviewed heads below. The historical `LICENSE` at that base declares MIT, copyright Kamil Myśliwiec.

The two review threads occur at different heads and describe different roots. They must become separate review opportunities if curated, while remaining in the same PR/source/root-family duplicate cluster for partitioning. Combining both answers into one reviewer-visible case would expose future state and distort discovery credit.

### Opportunity 2A: strip/transform option coupling

#### Historical identity and canonical evidence

- Reviewed defective head: `ba00ce65a68190c093c183adf2f9f67948332a95`, tree `337cc0793d96b6ed94bf3b7e4c369c1b501c210e`.
- Direct child repair: `eebd72c5e44f2f498252e95f47fd23516234aa41`, tree `174b4a6493d903bbec6f4d0944f1674a57dd10c5`.

| Evidence | Commits | Files / logical stats | Stored bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Reviewed defective diff | `18125677...` → `ba00ce65...` | 4 files, 1,291 insertions, 173 deletions | 49,597 | `b9e1104df85f116d1715bfdd67e2040b4989964e30e82b40b2ff2adf602abfe7` |
| Direct repair diff | `ba00ce65...` → `eebd72c5...` | 2 files, 22 insertions, 3 deletions | 2,827 | `91b51e2bd379fa826f4b86e52f500723fab4c2ce0f1c5a42d61de9b9af138312` |

The large reviewed diff includes a package-lock update; it remains preserved rather than silently reducing the review opportunity to the decisive source hunk.

#### Review evidence and frozen candidate root

Inline comment `165802324`, created `2018-02-03T02:45:23Z` and updated `2018-02-05T19:36:05Z`, targets `packages/common/pipes/validation.pipe.ts`, binds `original_commit_id=ba00ce65a68190c093c183adf2f9f67948332a95`, and explains that coupling the flags with `||` makes stripping without transformation impossible. Author reply `165828337`, created `2018-02-03T23:19:00Z`, accepts that a caller may want stripping without transformation while noting that transformation was intended to default on.

At this head, the constructor computes `shouldTransform` from `options.transform || options.strip || options.reject`, and `transform()` returns the class-transformed entity whenever `shouldTransform` is truthy. Thus the public configuration `{ transform: false, strip: true }` cannot preserve the caller's explicit false: `strip` forces the transformed entity return path. The observable consequence is that a caller requesting a stripped plain value receives a transformed class instance instead.

The direct child repair makes explicit `transform` control transformation independently, returns `classToPlain(entity)` for the strip-only path, and adds a test for `{ transform: false, strip: true }` that expects a plain object without the extra property. This authenticates the intended option contract and smallest repair boundary.

Disposition: **retain for independent curation as a distinct development defect candidate**. Proof level: `complete-static-trace`; runtime result: `unresolved` because the historical suite was not run.

### Opportunity 2B: mutation of caller-owned options

#### Historical identity and canonical evidence

- Reviewed defective head: `ff229b522f8812cbb362cbafc5d67ab2662e2238`, tree `507af427e58b913284918a48e556a1ae98d99d8d`.
- Direct child repair: `aaab2bc6efd65a28f0b6e451f11f44ad131aa09e`, tree `71e35064b71d7c0a531e17e9aeb6d0d2c0866282`.

| Evidence | Commits | Files / logical stats | Stored bytes | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Reviewed defective diff | `18125677...` → `ff229b52...` | 4 files, 1,310 insertions, 175 deletions | 50,828 | `987abcd66bfac961dbd54d2a58a4c094b56be0bba288e06d59eebd26f3e9e0b9` |
| Direct repair diff | `ff229b52...` → `aaab2bc6...` | 1 file, 5 insertions, 5 deletions | 1,041 | `db88d64f576d2dd2f511b9b4ec29ba9ba6a96cb773933d5e8c9d18dbccb619ac` |

#### Review evidence and frozen candidate root

Inline comment `165833857`, created `2018-02-04T05:06:09Z` and updated `2018-02-05T19:36:05Z`, targets the same pipe source and binds `original_commit_id=ff229b522f8812cbb362cbafc5d67ab2662e2238`. It objects that the pipe deletes a property from an object it does not own and proposes destructuring. The subsequent thread preserves the reasoning: author question `165838004` asks what harm the deletion can cause; reviewer reply `165839334` explains the destructuring separation; author reply `165842306` accepts the spread/destructure approach.

At this head, the public constructor reads `options.transform`, then executes `delete options.transform`, then copies the remaining object into `validatorOptions`. The deletion synchronously mutates the caller-owned object before the copy. A caller that reuses the same configuration object—for another pipe or another consumer—therefore observes that `transform` has disappeared, potentially changing the later consumer's default-selection behavior.

The direct child repair destructures `{ transform, ...validatorOptions }` and stores the new rest object, preserving the caller's source object while retaining separate transform and validator configuration. This is a direct, source-authenticated repair of the mutation seam.

Disposition: **retain for independent curation as a distinct development defect candidate**. Proof level: `complete-static-trace`; runtime result: `unresolved` because the historical suite was not run.

## Proof limits, elapsed time, and stopping decision

- No VS Code or NestJS repository code, dependency installation, build, or test was executed. The NestJS labels are complete static traces, not reproductions.
- The NestJS repair tests were inspected but not run. Their existence supports intended behavior; it does not supply a `reproduced` proof level.
- The exact VS Code review head was irrecoverable through both public API and Git transport. The surviving comment hunk and rebased correction support the lead, but they cannot satisfy the plan's exact review-opportunity contract.
- Current API PR base/head values were never substituted for a historical intermediate reviewed snapshot.
- The bounded investigation ran from scratch creation at `2026-09-05T13:27:13Z` through the initial evidence write-up at approximately `2026-09-05T13:34:14Z`: about 7 minutes total, well below either two-hour case limit.
- The only material reconstruction failure was the unavailable VS Code object. It is preserved as an inventory loss rather than repaired by a synthetic reverse diff or final-head substitution.
- Independent accountable confirmations, duplicate grouping, frozen truth records, packet binding, and formal admission remain undone for both NestJS candidates.

Net result: one named lead is rejected from the primary benchmark because the exact reviewed state cannot be recovered; the other named PR provides two independently traceable development roots at distinct historical heads. Nothing here demonstrates Peregrine efficacy or authorizes provider experiments.
