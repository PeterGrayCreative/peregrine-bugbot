# Independent unmatched-finding adjudication

Every one of the 62 findings left unmatched by the frozen semantic grading was
reviewed independently against the changed code and, where applicable, narrow
runtime counterexamples. The experiment's original outputs were not altered.

## Clean-labelled cases: all 32 unmatched findings

Classification totals: 29 confirmed change-relevant defects, 2 unsupported
blocking false positives, and 1 disputed contract claim. A separate
high-severity audit classified the disputed redaction claim as unsupported; the
broader audit conservatively left it unresolved. Either treatment leaves the
method-packet arm no worse on the blocking-false-positive gate.

| Attempts and finding indexes | Root | Classification |
| --- | --- | --- |
| `000015#0`, `000016#0`, `000160#0`, `000165#0` | Examples import Go's `text/scanner` instead of the changed local scanner | confirmed defect |
| `000020#0`, `000084#0`, `000173#0`, `000174#0` | Window rewrite compares unnormalized numbers and changes slice semantics | confirmed defect |
| `000033#0`, `000034#0`, `000123#0`, `000124#0`, `000170#0` | Diagnostic logging can mask the original settings-read failure | confirmed defect |
| `000071#0`, `000071#1`, `000072#1`, `000125#0`, `000125#1`, `000126#0`, `000126#1`, `000189#0`, `000190#1` | Logger/handler thresholds and duplicated attachment produce dropped or duplicate records | confirmed systemic defect |
| `000071#2`, `000072#0`, `000126#2`, `000190#3` | Compatibility facade drops public `VALID_LEVELS` and `VALID_FORMATS` | confirmed defect |
| `000072#2`, `000125#2`, `000190#2` | Added JSON profiles expose unescaped-message invalid JSON | confirmed defect |
| `000004#0` | Hypothetical exported-signature caller break | unsupported blocking false positive, treatment |
| `000171#0` | Claim that `max` requires newer Go than declared 1.22 | unsupported blocking false positive, control |
| `000190#0` | Profile redaction metadata is not enacted by `load_profile` | disputed: high-severity audit says unsupported; broad audit says contract unresolved, control |

Reliability by root, expressed as control detections versus treatment detections
across three repeats:

| Root | Control | Treatment | Outcome |
| --- | ---: | ---: | --- |
| Local scanner examples | 1/3 | 3/3 | treatment-only reliable |
| Window coercion/slicing | 1/3 | 3/3 | treatment-only reliable |
| Logger masks primary error | 3/3 | 2/3 | both reliable |
| Logger topology | 3/3 | 3/3 | both reliable |
| Legacy constants | 3/3 | 1/3 | control-only reliable |
| JSON formatting | 1/3 | 2/3 | treatment-only reliable |
| Branded-ID signature claim | 0/3 | 1/3 | unsupported and unreliable |
| Go-version claim | 1/3 | 0/3 | unsupported and unreliable |
| Redaction contract claim | 1/3 | 0/3 | disputed and unreliable |

Thus each arm produced one unambiguously unsupported medium `fix-in-pr`
finding, neither reliably. Even pessimistically treating redaction as another
control false positive, treatment does not worsen blocking false positives.
Four of the six implicated supposedly clean cases contain reproducible defects
and must be corrected or recurated before they can support precision or FDR.

## Seeded case `validation/case-d3f8026e`: all 30 unmatched findings

The 30 instances reduce to 18 omitted, independently confirmed defect roots.
There were 15 canonical confirmed-new instances and 15 later duplicate,
same-root, or composite instances; none were unsupported or unresolved.

| Root | Omitted defect |
| --- | --- |
| R1 | Invalid timestamps bypass lifecycle comparisons through `Date.parse()` returning `NaN` |
| R2 | Valid offset timestamps are ordered lexically instead of chronologically |
| R3 | Reservation preview reports an unpersisted reservation as created |
| R4 | Inbound receipts are summed or filtered before complete validation |
| R5 | Duplicate purchase-order SKUs are silently overwritten |
| R6 | Purchase-order numeric state is not validated |
| R7 | Invalid source or target stock passes transfer validation |
| R8 | Invalid lot quantities can satisfy integer allocations |
| R9 | Event serialization publishes contract-invalid events |
| R10 | Existing serial keys are not canonicalized |
| R11 | Shipment package and rate numbers are not validated |
| R12 | Supplier minimums and lead times are not validated |
| R13 | Utilization bypasses the module's capacity validator |
| R14 | Position and replenishment-rule SKUs need not match |
| R15 | `NaN` bypasses the stockout-threshold range check |
| R16 | Projection rejects reconciliation's signed shortage adjustments |
| R17 | Reservation request identity and time metadata are not runtime-validated |
| R18 | Stock snapshot quantities are not runtime-validated |

