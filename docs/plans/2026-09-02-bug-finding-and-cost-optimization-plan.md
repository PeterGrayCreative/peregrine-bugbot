# Peregrine Bug-Finding and Cost Optimization Plan

**Status:** Proposed — revised after architecture, evaluation, and Vette soundness review
**Date:** 2026-09-02
**Scope:** `skills/invariant-first-pr-review`, `src/core`, `src/engines`, `src/github`, `schemas/`, `eval/`, `peregrine.config.json`, `.github/workflows`, and target-repository profiles
**Goal:** Raise recall on consequential defects while reducing effective cost and wall time, without weakening the evidence bar, schema validation, secret scanning, profile trust, two-stage isolation, revalidation before posting, or GitHub permission boundaries.
**Implementation checklist:** [2026-09-02-bug-finding-and-cost-optimization-checklist.md](./2026-09-02-bug-finding-and-cost-optimization-checklist.md)

## Executive decision

Approve the direction, but do not execute the original phase order.

The first implementation work must make the evaluation harness faithful and resistant to survivorship bias. Peregrine cannot safely optimize prompts, budgets, chunking, or routing while fixture runs bypass the production manifest path, failed runs disappear from reports, and one systemic finding cannot receive credit for multiple symptoms of the same root cause.

Treat this as a six-to-eight-week experimental program. A useful, defensible improvement may be available around the end of week three, but corpus curation, serial live-model runtime, provider availability, and human adjudication control the real schedule. Benchmark each behavioral change independently so its recall and cost effects remain attributable.

## Outcomes

After the core program:

1. Every attempted benchmark run is persisted, including timeouts, provider failures, parse failures, and invalid configurations.
2. Seeded and historical cases reproduce a real Git base/head range and exercise the production manifest and profile-trust path.
3. Reports distinguish bug-instance recall from root-cause recall and distinguish routing, breadth, investigation, budget, and presentation misses.
4. Cost comparisons emphasize provider cost when observable, plus uncached input, turns, tool calls, median/P95 wall time, cost per reviewed PR, and cost per reliably found root cause. Subscription/session-backed CLI runs may leave monetary cost unavailable; they still record exact model identities and all observable efficiency data. Total input remains diagnostic.
5. The runner consumes a typed review manifest rather than scraping human-readable console output.
6. The investigator receives a cache-stable method core plus a variable lane/profile appendix instead of spending turns traversing skill files.
7. Breadth receives compact activated-lane counterexamples and seam guidance without gaining final adjudication authority.
8. Candidate budgets are bounded and respond to actual candidates, escalations, and unavailable coverage.
9. A trusted target-repository profile is benchmarked before automatic risk-based downgrades are considered.
10. Consequential, reviewable large diffs can be partitioned at file and hunk boundaries without silently omitting changed hunks or reporting partial coverage as clean.
11. Model-visible cases are blind: they contain no answer markers, descriptive case names, future fix history, review comments, issue text, or accessible ground-truth files.
12. Control and treatment runs are contemporaneous, randomized, and reproducible, with a sealed holdout used only after the design and thresholds are frozen.
13. Completeness is a runner-owned state derived from deterministic transport coverage and validated ledgers, never solely a model claim.

## Explicit deferrals and non-goals

- Do not optimize raw total input tokens as the primary KPI.
- Do not shorten Codex timeouts as a cost-control mechanism. Timeouts remain failure guards.
- Do not build caller precomputation until search/tool telemetry shows it will save more context than it adds.
- Do not expose medium-confidence or follow-up findings in PR bodies by default. Treat that as a separate, opt-in product-noise experiment.
- Do not automatically downgrade docs-only changes to `clean`; specifications, runbooks, release docs, and configuration examples may be contract-bearing.
- Do not give the provider process general Bash access for verification. Future test execution must be runner-controlled and credential-scrubbed.
- Do not promote production outcomes directly into benchmark truth or automatically tune prompts, thresholds, profiles, or lanes from weak labels.
- Do not tune against holdout cases.
- Do not use the marker-driven mock corpus as evidence of model recall. It remains a structural pipeline smoke test only.
- Do not compare a newly run treatment with a historical control run when model, CLI, cache, or provider conditions may have drifted.
- Do not treat every unmatched finding as a false positive until a blinded adjudicator confirms it is unsupported.

## Current baseline and measurement policy

The only live measurement is the Shack PR 3449 acceptance run (`docs/validation/2026-09-01-shack-pr-3449.md`, Codex, Luna/low → Sol/high):

| Metric | Observed value | Interpretation |
| --- | ---: | --- |
| Total input tokens | 1,284,123 | Diagnostic only |
| Cached input tokens | 1,108,480 | About 86% of total input |
| Uncached input tokens | 175,643 | Better proxy for newly introduced context |
| Investigation input tokens | 1,226,671 | Diagnostic only |
| Investigation uncached input tokens | 145,583 | Better Phase 2 baseline |
| Wall time | 450 s | Baseline for median/P95 measurements |
| Recall / false positives | Unmeasured | Must be established on the gold set |

The latest validation record has no completed live Claude inference because authentication was expired. Until a successful Claude run is recorded, provider comparisons must be labeled **Codex-only**.

Experiments support both explicit API-key access and contained CLI-session access, including Codex subscription-backed runs. Access mode is part of the immutable protocol. A CLI session must be mounted through the approved evaluation-containment boundary; the harness must never consume an ambient user home or silently fall back to an API key. When a session-backed runner does not expose monetary charges, cost is `n/a`, not zero. Exact model identifiers, provider-attempt count, observed tokens/cache/work, wall time, and failure rate remain mandatory, and a hard provider-attempt ceiling substitutes for an unenforceable dollar ceiling.

### Primary metrics

| Metric | Why it matters |
| --- | --- |
| Provider-reported cost per review | Closest available measure of actual spend |
| Estimated cost from provider-specific base/cache-write/cache-read/output rates | Supports providers that omit cost telemetry without flattening different billing semantics |
| Provider access mode and provider-attempt count | Keeps API-key and subscription/session-backed experiments distinguishable and bounded when monetary cost is unavailable |
| Base, uncached, cache-creation, and cache-read input as exposed by each provider | Distinguishes new context, cache population, and reuse without double-counting |
| Output and reasoning-output tokens | Captures generation cost |
| Turns and tool calls by stage | Identifies repeated traversal and search costs |
| Median and P95 wall time | Represents user experience and CI capacity |
| Cost per reviewed PR | Keeps clean reviews in the denominator |
| Cost per reliably found root cause | Combines efficiency and useful recall |
| Completion and failure rates | Prevents cheaper but unreliable routes from looking superior |

