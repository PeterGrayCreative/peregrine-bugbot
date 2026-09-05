# Eval harness

Compares model configs (and engines) on bug-finding value: recall, false
positives, and cost per case. The winner is the knee of the cost-vs-recall
curve, not the top of the leaderboard. Claude and Codex runs also report
separate breadth/investigation duration and input-token means; missing provider
cost telemetry is shown as `n/a`, never as free.

Review artifacts preserve provider token semantics instead of forcing both
providers into one lossy cached-token field. Claude records base input, cache
creation, cache reads, output, and reasoning output separately. Codex records
the reported input total, safely derived uncached input, cache reads, output,
and reasoning output. A normalized total is present only when every contributing
component is known. Each stage also records UTF-8 prompt bytes, duration, the
configured/requested model name, a prompt hash, and turns/tool work when the
provider exposes a complete event stream. Provider-resolved model identity stays
unavailable unless the provider reports it explicitly.
Raw provider envelopes and tool output are not persisted. If a later stage
fails, its attempt artifact retains sanitized stage telemetry and already
incurred spend from earlier stages.

Reports label cost as provider-reported, estimated, mixed-source, or
unattributed.
An estimate requires an exact dated pricing contract; unknown models and
partial usage stay `n/a`. Aggregate token, work, and cost values are emitted
only when every contributing stage and every expected attempt supplied the
field, so a failure or missing value cannot silently improve a route's mean.
Wall-time mean and median include failed attempts when every expected attempt
has an artifact; they are `n/a` when an attempt is missing. P95 uses the
nearest-rank definition and is shown only with at least 20 attempts. Known
spend from failed attempts is shown separately as an incurred-cost lower bound,
not as a comparable cost-per-case result.

Each new matrix directory starts with `matrix-manifest.json`, which inventories
every expected configuration/case/repeat before provider work begins. Every
finished attempt then records either a completed result or a sanitized failure
with a stable kind. Reports show completion and failure rates by kind,
conditional recall, and recall with
failed or interrupted bug-bearing attempts counted as misses. Directories from
older versions that have no attempt manifest, and P1 schema-v1 artifacts from
before manifest attempts recorded corpus and runner identity, are labeled
`legacy/incomplete`; their completion and failure-inclusive metrics are
intentionally unavailable.
PR3 schema-v1 artifacts that recorded corpus and reproducible-history
provenance but predate manifest runner identity and provider-correct stage
telemetry are recognized only by their exact writer-era shape. They are also
`legacy/incomplete`: grading remains available, but their old aggregate usage,
cost, duration, and recall are excluded from behavioral comparisons.
The corresponding PR3 mock shape remains raw-less and is accepted only with
its exact zero-valued legacy usage fields; it is not promoted to a behavioral
or telemetry benchmark.
Their telemetry denominator and all comparison telemetry means are also
reported as `n/a` because these formats do not establish a comparison-safe
attempt and telemetry identity.

Runs using the deterministic mock are labeled `structural-only`. They verify
fixture transport, accounting, and expected marker detection; their marker
counts are never presented as model recall, provider cost, or findings-per-dollar
and are excluded from the behavioral cost-versus-recall plot.

## Immutable experiments

Every new matrix config must declare one of four experiment modes:

- `structural-smoke` uses the mock runner, exact grading, and no provider
  access. It proves only the deterministic harness path.
- `screening` is a small development-corpus control/treatment comparison used
  to reject an unsafe or clearly inferior intervention. It is not release-level
  efficacy evidence, holdout evidence, or proof that the visible gold-set gate
  is ready.
- `visible-checkpoint` uses the admitted visible seeded benchmark across
  development and validation without claiming historical-gold or sealed-holdout
  status. A frozen shortened-funnel category produces `visible-seeded-panel`;
  an ad hoc opaque `caseIds` allowlist produces `diagnostic-visible-subset`
  evidence; omitting both runs the full visible corpus and produces
  `visible-seeded-checkpoint` evidence.
