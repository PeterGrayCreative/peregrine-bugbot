import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  TRUSTED_LOCAL_REVIEW_DEADLINE_MS,
  TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES,
  prepareTrustedLocalReviewPair,
  runTrustedLocalReviewAttempt,
  runTrustedLocalReviewPair,
  type TrustedLocalReviewPairInput,
} from "../eval/trusted-local-review-runner.js";
import type { ExecResult } from "../src/util/exec.js";

const completed = {
  status: "completed",
  limitations: [],
  findings: [{
    file: "src/value.ts",
    startLine: 2,
    endLine: 2,
    explanation: "The new branch reverses the established success condition.",
    impact: "Valid requests are rejected while invalid requests continue.",
    severity: "high",
  }],
};

test("pair fixes model, effort, tools, schema, and scope while isolating A/B prompts", async () => {
  const fixture = createFixture();
  try {
    const calls: Array<{ args: string[]; stdin: string; cwd?: string; home?: string }> = [];
    const sessions: string[] = [];
    const terminals = await runTrustedLocalReviewPair(fixture.input, {
      run: async (_command, args, options) => {
        const home = options?.env?.CODEX_HOME;
        assert.ok(home);
        sessions.push(home);
        assert.equal(readFileSync(join(home, "auth.json"), "utf8"), "test-auth");
        assert.equal(options?.env?.OPENAI_API_KEY, undefined);
        assert.equal(options?.inheritEnv, false);
        assert.equal(options?.timeoutMs, TRUSTED_LOCAL_REVIEW_DEADLINE_MS);
        assert.equal(options?.maximumOutputBytes, TRUSTED_LOCAL_REVIEW_OUTPUT_BYTES);
        calls.push({ args: [...args], stdin: options?.stdin ?? "", cwd: options?.cwd, home });
        return successStream(completed);
      },
    });
    assert.deepEqual(terminals.map((terminal) => terminal.status), ["completed", "completed"]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.args, calls[1]!.args);
    assert.equal(calls[0]!.cwd, fixture.checkout);
    assert.equal(calls[1]!.cwd, fixture.checkout);
    assert.notEqual(calls[0]!.stdin, calls[1]!.stdin);
    assert.match(calls[0]!.stdin, /^Review this change for consequential correctness bugs/);
    assert.doesNotMatch(calls[0]!.stdin, /PEREGRINE_ROLE/);
    assert.match(calls[1]!.stdin, /PEREGRINE_ROLE: investigation-worker/);
    assert.ok(calls[0]!.args.includes("gpt-5.6-sol"));
    assert.ok(calls[0]!.args.includes('model_reasoning_effort="high"'));
    assert.ok(calls[0]!.args.includes("read-only"));
    assert.equal(calls[0]!.args.some((arg) => arg.startsWith("projects.")), false);
    assert.ok(sessions.every((session) => !existsSync(session)));
    for (const arm of ["A", "B"]) {
      const directory = join(fixture.attemptRoot, `case-trusted-${arm}`);
      assert.equal(readFileSync(join(directory, "prompt.txt"), "utf8"), calls[arm === "A" ? 0 : 1]!.stdin);
      assert.deepEqual(JSON.parse(readFileSync(join(directory, "final-findings.json"), "utf8")), completed);
      for (const name of ["prompt.txt", "argv.json", "raw.jsonl", "stderr.txt", "usage.json", "final-findings.json", "terminal.json"]) {
        assert.doesNotMatch(readFileSync(join(directory, name), "utf8"), /test-auth/);
      }
    }
  } finally {
    fixture.cleanup();
  }
});

test("successful JSONL retains normalized CLI usage and exact bounded raw output", async () => {
  const fixture = createFixture();
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const result = successStream(completed);
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, { run: async () => result });
    assert.equal(terminal.status, "completed");
    assert.deepEqual(terminal.usage, {
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    });
    assert.equal(readFileSync(join(attempt.attemptDirectory, "raw.jsonl"), "utf8"), result.stdout);
    assert.deepEqual(JSON.parse(readFileSync(join(attempt.attemptDirectory, "usage.json"), "utf8")), terminal.usage);
  } finally {
    fixture.cleanup();
  }
});

