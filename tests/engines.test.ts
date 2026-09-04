import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createClaudeEngine } from "../src/engines/claude.js";
import { createCodexEngine } from "../src/engines/codex.js";
import { RunFailureError } from "../src/core/run-failure.js";
import { parseRunRecord } from "../eval/artifacts.js";
import type { PeregrineConfig, ReviewContext, RunRecord, RunnerName } from "../src/types.js";
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

function assertStrictFailureArtifact(runner: RunnerName, error: RunFailureError): void {
  const baseRef = "1".repeat(40);
  const headRef = "2".repeat(40);
  const output = [
    `base: ${baseRef} (argument)`,
    `head: ${headRef}`,
    `merge-base: ${baseRef}`,
    "Changed files",
    "(none)",
    "",
  ].join("\n");
  const record: RunRecord = {
    schemaVersion: 1,
    attemptId: "attempt-prompt-isolation",
    caseName: "development/case-00000001",
    caseKind: "seeded",
    configName: `${runner}-prompt-isolation`,
    repeat: 1,
    caseCorpus: "development",
    runner,
    startedAt: "2026-09-03T00:00:00.000Z",
    finishedAt: "2026-09-03T00:00:10.000Z",
    attemptDurationMs: 10_000,
    evaluationProvenance: {
      history: {
        schemaVersion: 1,
        materialization: "fixture-patch",
        objectFormat: "sha1",
        baseRef,
        headRef,
        mergeBase: baseRef,
        baseTree: "3".repeat(40),
        headTree: "4".repeat(40),
        commitCount: 2,
        baseIsMergeBase: true,
        checkedOutTreeMatchesHead: true,
        treeReproductionVerified: true,
        diffNormalization: "identity-v1",
        diffSha256: "5".repeat(64),
      },
      manifest: {
        entryPoint: "prepareReviewManifest",
        skillName: "invariant-first-pr-review",
        baseRef,
        headRef,
        mergeBase: baseRef,
        outputSha256: sha256(output),
        output,
        profileSource: "none",
        headProfileChanged: false,
      },
    },
    outcome: {
      status: "failed",
      failureKind: error.kind,
      message: error.message,
      durationMs: error.telemetry?.durationMs ?? 1,
      ...(error.telemetry ? { telemetry: error.telemetry } : {}),
    },
  };
  assert.doesNotThrow(() => parseRunRecord(record, `${runner} prompt-isolation failure`));
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
  ctx.config.runners.codex.investigationPromptMode = "method-packet";
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
  assert.match(
    calls[1]?.stdin ?? "",
    /^PEREGRINE_ROLE: investigation-worker\n\n<peregrine-method-core trusted="true"/,
  );
  assert.match(calls[1]?.stdin ?? "", /<peregrine-variable-appendix trusted="false">/);
  assert.doesNotMatch(calls[1]?.stdin ?? "", /Read .*\/SKILL\.md completely/);
  assert.match(calls[1]?.stdin ?? "", /breadth pass produced the ledger/);
  assert.equal(reviewed.engine, "codex");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.usage.inputTokens, 22);
  assert.equal(reviewed.usage.cachedInputTokens, 4);
  assert.equal(reviewed.usage.uncachedInputTokens, 18);
  assert.equal(reviewed.usage.cacheReadInputTokens, 4);
  assert.equal(reviewed.usage.costUsd, undefined);
  const raw = reviewed.raw as {
    breadth: { model: string; promptSha256: string };
    investigation: { methodCoreSha256: string; methodSourceSha256: string };
  };
  assert.equal(raw.breadth.model, context().config.runners.codex.breadthModel);
  assert.equal(raw.breadth.promptSha256, sha256(calls[0]?.stdin ?? ""));
  assert.match(raw.investigation.methodCoreSha256, /^[a-f0-9]{64}$/);
  assert.match(raw.investigation.methodSourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(validatedStages, ["breadth", "investigation"]);
});

test("method-packet compilation fails as a typed configuration outcome before provider work", async () => {
  const assets = mkdtempSync(join(tmpdir(), "peregrine-missing-method-assets-"));
  try {
    for (const runner of ["claude", "codex"] as const) {
      let calls = 0;
      const fake: typeof exec = async () => {
        calls++;
        return { stdout: "", stderr: "", code: 0, timedOut: false };
      };
      const ctx = context();
      ctx.config.runners[runner].investigationPromptMode = "method-packet";
      ctx.evaluationIsolation = {
        providerHome: "/tmp/peregrine-test-provider-home",
        providerAssetsRoot: assets,
        validatePrompt() {},
      };
      const engine = runner === "claude" ? createClaudeEngine(fake) : createCodexEngine(fake);
      await assert.rejects(
        () => engine.review(ctx),
        (error: unknown) => {
          assert.ok(error instanceof RunFailureError);
          assert.equal(error.kind, "configuration");
          assert.match(error.message, /investigator method packet unavailable/);
          assert.equal(error.telemetry, undefined);
          return true;
        },
      );
      assert.equal(calls, 0);
    }
  } finally {
    rmSync(assets, { recursive: true, force: true });
  }
});