- `checkpoint` is the larger contemporaneous control/treatment comparison used
  at the historical-gold evaluation gate. Development and validation results
  remain separate in the report.

A fresh run writes a self-authenticating `experiment-manifest.json` before its
first attempt. The manifest freezes the repository commit; repository, corpus,
prompt, method, schema, effective merge-base profile, judge, matrix config,
Peregrine config, and aggregate configuration hashes; effective model names and
efforts; CLI versions and provider availability; the random seed and cache
condition; access and cost-accounting modes; all ceilings; timestamps; and the
complete run order. `matrix-manifest.json` is derived from that schedule.

For screening, visible-checkpoint, and checkpoint experiments, the seeded scheduler shuffles
case/repeat blocks, keeps each control/treatment pair adjacent, and alternates
which variant runs first. Attempts execute sequentially so the two variants are
contemporaneous without concurrent sessions obscuring rate limits or accounting.
The seed reproduces the order; it does not make model output deterministic.

The evidence directory is append-only:

```text
eval/runs/<timestamp>/
├── experiment-manifest.json
├── matrix-manifest.json
├── state/
│   ├── attempt-000001.started.json
│   └── attempt-000001.provider-started.json  # live provider attempts only
├── attempt-000001.json                       # terminal success or failure
├── experiment-stop.json                      # present only after a ceiling stops the run
├── experiment-terminal-seal.json             # complete/stopped manifests, state, attempts, stop
├── attempt-000001.graded.json                 # completed attempts only
├── experiment-grading-seal.json              # all applicable graded artifacts
└── funnel-decision.json                       # optional write-once stage decision
```

Manifests, state markers, terminal attempts, and stop records use exclusive,
atomic creation and are never replaced. Before releasing its writer lock, a
complete or ceiling-stopped run writes a terminal seal over both manifests,
every state marker and terminal attempt, and any stop record. The lock itself,
grades, reports, and seals are excluded. A sealed run is terminal; resume only
validates and returns it. A durable start marker without a terminal attempt is
an interruption: it stays unsealed, is never resumed in place, and remains
eligible for retry. Retrying a failed or interrupted attempt creates a new
one-attempt experiment whose manifest links the source experiment, raw manifest
hash, attempt ID, and exact source-attempt evidence digest; the source evidence
is unchanged. Every experiment terminal record and derived grade also carries
the experiment ID and raw manifest hash, preventing same-named attempts from
another run from being substituted. Concurrent resumes are rejected by a
run-directory lock. A stale lock requires deliberate operator inspection and
recovery.

Grading requires and validates the terminal seal. It preserves and validates
valid grades when continuing a partial, unsealed grade set, then writes one
grading seal only after every completed attempt has a grade. Failed attempts
have no grade. Reporting requires both seals and validates the complete graded
artifact set, so replacement or deletion cannot silently improve a benchmark.

Ceilings are evaluated from durable evidence before the next scheduled attempt.
They cover provider-started attempts, observed provider cost when available,
the sum of persisted attempt durations, overall failure rate after its declared
minimum sample and a complete paired block, and consecutive failures. Because a provider can exceed a
dollar or wall-time threshold during an in-flight attempt, those observed
ceilings stop work before the following attempt rather than promising an
absolute upper bound. The provider-attempt limit is the hard reviewer-attempt
boundary; one reviewer attempt may still contain both breadth and investigation
provider calls. Failure ceilings likewise stop before the following attempt.
The stop decision and the evidence used to reach it are written to
`experiment-stop.json`; a stopped experiment is not silently resumed.

`providerAccess` and `costAccounting` describe how a live experiment is funded
and measured:

- `api-key` with `required` accounting is for an explicit provider credential
  and requires a dollar ceiling. Missing cost after provider work stops the
  experiment before another call.
- `cli-session` supports subscription/session-backed Claude Code or Codex CLI
  runs without requiring API billing credentials. Use `best-effort` accounting:
  provider-reported token, work, duration, and cost fields are preserved when
  available, but missing dollar cost stays `n/a`. A positive
  `maxProviderAttempts` is therefore mandatory when calls are enabled.

