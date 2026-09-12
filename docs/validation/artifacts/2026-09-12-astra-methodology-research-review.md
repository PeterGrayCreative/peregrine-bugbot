# Peregrine evaluation methodology review

**Verdict: approve with changes.** The plan is a credible research direction and a defensible exploratory product evaluation. It is not yet a complete confirmatory protocol, and it does not establish that Peregrine adds value. Preserve its comparison design, scoped truth, failure accounting, and independent evaluation data. Simplify the governance machinery where it delays collecting informative observations.

The central distinction is between **independence of evaluation data**, **independence of the adjudicator**, and **validity of the label**. None implies the others. A separate AI session is not independent human confirmation; a human signature does not establish correctness; an inaccessible historical holdout does not establish absence from model training. These are analytical distinctions used throughout this review.

## Review scope and evidence

The requested file is absent from the main checkout, whose local HEAD was 9fc6fd79a414ab8a8c05d8e4e5c49d7810eda223. The reviewed file is the identically named plan in the ts-js-evidence-r4 worktree at commit 7653eb0ad205a90f5d28fe9f3691dadf78377a66. Its SHA-256 is 22d3787859bdd7724ab0930f7137fc9e48080eaa0083dff340188e2b6d3ea142. The same bytes exist in the ts-js-evidence-r3-decisions worktree and the Codex a168 worktree at HEAD 3335518cd00c93c54f3c48b05035e9236913eb74.

The assessment also reads the R2 human-review packet specification and the September 9 R2 partition-binding and R3 inferential-decision checkpoints to clarify human dispositions and the three-repeat safety rule. Their implementation/status assertions were not independently audited. No corpus cases were relabeled, no reviewer experiments were run, and no repository files or external records were changed. This report is a separate deliverable.

Primary literature and official methodology were checked on September 12, 2026. Published papers, methodological guidance, and preprints are identified in the source inventory. Judgments about Peregrine and the proposed protocol below are this reviewer's inferences and recommendations, not claims that an external paper evaluated Peregrine.

## Component assessment