Total input tokens remain in reports as a diagnostic, not a release gate.

## Guardrails for every stage

- Preserve the finding-contract evidence bar, strict/fail-closed parsing, secret scanning, analysis/posting isolation, revalidation before posting, and separate GitHub permissions.
- Preserve the two-stage topology and strong investigation for high-risk work.
- Repository-local profiles and custom lanes remain trusted only from the merge base. Head-authored profile changes are reviewed code, not active reviewer configuration.
- New model-output fields are optional unless a deliberate schema-version change is approved. Update schema, parser, fixtures, and tests together.
- Failed, incomplete, or partially inspected reviews must never be reported as `clean`.
- Matrix overrides must pass the production configuration validator after merging with the base configuration.
- Every behavioral PR ends with `npm run validate` and a paired screening benchmark. Full-corpus comparisons run at checkpoint gates rather than after every small edit.
- Each experiment has one primary intervention. Do not combine method packets, breadth guidance, caller indexes, budgets, posting changes, and routing into one PR.
- Record exact base/head, case set, repeats, judge, routes, provider availability, and feature flags in each validation document.
- Keep structural smoke, development, validation, and sealed-holdout corpora separate. Opening the holdout ends that experiment cycle; its cases then move into the visible corpus and a new holdout is established.
- Run control and treatment in randomized, interleaved blocks under the same provider window. Record the randomization seed and report paired case-level deltas.
- Record repository SHA, corpus SHA, prompt/method hash, schema hash, profile hash, CLI version, exact model identifier, price-table version, and judge version with every live experiment.
- Distinguish deterministic transport coverage, model-attested analysis coverage, and publication filtering. Only the runner decides whether coverage is complete.
- Use one canonical core-lane registry and an explicit mapping from manifest lane IDs to finding categories; custom lane IDs remain separately validated data.

## Dependency graph

```text
Stage 0: benchmark integrity
  ├── failed-run accounting
  ├── blind and isolated case materialization
  ├── reproducible base/head histories
  ├── typed manifest in shadow/parity mode
  ├── root-cause-aware grading and adjudication
  ├── provider-correct cost telemetry
  └── reproducible experiment runner
          │
          ▼
Stage 1: curated gold set v1 and unmodified baseline
          │
          ▼
Stage 2: cost work
          │
          ▼
Stage 3: recall work and runner-owned completeness
          │
          ▼
Stage 4: first trusted repository profile and controlled rollout
                  │
                  ▼
Stage 5: hunk-safe large-diff pilot, ~50-case expansion, opt-in routing

Deferred: runner-controlled verification and outcome weak-label collection
```

## Delivery sequence

Implement as small, independently reviewable PRs:

| PR | Scope | Depends on |
| ---: | --- | --- |
| 1 | Persist failed matrix attempts and report completion/error rates | — |
| 2 | Add blind, isolated case materialization and benchmark-leakage checks | 1 |
| 3 | Add reproducible base/head histories and exercise the production manifest path | 2 |
| 4 | Add canonical lane IDs, root-cause groups, severity, many-to-one grading, precision adjudication, and miss stages | 3 |
| 5 | Add provider-correct usage/cost metrics, observed turns/tool calls, and experiment metadata | 1 |
| 6 | Add JSON manifest output and typed parsing in shadow/parity mode | 3 |
| 7 | Curate gold set v1 and record the unmodified baseline | 4–6 |
| 8 | Add a stable investigator core plus variable lane/profile appendix | 7 |
| 9 | Add structural breadth compaction and concise output-schema bounds | 8 |
| 10 | Add activated-lane counterexamples and the seam checklist | 8 |
| 11 | Add compact investigation coverage and runner-owned completeness semantics | 10 |
| 12 | Add bounded, risk-sensitive candidate budgets | 11 |
| 13 | Build and benchmark the first target-repository profile | 7, 12 |
| 14 | Pilot hunk-safe large-diff chunking | 12 |
| 15 | Expand to approximately 50 cases and pilot repository-opt-in routing | 13, 14 |

PRs 8–12 each receive their own paired screening comparison. A failed
intervention remains recorded as negative evidence and is not merged merely to
preserve the sequence. The next independent intervention may proceed from the
latest accepted dependency when the plan records that substitution before its
benchmark is frozen. Run the full development/validation corpus at Checkpoints
2 and 3. PRs 13–15 remain feature-flagged until their specific gates pass, and
the sealed holdout runs only after the selected design, thresholds, and route
policy are frozen.

---

## Evaluation protocol used by every stage

### Corpus tiers

1. **Structural smoke:** deterministic marker-driven cases used only to prove matrix → grade → report plumbing. These results never support a model-quality claim.
2. **Development:** visible curated cases used to design and debug one intervention.
3. **Validation:** visible but non-tuning cases used only at checkpoint gates. If a validation result changes the design, record that decision and do not present later validation performance as untouched confirmation.
4. **Sealed holdout:** hidden case identities, ground truth, and expected outcomes. Run once after the design, thresholds, routing policy, and analysis code are frozen. After opening results, retire these cases into the visible corpus and create a new holdout for the next cycle.

Holdout storage must prevent accidental model or implementer access during tuning. A convention such as `holdout: true` in a readable case file is not sufficient isolation by itself.

### Benchmark blinding and historical-case isolation

- Use opaque case IDs in directory names, temporary paths, logs shown to models, and PR metadata.
- Reject model-evaluation fixtures containing `BUG`, `FIXME`, expected-answer prose, ground-truth identifiers, or other answer-bearing markers unless a curator explicitly documents why the text was present in the historical reviewed head.
- Keep `ground_truth.json`, later fix diffs, review threads, issue descriptions, and curator notes outside the model-visible repository.
- Materialize historical cases as sanitized repositories containing the complete base and head trees needed for review but no commits newer than the reviewed head, no remote, and no credentialed Git configuration. Preserve base/head ancestry without exposing the later fixing commit.
- Disable model-stage network access during evaluation where the provider host supports it. Otherwise record the limitation and exclude cases whose answer is publicly retrievable from supplied identifiers.
- Scan the final prompt, checkout path, repository tree, and accessible Git history for case-name and answer leakage before each live run.

### Paired execution and reproducibility