The selected access mode is evidence, not a credential fallback. A
`cli-session` experiment must receive only the selected provider's session
material through the containment backend; it must not read the operator's
ambient home or silently switch to an API key. Likewise, an `api-key`
experiment must not borrow an ambient login.

Provider-enabled screening, visible-checkpoint, and checkpoint experiments are accepted only when
the review runner and the immutable semantic judge both use their exact
contained profiles and independent ceilings. The judge consumes a complete,
content-addressed comparison schedule, writes a separate authenticated ledger,
and must finish successfully before definitive grading can be sealed.

`schemas/experiment-manifest.schema.json` and the two experiment seal schemas
provide the portable structural shapes. Their strict parsers remain authoritative
for relationships JSON Schema cannot express here, including self-authentication,
exact artifact sets and digests, paired block topology, balanced ordering,
runtime/runner consistency, retry equality, and secret rejection.

## Shortened benchmark funnel

`eval/benchmark-panels.json` freezes four nested, preregistered panels. Select
one with `--benchmark-category`; selection replaces arbitrary `repeats`,
`corpora`, and `caseIds`. The exact panel, restricted-case policy, gate policy,
definition hash, and evidence use are authenticated by the experiment manifest.

| Category | Cases | Repeats | Paired review attempts | Intended use |
| --- | ---: | ---: | ---: | --- |
| `smoke` | 6 development | 1 | 12 | Catch an observed sentinel regression; it cannot establish repeat reliability or efficiency. |
| `fast-screen` | 12 development | 2 | 48 | Reject unsafe or clearly slower ideas using a frozen two-observation rule; it does not establish three-repeat confirmation. |
| `confirmation` | 19 development/validation | 3 | 114 | Confirm reliable visible-root and uncertainty gates before the largest panel. |
| `full-checkpoint` | 32 development/validation | 3 | 192 | Maximum corrected visible-corpus checkpoint; still not historical-gold or sealed-holdout evidence. |

Each panel preserves high-risk sentinels, clean controls, variable cases, and a
compatibility-sensitive contract proxy. Confirmation and full-checkpoint also
schedule `case-d3f8026e` solely as a diagnostic large-diff transport and
registered-root sentinel. Independent adjudication showed that it is not
truth-complete, so its unmatched findings are structurally excluded from
precision, false-discovery, and required-adjudication gates by the decision
builder. The other four contaminated
cases listed by the registry are never scheduled. The exact logging-constants
compatibility case remains excluded; the smaller panels use declared contract
proxies and cannot prove that exact sensitivity is fixed.

Run the fail-closed template only after deliberately enabling provider calls
and configuring credential/session containment:

```sh
npm run eval:matrix -- --config eval/matrix.codex.funnel.json \
  --benchmark-category smoke

# Development iteration only: one treatment attempt per case/repeat.
# It is authenticated as treatment-only-diagnostic and cannot advance a gate.
npm run eval:matrix -- --config eval/matrix.codex.funnel.json \
  --benchmark-category fast-screen --treatment-only
```

Acceptance evidence always uses contemporaneous paired control/treatment
blocks. After judge, grade, and report complete, derive and persist the
write-once decision directly from the sealed artifacts:

```sh
npm run eval:funnel-decision -- --runs eval/runs/<dir>
```

The decision rejects stopped or unpaired experiments, missing terminal work,
treatment completion degradation, reliable high-severity regressions,
additional blocking unsupported treatment findings, and efficiency results
whose intervals cannot reach the preregistered target. Required unresolved
adjudications and weak confirmation remain `inconclusive`. Smoke does not gate
efficiency; fast-screen requires a positive signal; confirmation and
full-checkpoint require the frozen 20% target plus a case-cluster bootstrap
interval wholly above zero. Only a paired full-checkpoint can return
`visible-funnel-complete`, which is not a release, gold, or holdout claim. The
panel snapshot, seal identities, derived metrics and completion counts, result,
and content hash are retained in `funnel-decision.json`. Its portable structural
shape is `schemas/funnel-decision.schema.json`; the evidence reader verifies the
referenced seals and corpus, re-derives every metric, and requires byte-equivalent
decision content.

