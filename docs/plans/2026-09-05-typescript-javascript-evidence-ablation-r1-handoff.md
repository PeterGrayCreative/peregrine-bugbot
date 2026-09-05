# TypeScript/JavaScript evidence program handoff after R1

Date: 2026-09-05
Stop point: R1 complete; R2 not started
Branch: `research/ts-js-evidence-r1`
Pull request: #31

## Resume objective

The research program is paused immediately after R1. Five public historical
review opportunities are independently admissible for feasibility purposes.
Do not rerun R1 discovery, flatten the version history, or reinterpret this
small batch as efficacy evidence.

Authoritative entry points:

- Plan: `docs/plans/2026-09-04-typescript-javascript-evidence-ablation-plan.md`
- Progress: `docs/plans/2026-09-04-typescript-javascript-evidence-ablation-progress.md`
- R1 status: `docs/validation/2026-09-05-r1-historical-reconstruction-status.md`
- Feasibility report: `docs/validation/2026-09-04-r1-historical-reconstruction-feasibility.md`
- Evidence root:
  `docs/validation/artifacts/2026-09-04-r1-historical-reconstructions/`
- Authoritative v3 packet:
  `curation/versions/r1-case-evidence-v3/packet-manifest.json`

V3 packet SHA-256:
`d96904edf56c5b8dac970f59fa95a14c495cde5bd22d50a805e6874df098c2fe`.

## State that must be preserved

- V1 is intentionally failed. Its two independent rejections exposed a wrong
  TypeScript review base and an overbroad Karma trace.
- V2 is intentionally retained. It records the substantive corrections and
  confirmations.
- V3 is authoritative. It stores canonical diff bytes for all five cases,
  supersedes prior patch-hash claims, and has two directly authored rostered
  confirmations per case.
- Raw GitHub responses, prior manifests, cases, confirmations, and unsuccessful
  evidence must remain append-only.
- No production prompt, model, route, skill, posting behavior, or historical
  provider result changed under R1.

## Verification on resume

Use the repository-pinned Node version before Node commands:

```sh
source /Users/petergray/.nvm/nvm.sh
nvm use 22
node scripts/evidence/validate-r1-curation.mjs --require-complete
node --import tsx --test tests/evidence-r1-curation.test.ts
npm run typecheck
```

Expected readiness is: v1 `failed`, v2 `ready`, v3 `ready`, and 2/2 v3
confirmations for every case. Any other state is an integrity failure to resolve
before R2.

## Next authorized planning boundary

The next plan step is R2, not a provider experiment:

1. Define the content-addressed, resumable candidate-inventory format and loss
   reason taxonomy without building a database.
2. Collect at most 100 public candidates across at least six repository
   families, preserving the specified random sample and 50/25/25 source mix.
3. Record curator time and every exclusion/defer reason, including reconstruction
   complexity and unavailable historical objects.
4. Curate toward 36 cases: 24 bug-bearing and 12 reviewed comparisons, with no
   family above 25%, at least half the bug cases crossing files or runtime/
   contract boundaries, and explicit duplicate-family groups.
5. Freeze development/selection partitions before any reviewer output is seen.

R3 deterministic harness work may proceed in parallel only after the resumed
scope explicitly allows it. R4 remains the next provider-authorization
checkpoint. Do not run models, edit prompts, start the four-arm experiment, or
make production routing/posting changes during R2.

## Known limitations carried forward

- Five cases prove feasibility, not expected yield from 100 candidates.
- None of the historical project test suites was rerun under its original
  environment; proof levels remain complete static trace plus historical
  observation where recorded.
- Public dates do not prove absence from model training data.
- Karma #2714 is only a callback-selection comparison, never a globally clean
  PR.
- Karma #2846 credits only the ordinary refresh-loaded local-file root; URL and
  watcher-added-file type loss are separate disclosed seams.
- The five-case batch is repository- and mechanism-concentrated and cannot
  support product-value or transfer claims.

## Resume completion criterion

Do not mark the overarching goal complete at this handoff. R1 alone is complete.
On resume, advance only when R2's candidate inventory, curation evidence,
duplicate controls, partition manifest, and loss/yield report withstand
independent review. Provider work remains separately authorized later.
