# r1-karma-2714: reviewed retry callback comparison

Status: primary static analysis complete; independent curator confirmations pending
Class: JavaScript, reviewed comparison
License: MIT

## Review opportunity

- PR: [karma-runner/karma#2714](https://github.com/karma-runner/karma/pull/2714),
  created 2017-05-17T09:31:02Z and merged 2017-06-26T18:40:21Z.
- Review base `2a847c250bb62134d87f5230d97be8483d4a13cf`.
- Review-base tree `cdc374713370669a20fdbc475096c9bc81a54343`.
- Reviewed head `2789bf57abd977def5caf22609eef74acbad292e`,
  tree `4a556b9586f02fc900c472b652919b7fb420847b`.
- Exact diff: two files, 62 additions, four deletions; binary diff SHA-256
  `de5febb6c4011f73a8e192795601b8a27e97ba017d57a3699425a2eb9325ab6f`.

## Declared comparison scope

The tempting review claim is that the final `return fs.readFile(...)` should
call the local callback directly. Within the declared retry-callback scope, the
claim is not supported:

1. `handleFile(err, buffer)` is the callback passed to `fs.readFile`.
2. The initial read and every retry must ask the filesystem for a fresh buffer;
   calling `handleFile` directly has neither a new error result nor buffer.
3. The retry branch already calls `fs.readFile(file.originalPath, handleFile)`.
4. Reviewer `dignifiedquire` raised the concern in
   [discussion r118850978](https://github.com/karma-runner/karma/pull/2714#discussion_r118850978).
5. The author explained the callback relationship and renamed `handleFile` to
   `readFileCallback` in `92a8c81fbed0cae423fbd84d3e64bc4086fd30af`;
   the control flow did not change.

This is a plausible protected pattern: repeated asynchronous filesystem calls
are intentional, while direct recursion would not perform the retry.

## Truth boundary and limitations

Label only as “reviewed comparison case; no confirmed defect in the retry
callback-selection scope.” The PR contains other debatable behavior, including
throwing from an asynchronous callback and a weak terminal-retry test. Those
surfaces are outside this comparison label and prevent any global clean claim.
Two independent accountable confirmations remain an admission blocker; the
analysis author is not a formal confirmation.