Unmatched findings are finalized only through a committed curator source and a
separate append-only ledger. The source must be reviewed, committed on a clean
descendant of the experiment's repository commit, and bind each decision to the
experiment ID, attempt ID, finding index, and finding digest. Then run:

```sh
npm run eval:adjudicate -- --runs eval/runs/<dir> \
  --input docs/validation/<adjudication-source>.json
npm run eval:funnel-decision -- --runs eval/runs/<dir>
npm run eval:report -- --runs eval/runs/<dir>
```

`experiment-adjudication.json` authenticates the original experiment,
terminal/grading seals, committed Git source, and final classifications.
`funnel-decision-adjudicated.json` is a versioned derived decision linked to
both the ledger and the original `funnel-decision.json`; neither original
grades nor the original decision are rewritten. Diagnostic-only cases remain
available for registered-root recall and transport diagnostics, but their
findings are excluded consistently from aggregate precision, false-discovery,
false-positive, and required-adjudication metrics. The source and ledger shapes
are documented by `schemas/experiment-adjudication-source.schema.json` and
`schemas/experiment-adjudication.schema.json`.

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
├── curation.json      # curator-only admission, strata, proof, and confirmations
├── proof.md           # example content-addressed curator proof; name is configurable
├── metadata.json      # optional sanitized title/body only
├── leakage_exceptions.json # optional content hashes + curator reasons
└── fixture/           # complete head-state tree for seeded/clean cases
```

Behavioral fixture trees are excluded from the repository's root TypeScript
typecheck because defect cases may intentionally contain code that does not
compile. Fixture correctness is governed by corpus admission, content-addressed
curator proof, and exact materialization/diff validation instead.

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

### Behavioral corpus admission

Development and validation cases use a stricter contract than structural
smoke fixtures. Run `npm run eval:validate-corpus` for a zero-provider integrity
check. It strictly parses truth and curation, authenticates the checked-in diff
and curator proof, runs the existing leakage and two-commit materialization
checks, verifies every truth line against the reviewed head, and reports whether
the corpus meets the preregistered readiness quotas. It never executes proof
artifacts or repository code and never starts a model. Run
`npm run eval:admit-corpus` when seeded visible-benchmark readiness must be an
exit-code gate. It permits the current seeded benchmark over admitted seeded
and clean fixtures once at least three distinct authenticated fixture source
trees and all other visible quotas are proven. `npm run eval:admit-gold-corpus` is the later
historical gold-set gate. Holdout readiness is reported separately and does not
block seeded development/validation runs.

Behavioral truth has no compatibility defaults. Every bug field must be
explicit, bug and root-cause IDs must be opaque, and unknown fields fail closed.
A `rootCauseGroup` is valid only when it connects at least two distinct observed
symptoms in the same case. Such a case must declare the `multi-observation`
change shape. Clean cases have empty truth; other case kinds have non-empty
truth.

Each behavioral case has `curation.json` matching
`schemas/benchmark-curation.schema.json`. Its source-change digest is the exact
SHA-256 of the checked-in diff and must be unique across the visible corpus.
The proof artifact is curator-only, case-relative, a direct regular file, and
authenticated by its exact SHA-256. The validator does not execute it. The
complete no-symlink fixture file tree, including file paths, content hashes, and
executable bits, is authenticated as well. An `admitted` case requires two
distinct identities registered in the direct-file `eval/curator-policy.json`,
and each registered curator must affirm the complete ordered checklist for a
bug or clean case. The stable policy ID and trust semantics are bundle-bound;
ordinary registry additions or revocations do not invalidate unrelated bundle
digests, but a revoked identity makes its cases inadmissible at the next run.
The trust root is protected Git review of the registry and case changes. These
checks enforce distinct registered identities; they are not cryptographic proof
that two different humans performed the reviews. Each
confirmation also binds `caseBundleSha256`, which authenticates exact case JSON,
truth, diff, proof, fixture-tree bytes, stable curator policy ID, and normalized
source, strata, and proof metadata.
Changing any of those inputs invalidates both confirmations. Use `draft` until
independent confirmation is complete.

Readiness requires 36 admitted visible cases: development has at least 12 bug
cases and 8 clean controls; validation has at least 12 bug cases and 4 clean
controls. Each core lane has an independent defect case in each corpus and a
comparable clean surface. Clean controls remain at least 25% of the corpus.
At least three cases are multi-observation; direct, seam, multi-observation,
and large-diff shapes are represented; and at least three admitted cases are
realistic large diffs. Seeded readiness requires at least three distinct
authenticated fixture source trees; this is fixture diversity, not evidence of
three independent repositories. Gold-set readiness separately requires at least three historical
repository identities authenticated against their materialized local sources;
seeded and clean fixtures never count as historical repositories. Historical
identity is location-independent: SHA-256 over a versioned canonical record of
the Git object format and the sorted complete root commit OIDs reachable from
the selected immutable head in a non-shallow, non-rewritten clone. Copies, path
aliases, relocation, and remote URL spelling therefore do
not inflate repository diversity. Forks with common complete roots are
conservatively treated as one family; unrelated histories merged later may
change this identity and require curator review. Both
gates require at least two derived language families and two architecture
families. Language is derived from the changed/head file extensions, while
architecture uses a closed schema enum and must remain consistent within each
historical repository family. Fixture aliases are curator labels only: multiple
distinct authenticated fixture trees may share an alias, and aliases do not
contribute to either fixture-source or historical-repository diversity counts.
Size strata are deterministic from the identity-normalized checked-in diff:
small is at most 250 lines, medium is 251 through 1,500, and large is at least
1,501. The `large-diff` shape and `large` size must agree exactly. This matches
the production 1,500-line limit frozen when corpus schema version 1 was defined.

The sealed holdout is never stored under `eval/cases`. Once a steward and
external access-controlled corpus exist, only `eval/holdout-commitment.json`
matching `schemas/holdout-commitment.schema.json` is checked in. It contains a
steward identity hash, corpus commitment hash, case count, and unopened status;
case IDs, sources, and truth are forbidden. Do not create this file until those
facts are real.

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

Once the follow-up containment backend permits provider launch, the live
process receives an attempt-specific `HOME`, XDG paths, temporary directory,
and disabled global/system Git configuration. Ambient SSH agents, Git
credential helpers, CLI home directories, proxy URLs, and unrelated credentials
are not forwarded. API-key mode receives only the selected explicit credential
(`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). CLI-session mode will instead require
a provider-specific, read-only session mount accepted by the containment
contract. Until that contract is implemented and tested, neither access mode
may start a live attempt. Claude's eval-only `--bare` behavior and any session
mount details must be reconciled by that safety slice rather than weakened in
the matrix runner.

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
point. That entry point emits the unchanged human-readable packet used by the
models and a schema-v1 typed shadow from the same lane-matching pass. Evaluation
artifacts retain and hash the typed shadow for parity analysis; no prompt or
routing consumer reads it during the unmodified-baseline stage.
The typed shadow also records the complete set of changed source files at or
above the canonical 400-line threshold, including base and head line counts.
Evaluation ingestion binds both typed commit fields to the reproduced history,
and text/typed parity covers changed-file, lane, and large-file inventories.
Unavailable, empty, oversized, secret-bearing, or ref-mismatched output
is a configuration failure. Attempt records retain the verified history even
when manifest preflight fails; successful preflight additionally retains the
exact bounded manifest text, its UTF-8 SHA-256, typed shadow and hash, refs, and
profile provenance. This work does not alter prompts, grading, routing, budgets,
posting, or model choice. These history and manifest checks are
evaluation-integrity evidence, not model-quality evidence.

