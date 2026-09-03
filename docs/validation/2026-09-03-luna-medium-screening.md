# Codex Luna-Medium Diagnostic Screening

**Date:** 2026-09-03

**Scope:** Benchmark capability checkpoint

**Disposition:** Passed as diagnostic development screening; not a checkpoint,
historical-gold, routing-approval, or sealed-holdout result

## What this validates

Peregrine can run a preregistered, subscription-backed Codex experiment from
case materialization through contained review, blinded semantic judging,
root-cause grading, and HTML/JSON reporting. Failed and interrupted precursor
runs remained sealed evidence; none were reclassified as clean or omitted from
their own reports.

This screening does **not** establish the plan's historical gold set or sealed
holdout. The visible seeded corpus is suitable for developing and debugging
experiments. Production route changes still require the later checkpoint gates.

## Runtime and containment

- Repository commit used by the successful run:
  `0215dd360ad020154df21ebbfead9c53df28202d`
- Node: `v22.22.1`
- Codex CLI: `0.152.0`
- Accepted private image:
  `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3`
- Provider access: explicitly selected sanitized CLI session
- Cache condition: uncontrolled
- Cost accounting: best effort; monetary cost unavailable rather than recorded
  as zero

The host authenticates to private GHCR and pre-pulls the exact accepted digest.
Runtime launches use `--pull never`. Docker configuration and registry
credentials are not mounted into review or judge containers. Provider state is
an attempt-private tmpfs; only the sanitized provider `auth.json` is mounted
read-only into that state directory.

## Corpus readiness

Strict validation admitted 36 visible behavioral cases:

- 20 development and 16 validation cases
- 24 bug cases and 12 clean controls (33.3% clean)
- All 12 built-in lanes represented in both visible corpora
- Four multi-observation cases and three representative large-diff cases
- Three languages and six architecture families
- All cases use authenticated, reproducible fixture sources

This satisfies the visible seeded-development benchmark contract. It does not
satisfy `goldSetReady` or `finalHoldoutReady` because no historical repository
families or inaccessible steward-controlled holdout have been assigned.

## Preregistered screening

The checked-in configuration is
[`eval/matrix.codex.screening.json`](../../eval/matrix.codex.screening.json).
It selects eight admitted development cases before model output is observed,
uses one repeat, and schedules 16 randomized/interleaved review attempts.

- Control: Luna high for breadth, Sol high for investigation
- Treatment: Luna medium for breadth and investigation
- Blinded semantic judge: Luna medium, `semantic-v1`
- Review ceiling: 16 provider attempts, three-hour wall time, 25% failure rate
  after eight attempts, or three consecutive failures
- Judge ceiling: 100 provider attempts with the same wall-time and failure stops

Experiment ID:
`e098b5223a0ad2d507a0a29af916cbd497ca661b39c8c26daa27ae86beaa62e3`

## Result

| Metric | Luna medium only | Luna high to Sol high |
| --- | ---: | ---: |
| Completed attempts | 8/8 | 8/8 |
| Bug-instance recall | 100% | 100% |
| Root-cause recall | 100% | 100% |
| Adjudicated precision | 100% | 100% |
| False-discovery rate | 0% | 0% |
| Blocking false positives on clean controls | 0 | 0 |
| Mean wall time | 62.48 s | 110.52 s |
| Mean input tokens | 123,015.75 | 305,377.38 |
| Mean uncached input tokens | 34,727.75 | 51,041.38 |
| Mean cached input tokens | 88,288 | 254,336 |
| Mean output tokens | 1,948.13 | 3,751.50 |
| Mean reasoning tokens | 895.75 | 2,475.88 |
| Mean tool calls | 4.25 | 7.50 |
| Monetary cost | n/a | n/a |

On this diagnostic sample, the treatment preserved measured quality while
reducing mean wall time by 43.47%, total input tokens by 59.72%, uncached input
tokens by 31.96%, cached input tokens by 65.29%, output tokens by 48.07%,
reasoning tokens by 63.82%, and tool calls by 43.33%. One repeat over eight
visible cases is not enough to infer non-inferiority or authorize production
routing.

## Fail-closed evidence

Four precursor experiment directories were preserved locally and sealed:

- `2026-09-03T19-00-22-757Z`: provider-asset leakage and stdin failures
- `2026-09-03T19-15-35-122Z`: read-only Codex state failures
- `2026-09-03T19-27-25-426Z`: reviews completed; judge path translation failed
- `2026-09-03T19-59-00-234Z`: reviews completed; judge rejected a non-Git checkout

Those failures exposed and drove fixes to provider-visible admission parity,
interactive stdin, private writable Codex state, host/container path
translation, and the judge-only trusted-directory flag. Raw run directories are
ignored and are not committed because they can contain large provider evidence;
the immutable hashes below identify the successful local evidence.

## Evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| Screening configuration | `cf0e6801575f42d1b0937ce35c5242c9e67fad8ebe30484383059e22f13403a3` |
| Experiment manifest | `ee12d4af60c4439405d7f5cf2627326069821e97f9c18edc30184aac79584c67` |
| Experiment terminal seal | `921739fd3af40639d08f9872b5f0a6428ed4cd91e200c0a833e40ca6c9a0b1cc` |
| Judge terminal seal | `89d1fa3e8abf2c0b8fbeeda0db411f2f9c89a4bf09ed49a6d5f7bc59b94b0b30` |
| Grading seal | `abf8b708900b46733f46958f7fc18b366ff22938b687f19cfd2f5f77a2c9b222` |
| JSON report | `21f29e4606bd5b308f7da97e4a0730f518240ff6b5686e8de0cbda48cae0fa25` |
| HTML report | `b5eae7ef61cf7140a2edc0c3d1b8eb51bfc721272e54d1509134ea99b015861b` |

The experiment manifest also freezes corpus, prompt, method, schema, profile,
judge, effective-model, and matrix hashes. Re-running changed code creates a new
experiment identity rather than mutating this evidence.

## Commands

Activate the pinned Node version before every Node command:

```bash
source /Users/petergray/.nvm/nvm.sh
nvm use 22
npm run eval:admit-corpus
npm run validate
```

With the exact image already present and a mode-0700 sanitized Codex session:

```bash
PEREGRINE_CODEX_SESSION_DIR=/path/to/sanitized/session \
  npm run eval:matrix -- --config eval/matrix.codex.screening.json
npm run eval:judge -- --runs eval/runs/<run-directory>
npm run eval:grade -- --runs eval/runs/<run-directory>
npm run eval:report -- --runs eval/runs/<run-directory>
```
