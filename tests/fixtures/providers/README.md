# Provider telemetry fixtures

These fixtures are sanitized, synthetic contract samples derived from the
provider shapes already exercised by Peregrine's adapter tests. They contain no
prompts, repository contents, credentials, or raw tool output beyond the short
UTF-8 byte-count sentinel.

They are not evidence that a particular CLI version emits incremental or
cumulative multi-turn token totals. Until a real capture with recorded CLI
version and capture date establishes that behavior, Peregrine accepts one
Codex usage snapshot and marks multiple snapshots ambiguous instead of summing
them. A future captured fixture must record the CLI version, capture date,
redactions, and independent charge reconciliation here before changing that
rule.
