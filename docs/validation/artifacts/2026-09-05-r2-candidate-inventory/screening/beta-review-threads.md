# R2 beta review-thread screening

Status: candidate screening only; no case is admitted and no partition is assigned.

## Method and evidence boundary

I screened the cached `search/issues` discovery frames for VS Code, Next.js,
and NestJS, removed every PR present in `random-sample-v1.json`, and then
captured the public inline-review-comment endpoint for 32 leads through
`scripts/evidence/public-capture-store.mjs`. New response bodies and immutable
request receipts are preserved under
`/private/tmp/peregrine-r2-beta-sources/context/{objects,requests}`. Search
comment counts were used only to find leads; every retained entry below names
an actual inline comment ID, body mechanism, date, path, and
`original_commit_id` review-head lead.

The GitHub API reports each cited PR author and inline-comment author as type
`User`; none is reported as type `Bot`. That metadata does not prove human-only
authorship or lack of automation. Current GET bodies are not an edit history.
Any `updated_at` later than `created_at` remains potentially edited, and an
after-2020 update or review requires an archived original before it can serve
as strict in-window evidence.

## Shortlist

### 1. `microsoft/vscode#106448` — wrapped-tab layout uses the wrong group and stale dimensions

- PR created `2020-09-11T03:48:04Z`; discovery receipt:
  `raw/requests/2d1ed479f04199ae15a222998788a402027b26e60ba7fffaf77e8f6ed1d0321a.json`.
- Inline comments `489998681` and `499741152`, created 2020-09-17 and
  2020-10-05, identify two concrete seams: querying a global
  `div.tabs-container` fails with multiple editor groups, and returning a
  dimension before the asynchronously scheduled layout applies its CSS yields
  stale height. Paths are `editorDropTarget.ts` and `tabsTitleControl.ts`;
  original review heads are `f28b382003884276c9efd0a1767f9eba673617ae`
  and `ac0a02482669a6b142d0d09f516f733fe2b906c5`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/2b026ef740df940b4a93d30eeffb210338cc5a2291e2a4e579062baeff1e21d2.json`
  (body SHA-256 `e33f4bebd2fe706d42cbc8321c512147c00332e36fb0f6f2ade6a74e17cbb223`).
- Uncertainty: both bodies have `updated_at=2021-01-04`; recover their pre-2021
  text before strict historical use.

### 2. `microsoft/vscode#85326` — ARM postinstall condition may run off Windows

- PR created `2019-11-21T18:59:10Z`; discovery receipt:
  `raw/requests/cbdf2591e32e2f9eedb5088c464401f731a08cfa09914a821b4b93c6ed3cb057.json`.
- Comment `349274977`, created `2019-11-21T19:26:10Z`, reports that the build
  error likely comes from a postinstall check that should fire only on Windows.
  Path `build/npm/postinstall.js`; original review head
  `1d372ecfb3bf4a8a05389899471834366e78a16b`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/40b11f1533adffaae3b6bbd0f40a0bd70c3e7a63d8a64eecbec960a68f16cde1.json`
  (body SHA-256 `9a0a9beef8ff80bcb0cbc33c31eeb61cbeb3d5c1599e551e1b348c8a955817e6`).
- Uncertainty: static source reconstruction must establish the non-Windows
  caller and observable build failure; body updated within the window.

### 3. `microsoft/vscode#98988` — asynchronous move guard is not awaited

- PR created `2020-06-01T22:30:03Z`; discovery receipt:
  `raw/requests/69755dff24f91e96f2d4a96744e3aa1aba6c42a61c24116e5008ab28231492d3.json`.
- Comment `440055406`, created `2020-06-15T09:43:10Z`, states “Missing
  `await` on `canMove`” in `workingCopyFileService.ts`. This is a concrete
  promise/authorization-of-operation seam: a promise value can be treated as
  truthy before the move feasibility result resolves. Original review head
  `e0cd188e0d2e8007713efe37f8dc9821b5716f05`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/c043435131dcb91634e38792165680db61c9f2a68dc1b9f5b0899dd6f56cc664.json`
  (body SHA-256 `ce883f74cfe89a0880ef1f9f2535de0cb560549fa16edf1b1a60af80d24d9cc5`).
- Uncertainty: reconstruct the exact callee return type and correction commit;
  body updated within the window.

### 4. `microsoft/vscode#113285` — unconditional inline-hint cache leaks