- Compare a control and one treatment at a time.
- Randomize and interleave control/treatment order within each case/repeat block using a recorded seed.
- Run both variants during the same provider window with the same case snapshot, exact model ID, CLI version, permissions, and timeout policy.
- Keep provider access mode fixed within a comparison. Record `api-key` or `cli-session`; never compare a session-backed treatment with an API-backed control as if access conditions were identical.
- Record cold-cache and warm-cache results separately. Do not let the second variant systematically inherit a warmer cache.
- Persist an immutable experiment manifest containing all code/config/corpus/profile/prompt/schema hashes, provider/CLI versions, judge version, run order, timestamps, and failed attempts.
- Make runs resumable without silently replacing a failed attempt. A retry is a new linked attempt.

### Benchmark cadence and budget

- **Per-commit smoke:** deterministic, zero-provider-cost structural checks.
- **Per-PR screening:** 8–12 stratified development cases, one or two repeats, with early termination on a high-severity regression, failure-rate increase, or cost ceiling breach.
- **Checkpoint evaluation:** full development and validation sets with three repeats and contemporaneous control/treatment runs.
- **Final release/routing gate:** one sealed-holdout run after all choices are frozen.

At the current 450-second reference duration, 30 cases × 3 repeats × 2 variants requires about 22.5 serial model-hours. Every checkpoint therefore needs an explicit maximum wall-clock budget, provider-attempt limit, resume policy, and stopping rule before it starts. API-key runs with enforceable accounting also require a provider-spend ceiling. Session-backed CLI runs may use best-effort monetary accounting, but unavailable cost never counts as zero and cannot satisfy a dollar-improvement gate by itself. Report P95 only for a stratum with enough observations; otherwise report the paired duration distribution and median.

### Grading and adjudication

- Freeze and version the exact and semantic judge implementations before a control/treatment comparison.
- The semantic judge is blind to engine, route, and variant. Its decision is evidence, not final authority.
- Blindly adjudicate every control/treatment disagreement, every unmatched High finding, and every candidate new defect. Audit a stratified sample of agreements as a calibration check.
- Classify unmatched findings as `confirmed-new`, `unsupported`, or `unresolved`; do not automatically call them false positives.
- Report bug-instance recall, root-cause recall, precision/false-discovery rate across all cases, blocking false positives on clean cases, comment volume, and confidence calibration.
- Keep semantic-judge and human-adjudication costs separate from production review cost.

---

## Stage 0: Make the benchmark faithful and impossible to game accidentally

**Duration:** 5–8 days for harness, isolation, telemetry, and experiment-runner changes, followed by corpus curation in Stage 1.
**Purpose:** Establish trustworthy inputs and accounting before changing review behavior.

### 0.1 Persist every attempted matrix run

Change `eval/run-matrix.ts` so every scheduled case/configuration/repeat produces an outcome:

```ts
type RunOutcome =
  | { status: "completed"; result: EngineResult }
  | {
      status: "failed";
      failureKind: "timeout" | "provider" | "parse" | "configuration";
      message: string;
      durationMs: number;
    };
```

Reports include expected, completed, and failed runs; completion rate; recall conditional on completion; recall with failures counted as misses; and failure rates by type. Missing output files cannot remove an attempted run from comparison.

After applying matrix overrides, reconstruct and pass the effective configuration through `validateConfig`. Do not mutate an already-validated object with unchecked `Object.assign` state.

**Files:** `eval/run-matrix.ts`, `eval/report.ts`, `src/config.ts`, result types/schemas, and focused tests.
**Must stay untouched:** prompts, routing, and posting.
**Risk:** legacy result folders lack failure records. Label them legacy/incomplete rather than inventing outcomes.
**Verify:** one completed fixture run and one forced failure report two expected attempts, one failure, 50% completion, and failure-inclusive recall.

### 0.2 Blind, isolate, and reproduce case history

Replace the ambiguous `commit` shape with a discriminated contract. Generated fixture commit IDs are outputs of materialization, not required case-file inputs:

```ts
interface FixtureCaseSpec {
  id: string; // opaque and non-descriptive
  kind: "seeded" | "clean";
  fixtureDir: string;
  diffFile: string;
  metadataFile?: string; // sanitized scope only
}

interface HistoricalCaseSpec {
  id: string; // opaque and non-descriptive
  kind: "historical";
  repoSource: string;
  baseCommit: string;
  headCommit: string;
  diffFile: string;
  metadataFile?: string; // sanitized scope only
}

type CaseSpec = FixtureCaseSpec | HistoricalCaseSpec;

interface MaterializedCase {
  repoPath: string;
  baseRef: string;
  headRef: string;
  exactDiffSha256: string;
  cleanup(): void;
}
```

Each attempt receives a unique `mkdtemp` repository. Fixture materialization commits the base, applies the patch, commits the head with fixed test-only Git identity and timestamps, verifies the exact diff, and returns the resolved refs. Historical materialization exports the full base/head trees into a new two-commit repository with no newer objects, later fixes, remote, hooks, credentials, or case artifacts. It verifies that the sanitized range reproduces the expected diff and preserves the unchanged context required by the review.

Before inference, run a leakage check over the prompt, checkout path, repository tree, and accessible history. The current marker-based fixtures remain in the structural-smoke corpus or are rewritten before any live-model use. Ground truth and curator notes never enter the checkout.

**Files:** `eval/run-matrix.ts`, case schemas/types, `eval/cases/**`, new materialization/leakage helpers, and tests.
**Must stay untouched:** production manifest trust order and the zero-cost mock smoke purpose.
**Risk:** sanitizing history can omit unchanged context or change object identity. Compare trees and exact diff, retain all base/head files, and fail rather than falling back to the unsanitized clone.
**Verify:** unique paths and cleanup; deterministic fixture refs; no model-visible markers or descriptive IDs; no later commits/remotes; exact base...head diff; available production manifest with expected files and lanes.

### 0.3 Add root-cause-aware grading

Extend ground truth:

```ts
type CoreLaneId =
  | "authorization"
  | "identifiers"
  | "data-integrity"
  | "persistence"
  | "runtime-config"
  | "contracts"
  | "concurrency"
  | "test-quality"
  | "logic-correctness"
  | "error-handling"
  | "frontend-state"
  | "boundaries-pagination";

type CustomLaneId = string & { readonly __customLaneId: unique symbol };

interface GroundTruthBug {
  id: string;
  rootCauseGroup?: string;
  lane: CoreLaneId;
  expectedDisposition: FindingDisposition;
  expectedSeverity: "high" | "medium" | "low";
  file: string;
  startLine: number;
  endLine: number;
  description: string;
  reachablePreconditions: string;
  observableImpact: string;
  provenance: string;
}
```

