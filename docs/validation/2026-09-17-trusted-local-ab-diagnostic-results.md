# Trusted local A/B diagnostic results

Date: 2026-09-17. Evidence class: visible seeded diagnostic.

The trusted local runner completed one Sol-high pair on `case-6c19f4ab`: Arm A used the competent minimal prompt and Arm B used the Peregrine single-reviewer method. Both used the same materialized TypeScript checkout, raw scope, output schema, CLI arguments, read-only access, and 20-minute deadline.

| Evidence | A: minimal | B: Peregrine |
| --- | ---: | ---: |
| Registered roots found | 1/1 | 1/1 |
| Unsupported additional findings | 0 | 0 |
| Status | completed | completed |
| Wall time | 26.915 s | 33.371 s |
| Input tokens | 37,859 | 54,419 |
| Cached input tokens | 24,320 | 34,816 |
| Uncached input tokens | 13,539 | 19,603 |
| Output tokens | 716 | 1,036 |
| Reasoning output tokens | 259 | 340 |

Both arms correctly reported the high-severity partial-mutation defect at `src/ledger-service.ts:13-14`. Peregrine took 23.99% longer and used 43.74% more input tokens, 44.79% more uncached input tokens, and 44.69% more output tokens in this pair.

The independent Astra-medium gate passed artifact integrity, root matching, usage normalization, checkout identity, and the registered execution contract. Full attempts and the gate are stored in the private evidence repository at commit `bf981af`.

This pair proves that the minimal and Peregrine prompts can run under the same observable local CLI contract and retain usable evidence. It provides no detection advantage for Peregrine on this easy exposed case. One visible seeded pair cannot establish efficacy, comparative reliability, generalized efficiency, historical performance, served-model identity, monetary cost, or a routing recommendation.

Two prior startup failures remain preserved in the private evidence repository. The first exposed missing stderr retention; the second identified an unsupported strict-config project-path override. The corrections merged in PRs #70 and #71. No failed attempt was overwritten.