- PR created `2020-12-22T10:38:10Z`; discovery receipt:
  `raw/requests/c552d3e662f86f76465be2df854b5b984f25184bd8c37d948447c52637296550.json`.
- Comment `551242588` says caching is needed only for providers with a
  `resolve` function and “Right now this is a leak.” Path
  `extHostLanguageFeatures.ts`; original review head
  `413b5d4705782466dc30e8c134a283141cdb6b5f`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/cdbad1449a2edadee28144a854bfd0c1071848d875e6b82e1618d6a418c2c0bc.json`
  (body SHA-256 `c8ba3002d0625d454b709cce424ca56ca78949158a4e05d80a050ceec02dfa37`).
- Uncertainty: the review was created `2021-01-04` and updated `2021-01-19`.
  Retain only as a review-head lead unless the program permits post-window
  review or an in-window source independently establishes the leak.

### 5. `vercel/next.js#7696` — strict-mode manifest failure and duplicate legacy prefetch

- PR created `2019-06-27T23:55:49Z`; discovery receipt:
  `raw/requests/6f2babb3e23bea3fee493b17f36f24be684d2d10749dd2f424c8e59e496c4443.json`.
- Comment `302333269` reports an implied-global assignment that fails in
  strict mode in `build-manifest-plugin.ts`; comment `308749817` reports that
  removing the in-flight set permits double prefetch between script insertion
  and execution on browsers without `link[rel=preload]`. Original review heads
  `f803e073e901eac3c18f12f9a7a3e1f7af11872a` and
  `724d45d7c5a563bb3e753a4bfe8f62a5c754d668`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/78c09350203ef5ee744fcfe0cbc5a4b245c99ce7afd73ec058ff6299c7d07ce0.json`
  (body SHA-256 `274dee374ca4c7889b31ece527d0035d63aec69a8b3aa279f27ea38a2142d912`).
- Uncertainty: these may be two distinct roots in one PR and must be curated
  separately; both bodies were updated in-window.

### 6. `vercel/next.js#7704` — third-compiler emulation diverges from webpack output semantics

- PR created `2019-06-28T22:47:22Z`; same discovery receipt as #7696.
- Comment `304968336` identifies re-running all plugins, recomputing the chunk
  graph, and re-Babeling files in a simulated third compiler as fragile and
  capable of skipping or duplicating webpack plugin behavior. Comment
  `306472735` points to filename/chunkFilename rules that diverge from the main
  webpack configuration. Original heads
  `7adf981de2379f3ec8ed67ef0fa5e9fcae1d151f` and
  `8cf16e07b0f282fb15681aedb46e0e5395979c27`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/475ca5f0378aadcc39fdb3ffc591da06a98c99be5a659dd1f67acf1c8b80b692.json`
  (body SHA-256 `9fbcd2a287385e547ba4b191a0c837a321e5b1d28fb98e9c409539539b1463e7`).
- Uncertainty: broad architectural concern; curation needs one reachable
  output mismatch rather than treating fragility itself as a defect.

### 7. `vercel/next.js#13333` — redirect tests follow the redirect and miss response semantics

- PR created `2020-05-25T08:20:32Z`; discovery receipt:
  `raw/requests/2bcee589e795f16e57cbd92b4e8d9a530625d373690a4aa9665594a071d71342.json`.
- Comment `438122352`, created `2020-06-10T13:29:51Z`, says the serverless
  integration test must disable redirect following to verify that the response
  actually sends a redirect. Path `test/integration/serverless/test/index.test.js`;
  original head `c63fd0a5ae388dd40667756f17334f4173a72fe9`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/f10aacf606ef9ad81738d3dd53121315ea28509f096af0fc14ad653c2a9fcdaa.json`
  (body SHA-256 `b470983b23773676025e67eb283c33a4f91b971ca554fc47d2f80d7e599d845e`).
- Uncertainty: test-gap lead only until the source response path and repaired
  assertion are reconstructed.

### 8. `vercel/next.js#16650` — test-only dummy base reaches the production bundle

