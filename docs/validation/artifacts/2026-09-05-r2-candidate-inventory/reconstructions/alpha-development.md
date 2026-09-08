# Alpha R2 development reconstructions

Curator: `codex-task:/root/r1_curator_alpha`

Date: 2026-09-05

Exposure: **VISIBLE HISTORICAL DEVELOPMENT**. Both cases are explicitly exposed development material. Neither is reserved validation, historical selection, historical confirmation, an admitted truth case, nor an independent curator confirmation. No provider run was performed.

## Evidence acquisition and integrity

Public GitHub GET responses for repository metadata, issues, timelines, pull requests, commits, files, reviews, and comments are preserved under `/private/tmp/peregrine-r2-alpha-reconstruction/raw/` through `public-capture-store.mjs`. All 44 receipts were re-read; every object matched its recorded SHA-256 and byte count. Exact public Git objects were fetched into credential-free scratch repositories under `/private/tmp/peregrine-r2-alpha-reconstruction/sources/`. Canonical diffs were generated with `git -c core.quotePath=true -c color.ui=false -c diff.renames=false diff --binary --full-index --no-ext-diff --no-textconv --no-renames --no-color --diff-algorithm=myers --src-prefix=a/ --dst-prefix=b/ --unified=3 <review-base> <review-head> --` and retained under the scratch `diffs/` directory.

Both repository API records identify an MIT license. At the introducing heads, webpack's `LICENSE` is Git blob `8c11fc7289b75463fe07534fcc8224e333feb7ff` (content SHA-256 `9068a8782d2fb4c6e432cfa25334efa56f722822180570802bf86e71b6003b1e`) and VS Code's `LICENSE.txt` is blob `0ac28ee234d232ac0691f39cebf95bf6b2a763a5` (content SHA-256 `9480271317925265e806a9a196aaa33410a962fa9d4d1e248a4a5187bc8c9df9`). These license observations establish source-use provenance, not authorship or originality.

## r2-dev-webpack-10335: snapshot deduplication loses a watched dependency

Status: complete static trace; retain as exposed development candidate, not admitted

Class: JavaScript, post-merge defect

License: MIT

### Review opportunity

