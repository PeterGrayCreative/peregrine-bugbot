# Stage 2 Checkpoint 2 experiment archive

This directory is the versioned, review-safe archive for the full visible
Checkpoint 2 experiment run `2026-09-04T10-24-44-905Z`.

It retains every scheduled experiment result:

- all 216 terminal control and treatment attempts, including the preserved
  timeout, full structured findings, stage telemetry, and provenance;
- all 197 contained semantic-judge decisions;
- experiment, judge, grading, and terminal seals;
- the immutable matrix and experiment manifests;
- machine-readable and rendered benchmark reports;
- complete paired efficiency analysis and uncertainty calculations; and
- finding-by-finding independent adjudication of every unmatched result.

`attempt-results.json` consolidates the per-attempt and graded result files so
the repository does not need 432 small duplicate files. `judge-results.json`
does the same for judge decisions. These files preserve the complete safe
structured outputs, not samples or aggregates.

Raw provider session material and verbose prompt/output envelopes are excluded
because they may contain credentials, provider-local metadata, or large copies
of inputs already represented by content hashes. Their terminal outcomes,
sanitized diagnostics, findings, usage, timing, tool telemetry, and source
artifact hashes are retained. `archive-manifest.json` records this policy and
SHA-256 hashes every archived artifact.

The experiment is immutable. Later adjudication found defects omitted from
several cases' ground truth; those discoveries are recorded in
`independent-adjudication.md` without rewriting the frozen run or its original
grading output.
