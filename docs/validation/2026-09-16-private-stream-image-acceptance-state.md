# Private-stream image evidence acceptance V2

The independent Astra-medium review passed for public commit
`97913d4c98eb217a0d716d58b5526a2589c43552`, private commit
`2a0ca1cd9bec5cfd78a1811092cb72606f07f87f`, freeze
`df8eaa464e01315f71b2ca082afa503be65abe9944151015ad45a4fa5cbdb15f`, and
reconstruction `f5b162a1750fca4b235608a4c9c3d76aaeada6415c69ff1be3e9086c4edf68fe`.
The new immutable gate records the coordinator-relayed verdict and its exact
reviewer identity, scope and evidence. Its hash proves file integrity, not a
cryptographic reviewer signature. All earlier files remain byte-for-byte intact.

`eval/private-stream-image-acceptance-v2.ts` records `imageAccepted: true` and
`runtimeEvidenceReady: true` for this credential-free distribution evidence.
The reviewer observed the earlier V1 state with acceptance and readiness false;
this separately authorized successor records the PASS without rewriting that
history. `runtimeReady`, `executionReady` and every publication/provider/canary/
retry/batch/production authorization remain false. Runtime selection is unchanged.

The successor requires the exact gate bytes plus all 22 original authenticated
publication inputs. Changed commits, source, image, run, attempt, artifact,
attestation, reviewer, verdict, or reviewed state reject. The private V2 replay
also binds original archive members, all 148 source inputs, the prior freeze and
reconstruction, and preservation of the reviewed public/private trees.

The image remains the same immutable digest from workflow `35153807393`:
`sha256:b7b2ab5d41b51f32a33c35e17e15746ac7c922d12243d5f773f4c7fcd2c30a52`.
Native-tag versus published-digest proof, emulated arm64, omitted raw streams,
and provider/session/scientific evidence limitations remain as documented in V1.

Validation uses Node 22, new deterministic gate tests, existing focused and
affected tests, typecheck, package/YAML/helper/static checks and exact private
replay with runtime-denial guards. Existing package scripts are preserved; run
the new test file explicitly with `node --import tsx --test
tests/eval-private-stream-image-acceptance-v2.test.ts`.

A fresh final Astra-medium acceptance-state gate must review this additive state
transition before publication or any further workflow. Provider work separately
requires an accepted successor execution contract, fresh exact authorization and
remaining CLI/session/catalog, served-identity, assessor/blinding and scientific
prerequisites. No new canary, retry or review slot is authorized here.
