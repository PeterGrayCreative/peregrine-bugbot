# Evidence-audit correction goal

Date: 2026-09-12
Status: termination path complete; Sections 1–2 complete, Section 3 failed readiness, Section 4 prohibited

## Goal

Replace the unsafe evidence-audit assumptions exposed by the Astra xhigh
methodology and R2 corpus reviews with a calibrated, prospective correction
path. Preserve all
old plans, packets, workbooks, seals, and progress records as historical
artifacts. The sealed v2 packet/workbook remain byte-unchanged and unadmitted;
this goal does not turn advisory AI recommendations into human decisions,
independent selection, a sealed holdout, or confirmation evidence.

This goal is a research-integrity correction, not a provider or product
rollout. Provider runs, production routes, automatic posting, and efficacy
claims remain unauthorized throughout.

## Implementation and review orchestration

Judgment-heavy implementation, evidence interpretation, corpus semantics,
protocol changes, and shared-contract decisions are owned by a
`gpt-6-astra` agent at medium effort or stronger when a documented ambiguity
requires it. A different, fresh `gpt-6-astra` medium-effort agent performs the
read-only quality/adherence gate after each section. The implementer cannot
approve its own section.

Luna agents may be used only for tightly bounded mechanical work with explicit
inputs, file ownership, invariants, and acceptance tests. Luna output remains a
proposal until the Astra implementer or primary integrator verifies the actual
diff and evidence. Repeated redesign, provenance ambiguity, semantic evidence
claims, or a required shared-contract change ends the Luna assignment and
returns the decision to Astra or the primary integrator. Passing structural
tests alone never authenticates an evidence claim.

The primary integrator retains scope, architecture, integration, durable
records, repository delivery, and final verification. No implementation or
gate agent may admit cases, convert AI advice into human curation, run a
provider experiment, or change production routing under this goal.

## Delivery sections and gates

Each section is completed only when its specified implementation or other
deliverable exists, its documentation and evidence contract are internally
consistent, and a `gpt-6-astra` medium-effort read-only quality/adherence gate
has reviewed it. The gate must check the section against this goal, the
calibrated protocol, the two audit artifacts, and the scope limits. It may
recommend revisions or mark the section inconclusive. It does not perform
human curation, grant admission, establish independent selection, execute a
provider run, or authorize R4. The next section cannot rely on an ungated
section.

### Section 1 — prospective protocol/design

Publish the [calibrated evidence-audit protocol](2026-09-12-calibrated-evidence-audit-protocol.md).
It must define AI proposals versus accepted labels; probability/stratified
sampling; exhaustive review of materially disputed and high-impact cases;
disagreement and resolution records; label-error uncertainty; expansion and
inconclusive triggers; the small-corpus full-human option; and the no-claim
boundary for unaudited cases. It must also freeze the competent baseline
contract and the exploratory/confirmatory statistical boundary.

Gate: `gpt-6-astra` at medium effort performs a read-only quality/adherence review of this protocol.

### Section 2 — successor packet repairs

Create a successor packet specification and repair ledger, without modifying
the sealed v2 packet/workbook. Bind the complete alpha-010 support; correct
alpha-025's review base and full diff; correct alpha-021's attribution; update
exposed-07's stale recovery status; and replace incomplete or blank rendered
proposal content with substantive, source-bound proposal material. Preserve
the RxJS alpha-025/random-007 duplicate-family relationship. All repaired
records remain proposals until the selected admission protocol accepts them.

Gate: `gpt-6-astra` at medium effort performs a read-only quality/adherence review that checks every repair
against source identity, packet binding, limitations, and leakage boundaries.

### Section 3 — corpus repair/replacement

Reassess the corrected pool prospectively. Do not fill the 16 bug-bearing and
5 comparison deficits by relabeling, weakened proof, or treating Astra
recommendations as human truth. Retain unresolved and `other/unclassified`
outcomes. Either perform the calibrated audit or use full human review for a
small corrected corpus. Do not claim individual human verification for cases
outside the audited sample, and do not create a protected selection partition
until the protocol's sampling, uncertainty, and access requirements pass.

