import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createClaudeEngine } from "../src/engines/claude.js";
import { createCodexEngine } from "../src/engines/codex.js";
import type { PeregrineConfig, ReviewContext } from "../src/types.js";
import type { exec } from "../src/util/exec.js";
import { nonSensitiveEnvironment, providerEnvironment } from "../src/security/provider-env.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function context(): ReviewContext {
  return {
    repoPath: resolve("."),
    diffPath: resolve("eval/cases/seeded-null-deref/diff.patch"),
    diffText: "diff --git a/src/app.ts b/src/app.ts\n+unsafe\n",
    baseRef: "base-sha",
    headRef: "head-sha",
    config: config(),
  };
}

const finding = {
  file: "src/app.ts",
  startLine: 1,
  endLine: 1,
  severity: "high",
  disposition: "fix-in-pr",
  category: "authorization",
  invariant: "ownership-before-record-read",
  title: "Missing ownership check",
  explanation: "The changed lookup does not scope by owner.",
  failurePath: "Another user supplies the identifier and reads the record.",
  confidence: 0.95,
};

test("provider subprocess environments exclude unrelated credentials", () => {
  const previousGitHub = process.env.GITHUB_TOKEN;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.GITHUB_TOKEN = "github-secret";
  process.env.ANTHROPIC_API_KEY = "anthropic-secret";
  process.env.OPENAI_API_KEY = "openai-secret";
  try {
    const claude = providerEnvironment("claude");
    const codex = providerEnvironment("codex");
    const helper = nonSensitiveEnvironment();
    assert.equal(claude.GITHUB_TOKEN, undefined);
    assert.equal(claude.OPENAI_API_KEY, undefined);
    assert.equal(claude.ANTHROPIC_API_KEY, "anthropic-secret");
    assert.equal(codex.GITHUB_TOKEN, undefined);
    assert.equal(codex.ANTHROPIC_API_KEY, undefined);
    assert.equal(codex.OPENAI_API_KEY, "openai-secret");
    assert.equal(helper.GITHUB_TOKEN, undefined);
    assert.equal(helper.ANTHROPIC_API_KEY, undefined);
    assert.equal(helper.OPENAI_API_KEY, undefined);
  } finally {
    restoreEnv("GITHUB_TOKEN", previousGitHub);
    restoreEnv("ANTHROPIC_API_KEY", previousAnthropic);
    restoreEnv("OPENAI_API_KEY", previousOpenAI);
  }
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const breadth = {
  model: "breadth-model",
  candidates: [
    {
      id: "auth-1",
      file: "src/app.ts",
      line: 1,
      lane: "authorization",
      invariant: "Records remain scoped to the verified owner.",
      counterexample: "another owner",
      evidenceNeeded: "lookup predicate",
    },
  ],
  clear: [],
  escalations: [{ target: "auth-1", reason: "authorization boundary" }],
  coverage: { coveredFiles: ["src/app.ts"], unavailable: [] },
};

test("Claude runner performs isolated, measurable breadth and investigation stages", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const fake: typeof exec = async (cmd, args) => {
    calls.push({ command: cmd, args });
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
    return {
      stdout: JSON.stringify({
        structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { findings: [finding] },
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  const reviewed = await createClaudeEngine(fake).review(context());
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === "claude"));
  assert.ok(calls.every((call) => call.args.includes("--plugin-dir")));
  assert.ok(calls.every((call) => call.args.includes("--json-schema")));
  assert.ok(calls.every((call) => !call.args.includes("--agents")));
  assert.equal(calls[0]?.args[calls[0].args.indexOf("--model") + 1], context().config.runners.claude.breadthModel);
  assert.equal(calls[1]?.args[calls[1].args.indexOf("--model") + 1], context().config.runners.claude.investigationModel);
  const schema = JSON.parse(calls[0]!.args[calls[0]!.args.indexOf("--json-schema") + 1]!) as Record<string, unknown>;
  assert.equal(schema.$schema, undefined);
  assert.equal(reviewed.engine, "claude");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.reviewedHeadRef, "head-sha");
  assert.equal(reviewed.usage.inputTokens, 20);
  assert.equal(reviewed.usage.costUsd, 0.02);
});

test("Codex runner performs isolated breadth and investigation stages", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const fake: typeof exec = async (_cmd, args, options) => {
    calls.push({ args, stdin: options?.stdin });
    const outputIndex = args.indexOf("--output-last-message");
    const schemaIndex = args.indexOf("--output-schema");
    const output = args[outputIndex + 1]!;
    const schema = args[schemaIndex + 1]!;
    writeFileSync(
      output,
      schema.endsWith("breadth-result.schema.json")
        ? JSON.stringify({
            ...breadth,
            model: "gpt-5.6-luna",
          })
        : JSON.stringify({ findings: [finding] }),
    );
    return {
      stdout: `${JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 },
      })}\n`,
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  const reviewed = await createCodexEngine(fake).review(context());
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.args.includes("read-only")));
  assert.ok(calls.every((call) => call.args.includes("--ignore-user-config")));
  assert.match(calls[1]?.stdin ?? "", /breadth pass produced the ledger/);
  assert.equal(reviewed.engine, "codex");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.usage.inputTokens, 22);
  assert.equal(reviewed.usage.cachedInputTokens, 4);
});

test("provider process failures are surfaced instead of becoming clean reviews", async () => {
  const fake: typeof exec = async () => ({
    stdout: "",
    stderr: "authentication failed",
    code: 1,
    timedOut: false,
  });
  await assert.rejects(() => createClaudeEngine(fake).review(context()), /authentication failed/);
  await assert.rejects(() => createCodexEngine(fake).review(context()), /authentication failed/);
});

test("provider failures never echo credential-like diagnostics", async () => {
  const secret = "token=abc123456789SECRET";
  const fake: typeof exec = async () => ({
    stdout: "",
    stderr: secret,
    code: 1,
    timedOut: false,
  });
  await assert.rejects(
    () => createCodexEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /abc123456789SECRET/);
      assert.match(error.message, /diagnostic omitted/);
      return true;
    },
  );
});

test("Claude provider JSON errors expose their actionable message", async () => {
  const fake: typeof exec = async () => ({
    stdout: JSON.stringify({ is_error: true, result: "unknown model: configured-model" }),
    stderr: "",
    code: 1,
    timedOut: false,
  });
  await assert.rejects(
    () => createClaudeEngine(fake).review(context()),
    /unknown model: configured-model/,
  );
});
