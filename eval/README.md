# Eval harness

Compares model configs (and engines) on bug-finding value: recall, false
positives, and cost per case. The winner is the knee of the cost-vs-recall
curve, not the top of the leaderboard. Claude and Codex runs also report
separate breadth/investigation duration and input-token means; missing provider
cost telemetry is shown as `n/a`, never as free.

Each new matrix directory starts with `matrix-manifest.json`, which inventories
every expected configuration/case/repeat before provider work begins. Every
finished attempt then records either a completed result or a sanitized failure
with a stable kind. Reports show completion and failure rates by kind,
conditional recall, and recall with
failed or interrupted bug-bearing attempts counted as misses. Directories from
older versions that have no attempt manifest are labeled `legacy/incomplete`;
their completion and failure-inclusive metrics are intentionally unavailable.

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

The checked-in seed suite covers nullability, ordinary zero/fallback logic,
swallowed errors, stale frontend closures, and pagination overlap, with clean
rename, nullish-default, and error-propagation controls. This is a regression
floor, not a statistically meaningful production benchmark. Add historical
cases and grow beyond 20 cases before making cost/recall routing decisions.

## Running

```bash
npm run eval:matrix                      # all configs × cases × repeats
npm run eval:grade  -- --runs eval/runs/<dir>
npm run eval:report -- --runs eval/runs/<dir>   # benchmark.json + benchmark.html
```

- Repeats (default 3, `eval/matrix.config.json`) are not optional — runs are
  stochastic, and single-run model comparisons will mislead you.
- `JUDGE=exact` is the default, free line-overlap judge for smoke tests and CI.
  Use `JUDGE=claude` or `JUDGE=codex` for semantic root-cause grading; the
  judge never sees which runner produced a finding. Override its model with
  `PEREGRINE_JUDGE_MODEL` or the provider-specific
  `PEREGRINE_CLAUDE_JUDGE_MODEL` / `PEREGRINE_CODEX_JUDGE_MODEL`.
- Spot-check ~20% of judge decisions by hand early on to calibrate it.

## Zero-cost smoke test

```bash
# mock engine "detects" lines marked `// BUG:` — verifies the whole pipeline
npm run eval:smoke
```

## Comparing against commercial bots

The harness measures *your* bot. To compare with Bugbot/CodeRabbit/Greptile,
mirror the eval cases into a scratch repo as real PRs, enable each bot's
trial, and hand-judge their comments against the same ground truth. Same
metrics, same cases, fair fight.