Gate: `gpt-6-astra` at medium effort performs a read-only quality/adherence review of the corrected corpus
ledger, sampling probabilities, initial decisions, disagreements, resolutions,
error uncertainty, and any trigger response.

### Section 4 — corrected R4 freeze

Freeze only the exact candidate/baseline prompts, raw scope, tools, model,
effort, output schema, comparable total allowances, routes, corpus identity,
rubric, failure categories, analysis, interval method, multiplicity policy,
and hashes needed for a later authorization decision. A two-arm
candidate-versus-baseline test is sufficient for product value. Retain four
arms only if instruction/topology attribution is explicitly sought and its
extra claims are marked exploratory. The 12-case/96-attempt plan remains an
exploratory screen; repeats do not increase the number of independent cases.

Before any confirmation claim, register a numerical, simulation-based, or
design-appropriate power/error plan with an explicit estimand, dependence unit,
practical margins, interval method, multiplicity policy, and failure rules.
The 2-of-3 severe rule may stop or investigate a run, but cannot certify a
statistical loss or safety result. The 50-PR cohort may collect feasibility and
signal only.

Gate: `gpt-6-astra` at medium effort performs a read-only quality/adherence review of the complete freeze.
This gate is not R4 authorization; provider execution requires a separate,
explicit authorization after the freeze.

## Completion boundary

Completion has two paths. On the readiness path, Section 1 has its protocol and
required read-only gate record, Section 2 has an actually repaired successor
packet, Section 3 has a corrected corpus that passes its readiness contract,
and Section 4 has an actually corrected zero-provider R4 freeze plus its
required read-only gate record. On the termination path, Sections 1 and 2 have
their required deliverables and gate records, and Section 3 has a gated
termination/inconclusive report that documents why corpus readiness and R4
cannot proceed; Section 4 is then not required and must not be fabricated. It does not
mean that the old packet is repaired in place, that a 36-case corpus is ready,
that any case is human-verified outside its declared audit path, or that
Peregrine efficacy has been measured.

## Terminal paths

Section 3 and the overall correction program have two valid terminal paths:

1. **Corpus readiness:** the corrected packet/corpus satisfies the frozen
   collection ceiling, repository-family balance, provenance, duplicate,
   truth, sampling, and uncertainty requirements; Section 4 produces a
   reviewable zero-provider R4 freeze and its Astra medium gate. This still
   requires separate authorization before any credential-bearing canary or
   provider execution.
2. **Reviewed termination or inconclusive:** the frozen budget, family target,
   proof, access, audit, or uncertainty requirements cannot be met. Publish the
   yield/loss ledger, unresolved reasons, and the exact boundary that prevented
   R4. Do not relabel cases or treat this outcome as evidence that Peregrine is
   effective or ineffective.

Deterministic implementation, evidence archival, and zero-provider R4
preparation are within this correction goal. Separate authorization applies to
credential-bearing canaries, provider runs, and other external execution—not
to those deterministic preparation steps.

## Durable source artifacts

- Public methodology report: [archived report](../validation/artifacts/2026-09-12-astra-methodology-research-review.md), source/archive SHA-256 `acccfd5c42c01ba3f3ab52a0c0d473f827d05fd79566adc2230fd71816598c38`, Git blob `7a68cbb21b756cbc2c1631747091ec5d0977f992`.
- Private corpus report: `PeterGrayCreative/peregrine-evidence-backup/audit-reports/2026-09-12-r2-corpus-audit.md` at private backup commit `d04cce4`, source SHA-256 `bd9e2b2f84b27648be6afc927a52f15e41ce87e9e5cacaf9c669149c09d3503a`, archived-file SHA-256 `054cdb8509c711694c7e060ba4c093df81f4189aaae7493245083ca08af81a4c`, and Git blob `1543798909e0de35de6b9d4df1f0ec0e278933e3`.

The source report paths under `/Users/petergray/Documents/Codex/2026-09-12/`
are execution provenance only. The repository/path/blob records above are the
normative durable references. The archived files add a terminal newline to
the source files where the source lacked one; both source and archived hashes
are recorded to make that normalization explicit.
- [Existing ablation plan](2026-09-04-typescript-javascript-evidence-ablation-plan.md)
- [Existing progress record](2026-09-04-typescript-javascript-evidence-ablation-progress.md)
