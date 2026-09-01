import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createClaudeEngine } from "../src/engines/claude.js";
import { createCodexEngine } from "../src/engines/codex.js";
import type { PeregrineConfig, ReviewContext } from "../src/types.js";
import type { exec } from "../src/util/exec.js";

function config(): PeregrineConfig {
  return JSON.parse(readFileSync(resolve("peregrine.config.json"), "utf8")) as PeregrineConfig;
}

function context(): ReviewContext {
  return {
    repoPath: resolve("."),
    diffPath: resolve("eval/cases/seeded-auth-bypass/pr.diff"),
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
  title: "Missing ownership check",
  explanation: "The changed lookup does not scope by owner.",
  failurePath: "Another user supplies the identifier and reads the record.",
  confidence: 0.95,
};

test("Claude runner loads the bundled plugin and validates structured output", async () => {
  let command = "";
  let receivedArgs: string[] = [];
  const fake: typeof exec = async (cmd, args) => {
    command = cmd;
    receivedArgs = args;
    return {
      stdout: JSON.stringify({
        structured_output: { findings: [finding] },
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      stderr: "",
      code: 0,
      timedOut: false,
    };
  };
  const reviewed = await createClaudeEngine(fake).review(context());
  assert.equal(command, "claude");
  assert.ok(receivedArgs.includes("--plugin-dir"));
  assert.ok(receivedArgs.includes("--json-schema"));
  const schema = JSON.parse(receivedArgs[receivedArgs.indexOf("--json-schema") + 1]!) as Record<string, unknown>;
  assert.equal(schema.$schema, undefined);
  assert.ok(receivedArgs.includes("--agents"));
  const agents = JSON.parse(receivedArgs[receivedArgs.indexOf("--agents") + 1]!) as {
    "breadth-worker": { model: string; effort: string };
  };
  assert.deepEqual(
    {
      model: agents["breadth-worker"].model,
      effort: agents["breadth-worker"].effort,
    },
    {
      model: context().config.runners.claude.breadthModel,
      effort: context().config.runners.claude.breadthEffort,
    },
  );
  assert.equal(receivedArgs.includes("--bare"), false);
  assert.equal(reviewed.engine, "claude");
  assert.equal(reviewed.findings.length, 1);
  assert.equal(reviewed.reviewedHeadRef, "head-sha");
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
            candidates: [
              {
                file: "src/app.ts",
                lane: "authorization",
                risk: "ownership",
                counterexample: "other owner",
                evidenceNeeded: "lookup predicate",
              },
            ],
            clearFiles: [],
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
