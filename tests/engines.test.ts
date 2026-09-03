import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createClaudeEngine } from "../src/engines/claude.js";
import { createCodexEngine } from "../src/engines/codex.js";
import { RunFailureError } from "../src/core/run-failure.js";
import type { PeregrineConfig, ReviewContext } from "../src/types.js";
import type { exec } from "../src/util/exec.js";
import { nonSensitiveEnvironment, providerEnvironment } from "../src/security/provider-env.js";
import { sha256 } from "../src/core/telemetry.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function context(): ReviewContext {
  return {
    repoPath: resolve("."),
    diffPath: resolve("eval/cases/structural-smoke/case-00000004/diff.patch"),
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
  const validatedStages: string[] = [];
  const fake: typeof exec = async (cmd, args) => {
    calls.push({ command: cmd, args });
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
    return {
      stdout: JSON.stringify({
        structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { findings: [finding] },
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 20,
        },
      }),
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  const ctx = context();
  ctx.evaluationIsolation = {
    providerHome: "/tmp/peregrine-test-provider-home",
    providerAssetsRoot: resolve("."),
    validatePrompt({ stage }) { validatedStages.push(stage); },
  };
  const reviewed = await createClaudeEngine(fake).review(ctx);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.command === "claude"));
  assert.ok(calls.every((call) => call.args.includes("--plugin-dir")));
  assert.ok(calls.every((call) => call.args.includes("--json-schema")));
  assert.ok(calls.every((call) => !call.args.includes("--agents")));
  assert.ok(calls.every((call) => call.args.includes("--bare")));
  assert.ok(calls.every((call) => call.args.includes("--disable-slash-commands")));
  assert.ok(calls.every((call) => call.args.includes("--strict-mcp-config")));
  assert.ok(calls.every((call) => call.args.includes("--no-chrome")));
  assert.ok(calls.every((call) => call.args[call.args.indexOf("--setting-sources") + 1] === ""));
  assert.equal(calls[0]?.args[calls[0].args.indexOf("--model") + 1], context().config.runners.claude.breadthModel);
  assert.equal(calls[1]?.args[calls[1].args.indexOf("--model") + 1], context().config.runners.claude.investigationModel);
  assert.match(calls[0]?.args[calls[0].args.indexOf("-p") + 1] ?? "", /^PEREGRINE_ROLE: breadth-worker/);
  assert.match(calls[1]?.args[calls[1].args.indexOf("-p") + 1] ?? "", /^PEREGRINE_ROLE: investigation-worker/);
  const schema = JSON.parse(calls[0]!.args[calls[0]!.args.indexOf("--json-schema") + 1]!) as Record<string, unknown>;
  assert.equal(schema.$schema, undefined);
  assert.equal(reviewed.engine, "claude");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.reviewedHeadRef, "head-sha");
  assert.equal(reviewed.usage.inputTokens, 20);
  assert.equal(reviewed.usage.baseInputTokens, 20);
  assert.equal(reviewed.usage.cacheWriteInputTokens, 0);
  assert.equal(reviewed.usage.cacheReadInputTokens, 0);
  assert.equal(reviewed.usage.costUsd, 0.02);
  assert.equal(reviewed.usage.costSource, "provider");
  const raw = reviewed.raw as { breadth: { model: string; promptSha256: string } };
  const breadthPrompt = calls[0]?.args[calls[0].args.indexOf("-p") + 1] ?? "";
  assert.equal(raw.breadth.model, context().config.runners.claude.breadthModel);
  assert.equal(raw.breadth.promptSha256, sha256(breadthPrompt));
  assert.deepEqual(validatedStages, ["breadth", "investigation"]);
});