Define `CORE_LANE_IDS` once from the twelve manifest lane IDs and an explicit mapping to the existing finding categories (`logic-correctness` → `logic`, `boundaries-pagination` → `boundaries`, and so on). Use that registry in manifest parsing, ground truth, coverage, grading, reports, and risk policy. Custom lane IDs are validated separately and never silently coerced into a core category.

Report both bug-instance recall and root-cause recall. One systemic finding may satisfy multiple symptoms in its `rootCauseGroup`; do not globally consume a finding index after the first match. Require compatible root-cause evidence so a vague systemic claim cannot absorb unrelated bugs.

Do not compute precision by treating every unmatched finding as false. Send unmatched findings through blinded adjudication and classify them as confirmed new defects, unsupported findings, or unresolved. Report false-discovery rate across bug-bearing and clean cases, plus blocking false positives on clean cases. Use curator-owned `expectedSeverity`, not model-assigned severity, for the no-high-severity-regression gate.

Miss stages become `none | routing | breadth | investigation | budget | presentation`. `presentation` means the issue was found but filtered or capped from posting; it is not a detection miss.

**Files:** `src/types.ts` or a new canonical lane registry, `eval/grade.ts`, ground-truth schema/types, cases, adjudication records, reports, and tests.
**Must stay untouched:** production consolidation rules.
**Risk:** loose matching over-credits generic findings, while incomplete ground truth mislabels valid new findings. Freeze the judge and require adjudication at the defined boundaries.
**Verify:** one systemic finding matches two grouped symptoms but not an unrelated bug; lane/category mapping is exhaustive; a newly confirmed unmatched defect improves precision rather than counting as a false positive.

### 0.4 Add a typed manifest

Add JSON output to `skills/invariant-first-pr-review/scripts/review-manifest.sh`, retaining text output for interactive use:

```ts
interface ReviewManifest {
  available: boolean;
  baseRef?: string;
  headRef?: string;
  mergeBase?: string;
  profile?: {
    source: "merge-base" | "external" | "none";
    changedAtHead: boolean;
  };
  changedFiles: Array<{
    path: string;
    status: string;
    activatedLanes: Array<{
      id: CoreLaneId | CustomLaneId;
      reason: "path" | "content" | "profile-extension";
    }>;
  }>;
  activatedLanes: Array<CoreLaneId | CustomLaneId>;
  customLanes: Array<{ id: string; trustedSource: string }>;
  warnings: string[];
  rawText?: string;
}
```

`src/core/manifest.ts` parses and validates this structure. During Stage 0, generate text and JSON from the same normalized data, retain the byte-compatible text packet in model prompts, and use JSON only for shadow parity checks and evaluation metadata. Do not change production prompt bytes while claiming to establish an unmodified baseline. Promote typed fields to method-packet, budget, profile, and routing consumers only in the later independently benchmarked intervention; those consumers never scrape headings from console prose. Preserve merge-base materialization and external-profile provenance.

**Files:** manifest script, `src/core/manifest.ts`, types/schema, and tests.
**Must stay untouched:** profile resolution order and trust boundary.
**Risk:** text and JSON modes drift or the typed path changes review behavior before the baseline. Generate both from common data, compare semantic inventories on every fixture, and snapshot representative output.
**Verify:** byte-compatible prompt text during Stage 0; JSON round-trip of files, lane reasons, merge base, profile provenance, custom-lane sources, and warnings; randomized shadow parity over the case corpus.

### 0.5 Record effective cost and work

Add observed per-stage `turns`, tool-call counts by type, tool-output bytes, prompt bytes, and per-turn usage when exposed. Before aggregating Codex events, prove with captured fixtures whether each event is incremental or cumulative; never sum cumulative totals. Parse Claude base input, cache-creation input, cache-read input, output, and provider-reported cost separately.

Use provider-specific, dated price contracts rather than one generic cached-token rate. Claude estimates must distinguish cache creation from cache reads and support relevant long-context tiers. OpenAI estimates must establish whether reported input includes cached input, derive uncached input without double-counting, and avoid billing reasoning tokens twice when they are already included in output pricing. Record `costSource: provider | estimated`, price-table version/date, service tier when known, and every unavailable component. Unknown models or ambiguous usage remain `n/a`, never zero.

Report duration, prompt size, tool work, cached/uncached/cache-write input as applicable, output, reasoning output, turns, tool calls, cost, cost per reviewed PR, and cost per reliably found root cause. Keep semantic-judge and evaluation-orchestration spend in a separate experiment-cost section.

**Files:** `src/types.ts`, engine adapters, captured provider-envelope fixtures, `src/core/review-result.ts`, config/docs, eval reports, and tests.
**Must stay untouched:** routes and prompts.
**Risk:** provider envelopes omit fields or change semantics, and cache writes/reads have different prices. Record `undefined`; never infer observed work from configured maxima or force incomparable providers into one shape.
**Verify:** incremental-versus-cumulative event fixtures; provider-specific pricing including cache write/read; long-context thresholds; missing-field behavior; explicit estimate labels; reconciliation against at least one provider-reported charge; accurate Codex-only labeling.

### 0.6 Make experiments reproducible and affordable

Extend the matrix runner with control/treatment pairing, seeded randomization, interleaved execution, immutable attempt records, resume support, explicit retry linkage, and per-experiment provider-attempt, spend, time, and failure ceilings. Produce a machine-readable experiment manifest with all hashes and versions required by the evaluation protocol. Support both API-key and contained CLI-session runners. For subscription/session-backed Codex or Claude runs, persist monetary cost as best-effort and rely on pre-registered provider-attempt, wall-time, and failure ceilings when exact dollars are unavailable.

Keep three execution modes separate: structural smoke, stratified screening, and full checkpoint. A screening pass can reject a bad intervention but cannot establish release-level efficacy. Full checkpoint runs use the contemporaneous control, not an old benchmark directory.

Within behavioral execution, use the checked-in shortened funnel rather than
paying for the entire visible suite after every edit. The four nested categories
are smoke (six development cases, one repeat), fast-screen (twelve development
cases, two repeats), confirmation (nineteen development/validation cases,
three repeats), and full-checkpoint (thirty-two development/validation cases,
three repeats). Panel membership is frozen and content-addressed before a run.
Smoke catches obvious breakage; fast-screen rejects unsafe or clearly inferior
ideas; confirmation establishes three-repeat visible reliability and
uncertainty; full-checkpoint is the largest corrected visible-corpus gate. None
is historical-gold or sealed-holdout evidence.

