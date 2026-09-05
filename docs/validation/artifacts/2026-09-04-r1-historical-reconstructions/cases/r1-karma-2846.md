# r1-karma-2846: manual file type ignored for scripts

Status: primary static curation complete; independent secondary curation pending
Class: JavaScript, review-caught defect
License: MIT

## Review opportunity

- PR: [karma-runner/karma#2846](https://github.com/karma-runner/karma/pull/2846),
  created 2017-10-20T01:57:47Z and merged 2017-11-21T16:46:28Z.
- Review base `e79463b94ff6d3ad87526b3c68b38b90e924ea42`, tree
  `8c42372cca4b0be9f0d2f75833a3abfba7fe904a`.
- Defect-bearing reviewed head
  `eab78ff696f3de8ae226f930e08b93d20ffbdb66`, tree
  `72fcd0063020977f14c2c15bdd8d9233e78c4a28`.
- Exact diff: five files, 40 additions, 16 deletions; binary diff SHA-256
  `7a23b80d43201932ab7a95c876ee99f205c295ea43ffb79acf5d932a46044dfb`.

Author and reviewer accounts are GitHub `User` accounts with no observed bot
indicator.

## Frozen root

The PR introduces a manual `type` that is carried from configuration into each
file and used for extensionless CSS and HTML. The script-tag path, however,
still derives MIME type only from `path.extname(filePath)`. Extensionless JS,
Dart, or module resources therefore fall back to `text/javascript`, and an
explicit type cannot override an existing extension. The new manual-type
contract is applied to two branches but omitted from the third.

## Static trace and historical correction

1. `Pattern.type` flows through `file-list.js` into `File.type`.
2. `middleware/karma.js` reads `file.type` and honors it only in the CSS and
   HTML branches.
3. It computes script type as `SCRIPT_TYPE[fileExt] || 'text/javascript'`, so
   the new value is absent at the relevant decision point.
4. Reviewer `appsforartists` identifies the missing override in
   [discussion r147017055](https://github.com/karma-runner/karma/pull/2846#discussion_r147017055)
   on 2017-10-25. A separate changes-requested review also asks for a script
   type and validation.
5. Later commits make the type override extension detection, normalize the
   script lookup, add `module`, validate allowed values, and add tests.

This is a complete static trace with contemporaneous review and accepted
correction. No historical Node environment was executed.

## Scope and limitations

The root is incomplete propagation of the manual type into script-tag
selection. The original PR description emphasizes an extensionless CSS example,
so severity and intended script scope must be reconfirmed during secondary
curation; the reviewer and final implementation provide strong scope evidence.
No global-clean assertion is made.