test("Codex temporary-output cleanup failures retain completed provider telemetry", async () => {
  const fake: typeof exec = async (_cmd, args) => {
    const output = args[args.indexOf("--output-last-message") + 1]!;
    const schema = args[args.indexOf("--output-schema") + 1]!;
    writeFileSync(
      output,
      schema.endsWith("breadth-result.schema.json")
        ? JSON.stringify({ ...breadth, model: "gpt-5.6-luna" })
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
  await assert.rejects(
    () => createCodexEngine(fake, () => {
      throw new Error("forced temp cleanup failure");
    }).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "configuration");
      assert.match(error.message, /temporary-output cleanup also failed/);
      assert.equal(error.telemetry?.stages.length, 2);
      assert.ok(error.telemetry?.stages.every((stage) => stage.completed));
      assert.equal(error.telemetry?.usage.inputTokens, 22);
      return true;
    },
  );
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
        (error: unknown) => {
          assert.ok(error instanceof RunFailureError);
          assert.equal(error.kind, "configuration");
          assert.match(error.message, new RegExp(`evaluation ${rejectedStage} prompt isolation failed`));
          if (rejectedStage === "breadth") {
            assert.equal(error.telemetry, undefined);
          } else {
            assert.equal(error.telemetry?.stages.length, 1);
            assert.equal(error.telemetry?.stages[0]?.stage, "breadth");
            assert.equal(error.telemetry?.stages[0]?.completed, true);
          }
          assertStrictFailureArtifact(runner, error);
          return true;
        },
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

test("Claude provider failures retain tokens without inventing complete work metrics", async () => {
  const fake: typeof exec = async () => ({
    stdout: JSON.stringify({
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 2,
      },
      messages: [],
    }),
    stderr: "provider failed",
    code: 1,
    timedOut: false,
  });
  await assert.rejects(
    () => createClaudeEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "provider");
      assert.equal(error.telemetry?.usage.inputTokens, 10);
      assert.equal(error.telemetry?.usage.outputTokens, 2);
      assert.equal(error.telemetry?.usage.toolCalls, undefined);
      assert.equal(error.telemetry?.usage.toolCallsByType, undefined);
      assert.equal(error.telemetry?.usage.toolOutputBytes, undefined);
      assertStrictFailureArtifact("claude", error);
      return true;
    },
  );
});

test("Claude code-zero parse failures without lifecycle arrays do not invent zero work", async () => {
  const fake: typeof exec = async () => ({
    stdout: JSON.stringify({
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 2,
      },
      structured_output: { invalid: true },
    }),
    stderr: "",
    code: 0,
    timedOut: false,
  });
  await assert.rejects(
    () => createClaudeEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "parse");
      assert.equal(error.telemetry?.usage.inputTokens, 10);
      assert.equal(error.telemetry?.usage.outputTokens, 2);
      assert.equal(error.telemetry?.usage.toolCalls, undefined);
      assert.equal(error.telemetry?.usage.toolCallsByType, undefined);
      assert.equal(error.telemetry?.usage.toolOutputBytes, undefined);
      assertStrictFailureArtifact("claude", error);
      return true;
    },
  );
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

test("contained timeout cleanup evidence preserves provider classification and observed usage", async () => {
  const fake: typeof exec = async () => ({
    stdout: JSON.stringify({
      usage: { input_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 2, output_tokens: 3 },
      messages: [],
    }),
    stderr: "",
    code: null,
    timedOut: true,
    cleanupErrors: ["force-removing evaluation container failed", "evaluation container survived force-removal"],
  });
  await assert.rejects(
    () => createClaudeEngine(fake).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "timeout");
      assert.equal(error.telemetry?.usage.inputTokens, 13);
      assert.equal(error.telemetry?.usage.outputTokens, 3);
      assert.match(error.message, /containment cleanup failed/);
      assertStrictFailureArtifact("claude", error);
      return true;
    },
  );
});

