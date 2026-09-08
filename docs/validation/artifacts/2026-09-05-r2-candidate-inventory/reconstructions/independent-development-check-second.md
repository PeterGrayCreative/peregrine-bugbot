# Independent development check: second reconstruction batch

Date: 2026-09-05  
Evidence class: independent AI static check, not human curation or admission

## Scope and method

This check independently inspected the three second-round development reports and the exact local Git objects available in the credential-free scratch clones. Object reads used `GIT_NO_LAZY_FETCH=1`; no network request, repository code execution, dependency installation, provider run, admission, commit, or push was performed. The dispositions below authenticate only the declared review opportunity and causal/protection trace. They do not establish a globally clean revision.

The absence of a contemporaneous substantive review comment is not, by itself, an exclusion criterion for a comment-independent natural comparison. Likewise, the historical collection window applies to the review opportunity: a later merge is a chronology limitation, not an automatic invalidation when the exact reviewed commits and discussion occurred in-window.

## Integrity results

| Opportunity | Independently checked identity | Canonical diff check | Result |
| --- | --- | --- | --- |
| Axios #874 | base `f31317aeca8f7fa385d6aee94ef6ec8ac9d7c072` / tree `375de76ed60c31d59d405001d855c8a3e660c347`; head `d29962a0515c29092025634d14977cc5b618585a` / tree `e1b8bb99873f7f0a818d75e9a9dd2d20bcb5701b` | 2,542 bytes; SHA-256 `a59f6ce73235b5e387dd2c8a084f55a199e104a1335574b89d1da075d1dff64d` reproduced | exact opportunity available |
| NestJS #5710 | base `8009337e23867393353a38be6d083f1cb1d12998` / tree `156f5861a966d181b39afb717a29f59032fde059`; head `525ef913079e44f28d11de7bc60e323f3c05ac0a` / tree `1ad7193ceb924bb5b19e117a098ae75e7b5f05ec` | 9,142 bytes; SHA-256 `a3bb1a3a0e1ac43b478cdb0f168746513fa4778f15fa9f1cb9eae27df0b2cdad` reproduced | exact opportunity available |
| Sequelize #8430 | base `a056b5aa36c7598f5cbb3aaee0165bda53e9c65a` / tree `0547c8a3712081add3675782b200e4e0e272e557`; reviewed head `bda0df47ebcca4ad06f9eec006d35537ce6deb43` / tree `0c9ada3aa6305bbd2e70b71d487beaf00c02d3b3`; final head `a2d0c10a38083958361ff8218a015adcc21e7764` / tree `e3a6afdf22b5e4137769e0a17c6ad59b3de4c49a` | reviewed/final diff 2,219 bytes; SHA-256 `b0141b612d654f0b32b9a7eac61d54febf319feb0114e6775fab187e659f01ce` reproduced | exact opportunity available |
| RxJS #2397 | base `c81882f289ebb58aae8a60d480da6aa871ab762f` / tree `e322acf1e1d7f021bcadb60395fd925dca153e21`; reviewed head `5acaafc49fd9050976e31b8c87cb55c4171edf4d` / tree `60a119d1a25bf5bc426a71daa08ae9dd15436ab2`; final sibling `2f951cdbd0e1edd56138c52456ae2bcb7eb6aa74` / tree `817bb26cb253bb4037b9bbee8a6468f319731815` | review `ff1015aa2c99c5742f2d2e51ca49011ad71eb83779cd2a8f00bce4dcb4ccab40`; reviewed-to-final `ebd7d07ca74be61cd2e669123a8307d7cd0927b4199cbb75facb7c396b9152db`; final `425df8c9c3ed3e37601982703b4fbfd35c9597c053a31ad87c0d3f5effcb5d46` reproduced | exact review and final opportunities available |
| NestJS #383, head 2A | base `18125677b203e437b467a777ad2b7decfe6d9a25` / tree `f9eb5d8df01eff5d498297fece4a7a91a61675bf`; head `ba00ce65a68190c093c183adf2f9f67948332a95` / tree `337cc0793d96b6ed94bf3b7e4c369c1b501c210e`; direct child `eebd72c5e44f2f498252e95f47fd23516234aa41` / tree `174b4a6493d903bbec6f4d0944f1674a57dd10c5` | review 49,597 bytes / `b9e1104df85f116d1715bfdd67e2040b4989964e30e82b40b2ff2adf602abfe7`; repair 2,827 bytes / `91b51e2bd379fa826f4b86e52f500723fab4c2ce0f1c5a42d61de9b9af138312` reproduced | exact opportunity available |
| NestJS #383, head 2B | same base; head `ff229b522f8812cbb362cbafc5d67ab2662e2238` / tree `507af427e58b913284918a48e556a1ae98d99d8d`; direct child `aaab2bc6efd65a28f0b6e451f11f44ad131aa09e` / tree `71e35064b71d7c0a531e17e9aeb6d0d2c0866282` | review 50,828 bytes / `987abcd66bfac961dbd54d2a58a4c094b56be0bba288e06d59eebd26f3e9e0b9`; repair 1,041 bytes / `db88d64f576d2dd2f511b9b4ec29ba9ba6a96cb773933d5e8c9d18dbccb619ac` reproduced | exact opportunity available |
| VS Code #98988 | exact reviewed head `e0cd188e0d2e8007713efe37f8dc9821b5716f05` is absent locally (`git cat-file -e` exits 128) | rebased corroborating pair `4ad934a9b7857062370d9385a2939b58b45ca975` / tree `8a1962907331ade82c233a10fa39d8fe7c2cd605` to `e615a8081f42bb983e5828839fa6f37750da9964` / tree `df7b2f50fea0d0df91ce0a939fb233d41a7b6236` reproduces 6,394 bytes / `ce548a1fd9a26f893054d7b6f01ed6a5ef2b497880411f9854d25ab29e21dde3` | exact opportunity unverified; rebased evidence is not a substitute |

