# r1-webpack-8233: unsafe folding of runtime require detection

Status: primary static analysis complete; independent curator confirmations pending
Class: JavaScript, post-merge defect
License: MIT

## Review opportunity

- Introducing PR:
  [webpack/webpack#8233](https://github.com/webpack/webpack/pull/8233), created
  2018-10-17T15:20:58Z and merged 2018-10-18T07:57:23Z.
- Review base `2228daff027113a10790c75f2901c0b804d60a25`, tree
  `6fc6ac847bc62e49f5f2ab9f7774b1f234b75267`.
- Final reviewed head `dcd38348e5a74e250a6dbfa22e743fc7da0964ff`,
  tree `70f9720cdb1e9641bc5e87a2a80822b9c20dc9d7`.
- Exact diff: three files, 101 additions, one deletion; binary diff SHA-256
  `6b161ba2086b471a6b96502fc68cfd6cc05f0d0760d194757aaafccd974b2687`.
- Escaped report:
  [issue #8829](https://github.com/webpack/webpack/issues/8829), created
  2019-02-24T18:00:54Z.
- Repair: [PR #8844](https://github.com/webpack/webpack/pull/8844), merged
  2019-02-28T09:35:34Z; fix commit
  `ab517aa080979e2a0aabe2186ca768d64ce76624`.

All referenced accounts are GitHub `User` accounts with no observed bot
indicator.

## Frozen root

PR #8233 adds a logical-expression optimizer that asks the parser to evaluate
the left operand and removes a branch when it receives a boolean. Existing
`APIPlugin` behavior registers a `typeof` evaluator for every replacement key,
including `__non_webpack_require__`, even though that key has no declared
replacement type. The combination treats
`typeof __non_webpack_require__ !== 'undefined'` as a compile-time truth and
folds a runtime environment guard. PDF.js then takes the `require` path even in
environments where it is unavailable.

## Static trace and historical correction

1. PR #8233 adds `expressionLogicalOperator`, evaluates the left operand with
   `parser.evaluateExpression`, and prunes the right branch based on `asBool()`.
2. Its own tests cover `typeof require`, whose type is known, but not
   `typeof __non_webpack_require__`, whose replacement type is absent.
3. Review comments thoroughly revise left/right preservation but do not test
   the missing-type key; the mechanism remains in the approved head.
4. Issue #8829 reports Webpack 4.21.0 as working and 4.22.0, the first release
   containing #8233, as reducing the runtime guard to `true`; it links a PDF.js
   reproduction and affected source.
5. PR #8844 guards `evaluateTypeof` registration with
   `if (REPLACEMENT_TYPES[key])` and adds a test that toggles runtime `require`
   and expects the `typeof` result to change.

The issue provides historical runtime observation and the repair test verifies
the causal contract. R1 independently confirms the introducing seam and repair
by static trace; it did not execute Webpack 4's historical test environment.

## Scope and limitations

The root is the interaction between logical folding and an undefined static
type for a deliberately runtime-sensitive alias. It is not a claim about all
logical folding. The linked PDF.js reproduction was not independently archived
or rerun in R1. Two accountable curator confirmations remain required; the
analysis author is not a formal confirmation.
