# Benchmark grading and adjudication

Peregrine separates deterministic structural grading from behavioral semantic grading.

Ground-truth bugs carry a canonical review lane, curator-owned severity and disposition, reachable preconditions, observable impact, provenance, and an optional root-cause group. A single reviewer finding may satisfy multiple bug observations only when those observations share the same non-empty curator-owned group. Reports therefore keep bug-instance recall and root-cause recall separate.

The semantic judge receives only the known defect evidence and one reviewer finding. It never receives the runner, route, model configuration, control/treatment label, repeat, or variant. Judge failures are retained as `failed` decisions and cannot silently become non-matches. Each decision binds the exact ordered finding occurrence, verdict, failure classification, and immutable judge-configuration fingerprint. Grading readers compare the complete judge identity (kind, version, and configuration fingerprint) to its experiment anchor, then recompute those addresses, the complete ordered decision traversal, and every derived match before trusting a result, including when two findings are byte-identical.

Unmatched behavioral `fix-in-pr` findings remain `unresolved` in this slice. A classification embedded only in a graded artifact is rejected: it cannot authenticate itself. Unresolved findings are excluded from the precision denominator and make definitive precision unavailable. A later append-only, run-bound curator adjudication ledger must bind the case, finding occurrence, classification, reason/evidence digest, and its own seal before `confirmed-new` or `unsupported` classifications can affect precision or false-discovery rate.

Exact grading remains suitable only for structural smoke and unequivocal location transport. It deterministically treats unexpected structural findings as unsupported so the smoke gate can continue to reject them.

Cost per reliably found root cause is available only for the preregistered three-repeat structure and requires at least two successful detections. One-, two-, or four-repeat data is not relabeled as reliable; the metric remains unavailable.

## Miss stages

The stage vocabulary is `none`, `routing`, `breadth`, `investigation`, `budget`, `presentation`, and `infrastructure`. `presentation` means a defect was detected but filtered or capped; it is not a detection miss.

Attribution is runner-owned, never judge-authored. A behavioral stage may be assigned only from authenticated manifest, breadth, investigation, budget, and presentation evidence. Until all required evidence exists, grading records an infrastructure/unattributable state instead of guessing. Typed-manifest parity and later coverage instrumentation supply the evidence needed to subdivide those cases safely.

## Compatibility

Historical ground-truth files are upgraded in memory with explicit legacy provenance so old structural and accounting artifacts remain readable. New curated development and validation cases must satisfy [`schemas/benchmark-case.schema.json`](../schemas/benchmark-case.schema.json). Legacy graded artifacts retain their original one-finding-per-bug rule; only artifacts carrying `root-cause-v1` grading evidence can represent grouped observations.

Live experiment execution remains fail closed until the accepted containment adapter also owns semantic-judge execution and the experiment protocol records a separate judge attempt, wall-time, and cost budget. This grading slice does not weaken that gate or treat direct legacy CLI grading as benchmark evidence.
