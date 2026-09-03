# Behavioral benchmark audit boundary

Corpus admission and result adjudication are separate trust decisions.

`npm run eval:validate-corpus` authenticates curator inputs without a provider:
strict truth, curation metadata, independent confirmations, proof and diff
digests, source uniqueness, leakage, reproducible history, line ranges, strata,
visible-corpus quotas, and the external holdout commitment. It does not decide
whether a model finding matches a root cause and does not execute curator proof
or repository code.

Semantic match decisions belong to the separately contained judge ledger. An
unmatched behavioral finding remains `unresolved` until a run-bound,
append-only curator adjudication ledger exists. Neither grading output nor this
corpus metadata may rewrite that disposition. Structural smoke uses exact
marker grading only and does not count toward behavioral quality claims.

The holdout steward must remain outside prompt tuning. The repository may hold
only the unopened commitment metadata. Opening the external holdout retires it
from holdout status and requires a new commitment for the next experiment cycle.
