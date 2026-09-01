# Historical and merged PR review

Use this procedure only for a merged, closed, or explicitly historical review. Keep the historical result separate from any verdict about the repository's current head.

1. Pin the PR's recorded head SHA, target branch, and merge metadata.
2. Recover the original review base from the first feature commit's parent, the recorded merge base, or merge metadata. Do not compare the historical head with the target branch's current tip. Record the source of the base SHA.
3. Preserve the target repository's current working state. Prefer remote Git objects, `git show`, or a disposable detached clone/worktree.
4. Before reading review comments, select the pre-review feature head from commit chronology and freeze a complete independent candidate ledger.
5. If evaluating remediation, treat each later head as a new intervention and re-run only the lanes its changes can affect.
6. Verify every claimed fix SHA exists in the PR commit list or repository object graph.
7. Reveal existing threads only after the ledger is frozen. Compare root-cause coverage, not raw comment counts or wording similarity.
8. Report the reviewed base/head pair, provenance, skipped runtime checks, and whether the defect remains in the current default branch.

Never post to, approve, or request changes on a historical PR unless the user separately asks for that external action.