Acceptance decisions always use contemporaneous paired control/treatment
blocks. Treatment-only smoke or fast-screen work is permitted for development
economy only when the manifest labels it diagnostic-only; it can never advance
a gate. Stop sequentially on a reliable high-severity regression, additional
blocking unsupported treatment findings, completion degradation, incomplete or
stopped evidence, or an efficiency interval that makes the registered target
unattainable. Unresolved required adjudications and weak confirmation are
inconclusive, not clean or passing.

Independent Checkpoint 2 adjudication invalidated four clean-control labels and
one truth-complete label. Exclude the four invalid clean cases from every
shortened panel. Retain the seeded large-diff case only as a plainly
diagnostic-only transport and registered-root sentinel; do not use its
unmatched findings for precision, false-discovery, or required-adjudication
gates. This preserves honest large-diff execution coverage without claiming
that incomplete truth is complete. Use smaller contract cases only as declared
compatibility proxies; they do not prove the excluded logging-constants
sensitivity.

**Files:** `eval/run-matrix.ts`, new experiment-manifest schema/types, CLI/config documentation, report code, and tests.
**Must stay untouched:** review prompts and route selection.
**Risk:** retry replacement, cache ordering, or provider drift can bias the comparison. Preserve every attempt and randomize block order.
**Verify:** deterministic order from a seed; balanced first/second variant position; safe resume; retries retained; ceilings stop before the next provider call; manifest records complete provenance.

### Checkpoint 0

Every attempted run is represented; blind and isolated cases exercise real base/head manifest routing; systemic findings grade correctly; unmatched findings have an adjudication path; typed manifest data passes shadow parity; provider-correct cost metrics and reproducible experiment manifests are available. Model prompt behavior remains unchanged. This is the first safe pause and rollback boundary.

---

## Stage 1: Build gold set v1 and record an unmodified baseline

**Duration:** 5–7 days.
**Purpose:** Establish enough real and clean cases for isolated experiments.

### Tasks

1. Curate a minimum of 30 cases, targeting 36 when necessary to meet coverage without relying on one case for many quotas. Do not build elaborate mining automation first.
2. Split cases before experimentation into development, validation, and sealed holdout sets. Holdout identities and ground truth stay outside the ordinary working tree or behind equivalent access control.
3. Cover all 12 invariant lanes with at least two independent confirmed defects per lane in the visible development/validation sets. A multi-lane case may contribute to more than one lane only when it contains independently curated ground-truth bugs for those lanes.
4. Keep at least 25% clean cases, including clean changes touching the same surfaces as high-risk bugs.
5. Include at least three multi-symptom cases with explicit root-cause groups.
6. Include multiple repositories and at least two materially different language/architecture families before making a general Peregrine claim. Otherwise label results as target-repository-specific.
7. Record an unprofiled baseline using unchanged production prompts/routes and three repeats, with randomized contemporaneous reruns of the control at each later checkpoint.
8. Use exact grading only for structural smoke and unequivocal location matches. Use a frozen semantic judge plus the required blinded adjudication for live comparisons.
9. Start with a curator workflow. A later mining helper may emit drafts, but a human must confirm each historical issue was real, reachable, consequential at its curated severity, and a defect rather than a product change.
10. Run the leakage scanner and sanitized-history verifier on every live case before admitting it to the corpus.

Historical case source metadata records the original base/merge-base and reviewed head, while the model receives only the sanitized two-commit materialization. Private-repository cases remain credentialed curator inputs or become secret-free reduced fixtures under an explicit policy; provider processes never receive repository credentials.

**Files:** `eval/cases/**`, `eval/README.md`, `eval/judge-audit.md`, case-schema tests, optional curation helpers, and `docs/validation/`.
**Must stay untouched:** prompts, engines, posting, and holdout cases during tuning.
**Risks:** correlated synthetic cases inflate confidence; historical fixes may not prove a defect; readable holdout metadata or later Git history leaks answers. Label provenance, blind inputs, isolate holdout data, and require curation.
**Verify:** all cases pass schema, leakage, history, and clean-materialization checks; visible quotas exclude holdout; baseline reports repository/language/size strata, lane, curated severity, stage, root cause, precision, cost, failures, and clean-case metrics.

### Checkpoint 1

A reliable, blind, unprofiled baseline exists for at least 30 curated cases, with development and validation sets visible and the holdout still sealed. Later interventions rerun this control contemporaneously rather than comparing only with stored historical numbers.

---

## Stage 2: Reduce effective cost and wall time without reducing recall

**Duration:** 4–6 days.
**Purpose:** Remove repeated method traversal and oversized routine output before adding work.

### 2.1 Stable investigator core and variable appendix

Add `src/core/method-packet.ts` and order the investigation prompt as:

```text
Stable prefix
1. Role and trust rules
2. Automated-investigator workflow
3. Finding contract
4. Summaries of every built-in lane
5. Output rules

Variable appendix
6. Activated lane details
7. Trusted profile and activated custom lanes
8. Scope and PR metadata
9. Typed manifest
10. Breadth ledger
11. Optional bounded context bundle
12. Diff
```

Initially extract the stable core with required-heading checks, snapshot it, and identify it by skill-content hash. Fail closed if a required section disappears. Treat provider prompt-cache reuse as an empirical outcome, not an architectural assumption: record actual cache reads/writes and compare cold and warm blocks. If the experiment works, prefer a canonical self-contained automated-investigator reference over increasingly complex extraction.

Tell workers that changed hunks are authoritative in the prompt; repository reads are for unchanged callers, schemas, tests, or guards. Do not ask automated investigators to read coordinator-only orchestration files.

**Files:** new `src/core/method-packet.ts`, `src/core/prompt.ts`, typed-manifest consumer boundary, prompt snapshots, and focused tests.
**Must stay untouched:** interactive skill behavior, lane text, finding contract, and profile trust.
**Risk:** extraction omits a rule. Snapshot the compiled packet and compare included workflow sections to canonical sources.
**Verify:** prompt snapshots, missing-heading failure, cache metrics, and paired benchmark results.

### 2.2 Structural breadth compaction and schema bounds