## Candidate dispositions

### Axios #874: reverse the negative disposition; retain a narrow natural comparison

The reconstructed head deliberately implements the historical Node response-header representation: documented singleton duplicates keep the first value, `set-cookie` remains an array, and other duplicates are comma-joined strings. The head's tests protect absent, single, and multiple `Set-Cookie`, duplicate `Age`, and duplicate `Foo`. The browser adapter calls this helper; the Node adapter returns Node's `res.headers` directly.

The proposed alternative—returning arrays for every repeated field—would change the browser adapter's public response shape for ordinary duplicate headers, diverge from the captured Node contract, and break consumers expecting strings for ordinary headers. That is enough for a **comment-independent natural scoped comparison**. The lack of contemporaneous substantive independent review is a provenance limitation, not a reason to discard an otherwise exact protected comparison.

The admissible scope is only the three-way helper/output-shape contract at this reviewed head. It must not claim that historical browsers exposed `Set-Cookie`, that this is the uniquely correct representation for every HTTP API, or that the full revision is clean.

Disposition: **retain for independent curation as a scoped comparison**; `complete-static-trace`, runtime `unresolved`.

### NestJS #5710: confirm the scoped comparison; preserve chronology as a limit

The feared compatibility break is not present for old type-valid inputs. `ClientProvider` is a union containing the old `ClientOptions`; intersecting that union with `{ name }` preserves the old `ClientOptions & { name }` branch. Existing factories returning the narrower old type remain assignable to the widened return. At runtime, old typed shapes lack a top-level `customClass` and continue through the pre-existing transport switch. The added integration coverage exercises custom and standard registrations together.

The exact commits are authored in November 2020 and the head-bound review question and answer occurred on 2020-12-21. The February 2021 merge does not erase that in-window review opportunity. It must be recorded as a chronology limitation, and later gRPC behavior must remain outside the comparison.

