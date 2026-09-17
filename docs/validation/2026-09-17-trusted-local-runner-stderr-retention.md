# Trusted local runner stderr retention

Date: 2026-09-17. Status: implementation verified; no replacement provider run authorized.

The first authorized trusted-local diagnostic ended before observable model inference: both attempts exited with code 1 in 47 ms and 24 ms, produced empty JSONL, and reported no usage or findings. Those original artifacts are preserved unchanged in the private evidence repository. They support no efficacy claim.

The run exposed one concrete observability defect: the runner captured subprocess stderr in memory but did not persist it. The correction writes bounded stderr to `stderr.txt` for every attempt and records its SHA-256 in `terminal.json`. It does not change prompts, models, access, deadlines, A/B ordering, or retry behavior.

Verification under Node 22:

- `npm run typecheck`
- `node --import tsx --test tests/eval-trusted-local-review-runner.test.ts` — 7/7 passed
- Independent fresh `gpt-6-astra` medium gate: PASS; no blockers

Any replacement diagnostic requires a new attempt root and separate authorization.
