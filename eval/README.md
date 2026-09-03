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

Cases are separated by intended use before any provider run:

```
eval/cases/
├── structural-smoke/  # marker-driven fixtures; mock runner only
├── development/       # live cases used while designing an intervention
└── validation/        # live checkpoint cases, never used for prompt tuning

<corpus>/case-<opaque-id>/
├── case.json          # discriminated fixture or historical source contract
├── diff.patch         # runner-owned input, never copied into the checkout
├── ground_truth.json  # grader-owned input, never copied into the checkout
├── metadata.json      # optional sanitized title/body only
└── fixture/           # complete head-state tree for seeded/clean cases
```

Case IDs and directory names must match `case-[a-f0-9]{8,32}`. Descriptive
names, curator notes, issue text, review threads, and later fixes stay outside
all model-visible paths and metadata. Fixture cases use `fixtureDir`;
historical cases use `repoSource`, `baseCommit`, and `headCommit`. Historical
private sources should be supplied as local curator checkouts; `repoSource`
may not embed credentials and the staging clone cannot use ambient credentials.

Build cases three ways:

1. **historical** — mine your repos for bug-fix PRs; the case identifies the
   introducing PR's source plus full base/head object IDs and checked-in diff. Gold
   standard: real bugs that escaped review.
2. **seeded** — take a clean merged PR and inject a realistic mutation
   (inverted conditional, off-by-one, dropped guard). Cheap recall data.
3. **clean** — merged PRs believed bug-free. Every finding is a false
   positive. Keep at least ~25% of cases clean or you won't measure noise.

Keep a handful of cases as a holdout you never tune prompts against.

The checked-in marker-driven suite covers nullability, ordinary zero/fallback
logic, swallowed errors, stale frontend closures, and pagination overlap,
with clean rename, nullish-default, and error-propagation controls. It is a
structural regression floor, not a model corpus or evidence of recall. The
runner refuses to send it to Claude or Codex.

Every scheduled case/configuration/repeat receives a new temporary repository.
The runner reconstructs deterministic base/head commits, supplies those refs
to the normal review path, then destroys the checkout and isolated provider
home whether the attempt succeeds or fails. Provider-visible repositories have
no remotes, hooks, credentialed Git configuration, nested Git data, case
artifacts, or commits newer than the reviewed head.

Before provider inference, Peregrine scans the checkout path, repository tree,
diff, sanitized metadata, and both final stage prompts for answer leakage. Live
cases fail closed on descriptive IDs, path traversal, symlinks, special files,
answer artifacts, ground-truth IDs, and undocumented markers such as `BUG` and
`FIXME`. The attempt manifest records whether provider-host network isolation
is enforced, limited, or not applicable. Current Claude and Codex integrations
record `limited`: tool/sandbox restrictions are present, but the runner cannot
independently attest a provider-host network namespace. Do not admit a live
case whose answer is publicly retrievable from supplied identifiers.

Live provider processes also receive an attempt-specific `HOME`, XDG paths,
temporary directory, and disabled global/system Git configuration. Ambient
SSH agents, Git credential helpers, CLI home directories, proxy URLs, and
unrelated credentials are not forwarded. Consequently, file-backed user-login
sessions are not a supported eval authentication path: provide the selected
provider's explicit environment credential (`ANTHROPIC_API_KEY`,
`CLAUDE_CODE_OAUTH_TOKEN`, or `OPENAI_API_KEY`). A missing credential is a
recorded provider failure, never a reason to fall back to the user's home.

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
# mock engine detects structural markers; no provider process is started
npm run eval:smoke
```

## Comparing against commercial bots

The harness measures *your* bot. To compare with Bugbot/CodeRabbit/Greptile,
mirror the eval cases into a scratch repo as real PRs, enable each bot's
trial, and hand-judge their comments against the same ground truth. Same
metrics, same cases, fair fight.
