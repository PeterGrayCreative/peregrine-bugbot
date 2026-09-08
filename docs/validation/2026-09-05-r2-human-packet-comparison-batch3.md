# R2 human packet preparation: comparison batch 3

Date: 2026-09-05

This aggregate covers only frozen slots `r2-random-005` through
`r2-random-008`. It records preparation readiness, losses, counts, and hashes;
it contains no causal answer or protected-scope claim.

| Slot | Aggregate result | Manifest SHA-256 | Decision/loss record SHA-256 | Diff SHA-256 | Raw tree SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `r2-random-005` | Explicit sampled loss; no substitution | `32847d862c5a2caaa818e237e19411680f5c2cae7bc3488a97861b821512bf34` | `3db0e080687c66e2feb1b9db96f4b2b6b45bdb3b2e9fdda73b0b53871f2f3671` | `5b9a165965856254796e6300a638cdab1d1f348d2b91f822c7f324c3d2909568` | `a234a16fa942b666efd18b3e1793cb7a632682c20347e086cf462993894e8eeb` |
| `r2-random-006` | Explicit sampled loss; no substitution | `7e0c37208a5a00c4048b09a1c1beb359111ca63bea015652a7da0b2272c65e4d` | `2b3b93158bfc58966e3717c8427f4494160aec377b38e4d9356814a5ae7bd4cb` | `e275201aecf3b43ef0fbc0a73048964d0d237aaa1cdf89f86d523e4406e3ffc7` | `a1819ebbef722146401861ebbe1ba1e9a9acaa1980e09fbc8bc1d15b0a137e8e` |
| `r2-random-007` | Ready for consolidated human review | `5536b0cdd81afeed768a71c84681fdac0c3acf6fdc52654b96fa16b46513d7ef` | `6975b73d52970edd5fa38f48ed817c76e6c78b94a409c3a25cbd8c2c44726539` | `7c9fbb28f965becb1f2fab52cc6726c207636cb69b59da2ce034a7d9f5dc4c92` | `22395814863af7333860947698ab4bd1c6d7ebdd34e053d7b11fb1c2e5b1edcc` |
| `r2-random-008` | Ready for consolidated human review | `5f229e5e8688645572b14a1fe2cba1e4100dfbb4e036118c09e8d8e6c14ce0ca` | `fbbc8ca7fc1c3bdcc801886a6949a4961afc9e27048c4205d5ecee13a05c0d82` | `d4cf6de0adae371d7df4432bd040309187bc14af71d717e2f4dae1f04704b909` | `262b8cd49e41ee30a8a53493b9cfcd61c9b7ff788998af3473acf6d8e07b0e00` |

Aggregate result: two ready records and two explicit losses, with zero slot
substitutions and zero acquisition shortfalls. The four retained source
captures total 6,980 KiB, and the complete batch directory is 7,860 KiB, below
the shared 250 MiB acquisition cap. Every initial screen completed within its
30-minute cap.

All 59 request receipts and 54 deduplicated response objects revalidated
against request-derived names, byte counts, and response hashes. All four
canonical diff hashes reproduced offline with lazy fetching disabled and
network protocols denied.

This batch remains visible preparation for one later consolidated human review.
It is not an admission, truth answer, reserved partition, independent
confirmation set, provider result, or proof of protected-folder access control.
No historical code, build, test, dependency, provider, commit, or push was
executed.

Scratch artifacts:
`/private/tmp/peregrine-r2-human-review-preparation/comparisons/beta-batch3/`.
