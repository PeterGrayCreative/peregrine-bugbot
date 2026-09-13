# AI prediction development registration v1

Date: 2026-09-13. Status: additive design registration; independent gate pending.
The executable check has no provider interface. Its success means only that
this registration reconstructs from the pinned evidence and its synthetic
sensitivity calculation behaves as specified.

## Decision and relationship to the original plan

The Section 3 FAIL and the completed correction termination remain in force.
The existing corpus-dependent Section 4 freeze remains prohibited. This is a
new prediction-only R3 analysis path under the explicit exception in the
[calibrated protocol](2026-09-12-calibrated-evidence-audit-protocol.md).
It preserves the original program through R8 and supplies a bounded step
toward learning whether further measurement is useful. It completes neither
R4 nor the wider goal. Production settings remain outside this registration.

Human curation would provide accountable external checks on semantic labels
and, with a suitable sampling design, information about label error. A human
signature alone supplies neither correctness nor independence. The user's
choice to use Astra is compatible with development work when labels remain
predictions. A separate AI gate checks reasoning and adherence but cannot
estimate correlated model errors or turn these labels into reference truth.

This design deliberately measures agreement with bounded AI predictions and
shows how assumed label and matching errors can change that description.
There is no calibrated truth estimator and no evidence here for an efficacy,
superiority, non-inferiority, safety, or generalization claim.

## Fixed frame and concentration amendment

The normative private artifacts are under
`PeterGrayCreative/peregrine-evidence-backup/ai-exploratory/prediction-development-v1/`:
`registration.mjs`, its generated `registration.json`, and
`registration.test.mjs`. The manifest reconstructs the exact 36-case ledger
from the xhigh report at private source commit `c753eb2`, joined to its pinned
FRAME. It copies the complete bounded interpretation and qualifications for
each case. The source report SHA-256 is
`ba4690e21c4b0661460253a8fd4d387231bdde61595baefbf28d61dbdf6bb38b`.

Include all 16 approved static AI proposals: 9 bug-bearing proposal bundles
and 7 partial comparison contracts. Exclude all 19 unresolved proposals, the
one rejected attribution, and all 11 retained losses. Exclusion supplies no
evidence of cleanliness. No further collection, substitution, repair-based
promotion, partition, or selection occurs under this version. A later change
requires a new version preserving this one and its outcomes.

The six repository counts are Next.js 5, Sequelize 4, RxJS 3, VS Code 2,
Axios 1, and Bull 1. There are 15 source families. This fixed set replaces the
old 25% concentration rule only for this descriptive development design:
maximum 5 cases from one repository, 31.25% of 16. The old contract still
failed. The new rule is registered after curation outcomes were known but
before any new review-arm outcomes; it is not retrospective evidence of a
passed old gate. Keeping the complete accepted set avoids selecting cases
to manufacture balance. It cannot support population sampling claims.

Alpha-025 and random-007 stay in one `rxjs-4595` dependence family despite
their different classes. Linked-family-001 is one proposal bundle with two
conditions; full bundle coverage requires both, not a convenient single-root
match. All repeated runs remain observations on the same cases. No protected
selection or holdout exists; historical public material may have been in
training, and the corpus and labels have been exposed during development.

## Exact intended contrast and parity contract

Use only A and B, two repeats per case, 64 scheduled single-session attempts.
The primary description is B minus A: the existing experimentally adapted
Peregrine single-session method versus the existing competent minimal
single-session reviewer. It tests method portability on this set. It does
not test the full two-stage production package, topology, or D-minus-C.
The registration fixes deterministic alternation of A/B order across case
index and repeat. This balances order; it is not a random population sample.

Use `compileMethodologyReviewPrompt` in `eval/methodology-prompts.ts` for A/B
at public base `b6d3be3`; A's minimal prompt is already a substantive review
instruction. B uses all standard core lanes, no project profile or custom
lanes. No candidate-specific route adaptation or tailoring to known answers
is permitted. Preserve the compiler's common static inspection boundary and
`schemas/methodology-review.schema.json`. No findings schema shortcut or
comparison-specific instruction is permitted.

Both receive the same exact raw introducing/reviewed diff, complete permitted
head snapshot, neutral task specification, pinned model version and effort,
read-only tools, access timing, schema, failure rules, and allowances. Intended
model setting remains the original homogeneous Sol-high setting; a concrete
served route/version must be separately frozen before execution. Per attempt,
the prospective equal cap is 120,000 aggregate model input/output/reasoning
tokens, 100 read-tool calls, 2,000,000 returned tool bytes, 16,000 output tokens,
and 20 minutes wall time, with no retries. Prompt construction and any
preprocessing consume the same total accounting allowance. Actual usage and
missing observability must be reported; equality of ceilings does not imply
equality of consumption. If the runtime cannot enforce or observe a cap,
execution preparation fails rather than silently choosing a replacement cap.

The full curator packet, old recommendations, later fixes, reports, labels,
source history, answer-bearing filenames/annotations, human RESPONSE and this
manifest cannot be mounted to either arm. Baseline resources additionally
exclude all Peregrine instructions, lanes, packets, profiles and examples.
Complete materialization must bind per-case base/head trees, raw diff hash,
allowed-file inventory and hashes, all assembled prompt bytes and hashes,
method source hashes, output schema, tool policy and logs. Both arms must be
able to inspect the same permitted raw repository context. Partial Git stores
or structural reference-only mounts do not establish this condition. A missing
required source is a preparation blocker and never a clean review.