test("timeout retains partial JSONL without manufacturing findings", async () => {
  const fixture = createFixture();
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const partial = `${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n`;
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, {
      run: async () => ({ stdout: partial, stderr: "", code: null, timedOut: true }),
    });
    assert.equal(terminal.status, "timed-out");
    assert.equal(terminal.findingsSha256, null);
    assert.equal(readFileSync(join(attempt.attemptDirectory, "raw.jsonl"), "utf8"), partial);
    assert.equal(existsSync(join(attempt.attemptDirectory, "final-findings.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("process failure retains bounded stderr for diagnosis", async () => {
  const fixture = createFixture();
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, {
      run: async () => ({ stdout: "", stderr: "configuration rejected\n", code: 1, timedOut: false }),
    });
    assert.equal(terminal.status, "process-failed");
    assert.equal(readFileSync(join(attempt.attemptDirectory, "stderr.txt"), "utf8"), "configuration rejected\n");
    assert.match(terminal.stderrSha256, /^[a-f0-9]{64}$/);
    assert.equal(terminal.findingsSha256, null);
  } finally {
    fixture.cleanup();
  }
});

test("malformed successful output fails without losing the raw evidence", async () => {
  const fixture = createFixture();
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const raw = `${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\nnot-json\n`;
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, {
      run: async () => ({ stdout: raw, stderr: "", code: 0, timedOut: false }),
    });
    assert.equal(terminal.status, "malformed-output");
    assert.equal(readFileSync(join(attempt.attemptDirectory, "raw.jsonl"), "utf8"), raw);
    assert.equal(terminal.usage, null);
  } finally {
    fixture.cleanup();
  }
});

test("missing CLI usage remains explicitly null without invalidating findings", async () => {
  const fixture = createFixture();
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, {
      run: async () => successStream(completed, false),
    });
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.usage, null);
    assert.equal(readFileSync(join(attempt.attemptDirectory, "usage.json"), "utf8"), "null\n");
  } finally {
    fixture.cleanup();
  }
});

test("session cleanup failure overrides an otherwise completed attempt", async () => {
  const fixture = createFixture();
  let session = "";
  try {
    const [attempt] = await prepareTrustedLocalReviewPair(fixture.input);
    const terminal = await runTrustedLocalReviewAttempt(fixture.input, attempt, {
      run: async (_command, _args, options) => {
        session = options?.env?.CODEX_HOME ?? "";
        return successStream(completed);
      },
      removeSession: () => undefined,
    });
    assert.equal(terminal.status, "cleanup-failed");
    assert.equal(terminal.cleanupCompleted, false);
    assert.ok(session && existsSync(session));
  } finally {
    if (session) rmSync(session, { recursive: true, force: true });
    fixture.cleanup();
  }
});

function createFixture(): {
  root: string;
  checkout: string;
  attemptRoot: string;
  input: TrustedLocalReviewPairInput;
  cleanup(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "trusted-local-review-test-"));
  const checkout = join(root, "checkout");
  const attemptRoot = join(root, "attempts");
  mkdirSync(join(checkout, "src"), { recursive: true });
  writeFileSync(join(checkout, "src", "value.ts"), "export const value = true;\n");
  const authFile = join(root, "auth.json");
  writeFileSync(authFile, "test-auth", { mode: 0o600 });
  return {
    root,
    checkout,
    attemptRoot,
    input: {
      caseId: "case-trusted",
      checkoutDirectory: checkout,
      authFile,
      attemptRoot,
      activatedLanes: ["logic-correctness"],
      scope: {
        baseRef: "a".repeat(40),
        headRef: "b".repeat(40),
        diff: "diff --git a/src/value.ts b/src/value.ts\n+export const value = false;\n",
        taskSpecification: "Preserve the established boolean behavior.",
        rawChangedPaths: ["src/value.ts"],
      },
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function successStream(value: unknown, includeUsage = true): ExecResult {
  const events: Record<string, unknown>[] = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "message-1", type: "agent_message", text: JSON.stringify(value) } },
    { type: "turn.completed", ...(includeUsage ? { usage: {
      input_tokens: 120,
      cached_input_tokens: 80,
      output_tokens: 30,
      reasoning_output_tokens: 10,
    } } : {}) },
  ];
  return { stdout: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, stderr: "", code: 0, timedOut: false };
}
