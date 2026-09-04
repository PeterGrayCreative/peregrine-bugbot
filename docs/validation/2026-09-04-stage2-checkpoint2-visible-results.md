# Stage 2 Checkpoint 2 visible comparison

## Outcome

Checkpoint 2's preregistered visible cost-intervention gates pass for PR 8's
method packet with the existing full breadth ledger. The treatment preserved
reliable detection of every registered seeded bug and root, lost no registered
high-severity root, completed every scheduled attempt, and reduced median
paired wall time by 29.81% across development and validation.

This is not final non-inferiority evidence. Independent review also found that
several cases marked clean or truth-complete contain unrecorded defects. The
frozen experiment remains valid for its registered seeded roots and paired work
measurements, but those contaminated cases must be corrected or recurated
before later precision, FDR, or truth-complete comparisons.

## Frozen experiment

- Run: `2026-09-04T10-24-44-905Z`
- Experiment ID: `3d4a67e08b52dbe32fff167f83f8f7648d66977cf0671ae200ee63d9abb6be5c`
- Repository commit: `405c70a7ec8e9ddd401df6c6f93e7017154e955b`
- Experiment manifest SHA-256: `d4fc5641101e031f803ec078d2a7268d438f988b15e54ab715a17db00773b777`
- Matrix configuration SHA-256: `3258da2cfd303e1dcbc866cbe55e5503debefa3bf8ac5674fffc4e22cdebf5a2`
- Corpus SHA-256: `a2e2d2b5b08b322818c258f72d7e8c7c5cafd928fc8acb29aa58af27c889bc49`
- Runtime image: `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`
- Codex CLI: `0.152.0`
- Experiment terminal seal: `ec2759e3b892786cdf15ea3f65d2955739bd0d0195681bc6b9d57a9a66941ab9`
- Judge terminal seal: `96f6746800d3328711390f2c0c58343dca130bfde5dc2eae6ee0db6eb2815a02`
- Grading seal: `22bdda8fc3ac3f2de06fbdf3672836d7048e9ecbb912619df7d919699eea14b9`

The matrix scheduled 36 cases, two arms, and three repeats: 216 attempts. All
216 reached a terminal state. Treatment completed 108/108; control completed
107/108, with one preserved 300-second timeout on clean validation case
`case-3ef9a502` repeat 3. The contained Luna-medium semantic judge completed
197/197 decisions without failure or retry.

## Recall and completion

| Corpus | Completion control / treatment | Reliable bugs | Reliable roots | Reliable high roots |
| --- | --- | --- | --- | --- |
| Development | 60/60 / 60/60 | 14/14 / 14/14 | 12/12 / 12/12 | 7/7 / 7/7 |
| Validation | 47/48 / 48/48 | 14/14 / 14/14 | 12/12 / 12/12 | 5/5 / 5/5 |
| Combined | 107/108 / 108/108 | 28/28 / 28/28 | 24/24 / 24/24 | 12/12 / 12/12 |

There were zero registered reliable bug regressions, zero registered reliable
root regressions, and zero registered high-root losses. The one control miss was
an infrastructure-labeled finding on one repeat of `case-f16c8b40`; control
still met the registered 2-of-3 reliability rule on that root.

## Paired efficiency

Only the 107 pairs where both arms completed enter paired duration and work
metrics. Percentage change is `100 * (treatment - control) / control`.

| Corpus | Median paired wall change | Treatment faster | 95% bootstrap interval |
| --- | ---: | ---: | ---: |
| Development | -28.31% | 52/60 | [-38.96%, -19.96%] |
| Validation | -29.88% | 36/47 | [-40.45%, -15.46%] |
| Combined | -29.81% | 88/107 | [-36.67%, -20.31%] |

The preregistered deterministic bootstrap used 10,000 resamples, seed
`202609043`, a 32-bit LCG, ordinary medians, and R type-7 percentile endpoints.
A case-cluster sensitivity bootstrap also remained entirely below zero:
development [-38.08%, -19.69%], validation [-47.27%, -11.12%], and combined
[-36.91%, -19.73%].

Combined paired supporting indicators:

| Indicator | Change |
| --- | ---: |
| Input tokens | -62.15% |
| Uncached input tokens | -39.35% |
| Cache-read tokens | -63.65% |
| Output tokens | -25.25% |
| Reasoning tokens | -25.96% |
| Tool calls | -50.00% |
| Tool-output bytes | -94.53% |
| Turns | 0.00% |
| Prompt bytes | +288.34% |

The larger prompt is expected because the treatment inlines the stable method
packet. Provider-reported monetary cost was unavailable, so no dollar claim is
made.

## Independent adjudication and corpus correction

All 62 unmatched findings were reviewed rather than automatically scored as
false positives.

- The 32 findings on clean-labelled cases contained 29 confirmed defects, two
  unsupported medium blocking findings, and one disputed control-only High
  contract claim. Each arm produced one unambiguously unsupported blocking
  finding, neither reliably. Treatment therefore did not worsen this gate.
- Four of six implicated clean-labelled cases contain confirmed defects.
- The 30 unmatched findings on `validation/case-d3f8026e` reduced to 18 real
  omitted roots. Treatment found a union of 16; control found four.
- Treatment lost reliable detection of one newly discovered medium root—the
  removed compatibility constants—while gaining reliable detection of three
  other newly discovered roots. This is outside the frozen registered seeded
  denominator and is disclosed rather than silently folded into the score.
- Root and disposition were independently confirmed on one deterministic
  paired sample for every built-in lane. Severity was not fully calibrated.

The affected cases must be quarantined from truth-complete precision/FDR use
until their ground truth and curator proofs are repaired. The frozen run and
grading are not rewritten after seeing these results.

## Gate decision

| Checkpoint 2 gate | Result |
| --- | --- |
| No registered reliable high-severity root regresses | Pass: 12/12 both arms |
| At most one registered visible seeded bug regresses | Pass: zero |
| Blocking false positives do not regress | Pass: one unsupported medium finding per arm; neither reliable |
| Completion does not regress | Pass: treatment 108/108 versus control 107/108 |
| Effective cost or median wall improves by at least 20% | Pass: median paired wall -29.81% |
| Paired deltas and uncertainty support the aggregate | Pass: both bootstrap analyses remain below zero |

PR 8's method packet is accepted for the visible Checkpoint 2 cost
intervention. PR 9's structural/adaptive compaction remains rejected and
unmerged. Before Checkpoint 3 measurement, repair or replace the contaminated
corpus cases and preregister how newly discovered roots enter future scoring.

The complete versioned archive is
[here](./artifacts/2026-09-04-stage2-checkpoint2-visible/README.md).