Compact `BreadthResult` before serialization. Always preserve candidates, escalations, unavailable files, covered files, per-file/per-lane clear counts, and a small sample of clear explanations. Record original and compacted counts. Throw only if preserved high-value content exceeds the hard limit.

Add reasonable `maxItems` and `maxLength` bounds to the breadth schema so concise output is generated rather than discarded later.

Do not use shorter Codex timeouts as a budget. Use concise prompts, schema bounds, explicit task limits, benchmark-supported effort changes, and observed turn/tool telemetry. Keep binary changes as structured metadata even when payloads are omitted. Defer stripping low-value Git header lines until measurement shows a material benefit.

**Files:** `src/core/breadth-result.ts`, `src/core/prompt.ts`, breadth schema/parser, telemetry, and focused tests.
**Must stay untouched:** candidates, escalations, unavailable coverage, and failure semantics.
**Risk:** compaction hides a gap. Preserve coverage counts and unavailable files.
**Verify:** a clear-heavy oversized ledger compacts with all high-value entries intact; high-value-only overflow still fails closed.

### Cost-change acceptance gate

Using randomized, contemporaneous control/treatment blocks across three repeats, define a bug as reliably detected when it is independently adjudicated as found in at least two of three runs. Pre-register the primary cost condition (cold, warm, or a production-weighted mix) and the non-inferiority margin before running:

- No reliably detected high-severity root cause is lost.
- At the visible Stage 2 and Stage 3 checkpoints, no more than one total visible
  seeded bug regresses from detection in at least two of three runs. At the
  final release/routing gate, apply the separately frozen historical-gold and
  sealed-holdout margins instead; a visible checkpoint cannot satisfy them.
- Blocking false positives do not increase.
- Completion rate does not decline.
- Effective cost or median wall time falls by at least 20%.
- Paired case-level deltas and uncertainty intervals support the same conclusion; do not decide from aggregate means alone.

Use this paired non-inferiority gate instead of “within one standard deviation”; repeat variance does not compensate for a small underlying case count.

### Checkpoint 2

The method-packet and compaction interventions each have attributable results.
If an intervention fails its registered gate, retain the negative evidence and
exclude that implementation from the accepted stack. The full visible
development/validation comparison tests the accepted Stage 2 stack against a
contemporaneous control. Effective cost or median wall time is at least 20%
lower without material recall regression.

The first structural-compaction implementation and its adaptive revision both
preserved measured quality but worsened median paired wall time. They are
rejected and remain unmerged. The accepted Checkpoint 2 treatment is therefore
PR 8's stable method packet with the existing full breadth ledger. PR 10 may
proceed from PR 8 after Checkpoint 2 passes; it does not depend on accepting a
failed compaction representation.

---

## Stage 3: Improve recall with compact evidence and bounded investigation

**Duration:** 5–7 days.
**Purpose:** Improve candidate quality and diagnostics without spending Phase 2 savings indiscriminately.

### 3.1 Activated-lane counterexamples and seam guidance

Give breadth only the **Lane summary** and `Counterexamples` section for activated lanes, supplied by the runner. Breadth still does not load lane files or assign severity.

Add a compact seam checklist: equality shortcuts, fallback identity, new helpers, schema constraints, lifecycle transitions, derived state, mode flags, startup hooks, transport conversions, error catches, and tests that stop before the risky operation.

Do not require verbose `CLEAR` prose for every branch. Use compact counts:

```ts
coverage: {
  decisionBoundariesSeen: number;
  filesCovered: string[];
  laneCoverage: Array<{
    lane: string;
    boundariesSeen: number;
    candidates: number;
  }>;
}
```

### 3.2 Compact investigation coverage

Separate three concepts before increasing budgets:

- `transportCoverage`: runner-derived proof that each changed hunk was embedded, intentionally filtered with an explicit policy result, or deterministically available through an allowed read path.
- `ledgerCoverage`: runner validation that every reviewable changed file has a candidate, clear entry, or unavailable entry and that every manifest-activated lane is represented.
- `analysisCoverage`: compact model attestation about candidates and lanes inspected. This is diagnostic and cannot by itself authorize `clean` or a cheaper route.

Add optional structured analysis coverage:

```ts
coverage: {
  candidatesSeen: number;
  candidatesTraced: number;
  budgetExhausted: boolean;
  lanesInspected: string[];
  rejected: Array<{
    candidateId: string;
    reason:
      | "unreachable"
      | "guarded"
      | "duplicate"
      | "preexisting"
      | "insufficient-contract"
      | "superseded";
  }>;
}
```

Detailed rejection prose belongs in debug artifacts only when requested. Use coverage to classify routing, breadth, investigation, budget, and presentation misses.

Change result construction so the runner no longer infers `clean` solely from an empty findings array. Introduce a versioned artifact state machine that can represent `completed`, `clean`, `incomplete`, `skipped`, and `failed` without ambiguity. `clean` requires successful stages, complete transport and ledger coverage, no unresolved unavailable surface, and zero confirmed findings. Posting reparses the artifact and refuses `incomplete`, `skipped`, or `failed` states. If this cannot remain backward compatible, bump the artifact schema deliberately and document migration behavior.

Audit ignored-path behavior as part of transport coverage. Lockfiles, generated files, binary changes, API specifications, runbooks, and shipped configuration may use specialized deterministic checks or metadata-only review, but they cannot disappear and still permit an unexplained clean result.

### 3.3 Bounded risk-sensitive candidate budget

Rename the behavioral meaning of `maxEscalations` to `investigationCandidateBudget`, retaining the old key as a temporary documented alias:

```ts
budget =
  baseBudget
  + Math.min(4, highRiskCandidates)
  + Math.min(2, explicitEscalations)
  + (coverageUnavailable ? 2 : 0);

budget = Math.min(budget, deep ? 14 : 8);
```

Respond to actual candidates and gaps, not just broad lane matches.

### 3.4 Defer caller precomputation

First measure searches per investigation, duration, use of unchanged callers, and language patterns. Only then evaluate a separate bounded index: at most 10–20 changed symbols, hit counts, up to three representative caller paths/lines each, and a recorded skip reason. Do not bundle it into PRs 8–12.

### 3.5 Keep detection separate from posting

Preserve medium and `follow-up` findings in artifacts, report their clean-case frequency, and measure action before exposing them in PR bodies. Any future “Additional findings” section must be repository-opt-in, initially appear only when a normal finding is posted, and use confidence 0.60 or higher.