test("Codex runner performs isolated breadth and investigation stages", async () => {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const validatedStages: string[] = [];
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
  const ctx = context();
  ctx.evaluationIsolation = {
    providerHome: "/tmp/peregrine-test-provider-home",
    providerAssetsRoot: resolve("."),
    validatePrompt({ stage }) { validatedStages.push(stage); },
  };
  const reviewed = await createCodexEngine(fake).review(ctx);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.args.includes("read-only")));
  assert.ok(calls.every((call) => call.args.includes("--ignore-user-config")));
  assert.ok(calls.every((call) => call.args.includes("--ignore-rules")));
  assert.ok(calls.every((call) => call.args.includes("project_doc_max_bytes=0")));
  assert.ok(calls.every((call) => call.args.includes("project_doc_fallback_filenames=[]")));
  assert.ok(calls.every((call) => call.args.some((arg) => /^projects\..+\.trust_level="untrusted"$/.test(arg))));
  assert.match(calls[0]?.stdin ?? "", /^PEREGRINE_ROLE: breadth-worker/);
  assert.match(calls[1]?.stdin ?? "", /^PEREGRINE_ROLE: investigation-worker/);
  assert.match(calls[1]?.stdin ?? "", /breadth pass produced the ledger/);
  assert.equal(reviewed.engine, "codex");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.usage.inputTokens, 22);
  assert.equal(reviewed.usage.cachedInputTokens, 4);
  assert.equal(reviewed.usage.uncachedInputTokens, 18);
  assert.equal(reviewed.usage.cacheReadInputTokens, 4);
  assert.equal(reviewed.usage.costUsd, undefined);
  const raw = reviewed.raw as { breadth: { model: string; promptSha256: string } };
  assert.equal(raw.breadth.model, context().config.runners.codex.breadthModel);
  assert.equal(raw.breadth.promptSha256, sha256(calls[0]?.stdin ?? ""));
  assert.deepEqual(validatedStages, ["breadth", "investigation"]);
});

test("evaluation prompt validation failures use stable configuration outcomes at both stages", async () => {
  for (const runner of ["claude", "codex"] as const) {
    for (const rejectedStage of ["breadth", "investigation"] as const) {
      let calls = 0;
      const fake: typeof exec = async (_cmd, args) => {
        calls++;
        if (runner === "claude") {
          const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
          return {
            stdout: JSON.stringify({
              structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { findings: [] },
            }),
            stderr: "",
            code: 0,
            timedOut: false,
          };
        }
        const output = args[args.indexOf("--output-last-message") + 1]!;
        writeFileSync(output, JSON.stringify({ ...breadth, model: "gpt-5.6-luna" }));
        return { stdout: "", stderr: "", code: 0, timedOut: false };
      };
      const ctx = context();
      ctx.evaluationIsolation = {
        providerHome: "/tmp/peregrine-test-provider-home",
        providerAssetsRoot: resolve("."),
        validatePrompt({ stage }) {
          if (stage === rejectedStage) throw new Error("forced prompt leak");
        },
      };
      const engine = runner === "claude" ? createClaudeEngine(fake) : createCodexEngine(fake);
      await assert.rejects(
        () => engine.review(ctx),
        (error: unknown) =>
          error instanceof RunFailureError &&
          error.kind === "configuration" &&
          error.message.includes(`evaluation ${rejectedStage} prompt isolation failed`),
      );
      assert.equal(calls, rejectedStage === "breadth" ? 0 : 1);
    }
  }
});

