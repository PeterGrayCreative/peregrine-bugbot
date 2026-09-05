# r1-karma-2846 v2: refresh-loaded local script type ignored

Status: corrected evidence awaiting two fresh independent confirmations  
Class: JavaScript, review-caught defect  
License: MIT

## Review opportunity

- PR: [karma-runner/karma#2846](https://github.com/karma-runner/karma/pull/2846), created 2017-10-20 and merged 2017-11-21.
- Review base: `e79463b94ff6d3ad87526b3c68b38b90e924ea42`, tree `8c42372cca4b0be9f0d2f75833a3abfba7fe904a`.
- Defect-bearing reviewed head: `eab78ff696f3de8ae226f930e08b93d20ffbdb66`, tree `72fcd0063020977f14c2c15bdd8d9233e78c4a28`.
- Base-to-head binary diff: 5 files, 40 additions, 16 deletions; SHA-256 `7a23b80d43201932ab7a95c876ee99f205c295ea43ffb79acf5d932a46044dfb`.

Author and reviewer accounts are GitHub `User` accounts with no observed bot indication.

## Frozen root and static trace

For ordinary local files discovered by `List._refresh`, the PR carries `Pattern.type` into `File.type`. The middleware honors that value for CSS and HTML, but script selection still uses only `path.extname(filePath)` and defaults to `text/javascript`. A refresh-loaded extensionless local JS, Dart, or module resource therefore cannot select its configured script type, and an explicit type cannot override an existing extension. Reviewer `appsforartists` identified the missing script-selection override in [discussion r147017055](https://github.com/karma-runner/karma/pull/2846#discussion_r147017055). Later commits make the configured type override extension detection and add supported script types and validation.

This is a complete static trace with a contemporaneous review correction. R1 did not execute the historical Node environment.

## Adjacent seams and corrected limitations

- The PR body is motivated by `https://fonts.googleapis.com/icon?family=Material+Icons`, an absolute URL. At this head, the absolute-URL branch constructs `new Url(pattern)` without forwarding `Pattern.type`. That separate earlier type-loss seam means the motivating example does not reach the frozen local-file script-selection root.
- `List.addFile` constructs `new File(path)` for watcher-added files, also dropping the matching pattern's configured type. This is another separate seam.
- The defect-bearing tests cover extensionless CSS and HTML. Later commits repair script selection, validation, and supported values, but the reviewed middleware test file does not add an explicit script-type regression assertion. V1's contrary test claim was unsupported.

The frozen root is therefore limited to ordinary refresh-loaded local files whose type reaches `File.type` and is then ignored by script-tag selection. No credit is claimed for the absolute-URL or watcher paths, and no global truth-complete claim is made. Admission requires two fresh v2 confirmations.
