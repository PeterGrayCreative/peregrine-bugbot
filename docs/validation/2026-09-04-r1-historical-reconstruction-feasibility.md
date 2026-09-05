# R1 historical reconstruction feasibility

Date: 2026-09-04 (America/New_York)
Branch: `research/ts-js-evidence-r1`
Base: `origin/main` at `fa1ff4dc501f869730f88947ec3ef3cc5fa42037`
Status: complete after append-only correction and independent curation

## Result

Five authentic public review opportunities were reconstructed at exact
historical commits. The batch covers TypeScript and JavaScript, review-caught
and post-merge defects, and a plausible reviewed comparison. Four roots have a
complete static causal trace plus contemporaneous review or later fix evidence.
The comparison has a bounded static disconfirmation trace and is explicitly not
called globally clean. Two independent curators confirmed every authoritative
v3 bundle.

No reviewer, judge, or other provider experiment was run. No production prompt,
route, skill, or benchmark result was changed.

| Case | Language | Role | Exact review state | Primary result |
| --- | --- | --- | --- | --- |
| `r1-vscode-73801` | TS | Review-caught | Parent -> original reviewed commit | Cleanup attached to server exit also runs on restart; review moves it to extension-instance deactivation. |
| `r1-typescript-37467` | TS | Post-merge | Authentic merge base -> final reviewed head | General comment preservation interacts with organize-import deletion and duplicates comments on each save. |
| `r1-karma-2846` | JS | Review-caught | PR base -> original reviewed head | For ordinary refresh-loaded local files, manual type reaches `File.type` but is omitted from script MIME selection. URL and watcher seams are separate and disclosed. |
| `r1-karma-2714` | JS | Reviewed comparison | PR base -> reviewed head | Reissuing `fs.readFile` is the intended retry; direct callback recursion lacks a fresh result. No global clean claim. |
| `r1-webpack-8233` | JS | Post-merge | PR base -> approved head | Logical folding turns an unknown runtime `typeof` guard into a constant; later issue and fix bind the root. |

The original machine-readable identities and diff hashes remain in the immutable
v1 [`manifest.json`](artifacts/2026-09-04-r1-historical-reconstructions/manifest.json).
The authoritative identities, canonical stored patches, corrected truth
boundaries, and supersession records are bound by the v3 packet under
[`curation/versions/r1-case-evidence-v3/`](artifacts/2026-09-04-r1-historical-reconstructions/curation/versions/r1-case-evidence-v3/).

## Why these are review opportunities

- Every primary case uses the real pre-merge base and a commit that was actually
  present in the historical pull request. No case was manufactured by reversing
  a later fix.
- Review-caught cases freeze the defect-bearing intermediate head referenced by
  the review comment.
- Post-merge cases freeze the introducing PR and use later reports and repairs
  only as curator evidence. Those answers must be outside future reviewer
  mounts.
- The comparison freezes a naturally reviewed pattern. Its label is restricted
  to the specific callback-selection concern that was raised and resolved.

## Source and integrity evidence

The reconstruction used public Git objects from the canonical repositories and
GitHub's pull, issue, review, review-comment, and commit endpoints. Commit IDs,
tree IDs, binary diff SHA-256 values, source URLs, retrieval time, and API-output
hashes are recorded. Historical source licenses are Apache-2.0 for TypeScript
and MIT for VS Code, Karma, and Webpack.

The initial discovery response hashes in
[`source-hashes.md`](artifacts/2026-09-04-r1-historical-reconstructions/source-hashes.md)
are retained for provenance. The authoritative capture manifest and 20 raw
public response bodies are committed under
[`raw/`](artifacts/2026-09-04-r1-historical-reconstructions/raw/). The manifest
records the exact GET endpoint and parameters, byte length, and SHA-256 for each
body. The R1-specific capture script rejects a full 100-record response instead
of silently truncating; a general resumable paginator remains R2 work.

## Verification strength

| Case | Static trace | Historical runtime/test evidence | R1 execution |
| --- | --- | --- | --- |
| VS Code #73801 | Complete | Reviewer-described restart failure and accepted lifecycle correction | Not run |
| TypeScript #37467 | Complete | User-observed repeated output and later regression test | Not run |
| Karma #2846 | Complete | Review-caught and corrected before merge | Not run |
| Karma #2714 | Complete for declared comparison scope | Review discussion and semantics-preserving rename | Not run |
| Webpack #8233 | Complete | Reported 4.21/4.22 output difference and later runtime-sensitive regression test | Not run |

Static and reproduced evidence remain separate. Historical build execution was
not necessary to establish collection feasibility and would add dependency and
runtime reconstruction cost. It can be added selectively during R2 curation.

## Yield and source lessons

The feasibility search found five usable opportunities across four repositories
without a general collector. This proves availability, not the projected yield
from 100 candidates.

- GitHub review comments alone are insufficient. The strongest cases required
  review bodies, commit sequences, issue reports, and later repairs.
- A PR's current API `base.sha` may not be the base of an intermediate reviewed
  commit. VS Code #73801 would appear as a noisy 112-file diff using the drifted
  API base; the reviewed commit's parent reconstructs the actual four-file
  opportunity.
- A recorded target tip is not necessarily an ancestor of the reviewed head.
  TypeScript #37467 initially used a non-ancestor base and produced a reverse
  diff containing unrelated changes. Independent curation forced replacement
  with the authentic merge-base-to-head patch.
- Raw patch hashes depend on Git's abbreviated blob IDs unless the diff command
  fixes them. V3 stores the actual patch bytes and uses a fully specified
  `--full-index`, no-renames, no-textconv, deterministic diff command.
- Release-regression reports can identify authentic introducing PRs. Webpack's
  4.21-to-4.22 boundary isolated PR #8233 before the later fix was inspected as
  repair evidence.
- Natural comparisons need narrow truth scopes. Karma #2714 contains other
  debatable behavior, so only the reviewed callback-selection concern is a
  supported comparison label.
- [BugsJS](https://bugsjs.github.io/) is useful for reproduction candidates,
  but its buggy pre-fix versions do not automatically recover introducing pull
  requests. Express and Mongoose candidates inspected in the feasibility pass
  were also concentrated before the 2017 window. They remain candidate leads,
  not admitted primary review cases.
- The initial set is repository- and mechanism-concentrated and cannot be used
  to estimate efficacy. R2 still needs at least six families, random sampling,
  explicit loss reasons, and duplicate grouping.

No individual reconstruction exceeded the proposed two-hour deferral boundary,
but curator time was not instrumented in this pass. R2 must record it.

## Admission outcome and stop point

R1 establishes that authentic TS/JS review opportunities can be recovered and
defensibly curated. The original v1 packet is preserved as failed evidence:
both curators rejected two cases. V2 records the substantive corrections. V3
then canonicalizes all five patch artifacts, binds an exact curator roster, and
requires confirmations to name both the exact packet and case bundle.

Both rostered curators directly authored five v3 confirmations. The strict
zero-provider validator reports 2/2 confirmations for every case and `R1 v3
curator readiness: ready`. This closes the R1 feasibility gate; it does not yet
convert these cases into the future R2 historical benchmark schema or claim
Peregrine efficacy.

Work stops here by request. R2 candidate collection, R3 harness work, prompt
changes, and all provider calls remain unstarted. Resume from the dedicated
[handoff](../plans/2026-09-05-typescript-javascript-evidence-ablation-r1-handoff.md).