## Runtime image bootstrap

`container/eval-runtime/` defines the repo-owned Linux image intended for the
external containment backend. Its Node base is pinned by immutable multi-platform
digest, and its lockfile carries the same exact Claude Code and Codex CLI versions
as the production setup action. The build context contains only that definition,
the lockfile, and a zero-credential containment probe; it never contains the
Peregrine source tree, case corpus, or provider credentials.

Pull requests that touch the image build it without registry credentials, then
run the probe with no network, a read-only root filesystem, read-only checkout and
asset fixtures, one read-write output directory, and tmpfs-backed home and scratch
directories. The workflow invokes the repo-owned
`scripts/run-eval-runtime-probe.ts` launcher rather than carrying a second inline
copy of the Docker arguments. Its strict argument parser rejects missing or extra
mounts and weakened network, root, capability, user, or tmpfs controls. Inside the
container, the probe dynamically confirms that `/` and the two input mounts are
read-only, no non-loopback address or route exists, no default IPv4 or usable IPv6
route exists, and any Docker-created tunnel devices belong to an explicit inert,
zero-traffic allowlist. The writable mounts have the expected types. It also denies a
host-only sentinel and the Docker socket, confirms no common credentials were
inherited, and checks both CLI versions without making a provider request.

The same workflow has a separate manual, `main`-only publication job for
`ghcr.io/petergraycreative/peregrine-eval-runtime`. Only that job receives
`packages: write` and `GITHUB_TOKEN`; it publishes an amd64/arm64 candidate tagged
with the source commit. The job then pulls that exact multi-platform digest, runs
the same zero-credential probe for both `linux/amd64` and `linux/arm64`, and creates
the GitHub provenance attestation only after both pass. A failed post-publish probe
can therefore leave a commit-tagged candidate in GHCR, but that candidate remains
unattested and must not be approved. The workflow never publishes `latest`.