Posting diagnostics distinguish below-confidence, follow-up, duplicate, comment cap, outside diff, and superseded head. Do not combine them as `skipped`.

**Files:** method/prompt builders, breadth and review schemas/parsers, result construction and posting validation, canonical lane registry, config aliasing, grading/report code, and focused tests.
**Must stay untouched:** evidence bar, breadth/investigation authority split, default publication threshold, and PR-body behavior.
**Risks:** model-attested coverage is mistaken for proof, added guidance inflates output, or budget expansion spends the Stage 2 savings. Keep coverage layers separate and benchmark each intervention independently.
**Verify:** missing-hunk and unavailable-file cases become incomplete; empty findings alone cannot become clean; posting refuses incomplete artifacts; coverage remains compact; budget formula caps; paired recall and precision results pass.

### Recall-change acceptance gate

- At least two additional curated historical bugs become reliably detected at their curator-owned severity, or an equivalent pre-registered meaningful lane gain occurs.
- No high-severity development or validation root cause regresses. The sealed holdout remains unopened until the final design is frozen.
- Across all clean repeats, additional blocking false positives are at most one.
- False-discovery rate across all cases does not exceed the pre-registered margin after adjudicating new findings.
- Effective cost increases by no more than approximately 10–15%.
- Completion rate does not decline.

### Checkpoint 3

Breadth receives compact counterexamples; runner-owned completeness prevents false clean results; investigation coverage explains misses; budgets are bounded and evidence-responsive; recall improves without material noise.

---

## Stage 4: Build the first trusted repository profile and roll out experimentally

**Duration:** 3–5 days.
**Purpose:** Improve repository-specific recall and make later routing decisions safer.

After the unprofiled baseline:

1. Select the most frequently reviewed target repository.
2. Use `build-review-profile` to document canonical helpers, identifiers, auth guards, runtime modes, harnesses, and known defect classes.
3. Add `manifest-extend` tokens for concrete helpers, tenant resolvers, environment keys, and flags.
4. Use working-tree trust only during explicit profile validation; production reviews trust the merge-base snapshot.
5. Benchmark the candidate profile as an explicitly supplied, content-hashed external profile against the same sanitized case snapshots, with and without the profile. Do not rewrite historical merge-base commits merely to inject a future profile.
6. Freeze the profile before prompt tuning against that repository.
7. Never use holdout misses to populate `Known defect classes`.
8. Keep conclusions repository-specific until the unprofiled core intervention also passes cases from other repositories and architecture families.

Add `docs/profiles.md` for resolution order, trust behavior, responsibilities, and maintenance triggers. Target CI may warn when `.peregrine/**` changes, but head-authored changes remain inactive until merged.

**Files:** target-repository profile/custom lanes, `docs/profiles.md`, README link, profile-aware matrix configuration, and validation evidence.
**Must stay untouched:** merge-base profile trust, core lane text, and sealed holdout.
**Risks:** benchmark overfitting and self-authored reviewer configuration. Freeze before tuning and retain merge-base trust.
**Verify:** paired profile/no-profile comparison improves recall without increased false-discovery rate or blocking false positives; exact profile hash is recorded; manifest records external experimental provenance and custom-lane sources; holdout remains sealed.

### Checkpoint 4

One target repository has a trusted, benchmarked profile and feature-flagged rollout. Profiles precede risk routing.

---

## Stage 5: Pilot hunk-safe large diffs, expand the corpus, then test routing

**Duration:** 5–8 days plus corpus curation.

### 5.1 Hunk-safe large-diff chunking

1. Group ordinary file blocks by top-level directory and pack within the configured size.
2. Split oversized files only at hunk boundaries; preserve every changed hunk.
3. Include small overlap or a file summary when a file spans chunks.
4. Merge breadth ledgers with chunk-prefixed IDs and structural compaction.
5. Give investigation the whole-range typed manifest, candidate/escalation/high-risk hunks, and compact clear coverage for the rest.
6. Feed every chunk into runner-owned transport and ledger coverage. Any omitted, unreadable, or policy-filtered risk-bearing hunk makes the result incomplete unless a documented deterministic substitute covers that file class.
7. Retain a transparent hard ceiling for generated, mechanical, or impractically large changes.

The objective is: **No consequential, reviewable PR is skipped solely because its diff can be safely partitioned.** It is not “approximately zero skipped reviews.” Keep chunking behind `limits.chunkLargeDiffs` until large-diff gold cases pass. Exceeded cost ceilings produce explicit non-clean results.

**Files:** `src/core/diff.ts`, prompt/orchestration code, engines, result types/parser, config/docs, chunking tests, and large-diff cases.
**Must stay untouched:** full-diff commentable lines, inline anchoring, profile trust, and job isolation.
**Risk:** cross-chunk defects and silent omission. Preserve all hunks and use whole-range manifest data.
**Verify:** deterministic packing, no hunk loss, oversized-file tests, incomplete-not-clean behavior, and cross-directory defect cases.

### 5.2 Expand before routing

Grow to at least 50 cases:

- At least five cases in every high-risk lane.
- Approximately 20% sealed holdout, excluded from the visible five-case-per-lane quota.
- Clean cases on the same surfaces as high-risk bugs.
- Profiled and unprofiled cases clearly labeled.
- Large-diff and contract-bearing documentation cases.

### 5.3 Repository-opt-in risk routing

Risk is initially a deterministic policy decision with reason codes, not a falsely precise numeric score or one-lane boolean. Consider activated lanes including `contracts`, custom lanes, contract-bearing files, profile provenance, breadth escalations, coverage gaps, diff size, and change type. Add a numeric score only if later calibration shows it predicts outcomes better than transparent rules.

A repository may downgrade only when:

```text
profile is present and trusted
AND manifest completed
AND no high-risk lane or custom lane activated
AND breadth coverage is complete
AND no escalation was emitted
```

High-risk changes retain the strong route. A standard empty-ledger path may use smaller bounded investigation but does not skip independent investigation without a separately approved topology change. Docs-only changes post nothing or report policy-skipped/not-applicable; they do not claim `clean` automatically.

Record requested/actual route, policy tier, reason codes, and fallbacks. Keep routing repository-opt-in until the final sealed-holdout gate passes.

