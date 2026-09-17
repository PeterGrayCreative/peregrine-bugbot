# Trusted local A/B runner registration

Date: 2026-09-16. Status: implementation-only; no Codex or provider run is authorized or recorded here.

This successor replaces the stopped private-canary path for the first useful infrastructure check: one diagnostic comparison of the existing methodology prompts on one curator-approved, trusted PR checkout.

## Frozen comparison

- Arm A: existing competent minimal single-reviewer prompt.
- Arm B: existing Peregrine single-reviewer prompt and curator-selected activated lanes.
- Requested route for both arms: `gpt-5.6-sol`, reasoning effort `high`.
- Both arms receive the same checkout, raw scope, output schema, read-only Codex sandbox, disabled web search, disabled delegation, 20-minute wall deadline, and CLI configuration. Only the prompt differs.
- Each attempt uses a fresh temporary `CODEX_HOME` containing only a copied login `auth.json`; ambient API-key authentication is removed. The temporary home is deleted after the attempt.

The runner records an exclusive directory per arm containing the exact prompt, nonsecret CLI argv, bounded raw or partial JSONL, normalized CLI usage when exposed (`null` otherwise), parsed findings when valid, and terminal status with elapsed wall time and hashes. It does not enforce a token budget.

## Operator input

Run only after a curator supplies a trusted materialized checkout and a config file with exactly:

```json
{
  "caseId": "case-example",
  "checkoutDirectory": "/durable/trusted-case/review-head",
  "authFile": "/isolated/login/auth.json",
  "attemptRoot": "/durable/evidence/diagnostic-pair-1",
  "scope": {
    "baseRef": "<git object id>",
    "headRef": "<git object id>",
    "diff": "<authoritative diff>",
    "taskSpecification": "<contemporaneous task specification>",
    "rawChangedPaths": ["src/example.ts"]
  },
  "activatedLanes": ["logic-correctness"]
}
```

The future operator command is:

```sh
node --import tsx scripts/evidence/run-trusted-local-review.ts --config /absolute/path/to/config.json
```

## Claim boundary

The diagnostic can show that the A/B prompts can execute under the same observable CLI contract and retain usable evidence. Requested model and effort are configuration facts, not provider-served identity proof. CLI usage may be absent. Dollar cost, provider request count, hidden context, and complete model-visible inputs remain unavailable. A successful pair does not establish that Peregrine improves bug finding; that requires the registered historical comparison and blinded adjudication.