test("production engine invocations retain their original prompts, assets, argv, and environment", async () => {
  const claudeCalls: Array<{ args: string[]; options: Parameters<typeof exec>[2] }> = [];
  const claudeFake: typeof exec = async (_cmd, args, options) => {
    claudeCalls.push({ args, options });
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
    return {
      stdout: JSON.stringify({
        structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { findings: [] },
      }),
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  await createClaudeEngine(claudeFake).review(context());
  assert.equal(claudeCalls.length, 2);
  assert.ok(claudeCalls.every(({ args }) => !args.includes("--bare") && !args.includes("--strict-mcp-config")));
  assert.ok(claudeCalls.every(({ args }) => args[args.indexOf("--plugin-dir") + 1] === resolve(".")));
  assert.ok(claudeCalls.every(({ options }) => JSON.stringify(options?.env) === JSON.stringify(providerEnvironment("claude"))));
  assert.match(claudeCalls[0]?.args[claudeCalls[0].args.indexOf("-p") + 1] ?? "", /^PEREGRINE_ROLE: breadth-worker/);

  const codexCalls: Array<{ args: string[]; stdin?: string; env?: Record<string, string> }> = [];
  const codexFake: typeof exec = async (_cmd, args, options) => {
    codexCalls.push({ args, stdin: options?.stdin, env: options?.env });
    const output = args[args.indexOf("--output-last-message") + 1]!;
    const schema = args[args.indexOf("--output-schema") + 1]!;
    writeFileSync(
      output,
      schema.endsWith("breadth-result.schema.json")
        ? JSON.stringify({ ...breadth, model: "gpt-5.6-luna" })
        : JSON.stringify({ findings: [] }),
    );
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
  await createCodexEngine(codexFake).review(context());
  assert.equal(codexCalls.length, 2);
  assert.ok(codexCalls.every(({ args }) => !args.includes("--ignore-rules")));
  assert.ok(codexCalls.every(({ args }) => !args.includes("project_doc_max_bytes=0")));
  assert.ok(codexCalls.every(({ env }) => JSON.stringify(env) === JSON.stringify(providerEnvironment("codex"))));
  assert.match(codexCalls[0]?.stdin ?? "", /^PEREGRINE_ROLE: breadth-worker/);
});

test("provider process failures are surfaced instead of becoming clean reviews", async () => {
  const fake: typeof exec = async () => ({
    stdout: "",
    stderr: "authentication failed",
    code: 1,
    timedOut: false,
  });
  for (const engine of [createClaudeEngine(fake), createCodexEngine(fake)]) {
    await assert.rejects(
      () => engine.review(context()),
      (error: unknown) =>
        error instanceof RunFailureError &&
        error.kind === "provider" &&
        /authentication failed/.test(error.message),
    );
  }
});

test("provider adapters expose stable timeout failure codes", async () => {
  const fake: typeof exec = async () => ({
    stdout: "",
    stderr: "",
    code: null,
    timedOut: true,
  });
  for (const engine of [createClaudeEngine(fake), createCodexEngine(fake)]) {
    await assert.rejects(
      () => engine.review(context()),
      (error: unknown) => error instanceof RunFailureError && error.kind === "timeout",
    );
  }
});

test("provider adapters expose stable parse failure codes", async () => {
  const fake: typeof exec = async () => ({
    stdout: "not-json",
    stderr: "",
    code: 0,
    timedOut: false,
  });
  for (const engine of [createClaudeEngine(fake), createCodexEngine(fake)]) {
    await assert.rejects(
      () => engine.review(context()),
      (error: unknown) => error instanceof RunFailureError && error.kind === "parse",
    );
  }
});

test("second-stage failures retain already incurred stage usage and cost", async () => {
  let calls = 0;
  const fake: typeof exec = async (_cmd, args) => {
    calls++;
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
    return {
      stdout: JSON.stringify({
        structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { invalid: true },
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 2,
        },
      }),
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  await assert.rejects(
    () => createClaudeEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "parse");
      assert.equal(error.telemetry?.stages.length, 2);
      assert.equal(error.telemetry?.stages[0]?.completed, true);
      assert.equal(error.telemetry?.stages[1]?.completed, false);
      assert.equal(error.telemetry?.usage.costUsd, 0.02);
      assert.equal(error.telemetry?.usage.costSource, "provider");
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("malformed Codex JSONL never becomes trusted provider usage", async () => {
  const fake: typeof exec = async (_cmd, args) => {
    const output = args[args.indexOf("--output-last-message") + 1]!;
    const schema = args[args.indexOf("--output-schema") + 1]!;
    writeFileSync(output, schema.endsWith("breadth-result.schema.json")
      ? JSON.stringify({ ...breadth, model: "gpt-5.6-luna" })
      : JSON.stringify({ findings: [finding] }));
    return {
      stdout: `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 } })}\nmalformed\n`,
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  const reviewed = await createCodexEngine(fake).review(context());
  assert.equal(reviewed.usage.inputTokens, undefined);
  assert.equal(reviewed.usage.outputTokens, undefined);
  assert.equal(reviewed.usage.costUsd, undefined);
  assert.ok(reviewed.usage.promptBytes);
});

test("Codex artifact construction failures retain both completed stages", async () => {
  const maxFindings = Array.from({ length: 20 }, (_, index) => ({
    ...finding,
    startLine: index + 1,
    endLine: index + 1,
    explanation: "e".repeat(8000),
    failurePath: "f".repeat(8000),
  }));
  let calls = 0;
  const fake: typeof exec = async (_cmd, args) => {
    calls++;
    const output = args[args.indexOf("--output-last-message") + 1]!;
    const schema = args[args.indexOf("--output-schema") + 1]!;
    writeFileSync(output, schema.endsWith("breadth-result.schema.json")
      ? JSON.stringify({ ...breadth, model: "gpt-5.6-luna" })
      : JSON.stringify({ findings: maxFindings }));
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

  await assert.rejects(
    () => createCodexEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "parse");
      assert.match(error.message, /raw telemetry exceeds/);
      assert.equal(error.telemetry?.stages.length, 2);
      assert.ok(error.telemetry?.stages.every((stage) => stage.completed));
      assert.equal(error.telemetry?.usage.inputTokens, 22);
      assert.equal(error.telemetry?.usage.outputTokens, 6);
      return true;
    },
  );
  assert.equal(calls, 2);
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
