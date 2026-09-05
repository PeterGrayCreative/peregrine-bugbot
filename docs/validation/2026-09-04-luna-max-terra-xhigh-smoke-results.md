# Luna Max / Terra Xhigh smoke results

## Decision

Stop this treatment before `fast-screen` and return subsequent method and
prompt experiments to the accepted Luna-high breadth and Sol-high investigation
route.

The treatment preserved registered recall on the six-case smoke panel, but its
paired wall time was materially worse on every case. The sealed funnel decision
is `inconclusive`, not `reject`, because smoke deliberately does not gate
efficiency and one control-only unmatched finding remains unresolved. The stop
recorded here is therefore an operator product constraint: a route with this
size and consistency of wall-time regression is not worth another 48 review
attempts merely to reach the first efficiency gate.

No production route changed. No `fast-screen`, `confirmation`, or
`full-checkpoint` run was started.

## Frozen comparison

- Control: Luna high breadth to Sol high investigation, using the accepted
  method packet.
- Treatment: Luna max breadth to Terra xhigh investigation, using the same
  method packet.
- Judge: contained, blinded Luna medium using `semantic-v1`.
- Repository commit: `5d719102bb424e0148d967509665a204b39166b0`.
- Corpus: the frozen six-case `smoke` panel, including three high-risk
  sentinels, one compatibility proxy, and two clean controls.
- Funding/accounting: contained CLI session with best-effort monetary cost;
  unavailable dollars remain `n/a`.

The preregistration is
[`2026-09-04-luna-max-terra-xhigh-fast-screen-preregistration.md`](2026-09-04-luna-max-terra-xhigh-fast-screen-preregistration.md).

## Treatment-only diagnostic

Run: `2026-09-04T23-26-53-741Z`

- 6/6 treatment attempts completed.
- All five registered bugs and root causes were found.
- Neither clean control produced a finding.
- Mean wall time was 191.35 seconds; median was 183.87 seconds.
- Mean total input was 280,325 tokens, of which 63,877 were uncached and
  216,448 cached.
- The decision is correctly `diagnostic-only`; this run cannot advance a gate.

## Paired smoke

Run: `2026-09-04T23-47-36-593Z`

| Measure | Control | Treatment |
| --- | ---: | ---: |
| Completed | 6/6 | 6/6 |
| Registered bug-instance recall | 100% | 100% |
| Registered root-cause recall | 100% | 100% |
| Mean wall time | 94.18 s | 185.07 s |
| Median wall time | 88.56 s | 176.15 s |
| Mean breadth time | 58.09 s | 148.69 s |
| Mean investigation time | 30.90 s | 31.17 s |
| Mean total input tokens | 138,967 | 272,599 |
| Mean uncached input tokens | 49,004 | 55,938 |
| Mean cached input tokens | 89,963 | 216,661 |
| Mean output tokens | 3,456 | 8,251 |
| Mean reasoning tokens | 2,439 | 6,853 |
| Mean tool calls | 3.83 | 6.00 |

The preregistered paired metric reports a treatment improvement of
`-82.72593597658164%`, meaning the treatment was approximately 82.7% slower by
the case-paired median. Its case-cluster bootstrap interval is
`[-177.71327798731303%, -59.427523604956875%]`; all six case-level comparisons
favored the control.

The aggregate means tell the same story: treatment wall time was approximately
96.5% higher, total input was approximately 96.2% higher, and output was
approximately 138.7% higher. Nearly all added wall time arose in breadth:
Luna-max breadth averaged 148.69 seconds versus 58.09 seconds for Luna high,
while Terra-xhigh and Sol-high investigation means were nearly equal. This is
an attribution clue, not an isolated-model causal claim, because both model
route changes were bundled in one treatment.

One control-only finding on clean case `development/case-5ea42d18` was
initially unresolved. It claimed that narrowing an exported cache-key helper to
a branded identifier broke existing callers. Its sealed finding-evidence digest is
`da00f331f7472d4c99d4e9986c03c3a3d56a9f65289966b79303a422a5ecf54d`.
A later blinded curator classified it as unsupported because the fixture
contains no direct plain-string caller or compatibility contract. The separate
ledger reports control precision 0.8/FDR 0.2 and treatment precision 1/FDR 0.
The linked version-2 smoke decision mechanically says `advance` because smoke
has no efficiency gate; the operator's wall-time rejection remains controlling,
and no fast-screen is authorized.

## Conclusions

1. Luna max breadth plus Terra xhigh investigation did not improve bug finding
   on this panel because both routes already found every registered root.
2. The treatment consumed substantially more time and token work. The added
   time was concentrated in breadth.
3. The panel is small and cannot establish general model quality, but it is
   sufficient for the operator's stated early-stop rule: large wall-time
   increases are unacceptable.
4. Future behavioral experiments return to Luna high breadth and Sol high
   investigation on both arms unless model routing is itself the isolated,
   preregistered intervention.
5. The formerly unresolved control finding is retained through the durable
   curator-adjudication path. Resolving it does not justify more provider
   attempts on this rejected route.

An independent read-only audit reproduced the registered recall and paired
wall-time results, confirmed that all six timing pairs favored the control, and
agreed that this experiment should not advance. It also identified the
adjudication, diagnostic-report quarantine, and miss-attribution gaps now
recorded as open checklist prerequisites.

## Evidence

The complete sanitized artifacts are stored under
[`artifacts/2026-09-04-luna-max-terra-xhigh-screen`](artifacts/2026-09-04-luna-max-terra-xhigh-screen/README.md).

- Treatment-only experiment ID:
  `f468e08f304b9562209ad6680b6dde7c5c0b63ab0a9d6191e01f37c405bbecbe`
- Treatment-only terminal seal:
  `1fd21ff27136439feea245aab9240446f166ac3af6517f3dc3f24550ddb26e59`
- Treatment-only grading seal:
  `db58e2aeba6fd53f68059a04da0c751aa07b66ffde6cdcd9262fe41a0f4f1c40`
- Paired experiment ID:
  `251f82be481b224856534e5fe61c185789c591adc7fddc7b44616da2ba983185`
- Paired terminal seal:
  `dd34c7732ff04b5856dcd62b1255734dceea8fb06a67546752805d49c1a553a7`
- Paired grading seal:
  `89a84e087c00ddcd1b70702060cad5dd4283923c130c4788ab9b392f342228e2`
- Paired funnel decision:
  `8a185ce091016d19fc26ed53bc66fc950168e042efd5ff8e16fdf442be411f81`