test("code-zero containment cleanup failures retain incomplete Codex and Claude telemetry", async () => {
  const codexFake: typeof exec = async (_cmd, args) => {
    const output = args[args.indexOf("--output-last-message") + 1]!;
    writeFileSync(output, JSON.stringify({ ...breadth, model: "gpt-5.6-luna" }));
    return {
      stdout: `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 } })}\n`,
      stderr: "", code: 0, timedOut: false,
      cleanupErrors: ["evaluation container survived force-removal"],
    };
  };
  const claudeFake: typeof exec = async () => ({
    stdout: JSON.stringify({
      structured_output: breadth,
      usage: { input_tokens: 11, cache_creation_input_tokens: 0, cache_read_input_tokens: 2, output_tokens: 3 },
      messages: [],
    }),
    stderr: "", code: 0, timedOut: false,
    cleanupErrors: ["evaluation container survived force-removal"],
  });
  for (const [runner, engine] of [["codex", createCodexEngine(codexFake)], ["claude", createClaudeEngine(claudeFake)]] as const) {
    await assert.rejects(() => engine.review(context()), (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "configuration");
      assert.equal(error.telemetry?.usage.inputTokens, runner === "codex" ? 11 : 13);
      assert.equal(error.telemetry?.usage.outputTokens, 3);
      assert.equal(error.telemetry?.stages[0]?.completed, false);
      assert.equal(error.telemetry?.containmentCleanupFailed, true);
      assert.match(error.message, /completed but containment cleanup failed/);
      assertStrictFailureArtifact(runner, error);
      return true;
    });
  }
});

test("code-zero cleanup failure takes precedence over missing Codex provider output", async () => {
  let providerOutputRead = false;
  const fake: typeof exec = async () => ({
    stdout: `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 2, output_tokens: 3 } })}\n`,
    stderr: "", code: 0, timedOut: false,
    cleanupErrors: ["evaluation container survived force-removal"],
  });
  const ctx = context();
  ctx.evaluationIsolation = {
    providerHome: "/tmp/peregrine-test-provider-home",
    providerAssetsRoot: resolve("."),
    providerOutputRoot: resolve("."),
    runProvider: fake,
    readProviderOutput() {
      providerOutputRead = true;
      throw new Error("provider output must not be read after failed cleanup");
    },
    validatePrompt() {},
  };
  await assert.rejects(() => createCodexEngine().review(ctx), (error: unknown) => {
    assert.ok(error instanceof RunFailureError);
    assert.equal(error.kind, "configuration");
    assert.equal(error.telemetry?.usage.inputTokens, 11);
    assert.equal(error.telemetry?.usage.outputTokens, 3);
    assert.equal(error.telemetry?.containmentCleanupFailed, true);
    assert.match(error.message, /completed but containment cleanup failed/);
    assert.doesNotMatch(error.message, /did not write its structured output/);
    return true;
  });
  assert.equal(providerOutputRead, false);
});

test("code-zero cleanup failure takes precedence over invalid Claude provider output", async () => {
  const fake: typeof exec = async () => ({
    stdout: "not-json",
    stderr: "", code: 0, timedOut: false,
    cleanupErrors: ["evaluation container survived force-removal"],
  });
  await assert.rejects(() => createClaudeEngine(fake).review(context()), (error: unknown) => {
    assert.ok(error instanceof RunFailureError);
    assert.equal(error.kind, "configuration");
    assert.equal(error.telemetry?.usage.aggregation, "ambiguous");
    assert.equal(error.telemetry?.usage.inputTokens, undefined);
    assert.equal(error.telemetry?.containmentCleanupFailed, true);
    assert.match(error.message, /completed but containment cleanup failed/);
    assert.doesNotMatch(error.message, /invalid JSON/);
    return true;
  });
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

test("Claude artifact construction failures retain both completed stages", async () => {
  let calls = 0;
  const fake: typeof exec = async (_cmd, args) => {
    calls++;
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]!) as { title?: string };
    return {
      stdout: JSON.stringify({
        structured_output: schema.title === "Peregrine Breadth Sweep" ? breadth : { findings: [finding] },
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
    () => createClaudeEngine(fake, () => {
      throw new Error("artifact construction failed");
    }).review(context()),
    (error: unknown) => {
      assert.ok(error instanceof RunFailureError);
      assert.equal(error.kind, "parse");
      assert.match(error.message, /artifact construction failed/);
      assert.equal(error.telemetry?.stages.length, 2);
      assert.ok(error.telemetry?.stages.every((stage) => stage.completed));
      assert.equal(error.telemetry?.usage.inputTokens, 20);
      assert.equal(error.telemetry?.usage.outputTokens, 4);
      assert.equal(error.telemetry?.usage.costUsd, 0.02);
      assert.equal(error.telemetry?.usage.costSource, "provider");
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