- PR created `2020-08-28T12:37:21Z`; discovery receipt:
  `raw/requests/9ff1c895e0d44962d469f969aeeaad5e685ac68f92f8ad294ea0fbb458310b10.json`.
- Comment `486833277`, created `2020-09-11T07:42:14Z`, states that
  `refreshDummyBase`, intended only for unit tests, will be included in the
  production bundle. Path `parse-relative-url.ts`; original review head
  `cf4d53c722a3303271b411e69e214cf52e945569`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/9e5cd2b68ae74d234b79a05c339d0a39a476df4ebeff84680552436b88ab599c.json`
  (body SHA-256 `a6d00d5f4a8a48e4fc6a9cf8043679382e5676e5d4708038245488a093082ff8`).
- Uncertainty: verify bundler reachability and whether the consequence is
  shipped bytes only or also runtime behavior; body updated in-window.

### 9. `vercel/next.js#14746` — font data is produced in the wrong webpack phase

- PR created `2020-06-30T19:12:55Z`; discovery receipt:
  `raw/requests/701387848c5d186c6ec6bf79eb826e11fb4220978aef05ab6ec7dcb3fbb09645.json`.
- In a substantive inline thread about reusing the build manifest, response
  `452394809` explains that `BuildManifestPlugin` runs in the client build but
  `FontStylesheetGatheringPlugin` must run in the server build to see a
  user-defined `_document.jsx`; sharing the file across those phases is thus a
  concrete producer/consumer mismatch. Path `constants.ts`; original head
  `3eaade22a960544fbb22026cf770905ea69df1cc`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/bf4aac9a2f7a17ca805ee9aa8f349954eae6add55671ed2ba90862393cfee3ff.json`
  (body SHA-256 `f22340856a9acb666d678791ed9b55455bd13c2eaac2d6f5a95e65a06f275a6f`).
- Uncertainty: the cited mechanism is the author response, not an independent
  reviewer claim; reconstruct the initiating comment and resulting design.

### 10. `vercel/next.js#15231` — reload-based recovery can loop forever

- PR created `2020-07-16T17:28:45Z`; discovery receipt:
  `raw/requests/d9531ffa01f67bff6a65ed07ebe1653cd597dd45e6b4eea48e0b99bb477e3675.json`.
- Comment `469384561`, created `2020-08-12T16:23:14Z`, reports that reloading
  from the server re-triggers the same router error indefinitely and proposes
  rendering `_error` instead. Path `router.ts`; original head
  `1f145c65024ad4e93afce8b2f1725b673a9582b3`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/36cb72d7db28e644c20af56474f7f4c62f0fcf0b1269e6e08af2048b12a24984.json`
  (body SHA-256 `f5d1a930bc1e30c4a918591d84d03b23198992a2ecdfc0f89ed5d2c857cc8af1`).
- Uncertainty: verify the same error is deterministic across reload and identify
  the exact triggering route state; body updated in-window.

### 11. `vercel/next.js#17749` — image configuration validator mishandles null/undefined

- PR created `2020-10-09T15:18:47Z`; discovery receipt:
  `raw/requests/1572c286f244be45e84526da81c729638279167d47297f5bd7294a8f5f1e34c1.json`.
- Comment `505822595`, created `2020-10-15T20:32:29Z`, asks that the
  object-type validation explicitly handle `null` and `undefined`; `typeof
  null === 'object'` is the concrete bypass. Path `server/config.ts`; original
  head `59a26c041e87f637c8ea6465164013e283c2f1d4`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/782e69c4207a8b39945d3f1c80c5ca8d167519a533f5ec853087b1970d38c3ca.json`
  (body SHA-256 `45a4fc1e7583a3be95f58984ef939a020cbadbc5331caad1907a5afaf4090549`).
- Uncertainty: confirm whether undefined is reachable after defaults and what
  downstream access fails; body updated in-window.

### 12. `vercel/next.js#14848` — cancellation marker suppresses unrelated routing errors