- Introducing PR: [webpack/webpack#10335](https://github.com/webpack/webpack/pull/10335), “Performance improvement,” created 2020-02-03T14:54:54Z and merged 2020-02-04T09:02:25Z. The author `sokra` and the only external inline reviewer `alexander-akait` are API type `User`.
- Exact reviewed base: merge base `7f583400fb94c597e1b9898a9f2f5d2d63204a9c`, tree `b1f41c97d9bc1b16297aacddc4dc00051d6df1a5`.
- Final reviewed head: `9cebcfd9fd3bd3f4e19a4259c32a9ca630166f4b`, tree `76b43ac9b73dee1e250db601da1eb571e196c8d4`.
- The PR API's historical base-tip field is `89c752411e9bd803401acf1b8402559dae4c6eea`, tree `90ee205656bcac3637ba7f0643973bb10e36c909`. It is not the merge base: it is a merge commit whose first parent is `7f5834`. A two-dot diff from this tip falsely adds a `yarn.lock` reversal and reports 8 files, 498 additions, 208 deletions. The merge-base comparison matches the authenticated PR files response: 7 files, 495 additions, 205 deletions.
- Canonical reviewed diff: 39,002 bytes, SHA-256 `18f23ce9e08aaa3569f282516b52ed996e34fdacead9e740e17c9e04f0135f08`.
- Defect-introducing commit within the ten-commit PR: `352ecd0c3add237448ae307679afe23c4f364e48`, tree `f8a5156a6a09f6bfa669e498fc964ff45dacc365`, parent `7f583400fb94c597e1b9898a9f2f5d2d63204a9c`, subject “Dedupe snapshots via shared snapshots.” The escaped report's author later identified this commit by `git bisect`.
- Escaped report: [issue #10966](https://github.com/webpack/webpack/issues/10966), opened 2020-05-29T02:09:15Z and closed 2020-05-31T05:39:44Z. Reporter `ahwitz` is API type `User`; the thread also contains the bot-indicative account name `webpack-bot`, whose API type alone is `User` and is not treated as human provenance.
- Repair: [PR #10974](https://github.com/webpack/webpack/pull/10974), merged 2020-05-31T05:39:44Z. Repair base `255ae13f59ce36e93b6d8c4301e9cd3366140bda`, tree `0c7cb8b4ab102119a05af02dfb63182bc6c3ffcf`; repair head `beb58fd23dbeb87a7ca0ca257a4ee228457cef4e`, tree `4be60542e54b6ef8d88cc39378ae16d8ea85a1aa`. Its one-file, 22-addition, 4-deletion diff is 2,501 bytes, SHA-256 `3b5b6470535b960e400582ee4bdfe52d075aaa5f0c33734b11285e7b3a35a806`.

### Frozen root

Commit `352ecd0` adds cross-snapshot timestamp deduplication in `lib/FileSystemInfo.js`. When a new snapshot and a prior unshared snapshot overlap, it builds `commonMap` and immediately deletes each common path from the prior snapshot. Only afterward does it test `commonMap.size < 2`. For the one-shared-file case, the branch abandons deduplication but does not restore the deleted timestamp. The prior snapshot therefore stops tracking the shared dependency. A later edit can leave the build represented by that prior snapshot valid, so watch mode can reuse stale output.

The introducing code also creates shared child snapshots without propagating `startTime`. That weakens the `current.safeTime > startTime` validity guard because comparison against an absent start time cannot establish that a file may have changed during snapshot creation. PR #10974 repairs both timestamp ownership and time-bound compatibility. The one-file early deletion is the smallest boundary needed for the reported shared-import symptom; the missing `startTime` is a related defect in the same newly introduced optimization and repair family.

### Static causal trace

1. Before `352ecd0`, each snapshot owns its captured `fileTimestamps`; no cross-snapshot extraction can remove a dependency from an already-created snapshot.
2. The new `_snapshotOptimization` index makes a prior `Snapshot` reachable by paths encountered while building a later snapshot. In the unshared-entry branch, overlap is accumulated in `commonMap` and removed from `snapshot.fileTimestamps` before the minimum-size decision.
3. With exactly one file shared by two entrypoint snapshots, `commonMap.size` is one. The code takes `continue capturedFiles`, never creates the common child, and leaves the earlier deletion in place. The later snapshot still captures the file, but the earlier entrypoint's snapshot no longer invalidates from that dependency.
4. Issue #10966 supplies precisely this reachability: one file imported by two entries in webpack 5 development mode. The first edit changes the hash, while a subsequent edit reuses the same hash/output; production mode and webpack 4 update correctly. The reporter bisected to `352ecd0`, and changing the one-file threshold made the reproducer update.
5. The final #10335 diff includes seven files and several unrelated performance changes. Its stated test posture is “existing tests.” The captured review discussion comments only on the hard-coded SplitChunks hash function; it does not challenge `FileSystemInfo` timestamp mutation or add a one-overlap watch case.
6. PR #10974 moves `snapshot.fileTimestamps.delete(path)` until after the threshold has accepted construction of a shared snapshot. A one-file overlap therefore remains owned by the original snapshot. It also gives common snapshots a compatible minimum `startTime`, refuses incompatible reuse, and makes the validity check explicit about numeric start time.
7. The reporter installed the repair branch in the affected production codebase and confirmed it worked with no temporary local fix present. This is historical runtime evidence from the source report, not an execution performed in this reconstruction.

### Repair boundary, scope, and limitations

The known root is mutation-before-commit in the new snapshot-deduplication path, plus its directly related missing time boundary. It is not a claim that the other six files in #10335 are defective, nor that changing `commonMap.size < 2` is the preferred repair. The accepted fix preserves the optimization and repairs ownership/time semantics rather than adopting the reporter's threshold experiment.

No repository code was executed. The public reproduction repository was not independently archived or run, and PR #10974 explicitly says no regression test was added because the race was difficult to test. The static source path, exact bisect, historical output observation, repair delta, and reporter verification support `complete-static-trace`, not `reproduced` proof.

Initial-pass active time was approximately 9 minutes, including shared capture/fetch setup and the historical-base correction; it remained well below the two-hour case cap. Recorded failures/corrections: an initial zsh tuple loop did not split fields and emitted invalid scratch paths, without altering evidence; more importantly, the first two-dot API-base diff exposed a spurious eighth file. Fetching bounded history and using the true merge base corrected the canonical diff. An overly broad source grep produced truncated output and was replaced by path-specific inspection.

## r2-dev-vscode-112075: plain-text hover newlines collapse visually

Status: complete static trace; retain only as a low-impact exposed development candidate, not admitted

Class: TypeScript, post-merge presentation defect

License: MIT

### Review opportunity

- Introducing PR: [microsoft/vscode#112075](https://github.com/microsoft/vscode/pull/112075), “Just set textContent for custom hover,” created 2020-12-08T10:12:33Z and merged 2020-12-08T15:03:54Z. Author `alexr00` and approving reviewer `bpasero` are API type `User`; there are no captured inline review comments.
- Exact reviewed base: `b4ec131cff7fdcd507dd0f3bcca56496b2499047`, tree `91176fe7bae17f7979413d8ff1a983e790b71207`.
- Final reviewed head: `0fafd58b8ef2ddad433e64ad39ff923d86a1db0a`, tree `5a3bb34715e148274567ecc6933d1788d22f8639`. It is one commit whose parent is the exact base.
- Canonical reviewed diff: one TypeScript file, 22 additions, 20 deletions, 2,829 bytes, SHA-256 `a1b85ef7548488f076834212861eb8314141febb97c3c2464863939dd08eba0c`.
- Escaped report: [issue #112124](https://github.com/microsoft/vscode/issues/112124), opened 2020-12-09T03:47:17Z and closed 2020-12-10T10:50:04Z. It explicitly names #112075 as the cause and includes an affected custom-view-hover screenshot. Reporter `eamodio` is API type `User`.
- Repair: [PR #112133](https://github.com/microsoft/vscode/pull/112133), merged 2020-12-09T14:24:59Z. Repair base `6f933020e8dd4ea046eae2bcfc59a18edf2bc517`, tree `3976e26b424f82d19e89422018d06e57183a2c1d`; repair head `bc1e5b044df9785175bfbd801c2567412d8fb72c`, tree `4ed18d1e8fe1282dca4afad14e636d776843e504`. The one-file, one-addition diff is 710 bytes, SHA-256 `5962d805f21748e5b0a3c8c3b96f7a8df55919f84a5643397b91c1afba3cf11a`. Approving reviewer `jrieken` is API type `User` and commented on the issue that the fix was verified from source while reviewing.

### Frozen root

For `string` hover text, #112075 replaces `MarkdownString().appendText(text, Break)` plus Markdown rendering with direct assignment to `contentsElement.textContent`. `textContent` safely preserves newline characters in the DOM text node, but the surrounding `div.hover-contents` uses normal HTML whitespace handling, so line breaks are visually collapsed. Extension-contributed custom tree items can supply a string `tooltip`; `TreeRenderer.getHover` returns that string, its hover delegate calls `IHoverService.showHover`, and the changed `typeof options.text === 'string'` branch is therefore directly reachable.

### Static causal trace and consequence decision

1. At the base, string text is escaped through `MarkdownString.appendText` with `MarkdownStringTextNewlineStyle.Break`, which deliberately emits rendered line breaks.
2. The head separates strings from markdown and assigns the raw string as `textContent`. This avoids unnecessary Markdown rendering and preserves text safety, but adds no `white-space` styling.
3. Custom tree-view `ITreeItem.tooltip` values that are strings flow through `TreeRenderer.getHover` to the workbench hover service. A multi-line tooltip therefore reaches the changed branch.
4. Under normal CSS whitespace behavior, embedded newlines render as collapsed whitespace. Issue #112124 arrived the next day, names #112075 as cause, and shows the custom-view hover no longer preserving newlines.
5. PR #112133 adds exactly `contentsElement.style.whiteSpace = 'pre-wrap'` to the string branch. This preserves newlines while retaining direct safe text assignment. It adds no test; the captured approval and issue comment verify the source change, not an automated behavior check.

The case is **consequential enough only under a narrow presentation-correctness definition**: extension authors intentionally provide multi-line tooltip text, and users see distinct lines collapsed into one, reducing readability and changing the rendered contract. It is low severity, does not corrupt data or execution, and must never be represented as a functional failure. I retain it for exposed development feasibility because reachability, visible consequence, exact introducer, and smallest repair are unusually clear. A corpus policy requiring operational impact above presentation fidelity should reject it at later admission rather than silently up-rank it.

### Scope and limitations

The root is the missing `white-space: pre-wrap` companion when switching the plain-string rendering path to `textContent`. It is not a claim that direct `textContent` was generally wrong; that change avoids Markdown work and remains in the repair. Markdown-string hovers take the other branch and are outside the known root.

No VS Code build, extension host, DOM harness, or screenshot reproduction was executed. The linked screenshot bytes were not separately archived in this pass. Static source proves the browser rendering mechanism and the repair is a one-line causal match, while the issue supplies historical visual observation. Proof is `complete-static-trace`, not `reproduced`.

Initial-pass active time was approximately 5 minutes, overlapping shared capture/fetch setup and remaining well below the two-hour cap. No case-specific command failed. The only inspection loss was an initially broad grep that matched a very large generated performance fixture; the call-site trace was repeated with exact hover-service patterns and `treeView.ts` ranges.

## Development-only conclusion

webpack #10335 is a strong development reconstruction with a substantive stale-output consequence, exact introducing commit inside the full reviewed PR, and a complete static repair trace. VS Code #112075 is authentic and causally complete but materially weaker in impact; it is retained only as a low-severity presentation case. These judgments do not admit either case, allocate either to a partition, supply independent confirmations, or authorize use in reserved validation.
