# R2 beta review-thread screening supplement

Status: candidate screening only; no case is admitted and no partition is assigned.

## Method and evidence boundary

I screened 35 additional PR leads from the already-stored VS Code, Next.js,
and NestJS discovery frames. I issued no new search query. For each lead I
captured only the public core endpoint `pulls/{number}/comments` through
`scripts/evidence/public-capture-store.mjs`; immutable receipts and response
bodies are preserved under
`/private/tmp/peregrine-r2-beta-sources/supplement/{requests,objects}`. The
seven retained leads are disjoint from `random-sample-v1.json`,
`main-review-candidates-v1.json`, and the 18 entries in
`screening/beta-review-threads.md`.

Search comment counts were discovery signals only. Each retained entry below
binds an actual inline comment ID, path, date, and `original_commit_id`, and
states a concrete mechanism to investigate. GitHub reports every cited PR and
comment author as type `User`, not `Bot`; this does not prove human-only
authorship. Current GET responses are not edit histories. All cited comments
have `updated_at > created_at`, although each update remains within 2017–2020,
so strict historical use still requires treating the currently returned body
as potentially edited.

## Shortlist

### 1. `microsoft/vscode#35956` — standalone Monaco can lack the clipboard service

- PR “Add support for macOS globalFindClipboard #11233 #28896”, created
  `2017-10-10T05:51:08Z`; cached discovery receipt
  `raw/requests/b783a790dc1a7cee4de5f3e771e034a3475d94d15063decd714e63202006fc1d.json`.
- Reviewer `alexdima` (API type `User`) says comment `146625470`, created
  `2017-10-24T16:57:23Z`, that `IClipboardService` must be optional because the
  standalone Monaco editor may not provide it, and the code must handle a
  null/undefined service. A second comment, `146626509`, identifies an
  asymmetric state path: the controller always reads the global find
  clipboard but writes it only from `StartSearchAction`, not on every
  `findState` change.
- Paths are `src/vs/editor/contrib/find/browser/find.ts` and
  `src/vs/editor/contrib/find/common/findController.ts`; both comments bind
  original review head `2f267eec51c98475dffb8edcbfd3b7735b079527`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/6faabbd5ee4f57b391956fd2775783a6d1ebed90b0534f731fec3d14f2074761.json`
  (body SHA-256 `13e918a0eca9ae225b4aca96bde162bc360706a805dbabcd379ec13fcef8afd3`).
- Uncertainty: reconstruct standalone instantiation and the smallest of the
  two possible roots; both bodies were updated `2017-11-23`.

### 2. `vercel/next.js#7363` — MIME case changes whether an API body is parsed as JSON

- PR “API interface extensions”, created `2019-05-16T15:44:48Z`; cached
  discovery receipt
  `raw/requests/e171a4c4457a081c66a1d2f40571032f6477e73cb36d43659f7dcd7e3a51d490.json`.
- Reviewer `Janpot` (API type `User`) says in comment `288068219`, created
  `2019-05-28T12:05:29Z`, that MIME types are case-insensitive but the proposed
  string check is not. Thus a valid spelling such as `Application/JSON` can
  bypass the JSON branch unless the type is trimmed/lowercased or parsed.
- Path `packages/next-server/server/api-utils.ts`; original review head
  `92399dbaed48f738dbf3c7f97484ca116edee250`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/0008b708423b51ab246a9d5a4c3ec8662adbf28e92f6d3923a1ba864c16bfd4c.json`
  (body SHA-256 `c3d8265fae294d88ebc740f16ab788e73f4f0b3b515c3d8636a6df394194d1c7`).
- Uncertainty: verify the exact pre-fix conditional and observable request-body
  shape; body updated `2019-06-05`.

### 3. `nestjs/nest#814` — dependency-error formatting assumes every token has a name

- PR “feature(@nestjs/core) display known dependency names in unknown
  dependency exception”, created `2018-06-26T08:03:29Z`; cached discovery
  receipt
  `raw/requests/28dcffc93f8e7d92cd2c5a5a59c0cebe569b521af7ef80f3314ec2ac48731922.json`.
- Author comment `200149278` identifies that `arg.name` may not exist and needs
  a fallback. Reviewer `kamilmysliwiec` (API type `User`) confirms in comment
  `200173347`, created `2018-07-04T16:43:25Z`, that `@Inject()` produces odd
  messages and an unspecified type is rendered as `Object`, and asks for both
  scenarios to be tested.
- Path `packages/core/errors/messages.ts`; both comments bind original review
  head `8057a5cf19173646ec21bec88d994713b394859d`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/156385458ce7a9e2c18400057eff3337e9dd5eb1c73d29c5e2c05cb037159705.json`
  (body SHA-256 `1cf1e5e9b2a4d9b8cacbe548913fbf5fd581a8cb38074316ff3e17d507f4af33`).
- Uncertainty: reconstruct the decorator/token representations and distinguish
  misleading output from a thrown formatting failure; bodies updated
  `2018-07-16`.

### 4. `vercel/next.js#9157` — custom rewrites lose dynamic values during hydration

- PR “Implement custom routes RFC”, created `2019-10-21T21:59:21Z`; cached
  discovery receipt
  `raw/requests/908e2c89736e93077bcf9f6a57db1f5ca612a1681bee17b171c6f8a48a3d7577.json`.
- Reviewer `ijjk` (API type `User`) says in comment `344420746`, created
  `2019-11-09T01:21:39Z`, that hydration of an auto-exported dynamic page
  parses values from the visible URL, but a rewrite such as `/hello` to
  `/blog/[slug]` leaves no slug-shaped segment to parse.
