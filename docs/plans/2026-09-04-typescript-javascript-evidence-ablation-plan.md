# TypeScript and JavaScript evidence gathering and Peregrine ablation plan

Date: 2026-09-04
Status: active research direction; R1 collection feasibility in progress

This program preserves the original optimization plan, its implementation
checklist, and every prior experiment. It pauses the next production
optimization sequence in favor of determining whether Peregrine improves real
TypeScript and JavaScript bug finding over competent minimal review. It does
not authorize production routing changes or provider runs.

## Decision

Answer these questions independently:

1. Does the complete review package beat a credible plain-agent alternative
   under a comparable resource allowance?
2. At a fixed model, effort, topology, tools, and input, do Peregrine's
   instructions improve outcomes?
3. Which workflow components help, add cost, or suppress discovery?
4. Do any gains transfer to unfamiliar repositories and mechanisms?
5. Does the system find independently confirmed defects outside the historical
   answer catalog, including prospective private pull requests?

Success may mean retaining all, some, or none of the methodology. Harness
correctness and faster prompt delivery are not evidence of better bug finding.

## Evidence boundaries

Track provenance, proof level, and exposure independently. The permitted
evidence classes are structural/mock, visible seeded diagnostic, visible seeded
checkpoint, historical candidate, verified historical case, visible historical
development, reserved historical validation, external sealed holdout, and
prospective private shadow review. Proof levels are `reproduced`,
`complete-static-trace`, and `unresolved`.

Dates support a pre-agent-origin assessment but do not prove non-exposure in a
model's training corpus. A historical case proves only the declared roots and
reviewed scope, never that an entire revision is clean.

## Historical collection

Start with public history from 2017-01-01 through 2020-12-31. Recover complete
review opportunities rather than isolated comments. Preserve source URLs,
timestamps, author and bot indicators, licenses, raw-source hashes, exact base
and head commits and trees, the reviewed diff, later fix evidence, a causal
root trace, verification, limitations, duplicate family, and partition.

Collection proceeds in two bounded stages:

- R1: attempt five reconstructions spanning TypeScript, JavaScript, a
  review-caught defect, a post-merge defect, and a plausible reviewed
  comparison. Do not run reviewers.
- R2: only after R1 succeeds, inventory at most 100 candidates across at least
  six repository families and target 36 admitted cases: 24 bug-bearing and 12
  reviewed comparisons, with no family above 25%.

Bug/fix pairs, backports, forks, clones, and related symptoms remain one
statistical family and one partition. Reverse-applying a fix is synthetic, not
an authentic introducing pull request. Two accountable independent curators
must confirm each admitted case.

## Transfer protection

Split cases before model outcomes are inspected:

| Partition | Initial target | Purpose |
| --- | ---: | --- |
| Historical development | 12 (8 bug, 4 comparison) | Feasibility, ablations, and budget estimates |
| Historical selection | 24 (16 bug, 8 comparison) | Curator-held selection after prompts freeze |
| Historical confirmation | Power-derived new set | Independent confirmation |
| External sealed holdout | Steward-controlled | One final frozen evaluation |
| Prospective private | 50 consecutive eligible PRs | Real discovery and noise |

A readable repository folder is not a sealed holdout. Without a steward and an
external store, stop at reserved historical validation.

## Measurement prerequisites

Before historical provider runs, reuse the existing evaluation platform and
repair these boundaries:

1. Add a separately sealed, run- and finding-bound append-only adjudication
   ledger that produces versioned decisions without overwriting old seals.
2. Separate provider, transport, parsing, tool, and context failures from
   completed behavioral misses. Incomplete scope cannot be reported as clean.
3. Share metric eligibility between reports and decisions so truth-ineligible
   cases enter no prohibited metric or uncertainty calculation.
4. Add a versioned historical protocol that admits `other/unclassified` roots
   and does not require Peregrine lane quotas.
5. Separate historical provenance from known-root, partial-truth, and reviewed
   comparison status.