- PR created `2020-07-04T13:13:05Z`; same discovery receipt as #15231.
- Inline response `453170787`, created `2020-07-11T08:13:41Z`, explains that
  `.cancelled` was also used to stop routing after unrelated failures such as
  `getServerSideProps` errors, causing those failures to be omitted from router
  events. Path `router.ts`; original head
  `d5743794f6482035087f2d15a3b96dd95311bace`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/eb3a0f1f1144e1e4f415d542ccb5959469d050232b6257176a78af5aa56f9b61.json`
  (body SHA-256 `9a1521a17b24b154d479d3c3fecbb750d4a682651c1898509eac62c623a8cb50`).
- Uncertainty: author response supplies the clearest mechanism; reconstruct the
  initiating concern and verify which pre-fix errors carry `.cancelled`.

### 13. `vercel/next.js#9872` — generated serverless code omits string quotes

- PR created `2019-12-29T17:38:35Z`; discovery receipt:
  `raw/requests/5f51f5ba52be3a104c86e4310d207439dec533787cf6d9dc7bdea670462c9926.json`.
- Comment `361865777`, created `2019-12-29T18:36:22Z`, supplies the quoted
  form `req.url.startsWith('${basePath}')` and says the generated loader code
  still needs quotes. Path `next-serverless-loader.ts`; original head
  `adc5b3fcb32f9f6534a546d2f6b6788efee5ed7b`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/942f4842a8faabc4d84764dd0564802ede2842eae5f026b9237c74e089d69da8.json`
  (body SHA-256 `af2ad97eddc76ea0792e0f44e3f0b22547e728942a2aed4162da90ec111d1a2f`).
- Uncertainty: reconstruct the template expansion to determine whether the
  unquoted value is invalid JavaScript or merely changes matching semantics.

### 14. `vercel/next.js#16126` — scoped comparison lead for Promise.all early rejection

- PR created `2020-08-12T17:36:33Z`; discovery receipt:
  `raw/requests/42db08a3adce454ea1808373d745d7dbc1857e05a2138183a811aaf22fffee41.json`.
- Comment `471709976`, created `2020-08-17T18:52:27Z`, gives a concrete
  defense of `Promise.all`: any stylesheet error should immediately trigger a
  reload, so bailing on the first rejection is intentional. Path
  `packages/next/client/index.tsx`; original head
  `786aa4b63729c87c8240e4035a1ac55c29030157`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/a72eeb5e2752448444773d28c425ee2d95b95baa4c113d789dcef965610adb79.json`
  (body SHA-256 `a88fc45ce90938724395af7114a95ff49670952527d91247e42dc4b4ec1a0b01`).
- Uncertainty: comparison lead only; reconstruct the initiating review concern
  and ensure every rejected promise has the same reload consequence.

### 15. `vercel/next.js#20428` — route refocus breaks autofocus

- PR created `2020-12-23T16:34:51Z`; discovery receipt:
  `raw/requests/15ab4dd2677419a35fa4f5c5ff9d94789e8bb3b15da293ce211353d6d240f46d.json`.
- Comments `591966433` and `593807776` state that moving focus on route change
  breaks page `autoFocus`, followed by the author explicitly accepting that
  consequence and removing the focusing side from this PR. Path `router.ts`;
  original head `8adf039134681c2dfa89cd45ac466e5bbf3812fc`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/6bcc2bb82931b39dfe373de5a3e5414d558d4d4f3e72e3afab20171135b890b7.json`
  (body SHA-256 `9095f87944b86e7b3e67ea3d7030ce2424afd5011dacc21f749d12716de56d9c`).
- Uncertainty: both comments are from March 2021. Keep as a review-head lead,
  not strict in-window evidence, unless the evidence policy permits a
  post-window review on an in-window PR.

### 16. `nestjs/nest#383` — ValidationPipe options are coupled and caller input is mutated

