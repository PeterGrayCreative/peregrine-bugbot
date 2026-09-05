# Stage 2 PR 9 Decision Record

Plan PR 9 was implemented and tested as two separate preregistered diagnostic
interventions. Both preserved registered recall and completion and both failed
the mandatory efficiency gate. Neither implementation is accepted or merged.
Unresolved findings prevent either run from establishing general precision or
false-positive preservation.

| Design | Quality | Median paired wall time | Decision |
| --- | --- | ---: | --- |
| Structural compact | registered recall and completion preserved; 3 unresolved findings per arm | +12.85% slower | reject |
| Adaptive structural compact | registered recall and completion preserved; 28 control and 30 treatment findings unresolved | +8.85% slower | reject |

The first design increased the transmitted representation on the small panel.
The adaptive revision selected compact output only when it was smaller, but
reduced total treatment ledger characters by only about 3.4%. Its downstream
median investigation-time improvement was 4.31%, insufficient to offset run
variance or meet the 20% checkpoint objective.

The immutable implementation, protocols, matrices, full aggregate reports, and
artifact hashes remain on remote commit
[`7573536`](https://github.com/PeterGrayCreative/peregrine-bugbot/tree/7573536):

- [first structural-compaction result](https://github.com/PeterGrayCreative/peregrine-bugbot/blob/7573536/docs/validation/2026-09-04-stage2-pr9-results.md)
- [adaptive preregistration](https://github.com/PeterGrayCreative/peregrine-bugbot/blob/7573536/docs/validation/2026-09-04-stage2-pr9-adaptive-preregistration.md)
- [adaptive result](https://github.com/PeterGrayCreative/peregrine-bugbot/blob/7573536/docs/validation/2026-09-04-stage2-pr9-adaptive-results.md)

The experimental branch remains available for reproduction and audit without
putting rejected runtime behavior on `main`. The accepted Stage 2 stack is PR
8's stable method packet with the existing full breadth ledger.

This is negative diagnostic evidence from visible seeded cases. It does not
support historical-gold, sealed-holdout, production-routing, or final
non-inferiority claims.
