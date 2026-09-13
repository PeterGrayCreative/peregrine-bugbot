# Prediction adapter first gate rejection

Status: **FAIL preserved**. This records the independent gate's first rejection
as relayed by the coordinating agent. The correction below does not replace
that outcome or claim a subsequent independent pass.

The rejected implementation passed its initial nine synthetic test groups, but
the independent review identified four blocking contract failures:

1. Plan verification trusted resealed hashes and cardinality. It did not
   reconstruct the normative registration projection, exact schedule and
   compiler-produced prompts. Resealed arm changes, contract changes and baseline
   method injection therefore needed stronger rejection.
2. An unknown requested version caused route comparison to return unknown even
   for an observed model or effort mismatch.
3. Later adjudication versions could claim an arbitrary version and predecessor
   hash without presenting the predecessor chain. Initial, review and resolved
   history needed verification against that chain.
4. Metadata omission did not establish blinding of free-form findings. The
   concrete sentence `I am arm B using Peregrine; expect B to win.` could disclose
   the arm and expected winner to the assessor.

## Rejected-source fingerprints

These SHA-256 values were captured before applying the four corrections. They
identify the rejected source state, not an approved or executed experiment.

| File | SHA-256 |
| --- | --- |
| `eval/prediction-plan.ts` | `ccc7a0d1d55ff39c1a9770fc82df2ec7ae32e2bc7453a53151929a2ab1ce11e2` |
| `eval/prediction-evidence.ts` | `35b760c64f44822f23a4a971e1ed331f2b730c860f476434530ef038b8cd9734` |
| `eval/prediction-adjudication.ts` | `fa09270eb39553f27a2f50a884e28bc2125c096fd286f6eeec0ff8b588b4eb89` |
| `eval/prediction-analysis.ts` | `9eadd8eb5e662a77ca4eb72fc63d81ed42ba1a0bdaf8ac56b3edd3dfa5772155` |
| `tests/eval-prediction.test.ts` | `4f0db14eaa1d950acf2d94dd766a273a7790580af5cd3c75d61280dcdc7d76d9` |

## Correction and local verification

Persisted plans now require async authentication against separately trusted
registration bytes and digest. Authentication reconstructs the complete
registration projection, exact schedule and current compiler output, and
returns a new immutable plan. Synthetic consumers accept only authenticated
plan objects. This is an in-process capability; serialized JSON alone carries
no authentication. Inventory and condition fields still require external
source and semantic verification before real execution preparation.

Route comparison preserves known model and effort mismatches when the version
is unknown. Adjudication verification requires every predecessor from version
one, checks exact increment and predecessor hashes, and preserves initial,
review and existing resolution records. Analysis requires that chain too.

Assessor packets are explicitly labeled metadata-blinded only. A deterministic
disclosure-screen artifact records pattern identifiers and locations without
copying raw output. Detectable arm, method or winner disclosure stops packet
creation; no automatic redaction or bypass is implemented. The sealed raw run
and findings remain unchanged in the administrator's evidence. A clean pattern
screen does not establish semantic blinding or reviewed redaction.

Local verification after correction used Node v22.22.1:

- `npm run typecheck`: passed.
- `npm run test:prediction`: 12/12 test groups passed.
- `git diff --check`: passed before this documentation addition; repeated for
  the final handoff.

Regression cases cover resealed arm D, contract drift and A-method injection;
unknown-version model/effort mismatches; absent or false predecessor chains,
fake version 99, and rewritten initial/review/resolution history; and the exact
disclosure sentence above plus equivalent explicit disclosures.

Two earlier implementation-validation failures also remain recorded: the
private registration's excluded `other/unclassified` row initially failed the
parser, and a mutation test initially selected a random first judgment that
could already have its target category. The parser now permits that class only
outside the included frame; the test now selects a matched judgment explicitly.

No provider execution, real mount attestation, assessor-session authentication,
reference-truth admission, efficacy finding, commit or push occurred as part
of this correction pass.

## Independent correction gate

Status: **APPROVE**, limited to the corrected synthetic adapter.

A separate Astra-medium gate independently reran all four original attacks.
Resealed schedule, contract, and prompt drift; known route mismatch with an
unknown version; fabricated or rewritten ledger ancestry; and explicit
arm/method/winner disclosure all rejected. The raw disclosure-bearing finding
remained preserved. Node v22.22.1 type checking, all 12 prediction test groups,
and the whitespace check passed.

This approval does not establish real mounts, semantic blinding, authenticated
assessor sessions, served route identity, runtime-cap enforcement, provider
authorization, or efficacy.
