# r1-typescript-37467: organize imports duplicates comments

Status: primary static analysis complete; independent curator confirmations pending
Class: TypeScript, post-merge defect
License: Apache-2.0

## Review opportunity

- Introducing PR:
  [microsoft/TypeScript#37467](https://github.com/microsoft/TypeScript/pull/37467),
  created 2020-03-19T00:09:44Z and merged 2020-03-31T17:18:07Z.
- Review base `ac3dc0c4d4a07db92f84c992b5b4ac26c89db8c8`, tree
  `ce84dcdb5af81773528d9c06ca0877a831f577fd`.
- Final reviewed head `6cbbdbcc4c22f7dd82b023059ca8230a927707e7`, tree
  `7a399efb616db0313641a8068f7943f9d4db4abc`.
- Exact diff: 15 files, 136 additions, 49 deletions; binary diff SHA-256
  `f2aebe7ce37f8b2bc5c8877301b26782ba9b0516f612875f0eaa5b435b320b91`.
- Escaped report:
  [issue #38507](https://github.com/microsoft/TypeScript/issues/38507), created
  2020-05-12T18:36:14Z.
- Repair: [PR #38599](https://github.com/microsoft/TypeScript/pull/38599),
  created 2020-05-15T18:53:23Z and merged 2020-05-15T21:25:12Z.

Accounts referenced by the PRs and issue are GitHub `User` accounts; no bot
indication was observed. Dates do not prove model non-exposure.

## Frozen root

The introducing PR changes general node-deletion behavior so that deleting
non-first imports preserves leading comments. Existing organize-imports logic
rebuilds the first import and deletes every subsequent original import using
the general deletion path. Because the newly built import list already retains
those comments, preserving them again during deletion leaves an extra copy on
each save. The result is repeated comment growth under `source.organizeImports`.

## Static trace and reproduced historical observation

1. PR #37467 adds `LeadingTriviaOption.StartLine` and applies it to non-first
   `ImportDeclaration` and `ImportEqualsDeclaration` deletion.
2. At the later failing revision, `organizeImports.ts` replaces the first import
   with the rebuilt list, then calls `changeTracker.delete(...)` for subsequent
   imports.
3. The generalized deletion therefore preserves trivia already represented in
   the rebuilt list.
4. Issue #38507 supplies a concrete two-import input and records one additional
   copy of the second comment after every save.
5. PR #38599 explicitly attributes the regression to #37467. Commit
   `428f5a19d6d17ffd30e9f757fedc8b72d68ba299` adds a deletion method with
   configurable trivia handling and changes organize imports to use it for
   subsequent imports; the PR adds a regression test.

The issue's before/after observation is historical reproduced evidence; R1
independently confirms the causal path by complete static trace. R1 did not run
the 2020 TypeScript test harness.

## Scope and limitations

The root is the interaction between generalized comment preservation and
organize-import deletion. It is not a claim about every comment transformation
or every defect in the PR. Two accountable curator confirmations are required
for admission; the analysis author is not automatically one of them.