| Attempt | Arm / repeat | Finding | Classification | Roots |
| --- | --- | ---: | --- | --- |
| `000055` | control / 2 | 1 | duplicate/same-root | R1, R2 |
| `000055` | control / 2 | 2 | confirmed-new | R3 |
| `000056` | treatment / 2 | 1 | duplicate/same-root | R1 |
| `000056` | treatment / 2 | 2 | duplicate/same-root | R4 |
| `000056` | treatment / 2 | 3 | duplicate/same-root | R5 |
| `000056` | treatment / 2 | 4 | duplicate/same-root | R7 |
| `000073` | treatment / 1 | 1 | confirmed-new | R2 |
| `000073` | treatment / 1 | 2 | confirmed-new | R1 |
| `000073` | treatment / 1 | 3 | confirmed-new | R4 |
| `000073` | treatment / 1 | 4 | confirmed-new | R8 |
| `000073` | treatment / 1 | 5 | confirmed-new composite | R5, R6 |
| `000073` | treatment / 1 | 6 | confirmed-new | R9 |
| `000073` | treatment / 1 | 7 | confirmed-new | R10 |
| `000073` | treatment / 1 | 8 | confirmed-new | R11 |
| `000073` | treatment / 1 | 9 | confirmed-new | R7 |
| `000073` | treatment / 1 | 10 | confirmed-new | R12 |
| `000073` | treatment / 1 | 11 | confirmed-new | R13 |
| `000073` | treatment / 1 | 12 | confirmed-new | R14 |
| `000073` | treatment / 1 | 13 | confirmed-new | R15 |
| `000074` | control / 1 | 1 | duplicate/same-root | R1 |
| `000074` | control / 1 | 2 | duplicate/same-root | R2 |
| `000115` | control / 3 | 1 | duplicate/same-root | R1 |
| `000115` | control / 3 | 2 | confirmed-new | R16 |
| `000116` | treatment / 3 | 1 | duplicate/same-root composite | R1, R2 |
| `000116` | treatment / 3 | 2 | duplicate/same-root | R4 |
| `000116` | treatment / 3 | 3 | confirmed-new composite | R17, R18 |
| `000116` | treatment / 3 | 4 | duplicate/same-root | R9 |
| `000116` | treatment / 3 | 5 | duplicate/same-root composite | R5, R6 |
| `000116` | treatment / 3 | 6 | duplicate/same-root | R11 |
| `000116` | treatment / 3 | 7 | duplicate/same-root | R12 |

The control union contains R1, R2, R3, and R16. The treatment union contains
R1, R2, R4-R15, R17, and R18. This case's official single seeded bug can still
be reported on its own, but the case cannot support precision, FDR, or a
truth-complete denominator until it is rebuilt or fully recurated.

## Lane calibration audit

The first deterministic qualifying paired sample for every built-in lane was
independently checked. Both arms matched the expected root and `fix-in-pr`
disposition in all 12 samples.

| Lane | Case / repeat | Control / treatment attempts |
| --- | --- | --- |
| authorization | `development/case-13f0a2c1` / 1 | `000059` / `000060` |
| boundaries-pagination | `development/case-a73e69c2` / 1 | `000050` / `000049` |
| concurrency | `development/case-a17c4e92` / 1 | `000162` / `000161` |
| contracts | `development/case-17ac84e2` / 1 | `000035` / `000036` |
| data-integrity | `development/case-6c19f4ab` / 1 | `000179` / `000180` |
| error-handling | `development/case-a13f09c2` / 1 | `000127` / `000128` |
| frontend-state | `development/case-d40b36f9` / 1 | `000047` / `000048` |
| identifiers | `development/case-2d91ac76` / 1 | `000098` / `000097` |
| logic-correctness | `development/case-e95d2a63` / 1 | `000214` / `000213` |
| persistence | `development/case-a1c4e90d` / 1 | `000150` / `000149` |
| runtime-config | `development/case-d0629f8b` / 1 | `000011` / `000012` |
| test-quality | `development/case-c83a51e7` / 1 | `000158` / `000157` |

This calibration covers root and disposition, not severity. Severity differed
from the gold label or between arms for several samples and remains a stated
limitation.
