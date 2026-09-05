# R2 consolidated human-review packet specification

Date: 2026-09-05

Status: planning only. This document does not admit a case, assign a partition, authorize a provider run, or supply a human confirmation.

## Decision boundary

R2 has one accountable human curator/verifier. It does **not** have two independent human confirmations. AI reconstruction and source-integrity checks may prepare evidence for that person, but they are not additional human confirmations and must not be represented as such.

The human wants one complete review batch rather than serial requests. The preparation phase should therefore assemble a single immutable packet with enough independently scoped proposals and reserves for the human to mark every case `approve`, `reject`, or `unresolved` in one sitting. Admission and partition selection occur only after that response is authenticated.

This packet cannot create a sealed-holdout claim from the current repository. Candidate identities, targeted screening mechanisms, and 12 development reconstructions are readable locally. Protected selection and truth must remain in a curator-controlled store that instruction authors cannot access. Until that store, access roster, and import boundary exist, the result can support visible development preparation only.

## Current inventory and honest arithmetic

The frozen inventory contains exactly 100 attempted slots:

| Source stratum | Slots | Current meaning |
| --- | ---: | --- |
| sampled without comment selection | 25 | Outcome-independent June 2019 sample; unscreened for clean/comparison truth |
| primary review-thread targets | 25 | 20 substantive leads, two possible comparisons, one weak lead, two evidence losses |
| additional review-thread leads | 25 | Correctness hypotheses with varying chronology and revision quality |
| post-merge leads | 25 | 23 potentially independent fix-bearing leads, one known R1 duplicate, one deferred/weak lead |
| **Total** | **100** | Attempted candidates, not valid or admitted cases |

Five unexposed slots have explicit restrictions already bound by `candidate-inventory-v1.json`: webpack #8829 has no independent credit because it duplicates `r1-webpack-8233`; RxJS #3165 lacks a fixing identity; VS Code #106448 and #113285 and Next.js #20428 need strict-window recovery. VS Code #98988 is one of the 12 exposed slots and its original reviewed object remains unrecoverable. None may be silently replaced or counted as a case.

The 12 exposed reconstruction slots currently produce 12 recoverable opportunities because NestJS #383 yields two distinct review heads while VS Code #98988 yields none:

| Proposed class | Recoverable opportunity | Existing proof location | Principal human-review risk |
| --- | --- | --- | --- |
| defect | Bull #537 | `reconstructions/bull-development.md` | Narrow to final-attempt multi-result handling; repair test covers a different retry path |
| comparison | Bull #556 | `reconstructions/bull-development.md` | Only the explicit-null/EventEmitter return scope; not globally clean |
| defect | webpack issue #10966 / introducing PR #10335 | `reconstructions/alpha-development.md` | Two related snapshot roots must not be inflated into independent changes |
| defect | VS Code issue #112124 / PR #112075 | `reconstructions/alpha-development.md` | Low-impact whitespace presentation may fail the consequence threshold |
| defect | Next.js #7363 | `reconstructions/beta-development.md` | Static MIME trace only; no local historical execution |
| comparison | Next.js #16126 | `reconstructions/beta-development.md` | Only the protected early-rejection route scope |
| comparison | Sequelize #8430 | `reconstructions/alpha-development-second.md` | The questioned guard is the repair; exclude unrelated syntax/rollback roots |
| defect | RxJS #2397 | `reconstructions/alpha-development-second.md` | Public declaration break is static; no later restoration fix was recovered |
| comparison | NestJS #5710 | `reconstructions/beta-development-second.md` | 2021 merge chronology and narrow old-registration scope |
| comparison | Axios #874 | `reconstructions/beta-development-second.md` plus independent correction | Contemporaneous Node header contract only; not whole-helper cleanliness |
| defect | NestJS #383 head 2A | `reconstructions/main-development-second.md` | Same PR/family as 2B; separate option-coupling root required |
| defect | NestJS #383 head 2B | `reconstructions/main-development-second.md` | Same PR/family as 2A; separate caller-mutation root required |

These are seven defect hypotheses and five scoped-comparison hypotheses, not confirmations. Against the desired 24 defect-bearing plus 12 comparison cases, the mathematical minimum gap is 17 defects and seven comparisons. That minimum has no rejection margin and is not a responsible packet target.

The recommended preparation ceiling is:

