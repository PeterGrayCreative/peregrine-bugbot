# R2 consolidated human-review checkpoint

Date: 2026-09-12

## Outcome

Added a deterministic review-only renderer and used it to publish all 36 R2
proposal cards as one scrollable file in the private evidence repository. This
reduces the remaining human gate to reading one document and filling one
workbook. It does not make, infer, or prefill any decision.

## Durable evidence

- Private evidence repository: `PeterGrayCreative/peregrine-evidence-backup`
- Default branch: `main`
- Commit: `5f32493`
- Review file: `review-workspaces/r2-recovered-human-review-v2/ALL-PROPOSALS.md`
- Review file SHA-256: `2dcd12dfa192416b0ef056ca644f830526e46e3df8df951b34d8c75fd95b21e5`
- Packet SHA-256: `2b73535d50524c256bf26223b9f577d94cb1110e47745b6ebc0a06893ed89574`
- Proposal sections: 36
- Relocated local links: 138; missing: 0

The document shows each dossier bundle digest, card path, and card digest. Card
content is explicitly labeled evidence rather than agent instruction. Only
ready-for-human-review proposals are included; reconstruction losses remain in
the sealed loss ledger. Decision entry remains exclusively in `RESPONSE.json`.

## Vette review

The initial renderer preserved nested relative links verbatim, which would have
resolved from the new consolidated-file location. The pre-commit Vette pass
identified this as a material review-integrity defect. The accepted fix
relocates each relative Markdown link against its original bound card location,
rejects links escaping the packet, and preserves absolute URLs and fragments.
A regression test covers the relocated proof path. No further actionable
finding remained in the bounded renderer diff.

## Verification

Using `.nvmrc` Node 22 (`v22.22.1`):

```text
npm run typecheck
npm run test:evidence-capture
```

Typecheck passed. Evidence-capture passed 27/27 tests. A separate link audit of
the durable generated file found 36 proposal headings and 138/138 resolvable
local links. No provider process or model experiment ran.

## Remaining gate

The durable `RESPONSE.json` still has 0/36 completed human decisions. The user
must review all cards, assign every decision and approved-case partition/class/
duplicate family, and complete the packet acknowledgment. Only then can the
existing compiler derive and authenticate the real R2 partition needed by R4.