The GHCR package is private. A benchmark host must authenticate to `ghcr.io`
with read-only package access and pre-pull the exact accepted digest before a
run. Runtime launches retain `--pull never`; Docker configuration and registry
credentials are never mounted into provider containers. Publication remains a
manual `main`-only operation with `packages: write`. Changed image source lands
first, then is manually published and probed, followed by a separate acceptance
change for the newly attested digest.

## Running

```bash
# Claude CLI-session checkpoint contract (currently disabled before provider work).
npm run eval:matrix -- --config eval/matrix.config.json

# Codex CLI-session checkpoint contract (also currently disabled).
npm run eval:matrix -- --config eval/matrix.codex.config.json

# Explicit provider-enabled diagnostic screening (16 review attempts).
PEREGRINE_CODEX_SESSION_DIR=/path/to/sanitized/session \
  npm run eval:matrix -- --config eval/matrix.codex.screening.json

# Continue only untouched, unsealed evidence. A sealed run is already terminal.
npm run eval:matrix -- --config eval/matrix.config.json \
  --resume eval/runs/<dir>

# Retry one failed or interrupted attempt in a new linked experiment directory.
npm run eval:matrix -- --config eval/matrix.config.json \
  --retry-runs eval/runs/<source-dir> \
  --retry-attempt attempt-000001

npm run eval:judge -- --runs eval/runs/<dir>   # contained semantic comparisons
npm run eval:grade  -- --runs eval/runs/<dir>
npm run eval:report -- --runs eval/runs/<dir>   # benchmark.json + benchmark.html
```

`--resume` and `--retry-runs` are mutually exclusive. Retry requires both
`--retry-runs` and `--retry-attempt`, and only failed or interrupted source
attempts are eligible. Use the same config that authenticated the source
experiment; changed code, corpus, prompts, methods, schemas, profiles, judge,
configuration, CLI versions, or provider availability fail closed instead of
quietly producing incomparable evidence.

