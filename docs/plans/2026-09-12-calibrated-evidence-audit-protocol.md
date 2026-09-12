# Calibrated evidence-audit protocol

Date: 2026-09-12
Status: prospective exploratory protocol; not a provider authorization

## Purpose and evidence class

This protocol governs future internal exploratory evidence labeling and
corpus repair. It is a successor path, not a rewrite of the sealed v2 packet
or workbook. The old packet/workbook remain unchanged and unadmitted. AI
outputs under this protocol are label proposals. They are not human decisions,
human verification, independent confirmation, protected selection, sealed
holdout evidence, or Peregrine efficacy evidence.

The Astra xhigh methodology review distinguishes mechanical provenance, semantic admission,
and output adjudication. A mechanically correct hash or test does not settle
semantic reachability or consequence; a human signature does not guarantee
correctness; and a separate AI session is not an independent human assessor.
These distinctions follow the reviewed primary sources on benchmark
construction and validation, including [BugsJS](https://bugsjs.github.io/paper/ICST19.pdf)
and [SWE-bench](https://arxiv.org/html/2310.06770v3).

## Label roles

AI may retrieve evidence, draft causal traces, propose severity and duplicate
families, suggest reproductions, and match findings to frozen roots. Every
such output must be stored as a proposal with model/version, prompt or rubric
version, input digest, timestamp, abstention state, and confidence/probability
when available. A proposed label must never populate a human identity field or
silently become an accepted label.

Audited labels may support aggregate estimates through the audit design below
or the simpler full-human option. Unresolved and `other/unclassified` remain
valid outcomes.
Calibrated AI-assisted labeling can support aggregate estimates only through
an explicitly implemented estimator and representative human audit. It does
not convert unaudited individual AI proposals into accepted case-level truth
or individually admitted known-root benchmark cases.
An executable or formal oracle may be used when it actually defines the target
behavior; an unrelated environment failure is not a reproduced defect.

## Calibrated audit design

Before labeling begins, freeze the rubric, AI model/version, examples,
abstention rule, strata, sampling frame, randomization seed or equivalent
selection record, and escalation triggers. The frame must include repositories,
languages, static versus reproduced evidence, severities, comparisons,
matched and unmatched findings, rejected candidates, and both candidate and
baseline outputs. Randomly audit apparently easy agreements as well as
disagreements and rejections. Auditing disagreements alone cannot estimate
overall label error.

For each future corpus or output-label population:

1. Define strata and their inclusion probabilities before viewing outcome
   patterns. Use a frozen representative probability sample, with explicit
   oversampling where high-impact or rare strata need precision. Record the
   probability of selection for every audited unit.
2. Require exhaustive audit of materially disputed, high-impact, and safety-
   sensitive cases, in addition to the probability sample. These cases are not
   a substitute for the random audit component.
3. Where feasible, have the audit reviewer make an initial judgment without
   seeing the AI conclusion, then expose the proposal for disagreement
   resolution. Record the initial judgment, AI proposal, disagreement type,
   resolution authority and rationale, final accepted status, and abstention.
4. Estimate label error by stratum and arm, including false-positive and
   false-negative directions where defined. Carry sampling weights and
   label-error uncertainty into the aggregate estimate; do not attach an
   ordinary interval to unchecked pseudo-labels and call it calibrated.
5. Expand the audited sample, pause, or report the result as inconclusive when
   error bounds exceed the preregistered tolerance, a high-impact disagreement
   cannot be resolved, sampling records are incomplete, an arm has differential
   grading error, or a safety trigger fires.

The exact confirmatory audit size is intentionally not specified here. Before
confirmation, preregister a numerical power/error analysis or a simulation
reflecting the actual strata, cluster sizes, dependence, target estimand,
practical margins, and acceptable label-error contribution. A precise number
must be the result of that design, not a fabricated fixed rule. Prediction-
powered inference is a relevant primary-method precedent for correcting model
predictions with audited labels while carrying uncertainty; it does not make
this code-review protocol self-validating. See [Prediction-Powered
Inference](https://www.stat.ubc.ca/~john/papers/AngelopoulosScience2023.pdf).

Separate corpus admission from post-run output adjudication. Corpus-admission
strata are repository, language, proof level, class, and severity. Output-
adjudication strata are arm and matched versus unmatched finding. Keep their
sampling frames, probabilities, decisions, weights, and uncertainty ledgers
separate; an output-audit sample cannot be substituted for a corpus-admission
decision.

For a fixed known-root R4 corpus, every admitted root/case label must be
supported by an accountable human decision or a validated executable/formal
oracle. The exception is a new, explicitly registered R3 protocol/analysis
path that treats labels as predictions and carries label uncertainty into the
estimand; it must not call those individual cases human-verified. The existing
R2 partition compiler cannot consume sampled AI approvals as if they were
case-level admissions. Sampled approvals may inform a calibrated aggregate
estimator only after that estimator is implemented and registered.

For a small corrected corpus, full human review of every semantic dossier and
every emitted finding remains a valid and simpler option. It must still record
scope, uncertainty, unresolved cases, and the absence of independent-human or
sealed-holdout claims. For larger paths, the calibrated audit is the default
exploratory design, not permission to call unaudited individual records
human-verified.

## Competent baseline contract

The baseline is a named, competent minimal reviewer, not a straw-man. Freeze
one exact minimal prompt byte sequence and its version hash. Candidate and
baseline receive identical:

- raw repository/PR scope and snapshot;
- model version, reasoning effort, tools, tool permissions, and read-only
  restrictions;
- output schema, finding contract, truncation and failure semantics;
- preprocessing, context budget, handoff accounting, and comparable total
  allowance; and
- access timing, retry policy, and completion deadline.

The baseline must be able to inspect the same scope, use the same allowed
tools, and substantiate findings under the same contract. Its prompt and
mounted resources must contain no Peregrine packet, lane, profile, example,
semantic annotation, answer-bearing history, or other Peregrine leakage. Hash
the assembled prompts and mounts and audit access logs. Equal caps alone do
not prove equal resources consumed; include preprocessing, handoff, and worker
costs in the allowance. These controls apply the reviewed resource and
holdout guidance from [AI Agents That Matter](https://arxiv.org/html/2407.01502v1).

A two-arm candidate-versus-baseline test is sufficient to answer the product-
value question for the named candidate and baseline. Retain four arms only for
instruction/topology attribution: e.g. fixed-topology method contrast and
two-stage workflow/package contrast. Four arms are not required for a product
value claim and do not automatically form a clean factorial experiment.

## Exploratory and confirmatory boundaries

The 12-case, four-arm, two-repeat design yields 96 review attempts and 144
planned model invocations, but it is explicitly exploratory. Repeats estimate
execution variability on the same case; they are not independent PRs,
repositories, roots, or bug families. This follows the reviewed paired-eval
guidance in [Miller](https://arxiv.org/html/2411.00640v1).

Before any confirmatory run, preregister all of the following:

- the primary estimand, such as the paired candidate-minus-baseline difference
  in case-balanced per-PR known-root recall, with comparison-case noise
  analyzed separately;
- the inferential population and dependence unit, including repository and
  duplicate-family clustering and the treatment of crossed families;
- the minimum worthwhile effect, tolerated noise/completion losses, and any
  superiority, non-inferiority, or equivalence claim;
- the numerical or simulation-based power/error plan and nuisance-variance
  assumptions, using development only for planning;
- the interval construction, resampling or model method, zero-denominator and
  failure handling, and leave-one-repository-out sensitivity; and
- the primary/secondary claims, multiplicity policy, stopping rule, and all
  deviations to report.

The need to freeze selection before confirmation follows [Cawley and
Talbot](https://www.jmlr.org/papers/volume11/cawley10a/cawley10a.pdf). Clustered
dependence and few-cluster limitations follow [Cameron and
Miller](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015.pdf).
The Astra xhigh methodology review's numerical illustrations are reviewer calculations,
not Peregrine results and not a prescribed confirmatory sample size. Sample-
size justification should follow [Lakens, Sample Size
Justification](https://doi.org/10.1525/collabra.33267); the terminology for
superiority, non-inferiority, and equivalence follows [Lakens, Equivalence
Tests](https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906/).

The September 9 2-of-3 severe rule is an operational stop/investigation rule:
baseline detection in at least two repeats and treatment detection in at most
one should pause the lane, preserve evidence, and investigate. It is not a
statistical test, non-inferiority result, safety certification, or proof that
the treatment lost. Report all severe discordances even when the rule does not
fire; the reviewed methodological calculation shows that a directional flag
can occur under equal performance.

The 50-PR consecutive private cohort is feasibility and signal collection.
Freeze eligibility, snapshots, follow-up, and symmetric candidate/baseline
adjudication, but do not treat it as a powered efficacy test, exhaustive
missed-defect reference, or production outcome claim. [AutoCommenter](https://arxiv.org/html/2405.13565v1)
and the [NIST AI RMF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf)
support measuring operational burden and context-specific risk without
overstating what shadow observation identifies.

## Disclosure and stop conditions

Reports must separate sourced facts, reviewer calculations, and Peregrine
policy choices. They must report sampling probabilities, audited and
unaudited counts, initial judgments, disagreement/resolution, label-error
uncertainty, unresolved cases, completion, and arm-specific grading error. Do
not infer a clean comparison from no comment, merge status, or passing tests.
Do not infer unseen or uncontaminated historical cases from dates alone; public
material may have been in model training. See [LiveCodeBench methodology](https://livecodebench.github.io/)
and [Datasheets for Datasets](https://arxiv.org/abs/1803.09010).

Stop and mark the result inconclusive when the audit cannot support its error
bound, a disputed/high-impact case lacks resolution, provenance or packet
binding fails, Peregrine leakage is detected, the baseline contract differs,
or a safety trigger fires without a documented investigation. Do not repair
these conditions by relabeling history or weakening proof.

## Authorization boundary

This protocol authorizes documentation and deterministic preparation of a
future evidence path only. It does not authorize provider runs,
credential-bearing canaries, production route changes, automatic posting,
release changes, or efficacy claims. Deterministic implementation, evidence
archival, and a zero-provider R4 freeze are within the correction program; a
corrected R4 freeze and its `gpt-6-astra` medium-effort adherence gate are
prerequisites for any later separate authorization of credential-bearing or
other external execution.
