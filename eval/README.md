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
├── leakage_exceptions.json # optional content hashes + curator reasons
└── fixture/           # complete head-state tree for seeded/clean cases
```

Case IDs and directory names must match `case-[a-f0-9]{8,32}`. Descriptive
names, curator notes, issue text, review threads, and later fixes stay outside
all model-visible paths and metadata. Fixture cases use `fixtureDir`;
historical cases use `repoSource`, `baseCommit`, and `headCommit`. Historical
private sources should be supplied as local curator checkouts; `repoSource`
may not embed credentials and the staging clone cannot use ambient credentials.
`case-aliases.json` is a curator-only compatibility map so pre-isolation run
artifacts with the former descriptive case names remain gradeable.
When legitimate historical source contains a marker such as `BUG` or `FIXME`,
`case.json` may name `leakageExceptionsFile`. Its version-1 entries contain
only the exact artifact SHA-256 and a substantive curator reason. A stale,
malformed, or non-matching hash does not bypass validation; exceptions never
permit a ground-truth phrase or prompt marker.

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
every reachable base/head Git blob (including binary and deleted files), diff,
sanitized metadata, and both final stage prompts for answer leakage. Live
cases fail closed on descriptive IDs, path traversal, symlinks, special files,
answer artifacts, ground-truth IDs, and undocumented markers such as `BUG` and
`FIXME`. The attempt manifest records whether provider-host network isolation
is enforced, unavailable, or not applicable. Current Claude and Codex integrations
record `unavailable`. CLI flags suppress local instructions, settings, hooks,
rules, MCP configuration, and trust state where supported, but neither CLI
attests a host filesystem allowlist or network namespace. Peregrine therefore
fails all live matrix attempts closed before provider execution. Enabling live
evaluation requires an externally enforced sandbox exposing only the sanitized
checkout, sanitized assets, required output, and provider endpoint.
Admin-managed provider policy may still apply and is not claimed as disabled;
the host sandbox must prevent it from reaching curator-only material.

Once an external containment backend permits provider launch, the live process
receives an attempt-specific `HOME`, XDG paths, temporary directory, and
disabled global/system Git configuration. Ambient SSH agents, Git credential
helpers, CLI home directories, proxy URLs, and unrelated credentials are not
forwarded. File-backed user-login sessions are therefore not a supported eval
authentication path: provide the selected provider's explicit environment
credential (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). Claude's eval-only
`--bare` mode intentionally disables OAuth and keychain authentication. At
that point, a missing credential is recorded as a provider failure; without
external containment, the earlier isolation check remains a configuration
failure and no provider process starts.

Each accepted case now proves a reproducible two-commit range before an engine
can run. Fixture commits use fixed identities and timestamps, including an
empty base for addition-only cases. Historical cases export the complete base
and head trees into the sanitized repository, preserve the source object
format, and require both recreated tree IDs to match the source tree IDs. That
last check fails closed on omitted unchanged content, Git links, checkout
filters, and normalization drift. The sanitized repository must have exactly
one local review ref, no remotes, alternates, shallow boundary, grafts, replace
refs, future objects, or unexpected reflog objects.

The canonical checked-in patch is the exact byte output of
`git diff --binary --full-index --no-ext-diff --no-color --find-renames
<base>...<head>` with Git's production-default context. Its documented
normalization is `identity-v1`: no newline, encoding, or whitespace rewriting
is allowed. The binary/full-index flags make binary changes reconstructable;
the default context keeps evaluation faithful to production review prompts.
Patch artifacts are marked `-text -whitespace` in `.gitattributes` so checkout
EOL conversion and the outer repository's trailing-whitespace checker cannot
reinterpret valid nested unified-diff context.

After history verification and before any provider or mock engine invocation,
every attempt calls the exported production `prepareReviewManifest` entry
point. Unavailable, empty, oversized, secret-bearing, or ref-mismatched output
is a configuration failure. Attempt records retain the verified history even
when manifest preflight fails; successful preflight additionally retains the
exact bounded manifest text, its UTF-8 SHA-256, refs, and profile provenance.
Typed manifest parsing remains a later shadow/parity slice, so this work does
not alter prompts, grading, routing, budgets, posting, or model choice. These
history and manifest checks are evaluation-integrity evidence, not model-quality
evidence.

## Running

```bash
npm run eval:matrix                      # all configs × cases × repeats
npm run eval:grade  -- --runs eval/runs/<dir>
npm run eval:report -- --runs eval/runs/<dir>   # benchmark.json + benchmark.html
```

Until genuine sanitized development and validation cases are admitted,
`npm run eval:matrix` writes an empty manifest, prints that no provider process
was started, and exits successfully. It never substitutes structural fixtures
or presents synthetic results as model evidence. Reports group development and
validation attempts separately.

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