- existing exposed proposals: at most 7 defect + 5 comparison;
- new curator-only proposals: at most 24 defect + 12 comparison;
- consolidated human packet: at most 31 defect + 17 comparison = 48 decision cards;
- desired post-review selection: exactly 24 approved defect cases + 12 approved scoped comparisons;
- rejection headroom: seven defect proposals and five comparison proposals, assuming all planned proposals are reconstructable.

This produces at most 48 decision cards but may inspect more inventory slots: 12 already exposed slots, 25 defect-primary slots (the #10123/#10688 family spans two), up to eight named defect reserves, and all 25 random slots, for a maximum of 70 distinct attempted slots. Every one is already inside the frozen 100. A PR that yields multiple roots consumes one inventory slot but may yield multiple case proposals only when exact reviewed heads and causal groups are genuinely distinct; duplicate-family accounting still prevents correlated cases from masquerading as independent source changes.

## Recommended next defect-preparation batch

The following is a reconstruction queue, not a selection or truth declaration. Work stops on a candidate when the two-hour initial reconstruction budget is reached, records the loss, and advances to a named reserve without erasing the failed slot. The integrator should retain at most 24 newly reconstructable defect proposals for the consolidated packet.

| Priority | Inventory work item | Why it is worth bounded reconstruction | Required stop/gate |
| ---: | --- | --- | --- |
| 1 | `r2-post-merge-alpha-004` — VS Code #99825 | Exact named introducer and merged repair; markdown/codicon sanitization boundary | Prove exact reviewed introducer head and that sanitization rejects the produced class |
| 2 | `r2-post-merge-alpha-002` — VS Code #83490 | Narrow merged change and exact revert; extension URI compatibility | Bind review base/head and observable URI comparison failure |
| 3 | `r2-post-merge-alpha-003` — VS Code #91709 | One-day repair and concrete dirty-editor/autosave lifecycle | Recover the exact 1.42 introducer rather than reverse-inventing it |
| 4 | `r2-post-merge-alpha-005` — VS Code #100364 | Reporter and maintainer confirm repaired debug configuration propagation | Recover the first bad change and distinguish it from the subsequent bad fix |
| 5 | `r2-post-merge-alpha-007` — Next.js #1798 | Explicit merged introducer and repair around error hydration | Verify exact reviewed head and client/server value path |
| 6 | `r2-post-merge-alpha-009` — Next.js #8045 | Exact named introducer and fixing PR for POST/405 dispatch | Preserve Express `app.render` reachability and supported method scope |
| 7 | `r2-post-merge-alpha-011` — Next.js #3755 | Narrow IE11 `startsWith` incompatibility and direct repair | Recover the introducing change; do not use only a reverse repair diff |
| 8 | `r2-post-merge-alpha-012` — Next.js #8517 | Suspected exact introducer, repair, test, and user-owned Performance marks | Confirm the relevant #8069 hunk and ownership consequence |
| 9 | `r2-post-merge-alpha-008` — Next.js #7889 | Reporter-confirmed serverless bundle repair | Recover the exact externalization introducer and production-only reachability |
| 10 | `r2-post-merge-alpha-013` — Sequelize #7771 | Exact introducing/fixing PRs and inverted composite-index regression tests | Bind one schema-generation root and historical dialect behavior |
| 11 | `r2-post-merge-alpha-014` + `r2-post-merge-alpha-015` — Sequelize #10123/#10688 family | Two observable include-loss symptoms around #9735 | One family work item; admit at most independently proved roots and never count duplicate symptoms twice |
| 12 | `r2-post-merge-alpha-020` — webpack #11707 | Exact bisected commit, revert, second repair, and release confirmation | Keep revert/repair in one causal family and prove plugin interaction |
| 13 | `r2-post-merge-alpha-018` — webpack #11243 | Narrow module re-export/default-production regression | Recover 4.43/4.44 introducing change and production reachability |
| 14 | `r2-post-merge-alpha-019` — webpack #11553 | Exact rc.0/rc.1 boundary, repair, and regression test | Treat webpack-cli compatibility as the same family, not extra credit |
| 15 | `r2-post-merge-alpha-021` — webpack #9706 | Concrete child-compilation/HMR hook mechanism and repair test | Separate conflict detection from the older plugin-hook misuse |
| 16 | `r2-post-merge-alpha-016` — webpack #8293 | Parser early return, two-stage repair, dynamic-import symptom | Decide whether #8294/#8338 are one repair family before proposing truth |
| 17 | `r2-post-merge-alpha-023` — Axios #2396 | Browser `file://` status-zero regression with direct fixing PR | Recover the 0.18/0.19 introducing change and browser-only contract |
| 18 | `r2-post-merge-alpha-025` — RxJS #4751 | Concrete scalar `endWith` failure and direct repair | Preserve duplicate issue/fix as one family and recover 6.5 introducer |
| 19 | `r2-review-main-012` — webpack #7655 | Exact review head, supported Node boundary, minimal stream reproduction | Pin historical Node support/dependencies; reject if consequence is unsupported |
| 20 | `r2-review-main-024` — RxJS #2318 | Explicit escaped Subject regression and wrong historical test | Recover actual introducing and fixing revisions, not only discussion prose |
| 21 | `r2-review-main-004` — Sequelize #9051 | Concrete acquisition-failure/unhandled-rejection path | Recover exact test-bearing head and repair; approval alone is insufficient |
| 22 | `r2-review-main-011` — webpack #7210 | Revision-bound asynchronous timeout-path omission | Prove supported Firefox/runtime reachability and the closure dependency |
| 23 | `r2-review-beta-025` — NestJS #814 | Exact review head and injectable-token fallback mechanism | Distinguish misleading formatting from an actual thrown formatter failure |
| 24 | `r2-review-beta-019` — Next.js #8646 | Exact head and lifecycle proof that warning runs before pages exist | Reconstruct the later on-demand entry seam and observable missing warning |

Named reserves, in order, are `r2-review-main-014` (webpack #4791), `r2-review-beta-020` (Next.js #10018), `r2-review-beta-021` (Next.js #10525), `r2-review-beta-005` (VS Code #35956), `r2-review-main-013` (webpack #8409, split carefully), `r2-review-main-019` (Axios #2689), `r2-review-main-023` (RxJS #2550), and `r2-review-beta-018` (Next.js #9157). A reserve enters preparation only after a primary is recorded as rejected/deferred or collapses into an existing duplicate family. The substitution is explicit in the packet loss ledger.

This queue is feasible as source work: it uses candidates already inside the frozen 100 and includes exact or near-exact revision/fix leads across all eight repository families. It is not evidence that 24 new defects will survive reconstruction or human review.

## Recommended comparison-preparation batch

The comparison gap is harder. Targeted bug/review screening cannot be converted into clean labels merely because a reviewer approved a change or a suspected bug failed to reproduce. The comment-independent sample is the appropriate first source.

Assign all `r2-random-001` through `r2-random-025` to a curator-only comparison screen. For each sampled PR, reconstruct the exact historical base/head before inspecting later outcomes, then ask whether one tempting alternative or suspicious construct is protected by a contemporaneous contract and focused test. Do not ask whether the entire PR is clean.

Promote at most 12 to full comparison dossiers. Every promoted dossier must have:

1. one narrow reviewed scope stated positively;
2. a reachable production or test-contract path demonstrating why the existing choice is correct;
3. exact base/head/tree/diff identities;
4. evidence that the scoped behavior is protected, not merely unreported;
5. an explicit list of adjacent behavior that remains unknown;
6. no known defect inside the declared scope;
7. no global-clean claim.

If fewer than seven new comparisons survive, the 12-comparison target is not currently feasible in a one-pass human packet. The packet must report the shortfall rather than relabel an uncertain review thread. Only after the random stratum is exhausted may the curator examine unresolved/retracted-suggestion leads already within the 100—such as Bull #1079, RxJS #2550, or Next.js #9157—for a protected comparison. Such a lead is promoted only if static or reproduced evidence establishes the existing behavior; uncertainty itself is not clean evidence.

## Curator-only assignment and storage layout

Nothing under the following root should be placed in the ordinary worktree before the instruction/prompt design freeze:

```text
<curator-controlled-root>/r2-review-prep-v1/
  access-roster.json
  inventory/
    candidate-inventory-v1.json
    source-manifest.json
  assignments/
    defects/<work-item-id>/assignment.json
    comparisons/<candidate-id>/assignment.json
  dossiers/
    <opaque-case-id>/
      dossier.json
      source-receipts.json
      review.diff
      repair.diff
      proof.md
      license.txt
      replay-manifest.json
  losses/<candidate-id>.json
  duplicate-families.json
  packet/
    packet-manifest.json
    review-index.html
    review-index.md
    cases/<opaque-case-id>.html
    cases/<opaque-case-id>.md
  human-response/
    decisions/<opaque-case-id>.json
    packet-decision.json
  selection/
    partition-map.json
    selection-seal.json
```

Concrete work ownership is separated by function:

| Assignment path | Permitted work | Forbidden work |
| --- | --- | --- |
| `assignments/defects/**` | Authenticate source, recover exact revisions, build canonical diff, causal trace, proof, license, and limitations | Admission, partition selection, instruction/prompt edits, provider runs |
| `assignments/comparisons/**` | Blindly screen the 25 random slots, then build only narrow protected-scope dossiers | Inferring clean truth from silence, approval, merge, or lack of later reports |
| `dossiers/**` | Normalize evidence and compute content hashes | Prefill a human decision or hide contrary evidence |
| `packet/**` | Render the single review batch and bind every dossier hash | Select development/validation/holdout cases |
| `human-response/**` | Sole human's authenticated decisions and reasons | AI-authored confirmations or copied R1 curator identities |
| `selection/**` | Human-controlled class balance, duplicate-family, and partition selection after decisions | Exposure to instruction authors before the applicable freeze |

`access-roster.json` must record every person or agent that can read dossier truth or selection state. An instruction author who reads protected truth before design freeze disqualifies that case from non-tuning validation. AI workers remain preparation identities only.

## Consolidated packet design

The packet should be static, self-contained, and immutable. `packet-manifest.json` binds the protocol, source inventory digest, access-roster digest, every dossier bundle SHA-256, duplicate-family map, rendering assets, and packet SHA-256. The HTML and Markdown views are alternate renderings of the same bound data; decisions bind dossier hashes, not page text alone.

The landing page contains:

- requested versus available counts by proposed class;
- repository, language, architecture, size, mechanism, lane, and exposure distributions;
- known duplicate families and strict-window losses;
- the exact number of proposals, losses, and unresolved preparation items;
- a clear statement that one human is reviewing and that no independence claim is made;
- no selected partition and no model outcome.

Each decision card presents, in this order:

1. opaque case ID and proposed class (`defect-bearing` or `scoped-comparison`);
2. source slot, repository, PR/issue URLs, historical dates, exposure state, and duplicate-family ID;
3. exact review base/head/merge base and tree IDs;
4. canonical full-index review diff with byte count and SHA-256;
5. authenticated primary-source receipts and direct proof links;
6. introducing change, later repair or recorded absence, and reachability relation;
7. causal trace from input through changed code to observable consequence;
8. proposed severity/consequence and smallest repair boundary;
9. truth scope, known adjacent unknowns, and proof kind (`reproduced` or `complete-static-trace`);
10. source license/provenance and replay/materialization status;
11. contrary evidence, chronology/edit limitations, and reconstruction losses;
12. human controls: `approve`, `reject`, or `unresolved`, required reason, optional correction, and acknowledgement of the exact dossier hash.

`approve` accepts only the proposed narrow class and scope. If the human believes a defect dossier is actually a comparison, or vice versa, they mark it `unresolved` or `reject`; a corrected dossier requires a new append-only packet version. `unresolved` never counts toward a quota. `reject` preserves the attempted candidate and reason. No agent may translate silence or an incomplete response into approval.

The final packet-level control asks the human to attest:

- they reviewed every decision card in the packet;
- decisions bind the listed packet and dossier hashes;
- approved defects are real, reachable, and consequential at the stated severity;
- approved comparisons are correct only within their declared scope;
- duplicate-family assignments are acceptable;
- listed limitations remain part of every approval;
- they are the sole human reviewer and make no independent-two-human claim.

## Selection after the one-time review

The selection program operates only on human-approved cards and without model results. It should attempt:

- 24 defect-bearing cases and 12 scoped comparisons overall;
- a 12-case visible development set targeting eight defects and four comparisons;
- a 24-case curator-held historical selection set targeting 16 defects and eight comparisons, released only after prompts freeze;
- no repository family above 25% of the 36 cases;
- at least 12 of the 24 defect cases crossing files or a runtime/contract boundary;
- all related PR/root/clone families in one partition;
- both TS and JS, review-caught and escaped defects, multiple architecture families, medium changes, and an explicit large-change feasibility sample;
- source-derived failure mechanisms, including `other/unclassified`; lane labels are secondary metadata only, never an admission quota.

The 12 already exposed reconstructions may enter development only. They cannot enter non-tuning validation or a sealed holdout. Because they provide only seven defect and five comparison proposals, an eight-defect/four-comparison development set requires at least one newly prepared visible defect and omitting or reserving at least one exposed comparison, even if every existing proposal is approved.

Cases selected for the 24-case historical selection set stay protected until the instruction, route, threshold, judge, and analysis freeze is recorded. After that freeze they may be imported for the registered selection run. This is reserved historical validation, not a sealed holdout. For the 75 targeted review/post-merge slots, high-level mechanisms are already readable in tracked screening reports; they are conservatively development-only unless an access audit proves the relevant instruction authors did not use that material before freeze. The random 25 offer the strongest remaining path to protected selection because their outcomes were not used for sampling, but their adjudicated truth and selection still require curator-only storage. The power-derived historical-confirmation set and steward-controlled external holdout are later program stages, not subsets this R2 packet can manufacture.

If the approved cards cannot satisfy counts, source balance, duplicate-family separation, or the 8/4 and 16/8 class targets, the selection result is `insufficient-corpus`. It must state the exact deficits. It must not auto-admit reserves, reuse one root as two cases, or expand beyond the registered 100 without a new prospective protocol. Do not import the seeded corpus's twelve-lane quota or other seeded admission thresholds into this historical protocol.

## Sole-human governance gap

Current R2 admission code cannot honestly encode this workflow. `eval/curator-policy.json` requires `minimumIndependentConfirmations: 2`; `eval/historical-curation.ts` and `eval/validate-corpus.ts` enforce the confirmation count against the caller-trusted roster. Supplying an AI identity, a second account controlled by the same person, or duplicated human signatures would forge independence.

A separately authorized implementation must introduce an append-only R2 governance version for one accountable human review. It should use explicit fields such as `reviewMode: "sole-human-v1"`, one registered human identity, and one required human decision bound to the case bundle and truth-scope hashes. AI reconstruction and verification records must live in a distinct evidence array that cannot satisfy the human gate. R1 governance and its two-curator records remain unchanged.

Until that version, every R2 case remains `draft` even if the human returns an approval packet. The human response can be preserved immutably, but existing code must continue rejecting admission rather than being weakened ad hoc.

## Protected-selection gap

The current ordinary worktree is not a protected selection store. It exposes:

- all 100 candidate identities;
- detailed mechanisms for targeted review and post-merge leads;
- all 12 development selections and their reconstructed truth clues;
- source artifacts that instruction authors can read.

Therefore:

- the targeted 75 and the 12 reconstructed opportunities cannot support a sealed-holdout claim;
- prior readability cannot be undone by later moving files;
- opaque IDs and hashes prevent accidental naming leakage but do not provide access control;
- a protected external curator root, access log, design-freeze digest, and controlled import are required for non-tuning selection;
- no holdout outcome should be returned to instruction authors until the one-time holdout run is sealed and complete.

The comparison screen over the random 25 is the remaining opportunity to keep adjudicated truth curator-only before selection. If those files or decisions are exposed before freeze, they become development material too.

## Readiness gates before asking the human

Do not send a rolling partial packet. The one-time review request is ready only when:

1. every included dossier has exact source, base/head/tree, full diff, proof, license, limitations, and replay status;
2. every source receipt and dossier file is hash-bound by the packet manifest;
3. duplicate families and multi-root PRs are explicitly grouped;
4. all known losses and unresolved reconstructions are visible in the packet appendix;
5. the packet contains enough proposals to plausibly reach 24 + 12 with stated rejection headroom; if the bounded 100 is exhausted first, send one terminal shortfall packet rather than serial partial requests;
6. no proposed comparison relies on silence or global cleanliness;
7. no proposed defect relies only on a later fix or comment;
8. AI preparation records are clearly non-human and non-confirming;
9. sole-human governance is implemented and tested without weakening R1, or the packet is labeled review-only and non-admissible;
10. protected selection storage and access responsibilities are assigned before any historical selection.

## Feasibility conclusion

The frozen 100 contains enough strong defect leads to justify a bounded attempt at 24 additional defect dossiers, and the resulting maximum 31 defect proposals gives useful human-rejection headroom above the required 24. Defect-side preparation is feasible, though exact-head recovery and duplicate-family collapse will reduce yield.

Comparison feasibility is not yet demonstrated. Five exposed scoped comparisons exist, so at least seven more must survive the outcome-independent random stratum. Screening all 25 random slots and preparing at most 12 comparison dossiers is the smallest honest next batch with useful headroom. If fewer than seven survive, the 36-case target cannot be reached in one human review without either accepting weaker evidence or preparing a new packet version; the former is forbidden.

The immediate blockers are governance and protection, not candidate count: one human cannot satisfy the current two-independent-confirmation reader, and the readable worktree cannot establish protected historical selection or a sealed holdout. The consolidated packet should be assembled only after those boundaries are resolved, then delivered once for explicit per-case `approve` / `reject` / `unresolved` decisions.
