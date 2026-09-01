# Breadth Worker Packet

Use this packet when delegating the comment-blind candidate sweep to a fast, low-cost model.

## Model routing

Choose the host's fastest low-cost model that can read code and use the required read-only tools. On Claude Code or Cowork, delegate to a subagent on the fast tier (e.g., Haiku or Sonnet). On Codex or another orchestrator, use the configured fast tier when model selection is exposed (for example, Terra or Luna where those aliases exist). Do not fail or invent a model identifier when none is available; fall back to the current model and preserve the two-pass workflow.

The worker discovers candidates only. The strong investigator owns verification, severity, disposition, consolidation, and review wording.

Model tier changes price and latency, not raw token volume. Keep one worker by default and use this narrow packet to produce the token savings. Add parallel workers only for genuinely independent invariant families; never split by file.

## Context packet

Send only:

- one-paragraph PR and ticket scope contract;
- base, head, and merge-base SHAs;
- assigned invariant lanes;
- changed-file manifest and relevant diff hunks;
- immediate schemas, helper signatures, or contract excerpts needed to understand those hunks;
- explicit exclusions and the output schema below.

Do not send:

- existing review-comment bodies or author replies;
- previous candidate ledgers or expected defects;
- full repository history or unrelated files;
- full test logs;
- the complete review matrix or finding contract.

Allow read-only searches for immediate callers, sibling surfaces, and configuration consumers when a hunk activates them.

## Worker task

1. Cover every assigned changed file and relevant immediate boundary.
2. Look for the smallest concrete counterexample at each assumption seam.
3. Merge repeated symptoms under one candidate ID when they share an invariant.
4. Mark a file `CLEAR` only with a specific reason.
5. Emit `ESCALATE` for any candidate or apparently clear boundary involving authorization, tenant isolation, secrets, schema or migration, data loss, lifecycle, races, runtime/bootstrap/deployment, or a published contract.
6. Stop after discovery. Do not investigate deeply or draft review comments.

## Output schema

Interactive hosts without a JSON schema may return compact lines:

```text
MODEL | <actual model if exposed, otherwise unavailable>
CANDIDATE | <id> | <lane> | <file:line> | <invariant> | <counterexample> | <evidence still needed>
CLEAR | <lane> | <file> | <specific reason>
ESCALATE | <candidate id or boundary> | <why strong-model review is mandatory>
COVERAGE | <files covered> | <files or context unavailable>
```

Automated runners supply `breadth-result.schema.json`. Map the same contract exactly:

- `model`: actual model, or `unavailable` when the host does not expose it;
- `candidates[]`: `id`, `lane`, `file`, `line`, `invariant`, `counterexample`, and `evidenceNeeded`;
- `clear[]`: `lane`, `file`, and a specific `reason`;
- `escalations[]`: candidate ID or boundary in `target`, plus `reason`;
- `coverage.coveredFiles[]` and `coverage.unavailable[]`.

Candidate IDs must remain stable within the run so the investigator can cross-reference and consolidate them. Every changed file must appear in a candidate, a clear conclusion, or `coverage.unavailable`; never omit unread context silently.

Do not include severity, disposition, prose summaries, fix plans, test commands, or GitHub-ready comments.