Those real mounts, served route, assembled prompt hashes and enforcement
bindings are not yet delivered by this registration. A further deterministic
implementation with its own fresh Astra medium gate is required. No provider
authorization can be inferred from the registration check.

## Prediction-aware outcomes and sensitivity

Freeze the exact bounded proposal bundle before any arm output. For case i,
arm a and repeat r, let coverage c(i,a,r) be 1 only when a completed review has
AI-adjudicated full coverage of the frozen bug proposal bundle, otherwise 0.
Every scheduled failure, missing attempt, timeout, tool/context failure,
transport failure, parse failure, and incomplete review contributes 0 in the
lower-bound description. Keep each failure category separately visible.
Partial valid findings from failed attempts remain available to all-output
adjudication, but cannot masquerade as a completed covered review.

Average the two repeats within case and then the nine case means. Report B
minus A for this case-balanced predicted-bundle coverage. Name it exactly as
prediction agreement; do not label it known-root recall. Report each bundle's
conditions separately as supplementary data without increasing sample size.
There is no bug-coverage denominator for the seven comparisons.

Use the executable `sensitivity(rows, k)` to enumerate all retained subsets
after allowing up to k of the nine predicted bug bundles to be invalid,
for every k from 0 through 9. For each nonempty subset average the paired
case differences; report the minimum and maximum. At k=9 also report that all
bundles may be invalid and the ratio is undefined. These are explicit
assumption bounds, not confidence intervals or probabilities of correctness.
They cover uncertainty about the registered predictions, not unknown defects
outside their contracts or the truth of excluded candidates.

Matching is also uncertain. Every disputed completed-attempt match has a
coverage interval [0,1]. For paired case means use lower(B)-upper(A) and
upper(B)-lower(A), then enumerate the same label subsets. Unknown or failed
execution stays 0 for the failure-inclusive coverage description; additionally
show [0,1] for its hypothetical completed coverage as a missing-execution
sensitivity, clearly separated from observed outcomes. Report the unbounded
matching-error scenario allowing every completed match to be wrong; do not
select only a favorable label budget. No threshold on any of these intervals
authorizes promotion or claims an effect.

Alongside case means, report repository means, equal-repository means,
leave-one-repository-out results and family-weighted results. For measures
across bug and comparison cases, first average members of `rxjs-4595` so the
family contributes once; never pool the two classes' denominators. Report
the exact counts of repositories, families, cases, conditions and repeats.
These are robustness descriptions, without population intervals or p-values;
six exposed repositories cannot establish generalization.

## All-output adjudication and incomplete comparisons

Preserve every raw response and parsed finding from every attempt and arm,
including failed/partial attempts. Pool findings by case, conceal arm and
expected winner, deduplicate causal roots, and give a fresh Astra xhigh
assessor the neutral reviewed source and frozen bounded contracts. Preserve
its initial prediction, evidence, abstention and dissent separately. A fresh
Astra medium reviewer checks every emitted finding's adjudication, including
matched findings and apparent easy rejections. Disagreement remains unresolved
unless an explicit source-based resolution is recorded; a second AI session
does not produce independently verified truth. Bind adjudication to run,
attempt, raw output, finding, source and rubric digests with append-only
versions, preserving initial scores and every failed attempt.

Classify each finding as predicted matched, predicted additional supported,
predicted unsupported, or unresolved. Review all out-of-contract findings on
both bug and comparison cases. Random-012's malformed surrounding syntax,
for example, may support a valid additional finding despite its accepted
event-name contract. Never infer unsupported from the absence of a known
root or from a comparison label. No class is called confirmed discovery.

Report predicted unsupported roots per scheduled review, unresolved roots per
scheduled review, raw finding burden per scheduled review, and comparison
cases with at least one predicted unsupported root. Show lower/upper noise
counts with unresolved findings assigned supported/unsupported, plus an
unrestricted AI-classification-error sensitivity allowing any classification
to flip. Report additionally the completed-only views, explicitly secondary.
Incomplete attempts with zero findings do not certify no noise; flag missing
output and completion loss alongside the failure-inclusive denominator.
Unknown costs are `n/a`; report total observed wall time, tokens and tool
usage including failures. Do not silently discard costly failed attempts.

## Stops, decisions and remaining implementation

Stop preparation for source/hash drift, missing reviewed context, unequal
scope or limits, baseline leakage, route ambiguity, or incomplete accounting.
Stop any separately authorized future run for a provenance break, leakage,
baseline contract mismatch, or a severe baseline-found/candidate-missed
discordance pending source-based investigation. With two repeats, every such
severe discordance triggers investigation; the old 2-of-3 rule does not apply.
Retain all attempts and report the truncated schedule as inconclusive. Do not
rerun failures or select an outcome-dependent replacement case.

The only current decision is whether to continue deterministic preparation.
The generic known-root grading and contrast modules require reference truth;
these prediction records must not be passed into them as admitted labels.
The existing prompt compiler can be reused, but a new execution adapter must
bind actual mounts, lifecycle, outputs, resource accounting, AI adjudication,
and all registered sensitivity summaries before behavioral results exist.
The small tested sensitivity primitive is not that adapter.

R5 remains unexecuted and requires separate explicit user authorization after
complete preparation. R6 confirmation and R7 shadow evaluation are untested;
this design supplies no protected set or calibrated label evidence for them.
R8 currently records method detection/noise benefit as not tested and overall
efficacy as inconclusive. A future descriptive result can justify another
development investigation, not deployment, retention for efficacy, or removal
for ineffectiveness. No provider experiment, production routing change,
automatic posting or release is authorized here.