- PR created `2018-01-29T14:09:07Z`; discovery receipt:
  `raw/requests/28dcffc93f8e7d92cd2c5a5a59c0cebe569b521af7ef80f3314ec2ac48731922.json`.
- Comment `165802324` reports that `||` coupling makes “strip but do not
  transform” impossible. Comment `165833857` separately objects to deleting a
  property from an options object not owned by the pipe and proposes
  destructuring. Both target `validation.pipe.ts`; original heads
  `ba00ce65a68190c093c183adf2f9f67948332a95` and
  `ff229b522f8812cbb362cbafc5d67ab2662e2238`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/f375b5cb1313c4e12ae77d92045da9cc8799df584e97b05128d6267fe5736d8a.json`
  (body SHA-256 `e11f8a3143f705bb75b06760e65959caaf82e63e645938a2d31c5f11d58940d5`).
- Uncertainty: likely two roots; verify option defaults, object aliasing, and
  public contract separately. Bodies updated in-window.

### 17. `nestjs/nest#2735` — Kafka client omits request/response send semantics

- PR created `2019-08-12T22:32:56Z`; discovery receipt:
  `raw/requests/9c740a1b93bbe4cfa26c14bb819b76643a9b53feefe557fbf510af72a20fe9b9.json`.
- Comment `313286491` asks why the client provides no `send` method for
  bidirectional communication. Response `313543405` gives the concrete
  mechanism: Kafka needs at least two topics and partition-aware routing, and
  the PR intentionally supports only asynchronous events. Path
  `client-kafka.ts`; original head
  `08e583d029cb837bc1dde4647f53a0299a07ff06`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/d49872fd11c59cd9657e27aa358ff84aa881ccad855ad89faab3b75a6e2382c1.json`
  (body SHA-256 `48a32b23f3a866218b43317d368d10563369fac872b1258887b3a666b0e3fc4e`).
- Uncertainty: likely a scope/API-capability comparison, not a correctness bug;
  retain only if the PR or linked issue promises Nest's `send` contract.

### 18. `nestjs/nest#5710` — scoped comparison lead for ClientProvider compatibility

- PR created `2020-11-17T17:07:05Z`; discovery receipt:
  `raw/requests/f3ca0f67958035a0e957f9f44933035ffac06982901e4981dac202cb4fc9f3de.json`.
- Comment `546630729` raises a breaking-change concern about
  `ClientProvider`; response `546825579` says it is a union of the old
  `ClientOptions` and the new custom-provider shape, so old inputs remain
  accepted. Path `clients-module.interface.ts`; both comments bind head
  `525ef913079e44f28d11de7bc60e323f3c05ac0a`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/context/requests/fa37767948524933b73e08d135244a970bdd62bea47e94d300d84bce0b9a9df3.json`
  (body SHA-256 `e5b39765544d0dae1bfa6279bd3aa05c1f1c6525a050a72251c9d74f29a55d13`).
- Uncertainty: comparison lead only. Source reconstruction must verify union
  assignability and runtime consumers; unchanged tests are not proof by
  themselves.

## Screening losses

- No inline review bodies at the public endpoint: VS Code #113315, #108120,
  #60640; Next.js #11293, #18921, #11949; NestJS #1568, #3558, #1901, #2062.
- Inline bodies present but no concrete correctness mechanism after review:
  VS Code #97272 (configuration shape, naming, whitespace), #95266 (mostly
  author notes and later 2022 follow-up), #32113 (naming/subclass structure),
  and Next.js #12843 (an unanswered question about CSS-per-chunk cardinality).
- These losses are screening outcomes only. They do not establish that the PR
  was correct, and general discussion counts cannot reverse them.

## Handoff

The strongest reconstruction starts are VS Code #98988; Next.js #7696,
#15231, #17749, #14848, and #9872; and NestJS #383. Next.js #16126 and NestJS
#5710 are useful narrow comparison leads. VS Code #106448, #113285, and Next.js
#20428 require archival treatment for after-window edits or reviews. No truth,
admission, duplicate-family, or partition decision is made here.
