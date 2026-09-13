# Sol-low operator integrity correction

The independent gate rejected public `b0e190618d3d515097352879236257e9c50fe94e`
and private `e09c68c5b70db61b68f86d436c57c13f4b2792c6`. A wrong freeze digest
escaped before reporting, and the low assessor accepted mechanical receipt names
without the underlying bytes. Both exact reproductions failed on that predecessor;
its commits, freeze and evidence remain unchanged in `sol-low-operator-v1/`.

The additive `sol-low-operator-v2/` correction is limited to those boundaries:

- Before trusting a freeze, the operator creates an independent private OS-temp
  intake. It preserves bounded exact supplied UTF-8 bytes, actual/expected hashes,
  supplied paths, action and sanitized rejection. Embedded identifiers and paths
  are explicitly untrusted. Rejection exposes the intake location; neither the
  requested report nor canary execution directory is created on a bad digest.
- Mechanical receipts bind run, attempt, complete scope and source. The low
  assessor v2 requires actual bounded bytes matching both independently pinned
  and retained inventories, contiguous start/terminal pairs, successful complete
  results and no persistence failure. It correlates actual client argv, prompt,
  image, PID and output, plus uncancelled container/network cleanup, absence and
  sealed audit bytes. Missing, duplicated, substituted, truncated, failed or
  cross-run receipts fail closed. Receipt contents do not replace independent
  catalog, identity, model-originated reads, lifecycle or leakage observations.

Regression tests include the exact gate failures, hostile embedded paths, 21
resealed receipt mutations, raw-byte substitution, duplicate artifacts, and
compatibility with receipts emitted by the real bridge using an injected executor.
Earlier item/turn/read/search regressions remain active. The strongest low result
remains `infrastructure-canary-observed-no-batch-eligibility`.

The original Sol/high and Sol/low scientific registrations, accepted image,
one-canary authorization scope, all 64 unstarted slots and production defaults
are unchanged. Only deterministic fixtures run; no provider, Codex client, Docker
or image operation occurs. Node22 validation and exact freeze/reconstruction
receipts are recorded privately. Typecheck, 89 prediction tests (including 16
operator groups), 13 HTTP tests and 101 affected tests pass. Fresh independent
review remains required.