- Path `packages/next/next-server/lib/router/router.ts`; original review head
  `3fee8e2af100e1798dd1a20196ce9fc16c91c2e1`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/e50e9bff1e8c82bd1472f042120db07bdadefe54d57404f8a9e964428df24e1c.json`
  (body SHA-256 `3dba1b8c81773df25ac3e4edc5bfee752fde5debc9b02d3c5d393d1bbba67d06`).
- Uncertainty: the comment explicitly says behavior still needed a design
  decision; reconstruct the hydration input and eventual repair rather than
  assuming the desired representation. Body updated `2019-11-09`.

### 5. `vercel/next.js#8646` — duplicate-page warning is scheduled before dev pages exist

- PR “Warn build on duplicate pages”, created `2019-09-06T02:00:51Z`; cached
  discovery receipt
  `raw/requests/908e2c89736e93077bcf9f6a57db1f5ca612a1681bee17b171c6f8a48a3d7577.json`.
- Reviewer `ijjk` (API type `User`) reports in comment `321573043`, created
  `2019-09-06T04:37:42Z`, that a newly added test showed the warning never
  fires in development: the collection at this point contains only `_app` and
  `_document`; ordinary pages are added later by `on-demand-entry-handler`.
  Comment `321686838` agrees the check must be covered at that later seam.
- Path `packages/next/server/hot-reloader.js`; both comments bind original
  review head `7fd1d80cba3125f35822cd812cec251312258258`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/9790fc7a8efd9671641c6bb6d3661ceee1a2d3f280c15bb3704b931a11d905bd.json`
  (body SHA-256 `d7858e06eae170f794ecc1cd727a595307f9cb463ab9fbd61ee1a25d087a8faa`).
- Uncertainty: reconstruct the development entry lifecycle and test fixture;
  bodies updated `2019-09-11`.

### 6. `vercel/next.js#10018` — two telemetry paths can relay the same measurement

- PR “Fix missing quotes around `in` operator check for PerformanceObserver”,
  created `2020-01-09T19:48:56Z`; cached discovery receipt
  `raw/requests/2c81eedc918581f9eb0c06795fbb6424acb69c710c2e8bcafa8c5940a1511d29.json`.
- Reviewer `prateekbh` (API type `User`) says in comment `365388378`, created
  `2020-01-10T19:13:20Z`, that removing the `else` allows both the
  `PerformanceObserver` path and the window `load` listener to relay the same
  measurement. The load listener is intended only as the fallback when
  `PerformanceObserver` is unavailable.
- Path `packages/next/client/index.js`; original review head
  `19e04a997032d6491ddee5761869a8498a4a1914`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/6d37a5234852bf74237edc96bb898677b2576f5aa1ecc359d8a7c549984c2c02.json`
  (body SHA-256 `9765304f7978c88319a7f729adf67aa7634a63e660c3bdc2e852d5b42442b63b`).
- Uncertainty: verify event ordering and the relay sink at this review head;
  body updated `2020-01-10`.

### 7. `vercel/next.js#10525` — falsy fallback conflates a missing env value with an intentional empty value

- PR “Add initial support for new env handling”, created
  `2020-02-13T22:04:51Z`; cached discovery receipt
  `raw/requests/8a8245e82ce2a86f820474e7943719e283b10658eb497ab3019d006d7ae6050b.json`.
- Reviewer `Timer` (API type `User`) says in comment `383364182`, created
  `2020-02-24T16:17:20Z`, that missing (`undefined`) and explicitly empty
  (`''`) environment values must remain distinct; a falsy fallback overwrites
  a value the user intentionally set empty.
- Path `packages/next/next-server/server/utils.ts`; original review head
  `25cf95c2eb35fdddfec5fd5f03474f3eaf01e59b`.
- Evidence receipt:
  `/private/tmp/peregrine-r2-beta-sources/supplement/requests/9abeed6abeedd26e0ad036c13019c7a2776c5c6ad0b647fc5f282f58a2cecae6.json`
  (body SHA-256 `091b8e51d34e2893b29bd0e215ddbc2b8532ae49d1b78809d16595193b8aa45c`).
- Uncertainty: reconstruct the precedence chain and externally visible env
  output; body updated `2020-03-26`.

## Screened but not retained

The cap was not filled with weaker threads. These 28 IDs remain preserved as
screening losses rather than silently disappearing:

- No inline review comments returned: `microsoft/vscode#52119`, `#107705`,
  `#43152`, `#94825`; `vercel/next.js#8848`, `#15491`, `#15672`;
  `nestjs/nest#1594`, `#1142`.
- Review evidence falls after the 2017–2020 window or has after-window edit
  uncertainty too central for this pass: `vercel/next.js#19052`, `#20598`,
  `#17606`.
- Comments were primarily architecture, style, naming, test organization, or
  unresolved product/design discussion rather than a sufficiently bounded
  correctness mechanism: `microsoft/vscode#66418`, `#51621`;
  `vercel/next.js#10133`, `#7125`, `#10127`, `#8968`, `#10077`, `#10857`;
  `nestjs/nest#2406`, `#4842`, `#5477`, `#5278`.
- Concrete but below this supplement's substantive-reconstruction bar or less
  complete than the seven retained leads: `microsoft/vscode#21416` (an
  `urf-32`/`utf-32` typo); `vercel/next.js#16539` (asset-prefix follow-up),
  `#14279` (webpack error presentation), and `#7263` (Windows fixture path and
  symlink behavior).

## Screening conclusion

The supplement contributes seven additional concrete review-head leads: one
VS Code, five Next.js, and one NestJS. They are suitable for later source/diff
reconstruction, not admission. The dominant remaining uncertainties are
historical body-edit provenance, exact pre-fix reachability, observable
consequence, and the smallest repair boundary.
