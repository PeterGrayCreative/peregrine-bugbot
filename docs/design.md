# Design notes

## Why two tiers

Review cost is dominated by deep, agentic investigation. Most of a diff never
needs it. A cheap breadth pass (Haiku-class, diff-only, ~$0.01–0.03/PR)
nominates candidates; a strong model (Sonnet/Opus-class) investigates only the
top `maxEscalations` with repo access. Expected all-in: ~$0.10–0.50 per PR.

## Why an engine interface instead of "the Claude bot"

Model rankings churn every quarter. The `Engine` contract
(`ReviewContext → EngineResult`) makes the model/vendor a config value, and —
more importantly — makes them *benchmarkable against each other* with the same
eval harness, since every engine reports findings and cost the same way.

## Precision over recall

There is no bot today, so any valid finding is a win — but only if the noise
stays near zero, because noisy bots get muted and then find nothing at all.
Hence: confidence threshold before posting, per-PR comment cap, fingerprint
dedupe across pushes, and the failure-path rule (an engine must state the
input/state that triggers the bug, or drop the finding).

## Rollout phases

1. **Shadow** — own repo, no `--post`; findings in job summary. Tune here.
2. **Active, own PRs** — `--post` on; watch precision and cost per PR.
3. **Opt-in org** — repos call the reusable workflow; one bot workspace/key.
4. **GitHub App** — only if/when central config, telemetry, and no-CI-minutes
   matter. Nothing in the engine or eval layers changes.

## Threat model (short version)

PR diffs and comments are attacker-controlled input to an LLM. Mitigations:
read-only tool allowlist in the review session, no execution of PR code,
member-gated mention trigger, no secrets beyond the API key in the job, no
write permissions on fork PRs. Findings are advisory comments — the bot never
approves, merges, or changes code.

## Choosing models with the eval harness

Run the matrix (configs × cases × 3 repeats), grade with the blind judge,
then read `benchmark.html`: recall vs cost/case with FP/case alongside.
Decision rule: cheapest config whose recall is within noise of the best,
subject to FP/case ≤ ~0.5. Re-run the same matrix when a new model ships or
the skill changes — cases and grading stay fixed, so results are comparable
over time.
