# r1-typescript-37467 v2: organize imports duplicates comments

Status: corrected evidence awaiting two fresh independent confirmations  
Class: TypeScript, post-merge defect  
License: Apache-2.0

## Review opportunity

- Introducing PR: [microsoft/TypeScript#37467](https://github.com/microsoft/TypeScript/pull/37467), created 2020-03-19 and merged 2020-03-31.
- Authentic review base/merge base: `933c2949236f38e1255a0aa4564246a3fef1518c`, tree `12cce8acd32216c6da7fa7dd38205440c624f4a1`.
- Final reviewed head: `6cbbdbcc4c22f7dd82b023059ca8230a927707e7`, tree `7a399efb616db0313641a8068f7943f9d4db4abc`.
- Base-to-head binary diff: 10 files, 135 additions, 6 deletions; SHA-256 `99d05fda5f0f3173eabf57a55fd41803abaa65cc957607b4d4d72f7a892a9acc`.
- Escaped report: [issue #38507](https://github.com/microsoft/TypeScript/issues/38507), created 2020-05-12.
- Repair: [PR #38599](https://github.com/microsoft/TypeScript/pull/38599), merged 2020-05-15.

The referenced accounts are GitHub `User` accounts with no observed bot indication. Dates do not prove model non-exposure.

## Frozen root and static trace

The PR changes general node deletion so deleting a non-first import preserves its leading comments. The pre-existing organize-imports path replaces the first import with a rebuilt list, then deletes each subsequent original import using that general deletion path. The rebuilt list already retains the comments, so preserving them again during deletion leaves another copy. Repeated organize-imports saves therefore grow the duplicated comment.

Issue #38507 records that observation. Repair commit `428f5a19d6d17ffd30e9f757fedc8b72d68ba299` adds deletion with configurable trivia handling and uses it for subsequent organize-import deletions. R1 uses the historical observation plus a complete static trace; it did not execute the 2020 TypeScript harness.

## Why v1 was superseded

V1 used `ac3dc0c4d4a07db92f84c992b5b4ac26c89db8c8` as the base. That commit is not an ancestor of the reviewed head. A two-dot comparison against it produced a 15-file, 136-addition, 49-deletion patch that reverse-included unrelated target-branch content. It was not the authentic review opportunity, even though the described bug root was real. V2 binds the merge base and authentic 10-file PR diff above and preserves the rejected v1 record.

## Scope and limitations

The root is the interaction between generalized comment preservation and the existing organize-import deletion path. It is not a claim about all comment transforms or all defects in the PR. Admission requires two fresh v2 confirmations.
