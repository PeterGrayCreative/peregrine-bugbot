# Eval harness

Compares model configs (and engines) on bug-finding value: recall, false
positives, and cost per case. The winner is the knee of the cost-vs-recall
curve, not the top of the leaderboard.

## Case library

Each directory under `eval/cases/` is one case:

```
eval/cases/<name>/
├── case.json          # kind: seeded | historical | clean; fixture or repo+commit
├── diff.patch         # the diff under review (base...head)
├── ground_truth.json  # known bugs ({"bugs": []} for clean cases)
└── fixture/           # head-state code (or use repo+commit in case.json)
```

Build cases three ways:

1. **historical** — mine your repos for bug-fix PRs; the case is the PR that
   *introduced* the bug (repo+commit at its head, diff of that PR). Gold
   standard: real bugs that escaped review.
2. **seeded** — take a clean merged PR and inject a realistic mutation
   (inverted conditional, off-by-one, dropped guard). Cheap recall data.
3. **clean** — merged PRs believed bug-free. Every finding is a false
   positive. Keep at least ~25% of cases clean or you won't measure noise.

Keep a handful of cases as a holdout you never tune prompts against.

## Running

```bash
npm run eval:matrix                      # all configs × cases × repeats
npm run eval:grade  -- --runs eval/runs/<dir>
npm run eval:report -- --runs eval/runs/<dir>   # benchmark.json + benchmark.html
```

- Repeats (default 3, `eval/matrix.config.json`) are not optional — runs are
  stochastic, and single-run model comparisons will mislead you.
- Grading uses a blind LLM judge (`JUDGE=llm`, model via
  `PEREGRINE_JUDGE_MODEL`); it never sees which config produced a finding.
  `JUDGE=exact` is a free line-overlap fallback for smoke tests and CI.
- Spot-check ~20% of judge decisions by hand early on to calibrate it.

## Zero-cost smoke test

```bash
# mock engine "detects" lines marked `// BUG:` — verifies the whole pipeline
JUDGE=exact npm run eval:matrix && JUDGE=exact npm run eval:grade && npm run eval:report
```

(Trim `matrix.config.json` to just the mock config first, or let the claude
configs fail without an API key and grade what completed.)

## Comparing against commercial bots

The harness measures *your* bot. To compare with Bugbot/CodeRabbit/Greptile,
mirror the eval cases into a scratch repo as real PRs, enable each bot's
trial, and hand-judge their comments against the same ground truth. Same
metrics, same cases, fair fight.