`eval/matrix.smoke.json` is the structural-smoke config.
`eval/matrix.config.json` is the fail-closed Claude CLI-session checkpoint
example; `eval/matrix.codex.config.json` is the corresponding Codex example.
Both live examples retain `providerCalls: "deny"` by default. Provider-enabled
copies must separately preregister review-run limits and semantic-judge limits.
`eval/matrix.codex.screening.json` is the explicit opt-in, provider-enabled
diagnostic used to compare the current Luna-high-to-Sol-high route with a
Luna-medium-only treatment over eight admitted development cases. It uses one
repeat and uncontrolled cache state, so its result is screening evidence only,
not checkpoint, routing-approval, or holdout evidence.
The only immutable semantic judge profile is Codex `gpt-5.6-luna` at medium
effort using `semantic-v1`.
Before enabling any screening, visible-checkpoint, or checkpoint config, set explicit positive
provider-attempt and wall-time limits plus deliberate failure thresholds; set a
dollar ceiling only when cost accounting is required or sufficiently reliable.
Changing `providerCalls` to `allow` requires the private-image pre-pull,
authenticated API-key or sanitized CLI-session setup, and deliberate ceilings.
Live cache state remains `uncontrolled` until a separate cache
protocol can enforce and attest cold or warm conditions.

Screening, visible-checkpoint, and checkpoint share the control/treatment protocol. Set
`experiment.mode` to `screening` for a curated development subset or
`visible-checkpoint` for an admitted visible development/validation comparison
that is explicitly not gold or holdout evidence, or
`checkpoint` for the planned
historical gold development/validation gate, and name exactly one `control` and
one `treatment` from `configs`. Before creating a run directory or starting a
provider, screening requires a non-empty selection and fully validates every
selected behavioral case. Visible-checkpoint and checkpoint schedules must
contain both development and validation cases and no structural-smoke cases.
Visible-checkpoint additionally requires the complete visible corpus to satisfy
`visibleSeededBenchmarkReady`; checkpoint requires `goldSetReady`. The checked-in
provider-enabled screening config is intentionally separate from the fail-closed
checkpoint examples. Running it is an explicit operator decision backed by the
private-image and credential setup; do not broaden its case list or reuse its
result as holdout evidence after inspecting model output.

For a practical screening or diagnostic visible-checkpoint run, add `caseIds`
at the matrix root. It must be a
non-empty, duplicate-free list of opaque `case-...` IDs, and every ID must name
an admitted case in the selected corpora. Screening allowlists remain
development-only; visible-checkpoint allowlists may span development and
validation. Discovery and global ID
collision checks still cover the complete case tree before the allowlist is
applied. The scheduled subset is sorted canonically before seeded shuffling, so
reordering `caseIds` does not change attempt order. Use a preregistered,
stratified subset (for example, representative defect lanes, clean controls,
change shapes, and sizes); do not choose cases after seeing model output.
`caseIds` is rejected for structural smoke and historical-gold checkpoint runs.
A preregistered categorized subset is immutably classified as
`visible-seeded-panel`; an ad hoc subset is `diagnostic-visible-subset`; a
no-allowlist visible checkpoint is `visible-seeded-checkpoint`. None is
historical-gold or sealed-holdout evidence.

The admitted seeded corpus supports development screening and, once
`visibleSeededBenchmarkReady`, visible-checkpoint runs. A historical-gold
checkpoint still fails before creating run artifacts or starting a provider
until the corpus satisfies the stricter `goldSetReady` contract. The harness
never substitutes structural fixtures or presents smoke or visible-checkpoint
results as gold or holdout evidence. Reports group development and validation
attempts separately.

- Repeats (default 3, `eval/matrix.config.json`) are not optional — runs are
  stochastic, and single-run model comparisons will mislead you.
- The judge kind, model, and version are frozen in the experiment manifest.
  Structural smoke uses the free exact line-overlap judge. Screening and
  checkpoint configs preregister the contained Codex Luna-medium semantic
  root-cause judge. The judge remains blind to which runner produced a finding.
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
