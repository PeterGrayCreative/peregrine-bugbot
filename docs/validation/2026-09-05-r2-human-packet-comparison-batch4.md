# R2 human packet preparation: comparison batch 4

Date: 2026-09-05

This aggregate covers only frozen slots `r2-random-009` through
`r2-random-012`. It records preparation readiness, losses, counts, and hashes;
it contains no causal answer or protected-scope claim.

| Slot | Aggregate result | Manifest SHA-256 | Decision/loss record SHA-256 | Diff SHA-256 | Raw tree SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `r2-random-009` | Explicit sampled loss; no substitution | `cf1bfe5949a76d82d086155aaa1129606c702eab753bac535c6bd77ebd030bd2` | `b213d5378298db0a1282d074c665903947d545ca292fb576b7b1c4152dee9b70` | `02bd25933da36b1cc8b39815aec239a880320dc218ebec6d3d9d25de7339df04` | `1570e60506e3cd09071dc8f1203f30def49825ce8231e5e3e088b4b016eb9a35` |
| `r2-random-010` | Explicit sampled loss; no substitution | `1c1e334cd8756cd168458fc6f978111e59508a5a39268f933b0034adcd37a122` | `2d487fa05081ea7797ecbbb347e5cd8bc63aa843c597d5bf99084e0a1c42fcd5` | `a776e9425c0a79deefaa5d8f00e9b2d87dc07d488f031c3ff4f95095dbe2cb77` | `dc5da86683c564a45a30eb653a523ce704ce83d90dbe6c572a2ec5ae68386f15` |
| `r2-random-011` | Explicit sampled loss; no substitution | `141a624a22b0b97beba20c1485408234f58b2fa5494669158c501bbcfcdaeaa7` | `eed9058fc76238cd66d429b14173ecd9344ab53f0eeb1023a065261790c93780` | `89cf01175d616c75d44256e8d3d4a559a6acf819d738072eec207ee8bb1a201b` | `2f13426a7f14a5432bfeabeeb8fddcfe7b1328cdbe7100313a3f19fe8bcf17bc` |
| `r2-random-012` | Ready for consolidated human review | `09968916d79a13881ed4c0cc4c63fcdd207d9f0290624dd0cb6dc05d8d8f8071` | `7e9f9a163273d72e849b41c81392d86ac029fc521dfe9ad533fb8d11a469dae1` | `119ae5f49339dc028f0fac485acd98a4c33b999c85f1a379fb9e3cbb1bcb8e69` | `c92ef7b0886ed8b1a3f16845001f1183476fd9a676b618e938f911204d579f8b` |

Aggregate result: one ready record and three explicit losses, with zero slot
substitutions and zero acquisition shortfalls. The four retained source
captures total 1,240 KiB, and the complete batch directory is 2,132 KiB, below
the shared 250 MiB acquisition cap. Every initial screen completed within its
30-minute cap.

All 54 request receipts and 51 deduplicated response objects revalidated
against byte counts and response hashes. All four canonical diff hashes
reproduced offline with lazy fetching disabled and network protocols denied.

This batch remains visible preparation for one later consolidated human review.
It is not an admission, truth answer, reserved partition, independent
confirmation set, provider result, or proof of protected-folder access control.
No historical code, build, test, dependency, provider, commit, or push was
executed.

Scratch artifacts:
`/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch4/`.