6. Compile neutral experimental arms whose generic variants cannot read
   Peregrine packets, lanes, profiles, examples, or semantic annotations. Hash
   assembled prompts and mounted resources.

These changes must preserve old readers and production defaults. Deterministic
tests, sanitized transcripts, leak probes, and a zero-provider dry run precede
all behavioral inference.

## First experiment

Use one pinned frontier model and effort for the methodology question: Sol high.
All arms receive identical raw scope, repository access, tools, read-only
restrictions, and a minimal finding contract.

| Arm | Topology | Guidance |
| --- | --- | --- |
| A | One Sol-high reviewer | Competent minimal review prompt |
| B | One Sol-high reviewer | Peregrine investigator method, experimentally adapted |
| C | Sol-high discovery then Sol-high review | Generic discovery and neutral handoff |
| D | Sol-high breadth then Sol-high investigation | Peregrine breadth, method packet, lanes, and contract |

The primary instruction contrast is D minus C. B minus A tests portability;
D minus A tests the package. Use equal total allowances across topologies and
identical allocations for fixed-topology contrasts.

The development schedule is 12 cases by four arms by two repeats: 96 review
attempts and 144 review-model invocations, excluding grading and curation. At
most three preregistered exploratory component screens may follow, each 48
attempts. No provider run begins without a frozen schedule and explicit
authorization.

## Grading and metrics

Freeze known roots before runs. Grade blinded to arm and expected winner by
causal mechanism, reachable conditions, and impact. Human reviewers inspect all
emitted findings in the pilot. Pool and blind unmatched findings across all
arms, deduplicate by root, and adjudicate them as `confirmed-new`,
`unsupported`, or `unresolved`.

Keep original scores immutable. A later truth version may support a symmetric,
explicitly post-hoc regrade but cannot overwrite prior results.

Report failure-inclusive case-balanced known-root recall; per-root repeat
reliability; every severe baseline-found/treatment-missed root; unsupported
roots per scheduled review; comparison cases receiving unsupported findings;
confirmed discovery; completion categories; and observable wall time, tokens,
tools, tool-output bytes, and enforced limits. Monetary cost is `n/a` when it is
not observable.

Use paired analysis, repository and duplicate-family clustering, frozen 95%
intervals and seeds, leave-one-repository-out sensitivity when repositories are
few, and explicit counts of repositories, families, cases, roots, and attempts.
Small zero-event samples do not certify tight non-inferiority bounds.

## Ordered checkpoints

| Step | Deliverable and stop condition |
| --- | --- |
| R1 | Five exact historical reconstructions and a source/yield report. Stop if authentic review opportunities are not recoverable. |
| R2 | A 100-candidate inventory, 36 independently curated cases, duplicate groups, and a frozen split. |
| R3 | Neutral and truthful harness prerequisites with deterministic integrity tests. |
| R4 | Four frozen prompts, caps, routes, runtime, corpus, rubric, analysis, hashes, and a zero-provider dry run. This is the next provider-authorization checkpoint. |
| R5 | Authorized 96-attempt methodology comparison and at most three registered component screens. |
| R6 | One frozen candidate, reserved selection, then separately powered confirmation. |
| R7 | Deployment-route bridge and authorized prospective private shadow cohort. |
| R8 | Component decision report: retain for detection, noise, or efficiency; simplify/remove; not tested; or inconclusive. |

Dependencies are `R1 -> R2`, `R1 -> R3`, and `(R2 + R3) -> R4 -> R5 ->
R6 -> R7 -> R8`. Collection and deterministic harness work may proceed in
parallel only after R1. Changes to the installed skill, release, or production
route are separate decisions.

## Definition of done

The final report must bind each component decision to immutable artifacts,
exact prompt and implementation hashes, model settings, independent sample
counts, paired effects and intervals, high-severity losses, confirmed new
discoveries, unsupported findings, and evidence-class limits. Completion is a
defensible decision, including an inconclusive or removal decision, not a
required positive result.