Disposition: **retain for independent curation as a scoped comparison**; `complete-static-trace`, runtime `unresolved`. Scope is limited to old type-valid registration shapes and their existing factory path, not arbitrary JavaScript objects, every transport, or the whole PR.

### Sequelize #8430: confirm as comparison; the questioned guard is correct

The change from manual `prepareEnvironment()` to `prepareEnvironment(false)` prevents a manually managed nested transaction from overwriting constructor-wide CLS state belonging to an outer managed transaction. The new `useCLS` guard controls the shared-namespace write; the identity-checked cleanup then cannot erase the outer value. Managed transactions retain the default `true`. The added test directly protects the narrower fact that manual preparation does not write CLS.

No later change removes this guard; the final source delta is unrelated. The suspected defect is therefore the repair, not a bug.

Disposition: **retain for independent curation only as a narrowly scoped comparison**; `complete-static-trace`, runtime `unresolved`. Do not include the separate default-syntax or rollback roots, or claim general transaction correctness.

### RxJS #2397: confirm the type-contract defect survived review

The reviewed head removes generic arity from exported `ErrorObservable<T>`, erases the generic static factory return, and changes the constructor payload to `any`. The final sibling removes only the two `readonly` modifiers; the generic removal is unchanged. Downstream TypeScript source naming `ErrorObservable<string>` therefore fails type checking because the exported class is no longer generic. The later matching compiler complaint supports the same mechanism.

Disposition: **retain for independent curation as a defect candidate**; `complete-static-trace`, runtime `unresolved`. The root is an exported/deep-import declaration compatibility break, not a runtime failure or a claim about all documented top-level APIs.

### NestJS #383 head 2A: confirm option-coupling defect

At head `ba00ce65...`, `shouldTransform` is computed from `transform || strip || reject`. Thus `{ transform: false, strip: true }` cannot preserve the explicit false: stripping forces the transformed-class return path. The direct child separates explicit transformation from stripping, returns `classToPlain(entity)` for strip-only behavior, and adds the matching regression test.

Disposition: **retain for independent curation as a distinct defect candidate**; `complete-static-trace`, runtime `unresolved`.

### NestJS #383 head 2B: confirm caller-owned mutation defect

At the later, different reviewed head `ff229b52...`, the constructor reads `options.transform`, deletes that property from the caller's object, and only then copies the remainder. Reusing the same configuration object therefore loses `transform` and can change a later consumer's behavior. The direct child replaces mutation with `{ transform, ...validatorOptions }` destructuring.

Disposition: **retain for independent curation as a distinct defect candidate**; `complete-static-trace`, runtime `unresolved`.

The two NestJS #383 opportunities must remain separate cases because they bind different historical heads and different causal mechanisms. They should remain in the same PR/source family for partitioning; combining them would expose later review state and distort discovery credit.

### VS Code #98988: leave unverified; do not substitute the rebased repair

The exact comment-bound object `e0cd188...` is unavailable in the local repository, so this check cannot authenticate its tree, historical base, complete reviewer-visible diff, or exact repair relationship. The surviving `4ad934a9...` to `e615a808...` pair and its reproducible diff corroborate the missing-await mechanism, but a rebased correction-equivalent commit is not the original review opportunity.

Disposition: **unverified and exclude from primary benchmark admission** unless the exact reviewed object is recovered. Preserve it as an inventory/reconstruction loss; do not manufacture a substitute from the present PR head, final head, comment hunk, or reverse-applied fix.

## Limits

- These are static source conclusions. Historical builds, tests, browsers, databases, and runtime behavior were not executed.
- Review/comment bodies may be historical evidence but do not replace the exact code trace; late or edited discussion must retain its provenance limits.
- No finding above is a global-clean assertion. Each comparison protects only the stated scope, and each defect truth is limited to its stated root.
- Duplicate-family grouping, partition assignment, frozen truth records, accountable human confirmation, formal admission, and provider authorization remain undone.
- This independent AI check is not either of the two required human curator confirmations.