**Files:** new `src/core/risk.ts` or equivalent policy module, config/types, engine orchestration, artifact reporting, matrix configurations, documentation, and focused tests.
**Must stay untouched:** strong routing for high-risk or incomplete cases, interactive routing precedence, and the two-stage topology.
**Risks:** false downgrade, insufficient standard-risk sample, or cache-biased savings. Default to the strong route whenever a prerequisite is absent and use the paired protocol.
**Verify:** exhaustive reason-code tests, manifest/profile/coverage failure fallbacks, high-risk route retention, docs-only policy behavior, and paired cost/recall holdout evidence.

### Routing acceptance gate

- Approximately 50 benchmark cases exist.
- The target repository has a trusted profile.
- High-risk cases always retain the strong route.
- The pre-registered paired non-inferiority analysis supports a margin of no more than five recall points for standard-risk cases; if the standard-risk stratum is too small for that conclusion, collect more cases rather than declaring equivalence.
- No blocking high-risk holdout bug is lost in the one final holdout run.
- Failed or incomplete reviews are never clean.
- Completion rate does not decline.
- The selected cheaper route lowers provider-reported or provider-correct estimated cost by a pre-registered material amount after cache-state balancing.

### Checkpoint 5

Large-diff review is safe and feature-flagged; the corpus supports routing decisions; one profiled repository passes an opt-in routing pilot.

---

## Deferred Stage 6: Runner-controlled verification actions

Do not implement provider-controlled Bash. A safer future design is:

1. Investigator requests a named action such as `unit-test:file-name`.
2. Peregrine validates it against structured configuration.
3. The Node runner launches a separate subprocess or container.
4. It receives no provider or GitHub credentials.
5. Network access is disabled.
6. A bounded result returns to investigation or a short adjudication pass.

Keep disabled until the boundary, scrubbing, fork/mention policy, timeout/cleanup, and platform sandbox support receive a dedicated security review.

## Deferred Stage 7: Outcome weak-label collection

Resolved threads, reactions, replies, and changed anchored lines are acceptance/noise signals, not proof. A future read-only collector may propose manually curated case drafts or threshold changes. It must not automatically promote outcomes into ground truth or tune prompts, thresholds, profiles, or lanes. Begin only after enough production reviews exist for meaningful rates.

## Checkpoints and rollback boundaries

| Checkpoint | Valid state | Rollback boundary |
| --- | --- | --- |
| 0 | Blind case isolation, faithful history, failure accounting, typed-manifest shadow parity, adjudication, provider-correct cost, and reproducible experiments | Revert harness PRs independently; model prompt behavior unchanged |
| 1 | At least 30-case unprofiled development/validation baseline with sealed holdout | Correct visible cases without runtime changes; holdout remains unopened |
| 2 | Stable packet and compaction lower cost/time | Revert PR 8 or 9 independently |
| 3 | Counterexamples, runner-owned completeness, coverage, and budgets improve recall | Revert PRs 10–12 independently; preserve artifact-version compatibility or migrate deliberately |
| 4 | First target profile benchmarked and flagged | Disable profile use or revert target profile |
| 5 | Safe large-diff pilot and opt-in routing on ~50 cases after one sealed-holdout gate | Disable chunking; route every class through strong path; retire the opened holdout |

## Open decisions requiring user input

1. Before Stage 1, which repositories and architecture families supply development, validation, and sealed-holdout cases, and which repository receives the first profile.
2. Who controls the sealed holdout and authorizes its one final run.
3. Whether private cases may be reduced and checked in or remain credentialed curator inputs used only to create sanitized repositories.
4. Per-screening and per-checkpoint provider-spend, wall-clock, and failure-rate ceilings.
5. The production cold/warm-cache mix used as the primary cost condition.
6. Provider price values, `pricingAsOf`, tier rules, and where estimates may appear.
7. Whether medium/follow-up findings should ever appear in PR bodies. Minimum proposed confidence is 0.60, not 0.50.
8. Whether runner-controlled test execution is acceptable after its security design exists.
9. Whether policy-skipped docs-only reviews should post a message or remain silent.

## Estimated blast radius

- **Stage 0:** roughly 16–22 source/eval/test/config/schema files plus case materialization, leakage checks, experiment manifests, captured provider envelopes, and metadata migration.
- **Stage 1:** at least 30 blind case artifacts split across development/validation/holdout storage, eval documentation, adjudication records, and validation reports.
- **Stages 2–3:** prompt/method builders, schemas/parsers, engine usage, config aliases, and tests.
- **Stage 4:** one target profile plus documentation and profile-aware eval configuration.
- **Stage 5:** diff chunking, risk classification, routing, engine orchestration, artifact reporting, and large-diff/routing cases.
- **Public contracts:** fields for failure outcomes, manifest data, compact coverage, provider-specific usage, policy/routing, and an explicit incomplete state. The artifact state-machine change requires deliberate versioning and posting compatibility review rather than being assumed additive.
- **Interactive users:** unchanged through benchmark work; breadth additions are additive; routing stays opt-in.
- **Security boundary:** unchanged unless deferred runner-controlled verification is separately approved.

## Definition of done

- PRs 1–15 are independent, `npm run validate` is green, and every checkpoint has validation evidence.
- Failed/missing attempts cannot improve apparent benchmark results.
- Every live-model case is blind, uses an opaque ID and sanitized reproducible base/head history, contains no accessible answer material, and exercises production manifest routing.
- Gold set v1 has at least 30 curated multi-repository cases with separate development/validation sets and a sealed holdout; routing evaluation uses ~50 cases, ~20% sealed holdout, and at least five visible cases per high-risk lane.
- Control and treatment run contemporaneously in randomized paired blocks, with immutable experiment provenance and explicit spend/time ceilings.
- Reports include bug-instance/root-cause recall, adjudicated precision/false-discovery rate, confidence calibration, clean-case blocking false positives, failure-inclusive metrics, miss stages, provider-correct cost, tool work, and appropriately stratified duration statistics.
- Typed manifest data passes shadow parity before any consumer changes model prompts or routing.
- Stage 2 lowers effective cost or median wall time by at least 20% without material recall or completion regression.
- Stage 3 reliably detects at least two additional historical bugs, or an equivalent lane gain, within cost and false-positive gates.
- Runner-owned transport and ledger coverage make an incomplete review incapable of becoming `clean` or postable.
- The first repository profile improves recall without increased blocking false positives.
- Large-diff chunking preserves every changed hunk and never reports incomplete coverage as clean.
- Cheaper routing remains off until the ~50-case, trusted-profile, one-time sealed-holdout, provider-cost, and completion gates pass.
- Deferred verification and outcome work stays out of core delivery unless separately approved.
