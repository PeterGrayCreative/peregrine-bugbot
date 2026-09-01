# Security

PR titles, bodies, diffs, repository files, existing comments, and model output are untrusted.

Controls:

- Fork PRs do not enter the privileged provider workflow.
- The model receives read-only repository tooling and never runs target code.
- Target and tool checkouts are separate, and temporary artifacts stay outside both.
- Only the selected provider secret enters the analysis step.
- Model subprocess environments remove unrelated variables whose names indicate tokens, keys, passwords, credentials, or connection strings; only the selected provider's authentication variable is retained.
- Analysis has no pull-request write permission.
- Posting has no provider secret and reparses the result artifact.
- Breadth and investigation outputs are checked for common token, private-key, and credential-assignment patterns before they are retained. Posting repeats this check immediately before any GitHub call.
- Raw telemetry is size-bounded; full provider envelopes are not persisted.
- The current PR head must match both the trigger head and reviewed head before posting.
- Finding paths must be safe repository-relative Git paths.
- Inline comments must map to context/addition lines in the supplied diff; a GitHub `422` triggers one body-only fallback.
- Mention review is limited to owner/member/collaborator commenters.
- Re-push concurrency cancels superseded automatic runs.

Peregrine posts advisory `COMMENT` reviews. It does not approve, request changes, merge, edit code, execute migrations, or create tickets.