| Component | Classification | Assessment and necessary qualification |
|---|---|---|
| Exact historical reconstruction | Research-standard principle; bespoke implementation | Preserve authentic reviewed base/head, contemporaneous inputs, later repair, and causal evidence. Real-bug benchmarks use reproducible faulty/fixed versions and executable tests. A reconstructed review opportunity is more demanding than a bug-fix pair, appropriately so for a review task. [BugsJS](https://bugsjs.github.io/paper/ICST19.pdf), [Defects4J](https://homes.cs.washington.edu/~mernst/pubs/bug-database-issta2014-abstract.html). |
| 2017–2020 source window | Sound for historical-origin provenance; weak for modern transfer | Old public material can predate widespread agent authorship while remaining available for training. Add current private cases before claiming contemporary generalization. [LiveCodeBench methodology](https://livecodebench.github.io/). |
| Human curation and static/reproduced proof levels | Sound; universal human sign-off is replaceable | Preserve evidence quality and uncertainty. Do not equate a static narrative with an executed reproduction, or an executed test with a proof that all relevant behavior is correct. Published benchmarks combine automation and human judgment in different ways. [SWE-bench](https://arxiv.org/html/2310.06770v3), [BugsJS](https://bugsjs.github.io/paper/ICST19.pdf). |
| Development, selection, confirmation | Research-standard | Selection outcomes cannot also provide untouched confirmation of the selected winner. Splits must precede outcome-driven tuning and keep related families together. [Cawley and Talbot](https://www.jmlr.org/papers/volume11/cawley10a/cawley10a.pdf). |
| Separate confirmation plus external sealed holdout | Bespoke and sound; potentially redundant | One adequately powered, genuinely untouched evaluation set can serve both functions. A second independent set adds replication or transfer evidence only if it answers a distinct question. This is a recommendation about efficiency, not a universal requirement. |
| Four arms A/B/C/D | Sound diagnostic design | D–C estimates the effect of the Peregrine workflow package within the two-stage topology. B–A estimates the adapted single-reviewer method. D–A estimates the complete package under the selected budgets. Because B and D contain different adaptations/components, this is not automatically a clean factorial experiment with one identical treatment factor. |
| Fixed model, tools, topology, resource limits | Research-standard control principle | Pin the actual model version and harness; document baseline competence; include preprocessing and handoff costs. Equal caps alone do not imply equal resources consumed. [AI Agents That Matter](https://arxiv.org/html/2407.01502v1). |
| Two development repeats; three confirmation repeats | Sound exploratory choice; not a reliability guarantee | Repeats estimate execution variability. They do not multiply the number of independent PRs, repositories, or bug families. Allocate repeats using observed within-case variability and case-acquisition cost. [Miller](https://arxiv.org/html/2411.00640v1). |
| Blinded causal adjudication | Research-standard principle | Blind arm identity and expected winner; preserve enough technical evidence to judge correctness. Validate the grading process on this task rather than importing a generic judge agreement rate. [Zheng et al.](https://arxiv.org/html/2306.05685v4). |
| Pooled discovery roots and immutable truth versions | Bespoke but strong | Symmetric adjudication prevents valid uncatalogued findings from being automatically penalized. Pooled truth is still incomplete and depends on participating systems. [Zobel](https://people.eng.unimelb.edu.au/jzobel/fulltext/sigir98.pdf). |
| Paired, clustered uncertainty | Research-standard principle; incomplete specification | Correct direction. Specify sampling units, cluster construction, weights, resampling algorithm, and inferential population. A percentile bootstrap over very few repositories may have poor coverage. [Cameron and Miller](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015.pdf). |
| Severe-loss and completion gates | Bespoke, defensible product safeguards | Use as conservative decision rules, not tests proving non-inferiority or a change in per-root success probability. Prespecify margins and statistical tests separately. [Lakens, equivalence testing](https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906/). |
| Append-only seals, identities, extensive authentication | Sound provenance; potentially overengineered | Useful when multiple operators can mutate evidence. For a small internal study, immutable run artifacts, a signed manifest, explicit revisions, and an access-controlled final test may suffice. Cryptographic integrity does not validate semantics or remove statistical bias. |
| Fifty consecutive private shadow PRs | Sound initial field cohort | Stronger deployment relevance than another curated historical slice. It needs eligibility rules, frozen PR snapshots, symmetric verification, clustering, and a prespecified follow-up window. Shadow review measures detection/noise; it does not demonstrate that displaying findings improves production outcomes. [AutoCommenter](https://arxiv.org/html/2405.13565v1), [NIST AI RMF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf). |

## 1. Is a human disposition on every item necessary?

**No universal methodological rule requires it. It is common in carefully curated bug datasets, reasonable at this pilot's scale, and replaceable under an explicit validation design.** BugsJS used manually validated bugs, while SWE-bench combines repository preparation and an automated execution-based validation pipeline. These establish different defensible construction practices, not one mandatory number of human signatures. [BugsJS](https://bugsjs.github.io/paper/ICST19.pdf), [SWE-bench, construction and validation](https://arxiv.org/html/2310.06770v3).

Separate three tasks:

1. **Mechanical provenance:** commit identity, diff bytes, timestamp receipts, hashes, and whether a specified test failed before and passed after. Automate these, with validation of the extraction and execution machinery.
2. **Semantic admission:** whether the behavior was reachable, violated the contemporaneous contract, and had the claimed consequence. Human expertise is valuable here, especially for static-only proof and negative/comparison labels.
3. **Output adjudication:** whether an emitted finding is correct, actionable, duplicated, or unresolved. This requires its own quality controls even when the admitted corpus was meticulously reviewed.

For 36 admitted cases, reviewing each semantic dossier is a sensible economy: a sophisticated sampling-and-correction system could cost more than the review it replaces. For hundreds or thousands, requiring one person to approve every uncomplicated mechanically verified record can become excessive. The scientific requirement is defensible measurement and disclosure of uncertainty; the per-card signature is a local governance choice.

The present packet explicitly requires per-card human decisions. Removing that gate would therefore require a prospectively documented protocol change. It would not be legitimate to have an AI fill the human identity fields, reinterpret silence as approval, or call AI consensus a second human confirmation. This conclusion follows from the declared local protocol, not from an alleged research-wide human-signature mandate.

One accountable human can support an internal evaluation with disclosed limitations. For a public claim depending on subjective labels, this review recommends a second qualified assessor independently labeling a representative subset, plus disputed and high-impact findings. Report initial agreement, disagreements, and resolution. Two reviewers on every easy item are not necessary; one uncalibrated reviewer on every difficult item is not automatically sufficient.

## 2. Can AI perform corpus labeling without invalidating the evidence?

**Yes for substantial assistance and calibrated measurement; conditionally for complete mechanical labeling; no for unvalidated semantic ground truth supporting strong efficacy claims.** Gilardi and colleagues demonstrate that machine annotation can outperform crowd workers on selected text tasks. That result establishes possibility, not transfer to causal code-review correctness. [Gilardi et al., PNAS](https://pmc.ncbi.nlm.nih.gov/articles/PMC10372638/).

Prediction-powered inference provides a principled alternative to treating predictions as truth: use a gold-labeled sample to estimate and correct prediction error, and carry that uncertainty into the reported quantity. Its validity depends on the sampling and inference assumptions, not on the model being intrinsically trustworthy. [Angelopoulos et al., Science](https://www.stat.ubc.ca/~john/papers/AngelopoulosScience2023.pdf). ARES demonstrates an application combining automated judges with human calibration for aggregate RAG evaluation; it is not a validation of code-review labels. [ARES, NAACL 2024](https://aclanthology.org/2024.naacl-long.20/).

Recommended controls for Peregrine:

- Use AI to retrieve evidence, draft traces, propose severity, propose duplicate groups, suggest reproductions, and match findings to frozen roots. Keep proposed labels distinct from accepted labels.
- Calibrate on a probability sample covering repositories, languages, static versus reproduced cases, severities, comparisons, matched findings, unmatched findings, and both treatment and baseline outputs. Randomly audit apparently easy agreements and rejected candidates as well as disagreements.
- Keep a random audit component even if high-risk cases receive exhaustive review. If audit probabilities differ, record them and use an estimator that accounts for that sampling. Reviewing only disagreements cannot estimate overall error reliably.
- Have audit reviewers first make their own judgment without the model's conclusion where feasible. Then expose the AI rationale for resolution. This reduces the opportunity for the proposed label to become the de facto answer.
- Record arm-specific false-positive/false-negative grading errors and uncertainty. Overall agreement alone can hide a grading bias large enough to reverse a small treatment effect.
- Freeze the labeling rubric, model/version, examples, and abstention rule before confirmation. Keep corpus labels and answer-bearing histories inaccessible to tested reviewers.
- Use an independently checked executable or formal oracle where it adequately defines the target behavior. A test written by the same model is evidence only after its expected behavior and relevance are checked; an unrelated environment failure is not a reproduced defect.
- For a scaled study, use an appropriate calibrated estimator or human-only audited estimates. Do not attach ordinary bootstrap intervals to unchecked pseudo-labels and assume label uncertainty has disappeared.

A separate model family, fresh context, or multiple AI votes can be useful cross-checks, but they do not establish independent errors. MT-Bench documented position and verbosity biases and grading limitations; evidence of self-preference was more qualified than a universal finding. Treat these as reasons to test the actual judge, not reasons to reject all automated judging. [Zheng et al., NeurIPS 2023](https://arxiv.org/html/2306.05685v4).

SWR-Bench is directly relevant recent primary research: it uses structured issue matching and evaluates human–LLM agreement. Its latest accessed version remains a preprint. It also defines unmatched predicted actions as false positives; that convention is unsuitable for Peregrine's open discovery objective unless unmatched findings are independently investigated. Peregrine's separate discovery adjudication is stronger on this point. [SWR-Bench v2, evaluation definitions](https://arxiv.org/html/2509.01494v2).

**All-AI semantic labeling without a credible independent oracle or human calibration can still support engineering diagnostics, but the result measures performance under those AI labels. It should not be presented as independently verified defect-finding efficacy.** A valid aggregate estimate based on audited AI labels also does not make every individual record human-verified.

## 3. Are the sample sizes, repeats, thresholds, and uncertainty defensible?

### What the plan actually specifies

The main document specifies five feasibility reconstructions; at most 100 candidates; 36 admitted cases; 12 development cases, comprising eight defects and four comparisons; 24 selection cases, comprising 16 defects and eight comparisons; two development repeats; a later power-derived confirmation set; 95% intervals; and 50 consecutive private PRs. It does **not** give a numerical confirmation sample size, target power, primary minimum worthwhile effect, tolerated noise increase, or complete bootstrap specification. “Power-derived” is an intention, not an executed power analysis.

This is acceptable for a staged research direction. It is incomplete for confirmation. Small studies can be justified by resource constraints or exploratory information value; they should not promise precision they cannot deliver. [Lakens, Sample Size Justification](https://doi.org/10.1525/collabra.33267).

The 96 attempts are not 96 independent cases. Known-root recall has only eight bug-bearing development cases, and the negative/comparison analysis only four comparison cases. Two repeats per arm give useful 0/2, 1/2, 2/2 descriptions. More distinct repositories and defect families often buy more transfer information than another repeat on an already repeated case; the optimum depends on between-case and within-case variance and acquisition cost. [Miller, paired analysis and power planning](https://arxiv.org/html/2411.00640v1).

### Quantitative illustrations

The following are this reviewer's calculations, **not Peregrine results or a completed power analysis**. For a simplified paired binary outcome, let q be the fraction of cases where the two arms disagree and delta the true difference in success rates. The variance of the paired difference is q minus delta squared. A normal-approximation planning calculation at two-sided alpha 0.05 and 80% power is:

**n approximately (1.96 + 0.842) squared × (q − delta squared) / delta squared.**

| True improvement being detected against zero | Assumed discordance q | Approximate independent pairs, rounded up |
|---|---:|---:|
| 10 percentage points | 0.20 | 150 |
| 10 percentage points | 0.40 | 307 |
| 5 percentage points | 0.20 | 621 |
| 5 percentage points | 0.40 | 1,248 |

This uses a simple one-binary-outcome-per-case approximation. Peregrine's case-balanced multiroot recall, repeated execution, and repository dependence require a design-specific simulation or analysis. The table does not prescribe 150 cases; it shows why 12 or 24 cases cannot routinely distinguish modest gains. Correlation, grading uncertainty, multiple claims, and tight non-inferiority margins can increase the requirement. Testing that the effect exceeds a positive worthwhile-effect margin is harder than testing it against zero. The general paired power framework is discussed by [Miller](https://arxiv.org/html/2411.00640v1).

For zero observed events among n independent Bernoulli opportunities, the exact one-sided 95% upper bound is **1 − 0.05^(1/n)**, obtained by solving (1 − p)^n = 0.05:

| Independent opportunities with zero events | Upper bound |
|---:|---:|
| 4 | 52.7% |
| 8 | 31.2% |
| 12 | 22.1% |
| 24 | 11.7% |
| 50 | 5.8% |
| 59 | 5.0% |
| 299 | 1.0% |

These single-rate bounds are not confidence bounds on a paired treatment-minus-baseline difference, and repeated/correlated observations cannot simply be substituted for n. Fifty private PRs are therefore a useful first cohort, not evidence of a sub-1% event rate.

The September 9 supplement reserves a severe-regression flag for baseline detection in at least two of three repeats and treatment detection in at most one of three. Under independent runs with both arms having true detection probability 0.5, each side of that rule has probability 0.5, so the directional flag occurs with probability **25% for a single root despite equal performance**. This is a direct binomial calculation. The rule is defensible as a precautionary investigation/deployment veto; it is not a calibrated statistical test. Report all severe discordances, rather than treating a failure to trigger this rule as evidence of safety.

### Required analysis changes

Define the primary estimand explicitly: for example, the mean paired difference in per-PR known-root recall, averaging repeats within each PR and eligible roots within each PR. Comparison cases with no registered defect do not have a recall denominator; analyze their noise separately. State whether inference targets the selected benchmark, a defined population of PRs, or new repositories.

Preserve pairing in resampling. Keep all repeats, roots, and arm outcomes together at their appropriate sampling level. If duplicate families are nested within repositories, the repository is the outer dependence unit for cross-repository inference. If families cross repositories, consolidate linked dependence components or use a justified method for crossed dependence. With only about six repository families, ordinary bootstrap coverage is fragile; leave-one-repository-out results reveal sensitivity but do not repair coverage. [Cameron and Miller](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015.pdf).

Freeze the number and type of resamples, interval construction, zero-denominator rules, failure handling, eligibility, and primary/secondary claims. Check the chosen estimator's coverage through simulations reflecting the observed cluster sizes and plausible dependence. Do not treat a fixed seed or 10,000 resamples as evidence of statistical validity. Few-run evaluation literature supports reporting uncertainty rather than point estimates alone; it does not certify every bootstrap on a tiny corpus. [Agarwal et al., NeurIPS 2021](https://arxiv.org/abs/2108.13264).

Choose worthwhile effects and tolerated losses from actual product tradeoffs: extra verified defects found, developer minutes spent on noise, latency, and cost. Distinguish superiority, non-inferiority, and equivalence. A nonsignificant difference establishes none of the latter two. [Lakens, equivalence testing](https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906/). No numerical recall/noise/efficiency margin in this review is being attributed to the main plan.

## 4. Biases that remain

| Bias | Residual problem | Recommended control and claim limit |
|---|---|---|
| Public-training contamination | Old public code, issues, tests, and fixes may have been seen during training. Equal model exposure does not guarantee cancellation if one workflow elicits memorized information more effectively. | Separate evaluator holdout protection from training exposure. Use current private snapshots created after a pinned model release where feasible, with documented access. Temporal benchmark collection is a relevant precedent; black-box contamination tests are not certificates of non-exposure. [LiveCodeBench](https://livecodebench.github.io/), [Oren et al.](https://arxiv.org/abs/2310.17623). |
| Selection and spectrum bias | Recoverable, documented, fixed bugs and popular repositories are atypical. The 24/12 balance and cross-file quota create a challenge set, not a production prevalence sample. Even the random stratum becomes selected after reconstruction and semantic admission. | Publish the sampling frame, attempted candidates, exclusions, and yields. Report challenge-set performance separately from consecutive-PR performance. Prespecified sampling prevents opportunism but does not itself confer representativeness. [Datasheets for Datasets](https://arxiv.org/abs/1803.09010). |
| Verification bias | Easily reproduced findings may be more likely to receive confirmed labels; silence, negative outputs, and difficult static claims may receive less scrutiny. | Equal verification time/rules across arms; audit rejected cases and matched findings; retain unresolved status and sensitivity bounds. This is a design recommendation applying measurement-error correction principles. [Prediction-powered inference](https://www.stat.ubc.ca/~john/papers/AngelopoulosScience2023.pdf). |
| False-clean labels | No comment, a merge, and passing tests do not establish absence of all defects. A narrow comparison proof does not validate every part of a full PR. | Keep the plan's scoped comparison claims. Score newly emitted findings on their merits rather than assuming comparison cases have no possible true findings. Human review comments are explicitly non-exhaustive in industrial evaluation research. [AutoCommenter](https://arxiv.org/html/2405.13565v1). |
| Correlated cases | Forks, backports, shared roots, repositories, PR authors, and repeated runs reduce effective information. | Split and analyze at the relevant family/repository levels; report all counts. Repository overlap across development and confirmation does not establish unfamiliar-repository transfer. [Cameron and Miller](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015.pdf). |
| Model-as-judge bias | Formatting, verbosity, arm identity, and common model errors can favor a system independently of correctness. A high aggregate agreement score can conceal differential error. | Blind and randomize presentation, use a common minimal finding contract, calibrate per arm, and verify decisive cases against code/contracts. [Zheng et al.](https://arxiv.org/html/2306.05685v4). |
| Prompt and answer leakage | Later review comments, repairs, tests, commit messages, raw history, paths, examples, and grader logs can reveal the answer. Hashes record content but do not prevent reading it. | Mount only contemporaneously available material; separate curator/judge stores and sessions; disable answer-bearing remote retrieval; log access. Audit repository history and derived packets as well as the main prompt. These are Peregrine-specific implementations of holdout protection. [AI Agents That Matter](https://arxiv.org/html/2407.01502v1). |
| Researcher degrees of freedom | Candidate replacement, root splitting, severity revisions, baseline weakening, extra screens, metric selection, exclusions, and stopping can all follow promising outcomes. | Register a single primary contrast, selection rule, schedule, and analysis; report every attempted arm and deviation. Revisions are legitimate exploration but require new untouched data for confirmation. [Nosek et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5856500/), [Cawley and Talbot](https://www.jmlr.org/papers/volume11/cawley10a/cawley10a.pdf). |

Two metric corrections deserve emphasis. **Partial corpus truth prevents exhaustive defect recall or specificity claims, but does not prevent precision estimation for emitted findings that are all independently adjudicated.** Conversely, noise per scheduled review can improve merely because a system fails to complete and emits nothing. Pair noise with completion and validated detection/yield requirements.

For unresolved emitted findings, report counts and bounds. If T findings are confirmed correct, U unresolved, and N total, the possible correct-finding fraction lies between T/N and (T+U)/N, assuming the remaining judgments are correct. This is elementary arithmetic, not a complete uncertainty interval. Distinguish demonstrated incorrectness from insufficient evidence; if “unsupported” includes the latter, label the result a support/adjudication metric rather than definitive false-positive precision.

The pooled union can support observed discovery yield and a clearly labeled pooled-root sensitivity analysis. It cannot reveal defects no participating reviewer found. Keep frozen known-root recall as the primary catalog metric; “confirmed-new” means absent from the frozen catalog, not necessarily previously unknown publicly or unseen in training. Pooling research provides a useful analogy but no guarantee of complete software ground truth. [Zobel](https://people.eng.unimelb.edu.au/jzobel/fulltext/sigir98.pdf).

## 5. Changes ordered by importance

1. **Separate the claims and make the baseline genuinely competitive.** Document the exact model behind “Sol high,” prompt, tools, context, allocations, and tuning budget. Let the baseline investigate, execute allowed tests, and substantiate findings. D–C concerns the two-stage workflow; D–A concerns package value. D also changes packets, lanes, and contracts, so “instructions alone” is too narrow unless all other derived inputs are held constant.
2. **Finish the statistical contract before confirmation, not necessarily before the pilot.** Name the population, primary paired metric, practical margin, target power or precision, cluster structure, and stopping rule. Estimate nuisance variance from development; use a sensitivity range rather than powering only for the pilot winner's likely inflated effect.
3. **Preserve actual test-data independence.** Reserve new repositories for the unfamiliar-repository claim. Protect confirmation before tuning. If selection changes the candidate, it is no longer confirmation. Combining confirmation and the external holdout is acceptable if the resulting set satisfies both statistical and access requirements.
4. **Use evidence-based, proportionate labeling.** At 36 cases, review semantic admissions and pilot findings directly; add independent checks for disputed, high-severity, static-only, and a random subset of other judgments. At scale, adopt a prospectively specified audited-AI estimator. Do not let unchecked AI labels pass a human-verification gate.
5. **Make discovery, unresolved truth, and failure effects explicit.** Adjudicate all arms symmetrically. Maintain frozen and expanded truth versions. Report completion alongside noise and avoid exhaustive-clean claims. Count each root once per review while preserving cross-arm and repeat attribution.
6. **Treat safety gates as operational safeguards.** The three-repeat rule triggers investigation; it does not establish statistical loss. Safety non-inferiority needs an explicit endpoint, denominator, margin, and adequate information.
7. **Run the private cohort early enough to test relevance.** Freeze consecutive eligibility and snapshots; keep model outputs hidden from ordinary review during shadow collection; use a fixed follow-up interval. If findings are later shown to developers, analyze that intervention separately.
8. **Reduce procedural duplication.** Retain one clear protocol, content-addressed run artifacts, one versioned adjudication table, access separation, and an audit trail. Repeated signatures, separate stores with identical purposes, and exact quota satisfaction should not become substitutes for a valid comparison. Any changed eligibility/count target must be registered prospectively.

## 6. Recommended streamlined protocol

**Stage A — development and measurement validation.** Use the five reconstruction feasibility cases and the planned 12-case, four-arm, two-repeat screen to validate the task, baseline, rubric, resource caps, and failure accounting. Treat all resulting efficacy estimates as exploratory. Review all emitted findings in this small pilot; deduplicate before semantic review while retaining every occurrence. Run additional component screens only when they answer a concrete decision worth their cost.

**Stage B — freeze one product and its comparator.** Select the candidate and a competent generic baseline using development evidence and a predeclared selection rule. If A and C remain plausible competing baselines, carry both into final testing. A two-arm final test is the minimum for a product-value claim against one named baseline; adding A or C is necessary if both the package and fixed-topology method claims are desired. Use the same pinned model, raw inputs, tools, and budget policy, and account for all preprocessing and worker work.

**Stage C — one untouched confirmatory cohort.** Draw enough new eligible cases and repository families for the prespecified effect or precision target. A final set can also be the sealed holdout; there is no need for two final sets merely because they have different names. Separate strata may cover verified historical defects and representative private PRs, but report their metrics separately. If corpus acquisition cannot meet the information target, make a bounded internal decision and retain an inconclusive scientific verdict. This separation of selection and evaluation follows [Cawley and Talbot](https://www.jmlr.org/papers/volume11/cawley10a/cawley10a.pdf).

**Stage D — paired execution and blind adjudication.** Run all registered arms on each frozen PR in randomized, contemporaneous blocks, using fresh sessions and isolated artifacts. Freeze retries, timeouts, budgets, and model settings. Keep the user-visible single-review behavior as the estimand; do not silently report best-of-repeat performance. Pool unique candidate findings across arms for blinded semantic adjudication and preserve the occurrence mapping for analysis.

**Stage E — one registered decision.** Report the paired primary effect and interval, independently sampled units, severe losses, unsupported and unresolved findings, completion, latency, tokens, and observed cost. Require the predefined quality/noise/completion conditions jointly, rather than declaring a win from whichever metric improves. Secondary and component conclusions are exploratory unless separately protected against multiple testing. Preregistered analysis separates prediction from post-hoc explanation. [Nosek et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5856500/).

**Stage F — prospective private validation.** Begin with the proposed 50 consecutive eligible PRs as an explicitly limited operational cohort. Run the frozen candidate and baseline on identical pre-review snapshots, keep outcomes blinded, and adjudicate their pooled findings with the same standard. Expand according to a prespecified sample-size or valid sequential design if greater precision is needed. Measure confirmed defects and developer burden per eligible PR. Do not claim overall missed-defect recall without a separate reference assessment capable of finding misses by both systems.

This design is sufficient to seek a credible answer to “does this Peregrine version improve useful review outcomes over this strong frontier-model baseline, on this declared population, at this budget?” Broader claims about all models, repositories, languages, and future defects need additional replication; they do not follow from a single model or one private organization.

## Internal decisions and publishable claims

| Evidence achieved | Defensible internal use | Defensible public wording |
|---|---|---|
| Small, exposed pilot with carefully checked labels | Find large regressions, simplify a component, decide whether more evaluation is worth paying for | Exploratory results on the stated cases; no independent efficacy confirmation |
| Frozen paired test on a defined historical sample | Choose between the tested configurations with quantified uncertainty | A qualified result for those sampling and exposure conditions; no contamination-free claim |
| Adequately informative protected confirmation with validated grading | Stronger adoption/removal decision | Confirmed comparative result for the stated estimand; provide protocol, artifacts, exclusions, intervals, and limitations |
| Current private shadow cohort | Assess contemporary discovery and noise in the target workflow | Prospective observational evidence for the specified organization/cohort; no causal claim that showing reviews improved outcomes |
| Independent repository/model/site replication | Support broader rollout | Broader generalization only to the dimensions actually replicated |

“Publishable” is not a synonym for a large or positive study: an honest small pilot, null result, or methodological failure analysis can be publishable. What requires stronger evidence is the affirmative efficacy or safety claim. A protected evaluation can be valid without a separate external steward if access separation is credible; an external steward strengthens independence and is necessary if the study explicitly promises that stronger designation. The current plan's narrower terminology is appropriately cautious.

## Sources

1. Gyimesi et al. **BugsJS: A Benchmark of JavaScript Bugs.** ICST 2019, peer-reviewed benchmark paper. [Paper](https://bugsjs.github.io/paper/ICST19.pdf).
2. Just, Jalali, and Ernst. **Defects4J: A Database of Existing Faults to Enable Controlled Testing Studies for Java Programs.** ISSTA 2014 tool paper. [Author publication page](https://homes.cs.washington.edu/~mernst/pubs/bug-database-issta2014-abstract.html).
3. Jimenez et al. **SWE-bench: Can Language Models Resolve Real-World GitHub Issues?** ICLR 2024; author manuscript. [Full text](https://arxiv.org/html/2310.06770v3).
4. Vijayvergiya et al. **AI-Assisted Assessment of Coding Practices in Modern Code Review.** AIware 2024; industrial primary study, not a marketing benchmark. Best-practice enforcement differs from Peregrine's defect-finding task. [Full text](https://arxiv.org/html/2405.13565v1), [publication DOI](https://doi.org/10.1145/3664646.3665664).
5. Zeng et al. **SWR-Bench: Assessing LLM Performance in Real-World Code Review Comment Generation.** Preprint, v2 revised June 5, 2026. [Full text](https://arxiv.org/html/2509.01494v2).
6. Zheng et al. **Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.** NeurIPS 2023 Datasets and Benchmarks; conversational evaluation, not code-review oracle validation. [Full text](https://arxiv.org/html/2306.05685v4).
7. Gilardi, Alizadeh, and Kubli. **ChatGPT Outperforms Crowd Workers for Text-Annotation Tasks.** PNAS 2023. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC10372638/).
8. Angelopoulos et al. **Prediction-Powered Inference.** Science 382, 669–674, 2023. [Author-hosted published paper and supplement](https://www.stat.ubc.ca/~john/papers/AngelopoulosScience2023.pdf).
9. Saad-Falcon et al. **ARES: An Automated Evaluation Framework for Retrieval-Augmented Generation Systems.** NAACL 2024. [Proceedings page](https://aclanthology.org/2024.naacl-long.20/).
10. Cawley and Talbot. **On Over-fitting in Model Selection and Subsequent Selection Bias in Performance Evaluation.** JMLR 11, 2010. [Paper](https://www.jmlr.org/papers/volume11/cawley10a/cawley10a.pdf).
11. Miller. **Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations.** Methodological preprint, November 2024; used for the explicit LLM variance/power framework, not as a universal sample-size mandate. [Full text](https://arxiv.org/html/2411.00640v1).
12. Cameron and Miller. **A Practitioner's Guide to Cluster-Robust Inference.** Journal of Human Resources 50(2), 2015. [Published paper](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015.pdf).
13. Agarwal et al. **Deep Reinforcement Learning at the Edge of the Statistical Precipice.** NeurIPS 2021. Related few-run benchmark evidence; RL is not the same task as code review. [Author manuscript](https://arxiv.org/abs/2108.13264).
14. Lakens. **Sample Size Justification.** Collabra: Psychology 8(1), 2022. [Paper](https://doi.org/10.1525/collabra.33267).
15. Lakens. **Equivalence Tests: A Practical Primer for t Tests, Correlations, and Meta-Analyses.** Social Psychological and Personality Science 8(4), 2017. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5502906/).
16. Jain et al. **LiveCodeBench.** Official benchmark methodology; cited for temporal collection and exposure handling, not for current leaderboard rankings. [Methodology](https://livecodebench.github.io/).
17. Oren et al. **Proving Test Set Contamination in Black Box Language Models.** ICLR 2024; author manuscript. [Paper](https://arxiv.org/abs/2310.17623).
18. Gebru et al. **Datasheets for Datasets.** Communications of the ACM, 2021; author manuscript. [Paper](https://arxiv.org/abs/1803.09010).
19. Kapoor et al. **AI Agents That Matter.** Primary study first posted in 2024, subsequently published in TMLR in 2025; linked author manuscript supports the cost-control and holdout arguments. [Full text](https://arxiv.org/html/2407.01502v1).
20. Nosek et al. **The Preregistration Revolution.** PNAS 115(11), 2018. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5856500/).
21. Zobel. **How Reliable Are the Results of Large-Scale Information Retrieval Experiments?** SIGIR 1998. Analogy for pooled incomplete judgments, not a software-specific completeness result. [Author-hosted paper](https://people.eng.unimelb.edu.au/jzobel/fulltext/sigir98.pdf).
22. NIST. **Artificial Intelligence Risk Management Framework (AI RMF 1.0).** Official guidance, January 2023. Supports context-specific measurement and evaluation rather than any specific proposed sample count. [Official PDF](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf).

## Local documents reviewed

- [Main plan, exact reviewed copy](/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r4/docs/plans/2026-09-04-typescript-javascript-evidence-ablation-plan.md): reconstruction and curation at lines 41–63; partitions at 65–78; arms at 103–124; grading and analysis at 126–147.
- [R2 human-review packet specification](/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r4/docs/plans/2026-09-05-r2-human-review-packet-spec.md): scoped comparisons, per-card controls, exposure limitations, and sole-human governance.
- [R2 partition checkpoint](/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r4/docs/validation/2026-09-09-r2-partition-binding-checkpoint.md): supplemental three-repeat severe-loss rule.
- [R3 inferential checkpoint](/Users/petergray/Documents/peregrine-bugbot/.worktrees/ts-js-evidence-r4/docs/validation/2026-09-09-r3-inferential-decisions.md): descriptive-versus-inferential boundaries and known missing authenticated inputs.
